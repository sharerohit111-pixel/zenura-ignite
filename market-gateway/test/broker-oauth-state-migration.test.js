"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261128173000_broker_oauth_state_nonce_store.sql"), "utf8");

test("broker OAuth state store is isolated and server-only", () => {
  assert.match(sql, /state_hash text primary key/i);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\)/i);
  assert.match(sql, /broker_name in \('upstox','fyers'\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on public\.broker_oauth_states from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.broker_oauth_states to service_role/i);
});

test("OAuth state is atomically consumed once and cannot be consumed for another broker", () => {
  assert.match(sql, /update public\.broker_oauth_states s[\s\S]*?consumed_at is null[\s\S]*?expires_at > p_now[\s\S]*?returning s\.user_id/i);
  assert.match(sql, /s\.broker_name = p_broker_name/i);
  assert.match(sql, /grant execute on function public\.consume_broker_oauth_state\(text,text,timestamptz\) to service_role/i);
  assert.match(sql, /p_expires_at > p_now \+ interval '10 minutes'/i);
});
