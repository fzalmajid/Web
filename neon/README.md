# Ruang Belajar: new Neon database

This is the complete schema for the independent Neon backend. It creates 16 application tables, private AI counters, and the RPCs used by the current UI. The historical Supabase SQL remains unchanged. This initializes a new database; it does not import historical account data or uploaded files.

The deployment runs `node scripts/setup-neon.mjs` before the build. It does nothing unless `NEON_MIGRATE=1`. An opted-in deployment must have `NEON_AUTH_BASE_URL` and `DATABASE_URL_UNPOOLED`, with a direct `.neon.tech` connection. Keep that connection server-only. `DATABASE_URL` stays pooled for application traffic.

The runner refuses any unmarked nonempty application database. It applies all checked-in migrations in one transaction, records normalized SHA-256 checksums in `private.app_migrations`, serializes competing builds with a transaction advisory lock, and verifies RLS, API roles, and private-counter permissions before committing. A failed check stops deployment and rolls back initialization. Do not edit an applied migration; add a new numbered migration.

The Data API must be enabled and use Neon Auth. The app's UUID identifiers are compatible with `auth.uid()`. An existing Neon helper is retained. Before the Data API installs its helper, the migration provides a nullable UUID helper based on `auth.user_id()` or standard PostgREST `request.jwt.claim.sub` / `request.jwt.claims` context; absent or malformed identity returns null. The helper does not validate a bearer token itself: the Data API or a server that verifies JWTs must supply trusted transaction-local claims. No unauthenticated table or RPC access is granted.

The Vercel Marketplace resource used for this release already has Neon Auth and its Data API enabled. On a separately provisioned database, enable both before switching `DATA_BACKEND` and `NEXT_PUBLIC_DATA_BACKEND` to `neondb`. Register each application's HTTPS origin in Neon Auth's trusted domains; the production origin is `https://web-fzalmajid.vercel.app`. Do not replace the app's absolute OAuth callback with a relative path to bypass this check. The shared Google provider is available for initial access; configure an owner-controlled Google OAuth client for production branding and control.

Browser authentication uses the same-origin `/api/auth` cookie proxy. The managed client exchanges the OAuth verifier when Home calls `getSession()`. `/auth/callback` initializes the same client for the provider's iframe/popup flow. No custom verifier exchange or middleware is needed for this client-driven login page. Database access and private file operations still verify a real managed JWT.

Profiles are created by the app's onboarding flow. There are no references or triggers into Supabase `auth.users` or Neon-managed authentication tables. Accepted friendships permit reading folders, ready source files and entries, and recordings. Private chat history, practice tools, embedding indexes, usage counters, and all writes remain account-owned. Composite foreign keys prevent attaching owned rows to another user's parent records. Friendship status changes use guarded RPCs. AI credits retain the shared 400-credit Jakarta-day pool and a transaction advisory lock; private usage rows are available only through authenticated definer RPCs.

To execute the actual SQL tests without adding production dependencies, install the isolated runtime in a scratch directory:

```text
npm install --prefix <scratch-dir> @electric-sql/pglite @electric-sql/pglite-pgvector
NEON_SCHEMA_TEST_RUNTIME=<scratch-dir> node --test neon/tests/schema.test.mjs
```

On PowerShell, set `$env:NEON_SCHEMA_TEST_RUNTIME` to the absolute scratch path before running the test command. These tests execute the full schema on PGlite PostgreSQL with pgvector and verify all table permissions, cross-owner access, accepted/pending friendships, private chat isolation, FSRS duplicate/conflict handling, vector ownership/invalidation, shared credit exhaustion, checksum idempotency, and full rollback. They do not connect to a cloud database or use application credentials.
