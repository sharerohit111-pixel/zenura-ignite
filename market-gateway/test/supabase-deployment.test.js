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

test("Manual production deployment uses OIDC and deploys both Supabase gateway and LIMIT worker",()=>{
 assert.match(deployWorkflow,/workflow_dispatch/);
 assert.match(deployWorkflow,/id-token:\s*write/);
 assert.match(deployWorkflow,/workload_identity_provider/);
 assert.match(deployWorkflow,/gcloud run deploy/);
 assert.match(deployWorkflow,/SERVICE:\s*zenura-market-gateway/);
 assert.match(deployWorkflow,/paper-limit-worker\.js/);
 assert.match(deployWorkflow,/zenura-paper-limit-worker-every-minute/);
 assert.match(deployWorkflow,/github\.ref == 'refs\/heads\/main'/);
 assert.doesNotMatch(deployWorkflow,/firebase deploy|firebase functions:deploy|service_account_key:/i);
});
