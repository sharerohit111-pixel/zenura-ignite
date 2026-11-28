"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261128180000_angel_one_login_rate_limit.sql"), "utf8");

test("Angel One login attempt store is server-only and indexed by user/time", () => {
  assert.match(sql, /create table if not exists public\\.angel_one_login_attempts/i);
  assert.match(sql, /user_id uuid not null references auth\\.users\\(id\\)/i);
  assert.match(sql, /on public\\.angel_one_login_attempts\\(user_id, attempted_at desc\\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on public\\.angel_one_login_attempts from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, delete on public\\.angel_one_login_attempts to service_role/i);
});

test("Angel One quota is serialized per user and bounded to five attempts per fifteen minutes", () => {
  assert.match(sql, /pg_advisory_xact_lock\\(hashtextextended\\(p_user_id::text, 0\\)\\)/i);
  assert.match(sql, /attempted_at < p_now - interval '15 minutes'/i);
  assert.match(sql, /v_count >= 5/i);
  assert.match(sql, /v_last > p_now - interval '1 second'/i);
  assert.match(sql, /insert into public\\.angel_one_login_attempts/i);
  assert.match(sql, /grant execute on function public\\.reserve_angel_one_login_attempt\\(uuid,timestamptz\\) to service_role/i);
});
