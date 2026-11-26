"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const connector=fs.readFileSync(path.join(__dirname,"connect.js"),"utf8");
const workspace=fs.readFileSync(path.join(__dirname,"order-workspace.js"),"utf8");
const client=fs.readFileSync(path.join(__dirname,"supabase-client.js"),"utf8");
const serviceWorker=fs.readFileSync(path.join(root,"markets/service-worker.js"),"utf8");
const rls=fs.readFileSync(path.join(root,"supabase/migrations/20261122120654_paper_trading_core_schema.sql"),"utf8");
const rlsTest=fs.readFileSync(path.join(root,"supabase/tests/rls_permissions.sql"),"utf8");

test("auth transitions publish previous and current user identities for account-bound UI reset",()=>{
  assert.match(connector,/const previousUserId = currentSession\?\.user\?\.id \|\| null/);
  assert.match(connector,/userId,\s*previousUserId,\s*identityChanged: previousUserId !== userId/);
  assert.match(connector,/authEvent,\s*sequence/);
  assert.match(workspace,/window\.addEventListener\('zenura-market-auth-ready'/);
  assert.match(workspace,/requestSeq\+\+; balanceRequest\+\+;/);
  assert.match(workspace,/currentOrders = \[\]; nextCursor = null; hasMore = false;/);
  assert.match(workspace,/\[cashAvailable,cashReserved,sharesAvailable,sharesReserved\]\.forEach\(el => \{ el\.textContent = '—'; \}\)/);
});

test("stale auth refreshes and responses cannot overwrite a newer session state",()=>{
  assert.match(connector,/const session = await sessionSnapshot\(\)\.catch\(\(\) => null\);\s*if \(sequence !== authStateSequence\) return;/);
  assert.match(connector,/const requestAuthSequence = authStateSequence/);
  assert.match(connector,/requestAuthSequence !== authStateSequence/);
  assert.match(connector,/const requestUserId = session\.user\.id/);
  assert.match(connector,/const latestSession = await sessionSnapshot\(\)\.catch\(\(\) => null\);\s*if \(requestAuthSequence !== authStateSequence \|\| latestSession\?\.user\?\.id !== requestUserId\)/);
});

test("Supabase browser client contains only a publishable key and persistent Auth session config",()=>{
  assert.match(client,/sb_publishable_/);
  assert.doesNotMatch(client,/service_role|serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY/i);
  assert.match(client,/persistSession: true/);
  assert.match(client,/flowType: "pkce"/);
});

test("private trading API requests are excluded from Service Worker caches",()=>{
  assert.match(serviceWorker,/request\.headers\.has\("authorization"\)\)return/);
  assert.match(connector,/cache: "no-store"/);
});

test("RLS migration enables row security and restricts visible rows to auth.uid ownership",()=>{
  for(const table of ["paper_accounts","paper_equity_positions","paper_derivative_positions","paper_orders","paper_derivative_orders","paper_watchlists"]){
    assert.match(rls,new RegExp("alter table public\\."+table+" enable row level security"));
    assert.match(rls,new RegExp("auth\\.uid\\(\\)\\) = user_id"));
  }
  assert.match(rlsTest,/Missing authenticated owner-scoped SELECT policy for public\.%/);
  assert.match(rlsTest,/Cross-user watchlist update unexpectedly changed a row/);
});
