import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const APP_ID = "ruang-belajar-neon-v1";
export const APP_TABLES = [
  "study_nodes", "source_files", "knowledge_entries", "recordings", "flashcards",
  "flashcard_reviews", "quizzes", "study_tasks", "study_paths", "study_units",
  "ai_conversations", "ai_messages", "knowledge_vector_chunks", "knowledge_vector_state",
  "user_profiles", "friend_connections",
];

export function migrationConnection(env) {
  if (env.NEON_MIGRATE !== "1") return null;
  if (!env.NEON_AUTH_BASE_URL) throw new Error("Neon Auth configuration is required for migration.");
  if (env.NEXT_PUBLIC_DATA_BACKEND && env.NEXT_PUBLIC_DATA_BACKEND !== "neondb") {
    throw new Error("Migration is restricted to the Neon application backend.");
  }
  if (!env.DATABASE_URL_UNPOOLED) throw new Error("A direct Neon migration connection is required.");
  let url;
  try { url = new URL(env.DATABASE_URL_UNPOOLED); }
  catch { throw new Error("The migration connection is invalid."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech") || url.hostname.includes("-pooler.")) {
    throw new Error("Migration is restricted to a direct Neon database connection.");
  }
  return env.DATABASE_URL_UNPOOLED;
}

export async function loadMigrations(directory = new URL("../neon/migrations/", import.meta.url)) {
  const names = (await readdir(directory)).filter(name => /^\d{4}_[a-z_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No application migrations were found.");
  return Promise.all(names.map(async name => {
    const sql = (await readFile(new URL(name, directory), "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
}

export async function verifySchema(client) {
  const tables = (await client.query(`
    select c.relname, c.relrowsecurity,
      has_table_privilege('anonymous',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anonymous_access,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
      has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
      exists(select 1 from pg_policy p where p.polrelid=c.oid) as has_policy
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname=any($1::text[])`, [APP_TABLES])).rows;
  if (tables.length !== APP_TABLES.length || tables.some(table =>
    !table.relrowsecurity || !table.has_policy || !table.authenticated_read || table.anonymous_access || table.anon_access)) {
    throw new Error("Application table security verification failed.");
  }
  const roles = (await client.query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('authenticated','anonymous','anon')")).rows;
  if (roles.length !== 3 || roles.some(role => role.rolsuper || role.rolbypassrls)) {
    throw new Error("API role security verification failed.");
  }
  const privateAccess = (await client.query(`
    select exists(
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relkind='r' and
        (has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or
         has_table_privilege('anonymous',c.oid,'SELECT,INSERT,UPDATE,DELETE') or
         has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
    ) as exposed`)).rows[0]?.exposed;
  if (privateAccess) throw new Error("Private application table verification failed.");
  const rpcAccess = (await client.query(`
    select p.proname,p.prosecdef,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as callable,
      has_function_privilege('anonymous',p.oid,'EXECUTE') as anonymous_access,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_access
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('consume_ai_credits','get_ai_usage_today','record_ai_model_usage','get_ai_model_usage_today')`)).rows;
  if (rpcAccess.length !== 4 || rpcAccess.some(rpc => !rpc.prosecdef || !rpc.callable || rpc.anonymous_access || rpc.anon_access)) {
    throw new Error("AI usage RPC security verification failed.");
  }
}

// One transaction prevents a partially created schema or half-installed grants.
// The database-wide advisory lock serializes concurrent preview/production builds.
export async function applyMigrations(client, migrations) {
  migrations ??= await loadMigrations();
  let phase = "preflight";
  await client.query("begin");
  try {
    await client.query("set local statement_timeout='120s'");
    await client.query("set local lock_timeout='30s'");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [APP_ID + ":migrations"]);
    const marker = (await client.query("select to_regclass('private.app_migrations') is not null as present")).rows[0]?.present;
    if (!marker) {
      const existing = (await client.query(`
        select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','f')
            and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')) as present`)).rows[0]?.present;
      if (existing) throw new Error("Refusing to initialize an unmarked nonempty database.");
      await client.query(`
        create schema if not exists private;
        create table private.app_migrations (
          app_id text not null, version text primary key,
          checksum text not null check(length(checksum)=64), applied_at timestamptz not null default now()
        );
        alter table private.app_migrations enable row level security;
        revoke all on schema private from public;
        revoke all on private.app_migrations from public;
      `);
    }
    const applied = (await client.query("select app_id,version,checksum from private.app_migrations order by version")).rows;
    if (applied.some(row => row.app_id !== APP_ID || !migrations.some(m => m.name === row.version && m.checksum === row.checksum))) {
      throw new Error("Migration history does not match this application's checked-in schema.");
    }
    let count = 0;
    for (const migration of migrations) {
      if (applied.some(row => row.version === migration.name)) continue;
      phase = migration.name;
      await client.query(migration.sql);
      await client.query("insert into private.app_migrations(app_id,version,checksum) values($1,$2,$3)", [APP_ID,migration.name,migration.checksum]);
      count++;
    }
    phase = "security-verification";
    await verifySchema(client);
    await client.query("commit");
    return count;
  } catch (error) {
    await client.query("rollback");
    error.neonMigrationPhase = phase;
    throw error;
  }
}

async function main() {
  // Do not load a driver or inspect credentials unless the deployment explicitly
  // opted in. Ordinary local builds and the legacy Supabase backend stay inert.
  const connectionString = migrationConnection(process.env);
  if (!connectionString) {
    console.log("Neon schema setup skipped (migration switch is off).");
    return;
  }
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  neonConfig.webSocketConstructor = globalThis.WebSocket ?? (await import("undici")).WebSocket;
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 20000 });
  let client;
  try {
    client = await pool.connect();
    const count = await applyMigrations(client);
    console.log(`Neon application schema verified (${count} migrations applied).`);
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    // Database errors can contain credentials, SQL text, or user values. Log
    // only a validated SQLSTATE, never the raw error, URL, or environment.
    const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : "";
    const phase = typeof error?.neonMigrationPhase === "string" && /^[a-z0-9_.-]+$/.test(error.neonMigrationPhase) ? " [" + error.neonMigrationPhase + "]" : "";
    console.error("Neon application schema setup failed" + code + phase + ". Deployment stopped; review configuration and migration checks.");
    process.exitCode = 1;
  });
}
