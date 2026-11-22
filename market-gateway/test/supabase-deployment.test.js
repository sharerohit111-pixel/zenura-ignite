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
