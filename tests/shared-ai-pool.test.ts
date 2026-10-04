import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAiCredits, aiQuotaError } from "../lib/aiQuota";

test("a heavy user's allowance follows remaining shared pool, not personal usage", async () => {
  const supabase = { rpc: async () => ({ data: {
    used: 320, limit: 400, remaining: 41, fair_share: 400,
    active_accounts: 2, pool_total: 400, pool_used: 359, pool_remaining: 41,
  }, error: null }) } as any;
  const usage = await checkAiCredits(supabase, "ask_web", "medium");
  assert.equal(usage.allowed, true);
  assert.equal(usage.remaining, 41);
  assert.equal(usage.used, 320);
  const error = aiQuotaError({ ...usage, allowed: false, remaining: 0 });
  assert.match(error.error, /Pool bersama seluruh akun/);
  assert.doesNotMatch(error.error, /Pembagian sementara|2 akun aktif|Gemini aktual/);
});

test("SQL pool policy keeps authentication and serialization without personal caps", () => {
  const sql = readFileSync("supabase/sql/shared_ai_credit_pool.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /Authentication required/);
  assert.match(sql, /if v_cost>v_pool_remaining then/);
  assert.doesNotMatch(sql, /if v_cost>v_user_remaining|floor\(v_pool_total/);
  assert.match(sql, /'remaining', greatest\(v_pool_total-v_total_used,0\)/);
  assert.match(sql, /'remaining',v_pool_remaining/);
});
