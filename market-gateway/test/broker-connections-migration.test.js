"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261128170000_broker_connections_encrypted_credentials.sql"), "utf8");
test("broker connection credentials are encrypted envelopes and server-only", () => {
  assert.match(sql, /access_token_ciphertext jsonb/);
  assert.match(sql, /refresh_token_ciphertext jsonb/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on public\.broker_connections from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.broker_connections to service_role/i);
});
test("broker connections are isolated by user and broker", () => {
  assert.match(sql, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /unique index if not exists broker_connections_user_broker_uq\s+on public\.broker_connections\(user_id, broker_name\)/i);
  assert.match(sql, /broker_name in \('upstox','fyers','angel_one'\)/);
  assert.doesNotMatch(sql, /'dhan'|'zerodha'/);
});
test("credential fields are ciphertext envelopes and never plaintext columns", () => {
  assert.match(sql, /jsonb_typeof\(access_token_ciphertext\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(refresh_token_ciphertext\) = 'object'/);
  assert.doesNotMatch(sql, /\b(access_token|refresh_token)\s+text\b/i);
});
