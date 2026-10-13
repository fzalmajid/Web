import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyMigrations, loadMigrations, migrationConnection, APP_TABLES } from "../../scripts/setup-neon.mjs";

// The optional isolated test runtime keeps production dependencies unchanged.
// npm install --prefix <scratch-dir> @electric-sql/pglite @electric-sql/pglite-pgvector
// NEON_SCHEMA_TEST_RUNTIME=<scratch-dir> node --test neon/tests/schema.test.mjs
const requireTest = process.env.NEON_SCHEMA_TEST_RUNTIME
  ? createRequire(resolve(process.env.NEON_SCHEMA_TEST_RUNTIME,"package.json")) : createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(requireTest.resolve("@electric-sql/pglite")).href);
const { vector } = await import(pathToFileURL(requireTest.resolve("@electric-sql/pglite-pgvector")).href);
const migrations = await loadMigrations();

async function database() {
  const pg = new PGlite({ extensions: { vector } });
  await pg.waitReady;
  const client = { query: async (sql,params) => params?.length ? pg.query(sql,params) : (await pg.exec(sql)).at(-1) ?? { rows:[] } };
  return { pg, client };
}
const a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222", c="33333333-3333-4333-8333-333333333333";
async function asUser(pg,id,fn) {
  await pg.exec("begin; set local role authenticated;");
  await pg.query("select set_config('request.jwt.claim.sub',$1,true)",[id??""]);
  try { const result=await fn(); await pg.exec("commit;"); return result; }
  catch(error) { await pg.exec("rollback;"); throw error; }
}
async function scalar(pg,sql,params=[]) { return Object.values((await pg.query(sql,params)).rows[0]??{})[0]; }

test("migration switch is inert and only a direct Neon connection can opt in", () => {
  assert.equal(migrationConnection({DATABASE_URL_UNPOOLED:"broken"}),null);
  assert.throws(()=>migrationConnection({NEON_MIGRATE:"1"}),/Auth configuration/);
  const env={NEON_MIGRATE:"1",NEON_AUTH_BASE_URL:"https://example.neon.tech/auth",DATABASE_URL_UNPOOLED:"postgresql://user:secret@ep-example.us-east-1.aws.neon.tech/neondb"};
  assert.equal(migrationConnection(env),env.DATABASE_URL_UNPOOLED);
  assert.throws(()=>migrationConnection({...env,DATABASE_URL_UNPOOLED:"postgresql://user:secret@legacy.supabase.co/postgres"}),/direct Neon/);
  assert.throws(()=>migrationConnection({...env,DATABASE_URL_UNPOOLED:"postgresql://user:secret@ep-example-pooler.us-east-1.aws.neon.tech/neondb"}),/direct Neon/);
  assert.throws(()=>migrationConnection({...env,NEXT_PUBLIC_DATA_BACKEND:"supabase"}),/Neon application/);
});

test("actual SQL initializes 16 tables, is idempotent, and enforces RLS and RPC behavior", async () => {
  const {pg,client}=await database();
  try {
    assert.equal(await applyMigrations(client,migrations),5);
    assert.equal(await applyMigrations(client,migrations),0);
    assert.equal(await scalar(pg,"select count(*)::int from pg_tables where schemaname='public'"),APP_TABLES.length);
    assert.equal(await asUser(pg,null,()=>scalar(pg,"select auth.uid()")),null);
    assert.equal(await asUser(pg,"invalid-id",()=>scalar(pg,"select auth.uid()")),null);
    assert.equal(await asUser(pg,null,async()=>{
      await pg.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a})]);
      return scalar(pg,"select auth.uid()");
    }),a);
    for(const [id,name] of [[a,"alice"],[b,"bob"],[c,"carol"]]) {
      await asUser(pg,id,()=>pg.query("insert into public.user_profiles(user_id,username) values($1,$2)",[id,name]));
    }
    const nodes={};
    for(const [id,title] of [[a,"A"],[b,"B"],[c,"C"]]) nodes[id]=await asUser(pg,id,()=>scalar(pg,"insert into public.study_nodes(user_id,title) values($1,$2) returning id",[id,title]));
    await assert.rejects(asUser(pg,a,()=>pg.query("insert into public.study_nodes(user_id,title) values($1,'forged')",[b])),{code:"42501"});
    await assert.rejects(asUser(pg,a,()=>pg.query("insert into public.source_files(user_id,node_id,file_path,file_name) values($1,$2,'x','x')",[a,nodes[b]])),{code:"23503"});
    const file=await asUser(pg,b,()=>scalar(pg,"insert into public.source_files(user_id,node_id,file_path,file_name,processing_status) values($1,$2,'bob/book','Book','ready') returning id",[b,nodes[b]]));
    const pendingFile=await asUser(pg,b,()=>scalar(pg,"insert into public.source_files(user_id,node_id,file_path,file_name) values($1,$2,'bob/pending','Pending') returning id",[b,nodes[b]]));
    const entry=await asUser(pg,b,()=>scalar(pg,"insert into public.knowledge_entries(user_id,node_id,source_file_id,title,content) values($1,$2,$3,'Book','paracetamol formulation '||repeat('example ',20)) returning id",[b,nodes[b],file]));
    await asUser(pg,b,()=>pg.query("insert into public.knowledge_entries(user_id,node_id,source_file_id,title,content) values($1,$2,$3,'Pending','paracetamol secret '||repeat('example ',20))",[b,nodes[b],pendingFile]));
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.study_nodes")),1);
    const request=await asUser(pg,a,()=>pg.query("select * from public.send_friend_request($1)",[b]));
    assert.equal(request.rows[0].connection_status,"pending");
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.knowledge_entries")),0);
    await assert.rejects(asUser(pg,a,()=>pg.query("update public.friend_connections set status='accepted' where id=$1",[request.rows[0].connection_id])),{code:"42501"});
    assert.equal(await asUser(pg,b,()=>scalar(pg,"select public.respond_friend_request($1,true)",[request.rows[0].connection_id])),"accepted");
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.study_nodes")),2);
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.source_files")),1);
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.knowledge_entries")),1);
    assert.equal(await asUser(pg,c,()=>scalar(pg,"select count(*)::int from public.knowledge_entries")),0);
    assert.equal((await asUser(pg,a,()=>pg.query("update public.study_nodes set title='hacked' where id=$1 returning id",[nodes[b]]))).rows.length,0);
    assert.equal((await asUser(pg,a,()=>pg.query("delete from public.source_files where id=$1 returning id",[file]))).rows.length,0);
    assert.equal((await asUser(pg,a,()=>pg.query("select * from public.get_shared_reference($1)",[b]))).rows.length,1);
    assert.equal((await asUser(pg,c,()=>pg.query("select * from public.get_shared_reference($1)",[b]))).rows.length,0);
    assert.equal((await asUser(pg,b,()=>pg.query("select * from public.search_knowledge('paracetamol')"))).rows.length,2);
    assert.equal(await asUser(pg,b,()=>scalar(pg,"select public.count_pending_knowledge_embeddings('intfloat/multilingual-e5-small')")),1);
    assert.equal(await asUser(pg,b,()=>scalar(pg,"select public.count_pending_knowledge_embeddings_scoped('intfloat/multilingual-e5-small',$1)",[nodes[b]])),1);
    await asUser(pg,b,()=>pg.query("insert into public.recordings(user_id,node_id,title,file_path) values($1,$2,'Audio','bob/audio')",[b,nodes[b]]));
    const card=await asUser(pg,b,()=>scalar(pg,"insert into public.flashcards(user_id,scope_node_id,front,back) values($1,$2,'Q','A') returning id",[b,nodes[b]]));
    await asUser(pg,b,()=>pg.query("insert into public.quizzes(user_id,scope_node_id,question) values($1,$2,'Q')",[b,nodes[b]]));
    await asUser(pg,b,()=>pg.query("insert into public.study_tasks(user_id,node_id,task_type) values($1,$2,'todo')",[b,nodes[b]]));
    const path=await asUser(pg,b,()=>scalar(pg,"insert into public.study_paths(user_id,node_id,title) values($1,$2,'Path') returning id",[b,nodes[b]]));
    await asUser(pg,b,()=>pg.query("insert into public.study_units(user_id,study_path_id,title) values($1,$2,'Unit')",[b,path]));
    const at=new Date(),due=new Date(at.getTime()+86400000),review="44444444-4444-4444-8444-444444444444";
    const schedule={fsrs_due:due.toISOString(),fsrs_stability:1,fsrs_difficulty:5,fsrs_elapsed_days:0,fsrs_scheduled_days:1,fsrs_learning_steps:0,fsrs_reps:1,fsrs_lapses:0,fsrs_state:2,fsrs_last_review:at.toISOString()};
    const syncArgs=[review,card,at.toISOString(),JSON.stringify(schedule)];
    assert.equal(await asUser(pg,b,()=>scalar(pg,"select public.sync_learning_review($1,$2,null,3,$3,$4::jsonb)",syncArgs)),"ok");
    assert.equal(await asUser(pg,b,()=>scalar(pg,"select public.sync_learning_review($1,$2,null,3,$3,$4::jsonb)",syncArgs)),"duplicate");
    assert.equal(await asUser(pg,b,()=>scalar(pg,"select public.sync_learning_review('55555555-5555-4555-8555-555555555555',$1,null,3,$2,$3::jsonb)",[card,at.toISOString(),JSON.stringify(schedule)])),"conflict");
    await assert.rejects(asUser(pg,a,()=>pg.query("select public.sync_learning_review($1,$2,null,3,$3,$4::jsonb)",syncArgs)),/Card unavailable/);
    const conversation=await asUser(pg,b,()=>scalar(pg,"insert into public.ai_conversations(user_id,title) values($1,'Private') returning id",[b]));
    await asUser(pg,b,()=>pg.query("insert into public.ai_messages(user_id,conversation_id,role,content) values($1,$2,'user','Private chat')",[b,conversation]));
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.ai_messages")),0);
    await assert.rejects(asUser(pg,a,()=>pg.query("insert into public.ai_messages(user_id,conversation_id,role,content) values($1,$2,'user','hacked')",[a,conversation])),{code:"23503"});

    // All 16 tables block unauthenticated reads, even in authenticated role.
    for(const table of APP_TABLES) assert.equal(await asUser(pg,null,()=>scalar(pg,`select count(*)::int from public.${table}`)),0,table);
    for(const role of ["anonymous","anon"]) {
      await pg.exec(`begin; set local role ${role}`);
      await assert.rejects(pg.query("select * from public.user_profiles"),{code:"42501"});
      await pg.exec("rollback");
    }
    await assert.rejects(asUser(pg,a,()=>pg.query("select * from private.ai_daily_usage")),{code:"42501"});
    await assert.rejects(asUser(pg,null,()=>pg.query("select public.consume_ai_credits('ask')")),/Authentication required/);
    const u=await asUser(pg,a,()=>scalar(pg,"select public.consume_ai_credits('ask','high')"));
    assert.equal(u.cost,4); assert.equal(u.pool_remaining,396);
    await asUser(pg,a,()=>pg.query("select public.record_ai_model_usage('shared-api-key|gemini-test',10,5,2,17)"));
    const usage=await asUser(pg,a,()=>scalar(pg,"select public.get_ai_usage_today()"));
    assert.equal(usage.total_tokens,17); assert.equal(usage.used,4);
    const other=await asUser(pg,b,()=>scalar(pg,"select public.get_ai_usage_today()"));
    assert.equal(other.total_tokens,0); assert.equal(other.pool_used,4);
    assert.equal((await asUser(pg,b,()=>pg.query("select * from public.get_ai_model_usage_today()"))).rows.length,0);
    // The shared pool cannot be exceeded; rejection leaves counters unchanged.
    await pg.query("update private.ai_daily_usage set credits_used=399 where user_id=$1",[a]);
    const denied=await asUser(pg,b,()=>scalar(pg,"select public.consume_ai_credits('study','instant')"));
    assert.equal(denied.allowed,false); assert.equal(denied.pool_used,399);
    const last=await asUser(pg,b,()=>scalar(pg,"select public.consume_ai_credits('ask','instant')"));
    assert.equal(last.allowed,true); assert.equal(last.pool_used,400);
    assert.equal((await asUser(pg,c,()=>scalar(pg,"select public.consume_ai_credits('ask','instant')"))).allowed,false);

    // Vector query executes pgvector against the same schema, filtered by model.
    const embedding=Array(384).fill(0); embedding[0]=1;
    const timestamp=await asUser(pg,b,()=>scalar(pg,"select updated_at from public.knowledge_entries where id=$1",[entry]));
    await asUser(pg,b,()=>pg.query("insert into public.knowledge_vector_chunks(user_id,entry_id,node_id,source_file_id,chunk_index,snippet,model,embedding,entry_updated_at) values($1,$2,$3,$4,0,'indexed text','intfloat/multilingual-e5-small',$5::vector,$6)",[b,entry,nodes[b],file,JSON.stringify(embedding),timestamp]));
    await asUser(pg,b,()=>pg.query("insert into public.knowledge_vector_state(user_id,entry_id,model,entry_updated_at,complete) values($1,$2,'intfloat/multilingual-e5-small',$3,true)",[b,entry,timestamp]));
    for(const table of ["flashcards","flashcard_reviews","quizzes","study_tasks","study_paths","study_units","ai_conversations","ai_messages","knowledge_vector_chunks","knowledge_vector_state"]) {
      assert.equal(await asUser(pg,b,()=>scalar(pg,`select count(*)::int from public.${table}`)),1,table+" owner");
      assert.equal(await asUser(pg,a,()=>scalar(pg,`select count(*)::int from public.${table}`)),0,table+" accepted friend");
      assert.equal(await asUser(pg,c,()=>scalar(pg,`select count(*)::int from public.${table}`)),0,table+" stranger");
    }
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.recordings")),1);
    assert.equal(await asUser(pg,c,()=>scalar(pg,"select count(*)::int from public.recordings")),0);
    assert.equal(await asUser(pg,c,()=>scalar(pg,"select count(*)::int from public.friend_connections")),0);
    assert.equal(await asUser(pg,c,()=>scalar(pg,"select count(*)::int from public.user_profiles")),3);
    const matches=await asUser(pg,b,()=>pg.query("select * from public.match_knowledge_vectors($1,'intfloat/multilingual-e5-small')",[embedding]));
    assert.equal(matches.rows.length,1);
    assert.equal((await asUser(pg,a,()=>pg.query("select * from public.match_knowledge_vectors($1,'intfloat/multilingual-e5-small')",[embedding]))).rows.length,0);
    await asUser(pg,b,()=>pg.query("update public.knowledge_entries set content='changed' where id=$1",[entry]));
    assert.equal((await asUser(pg,b,()=>pg.query("select * from public.match_knowledge_vectors($1,'intfloat/multilingual-e5-small')",[embedding]))).rows.length,0);
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select public.remove_friend($1)",[b])),true);
    assert.equal(await asUser(pg,a,()=>scalar(pg,"select count(*)::int from public.knowledge_entries")),0);
  } finally { await pg.close(); }
});

test("unmarked existing databases and changed checksums are rejected without changes",async()=>{
  const first=await database();
  try {
    await first.pg.exec("create table public.existing_data(id int)");
    await assert.rejects(applyMigrations(first.client,migrations),/unmarked nonempty/);
    assert.equal(await scalar(first.pg,"select to_regclass('private.app_migrations')"),null);
  } finally { await first.pg.close(); }
  const second=await database();
  try {
    await applyMigrations(second.client,migrations);
    await assert.rejects(applyMigrations(second.client,migrations.map((m,i)=>i?m:{...m,checksum:"0".repeat(64)})),/history does not match/);
    assert.equal(await scalar(second.pg,"select count(*)::int from private.app_migrations"),5);
  } finally { await second.pg.close(); }
});

test("SQL failure rolls back the entire initialization and existing auth helper is retained",async()=>{
  const first=await database();
  try {
    await assert.rejects(applyMigrations(first.client,[...migrations,{name:"0006_bad.sql",checksum:"0".repeat(64),sql:"select * from public.missing_relation"}]),{code:"42P01"});
    assert.equal(await scalar(first.pg,"select to_regclass('public.study_nodes')"),null);
    assert.equal(await scalar(first.pg,"select to_regclass('private.app_migrations')"),null);
  } finally { await first.pg.close(); }
  const second=await database();
  try {
    await second.pg.exec("create schema auth; create function auth.uid() returns uuid language sql stable as 'select null::uuid'");
    const original=await scalar(second.pg,"select pg_get_functiondef('auth.uid()'::regprocedure)");
    await applyMigrations(second.client,migrations);
    assert.equal(await scalar(second.pg,"select pg_get_functiondef('auth.uid()'::regprocedure)"),original);
  } finally { await second.pg.close(); }
});
