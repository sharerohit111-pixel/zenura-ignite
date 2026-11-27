"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const pkg=require(path.join(root,"package.json"));
const docker=fs.readFileSync(path.join(root,"Dockerfile"),"utf8");
const server=fs.readFileSync(path.join(root,"supabase-server.js"),"utf8");
const client=fs.readFileSync(path.join(root,"../markets/stocks/supabase-client.js"),"utf8");
const deploy=fs.readFileSync(path.join(root,"DEPLOYMENT.md"),"utf8");
const deployWorkflow=fs.readFileSync(path.join(root,"../.github/workflows/deploy-supabase-market-gateway.yml"),"utf8");
const marketDataCompliance=fs.readFileSync(path.join(root,"MARKET-DATA-COMPLIANCE.md"),"utf8");
const tradingPage=fs.readFileSync(path.join(root,"../markets/stocks/index.html"),"utf8");
const workflow=fs.readFileSync(path.join(root,"../.github/workflows/deploy-supabase-market-gateway.yml"),"utf8");
test("Cloud Run and npm default entrypoints run the Supabase-native gateway",()=>{
 assert.equal(pkg.main,"supabase-server.js");
 assert.equal(pkg.scripts.start,"node supabase-server.js");
 assert.match(docker,/CMD\s+\["node","supabase-server\.js"\]/);
 assert.match(server,/createSupabaseRuntime/);
 assert.match(server,/authProvider:"supabase"/);
});
test("Firebase-only legacy packages are excluded from production dependencies",()=>{
 for(const name of Object.keys(pkg.dependencies||{}))assert.doesNotMatch(name,/firebase|firestore/i);
 assert.ok(pkg.devDependencies["firebase-admin"]);
 assert.ok(pkg.devDependencies["@google-cloud/firestore"]);
});
test("Browser Supabase client exposes no service-role or provider secret",()=>{
 assert.match(client,/sb_publishable_/);
 assert.doesNotMatch(client,/SERVICE_ROLE|service_role|UPSTOX_CLIENT_SECRET|UPSTOX_TOKEN_ENCRYPTION_KEY/i);
});
test("Deployment guide provisions Supabase and Cloud Run, not Firebase services",()=>{
 assert.match(deploy,/Supabase Auth/);
 assert.match(deploy,/Cloud Run/);
 assert.match(deploy,/no separate Cloud Run Job or Cloud Scheduler/i);
 assert.match(deploy,/MARKET_DATA_RIGHTS_APPROVED/);
 assert.doesNotMatch(deploy,/gcloud run jobs deploy|gcloud scheduler jobs create/i);
 assert.doesNotMatch(deploy,/firebase functions:deploy|firebase deploy|FIREBASE_STAGING_PROJECT_ID/i);
});

test("Docker image builds from repository root and includes shared non-Firebase modules",()=>{
 assert.match(docker,/COPY market-gateway\/package\*\.json/);
 assert.match(docker,/COPY market-gateway\//);
 assert.match(docker,/COPY functions\/lib\//);
 assert.match(docker,/node:22-slim/);
 assert.match(pkg.dependencies["@supabase/supabase-js"],/^2\.119\.2$/);
});

test("Production gateway deployment is manual, main-only and uses WIF plus Secret Manager",()=>{
 assert.match(workflow,/workflow_dispatch/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/google-github-actions\/auth@v2/);
 assert.match(workflow,/docker build --pull -f market-gateway\/Dockerfile/);
 assert.match(workflow,/--set-secrets/);
 assert.match(workflow,/MARKET_GATEWAY_URL/);
 assert.doesNotMatch(workflow,/firebase deploy|firebase functions:deploy/i);
});

test("Manual production deployment keeps the Delivery LIMIT worker disabled until staging approval",()=>{
 assert.match(deployWorkflow,/workflow_dispatch/);
 assert.match(deployWorkflow,/id-token:\s*write/);
 assert.match(deployWorkflow,/workload_identity_provider/);
 assert.match(deployWorkflow,/gcloud run deploy/);
 assert.match(deployWorkflow,/SERVICE:\s*zenura-market-gateway/);
 assert.match(deployWorkflow,/PAPER_LIMIT_WORKER_ENABLED=false/);
 assert.match(deployWorkflow,/--no-cpu-throttling/);
 assert.match(server,/PAPER_LIMIT_WORKER_ENABLED==="true"/);
 assert.match(server,/setInterval\(runWorker,intervalMs\)/);
 assert.match(server,/runPaperLimitWorker\(\{maxOrders:10\}\)/);
 assert.match(deployWorkflow,/github\.ref == 'refs\/heads\/main'/);
 assert.doesNotMatch(deployWorkflow,/gcloud run jobs deploy|gcloud scheduler jobs create|firebase deploy|firebase functions:deploy|service_account_key:/i);
});

test("Paper Trading frontend gates protective exits on server worker readiness",()=>{
 const html=fs.readFileSync(path.join(root,"../markets/stocks/index.html"),"utf8");
 const js=fs.readFileSync(path.join(root,"../markets/stocks/stocks.js"),"utf8");
 const language=fs.readFileSync(path.join(root,"../markets/language-toggle.js"),"utf8");
 for(const id of ["paper-protective-type","paper-protective-price","paper-protective-create","paper-protective-orders-body","paper-protective-refresh"])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/protectiveWorkerEnabled=data\.workerEnabled===true/);
 assert.match(server,/if\(!paperProtectiveWorkerStatus\.enabled\)/);
 assert.match(js,/paper-protective-orders/);
 assert.match(js,/paper\/protective-orders\/.*\/cancel/);
 assert.match(js,/protectiveWorkerEnabled=false/);
 assert.match(language,/"Protective Orders":"सुरक्षात्मक ऑर्डर"/);
});
test("Equity protective create/list APIs validate user ownership and verified cash instruments",()=>{
 assert.match(server,/app\.post\("\/paper\/protective-orders"/);
 assert.match(server,/create_paper_equity_protective_order/);
 assert.match(server,/app\.get\("\/paper\/protective-orders"/);
 assert.match(server,/item\.instrument_type==="EQ"/);
 assert.match(server,/\["NSE_EQ","BSE_EQ"\]\.includes\(item\.segment\)/);
});
test("Protective-order cancellation API is authenticated and delegates to the owner-bound RPC",()=>{
 assert.match(server,/app\.post\("\/paper\/protective-orders\/:orderId\/cancel"/);
 assert.match(server,/userDb\.rpc\("cancel_paper_protective_order"/);
 assert.match(server,/p_user_id:user\.id/);
 assert.match(server,/idempotentReplay:result\?\.idempotent_replay===true/);

});
test("Equity protective worker is separately leased, bounded, quote-verified and opt-in only",()=>{
 const worker=fs.readFileSync(path.join(root,"lib/paper-protective-worker.js"),"utf8");
 assert.match(server,/createPaperProtectiveWorker/);
 assert.match(worker,/maxOrders=20/);
 assert.match(worker,/p_state_key:"paper_protective_orders"/);
 assert.match(worker,/execute_paper_equity_protective_fill/);
 assert.match(worker,/evaluateProtectiveOrder\(order,quote,now\)/);
 assert.match(worker,/isPositionCloseable\(order,position\)/);
 assert.match(worker,/normalizeProviderQuote\(entry,order\.instrument_key,\{now,maxAgeMs:15000\}\)/);
 assert.match(server,/PAPER_PROTECTIVE_WORKER_ENABLED==="true"/);
 assert.match(server,/protectiveWorker:\{\.\.\.paperProtectiveWorkerStatus\}/);
 assert.match(worker,/release_paper_market_worker_lease/);
 assert.doesNotMatch(deployWorkflow,/PAPER_PROTECTIVE_WORKER_ENABLED=true/);
});

test("Protective scan index only covers active, supported equity SELL exits",()=>{
 const fs=require("node:fs");
 const migration=fs.readFileSync(path.join(root,"../supabase/migrations/20261122141000_equity_protective_worker_scan_index.sql"),"utf8");
 assert.match(migration,/worker_checked_at timestamptz/);
 assert.match(migration,/where status='ACTIVE' and asset_class='EQUITY' and side='SELL'/);
 assert.match(migration,/product in \('DELIVERY','INTRADAY'\)/);
});
test("Public health response confirms the leased LIMIT worker without exposing secrets",()=>{
 assert.match(server,/limitWorker:\{\.\.\.paperLimitWorkerStatus\}/);
 assert.match(server,/lastCycle=\{scanned:result\.scanned,filled:result\.filled,failed:result\.failed,locked:result\.locked,cycleError:false\}/);
 assert.match(deployWorkflow,/jq -e '\.ok and \.instrumentMasterLoaded and \.limitWorker\.enabled == false'/);
 assert.doesNotMatch(server,/health[^\n]*SERVICE_ROLE_KEY|health[^\n]*UPSTOX_CLIENT_SECRET/i);
});

test("Production deployment fails closed without written market-data rights approval",()=>{
 assert.match(deployWorkflow,/MARKET_DATA_RIGHTS_APPROVED/);
 assert.match(deployWorkflow,/MARKET_DATA_RIGHTS_REFERENCE/);
 assert.match(deployWorkflow,/written provider\/regulatory approval is recorded/);
 assert.match(marketDataCompliance,/30-day lag/);
 assert.match(marketDataCompliance,/written confirmation from Upstox/);
});

test("Market-master and LIMIT worker retries use bounded exponential backoff",()=>{
 assert.match(server,/instrumentRefreshLastAttemptAt&&now-instrumentRefreshLastAttemptAt<30000/);
 assert.match(server,/workerBackoffMs=Math\.min\(30000,workerBackoffMs\*2\)/);
 assert.match(server,/nextWorkerRunAt=Date\.now\(\)\+workerBackoffMs/);
});

test("Paper Trading discloses per-user Upstox authorization and data rights",()=>{
 assert.match(tradingPage,/each user’s own Upstox authorization/);
 assert.match(tradingPage,/Public real-time display remains subject to Upstox permission/);
 assert.doesNotMatch(tradingPage,/PAPER INVESTING|Paper Investing/);
});
