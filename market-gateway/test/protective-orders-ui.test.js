"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const html=fs.readFileSync(path.join(root,"markets/stocks/index.html"),"utf8");
const source=fs.readFileSync(path.join(root,"markets/stocks/protective-orders.js"),"utf8");
const gateway=fs.readFileSync(path.join(__dirname,"../supabase-server.js"),"utf8");

test("stock terminal loads the isolated protective-order module and its controls",()=>{
  assert.match(html,/<script src="\.\/protective-orders\.js"><\/script>/);
  for(const id of ["paper-protective-type","paper-protective-price","paper-protective-create",
    "paper-protective-status","paper-protective-refresh","paper-protective-list-status","paper-protective-orders-body"])
    assert.match(html,new RegExp('id="'+id+'"'));
});

test("protective-order UI calls only authenticated server-side paper endpoints",()=>{
  assert.match(source,/ZENURA_MARKET_CONNECTOR/);
  assert.match(source,/\/paper\/protective-orders\?limit=50/);
  assert.match(source,/gateway\+'\/paper\/protective-orders'/);
  assert.match(source,/\/paper\/protective-orders\/'\+encodeURIComponent\(orderId\)\+'\/cancel'/);
  assert.match(source,/Authorization:'Bearer '\+token/);
  assert.match(gateway,/create_paper_equity_protective_order/);
  assert.match(gateway,/cancel_paper_protective_order/);
  assert.match(gateway,/instrument_type==="EQ"&&\["NSE_EQ","BSE_EQ"\]\.includes\(item\.segment\)/);
});

test("protective-order creation fails closed unless the server reports its worker enabled",()=>{
  assert.match(source,/data\.workerEnabled===true/);
  assert.match(source,/if \(!userId \|\| !gateway\)/);
  assert.match(source,/if \(!instrument\)/);
  assert.match(source,/if \(submitting \|\| !workerEnabled\) return/);
  assert.match(gateway,/if\(!paperProtectiveWorkerStatus\.enabled\)return res\.status\(503\)/);
});

test("uncertain create responses retain the same idempotency key and exact payload fingerprint",()=>{
  assert.match(source,/crypto\.randomUUID\(\)/);
  assert.match(source,/localStorage\.setItem\(retryKey\(userId\),JSON\.stringify\(value\)\)/);
  assert.match(source,/pending\.fingerprint!==fingerprint/);
  assert.match(source,/order_id:pending\.orderId/);
  assert.match(source,/if \(response\.status>=400 && response\.status<500\) clearPending\(userId\)/);
});

test("protective order rendering uses text nodes and account transitions invalidate prior requests",()=>{
  assert.match(source,/el\.textContent=String\(value \?\? '—'\)/);
  assert.doesNotMatch(source,/\.innerHTML\s*=/);
  assert.match(source,/requestSequence\+\+/);
  assert.match(source,/event\.detail\?\.signedIn/);
  assert.match(source,/render\(\[\]\)/);
});

test("new protective-order module is included in the gateway syntax-check command",()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,"../package.json"),"utf8"));
  assert.match(pkg.scripts.check,/protective-orders\.js/);
});


test("active protective orders expose owner-scoped modification without weakening worker gates",()=>{
  assert.match(source,/modify_paper_equity_protective_order/);
  assert.match(source,/method:'PUT'/);
  assert.match(source,/status==='ACTIVE'/);
  assert.match(gateway,/app\.put\("\/paper\/protective-orders\/:orderId"/);
  assert.match(gateway,/userDb\.rpc\("modify_paper_equity_protective_order"/);
  assert.match(gateway,/p_protective_order_id:orderId,p_user_id:user\.id/);
  assert.match(source,/Protective order modified\./);
});

test("protective modification RPC preserves share reservations and serializes against fills",()=>{
  const migration=fs.readFileSync(path.join(root,"supabase/migrations/20261127110000_modify_equity_protective_order_rpc.sql"),"utf8");
  assert.match(migration,/security definer/);
  assert.match(migration,/auth\.uid\(\) is distinct from p_user_id/);
  assert.match(migration,/for update/);
  assert.match(migration,/v_order\.status<>'ACTIVE'/);
  assert.match(migration,/v_position\.quantity-v_position\.reserved_quantity<v_quantity_delta/);
  assert.match(migration,/reserved_quantity=reserved_quantity\+v_quantity_delta/);
  assert.match(migration,/trigger_direction=v_direction/);
  assert.match(migration,/grant execute on function public\.modify_paper_equity_protective_order/);
});
