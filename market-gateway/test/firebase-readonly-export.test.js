"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {EXPORT_COLLECTIONS,NOT_REQUIRED_COLLECTIONS,EXCLUDED_COLLECTIONS,serializeFirestoreValue,sanitizeAuthUser,firestoreDocuments,exportSnapshot,resolveProjectId,parseArgs}=require("../scripts/firebase-readonly-export");
test("export scope is allowlisted and excludes broker credentials and operational state",()=>{
 assert.deepEqual(EXPORT_COLLECTIONS,["indianPaperAccounts","indianPaperOrders","indianDerivativeOrders","indianMarketWatchlists"]);
 assert.deepEqual(NOT_REQUIRED_COLLECTIONS,["customerProfiles (profile PII is not needed by the Paper Trading transformer)","users (profile/entitlement data is not needed by the Paper Trading transformer)"]);
 assert.ok(EXCLUDED_COLLECTIONS.some(x=>x.startsWith("upstoxConnections")));assert.ok(EXCLUDED_COLLECTIONS.includes("upstoxOAuthStates"));
});
test("serializes timestamps, bytes, dates and nested values with explicit type markers",()=>{
 const v=serializeFirestoreValue({createdAt:{_seconds:1700000000,_nanoseconds:123000000},payload:Buffer.from("hello"),nested:[new Date("2025-01-01T00:00:00.000Z"),42]});
 assert.deepEqual(v.createdAt,{__type:"timestamp",seconds:1700000000,nanoseconds:123000000});
 assert.deepEqual(v.payload,{__type:"bytes",base64:"aGVsbG8="});
 assert.deepEqual(v.nested[0],{__type:"date",iso:"2025-01-01T00:00:00.000Z"});assert.equal(v.nested[1],42);
});
test("auth export contains only the UID needed for orphan validation",()=>{
 const safe=sanitizeAuthUser({uid:"legacy-uid",email:"user@example.test",emailVerified:true,passwordHash:"never-export",passwordSalt:"never-export",phoneNumber:"+910000000000",displayName:"Private Name",metadata:{creationTime:"created",lastSignInTime:"signed-in"},providerData:[{providerId:"google.com",uid:"provider-uid",email:"user@example.test"}]});
 assert.deepEqual(safe,{uid:"legacy-uid"});
 assert.equal(JSON.stringify(safe).includes("user@example.test"),false);
 assert.equal(JSON.stringify(safe).includes("Private Name"),false);
 assert.throws(()=>sanitizeAuthUser({uid:""}),/UID is invalid/);
});
test("Firestore reader paginates by stable document name",async()=>{
 const rows=["a","b","c"].map(id=>({id,ref:{path:"indianPaperOrders/"+id},data:()=>({id})}));let calls=0;
 const db={collection(name){assert.equal(name,"indianPaperOrders");return {orderBy(field){assert.equal(field,"__name__");let cursor=null,limit=2;const q={limit(n){limit=n;return q;},startAfter(d){cursor=d;return q;},async get(){calls++;const start=cursor?rows.findIndex(x=>x.id===cursor.id)+1:0;return {docs:rows.slice(start,start+limit)};}};return q;}};}};
 const actual=[];for await(const row of firestoreDocuments(db,"indianPaperOrders",2))actual.push(row);
 assert.deepEqual(actual.map(x=>x.documentId),["a","b","c"]);assert.equal(calls,2);
});
test("CLI defaults to dry-run and requires explicit export confirmation",()=>{
 assert.deepEqual(parseArgs([]),{confirm:false,outputDirectory:null,pageSize:400,dryRun:true});
 const args=parseArgs(["--confirm-read-only-export","--out-dir","/tmp/export","--page-size","100"]);
 assert.equal(args.dryRun,false);assert.equal(args.outputDirectory,"/tmp/export");assert.equal(args.pageSize,100);
});

test("export project selection requires explicit FIREBASE_PROJECT_ID",()=>{
 assert.equal(resolveProjectId({FIREBASE_PROJECT_ID:"zenura-ignite-technologies",GOOGLE_CLOUD_PROJECT:"wrong-project"}),"zenura-ignite-technologies");
 assert.throws(()=>resolveProjectId({GOOGLE_CLOUD_PROJECT:"ambient-project"}),/FIREBASE_PROJECT_ID explicitly/);
 assert.throws(()=>resolveProjectId({GCLOUD_PROJECT:"ambient-project"}),/FIREBASE_PROJECT_ID explicitly/);
 assert.throws(()=>resolveProjectId({FIREBASE_PROJECT_ID:"   "}),/FIREBASE_PROJECT_ID explicitly/);
});


test("snapshot exports only four trading collections and UID-only Auth identities",async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),"zenura-export-minimal-"));
 const output=path.join(parent,"snapshot"),queried=[];
 const db={collection(name){queried.push(name);return {orderBy(){return {limit(){return {async get(){return {docs:[]};}};}};}};}};
 const manifest=await exportSnapshot({db,auth:{listUsers:async()=>({users:[{uid:"firebase-user-1",email:"private@example.test"}]})},outputDirectory:output,projectId:"synthetic-project"});
 assert.deepEqual(queried,["indianPaperAccounts","indianPaperOrders","indianDerivativeOrders","indianMarketWatchlists"]);
 assert.deepEqual(manifest.collections,["indianPaperAccounts","indianPaperOrders","indianDerivativeOrders","indianMarketWatchlists"]);
 assert.deepEqual(manifest.notRequiredCollections,NOT_REQUIRED_COLLECTIONS);
 const files=await fs.readdir(output);
 assert.deepEqual(files.sort(),["firebase-auth-users.jsonl","indianDerivativeOrders.jsonl","indianMarketWatchlists.jsonl","indianPaperAccounts.jsonl","indianPaperOrders.jsonl","manifest.json"].sort());
 const authData=await fs.readFile(path.join(output,"firebase-auth-users.jsonl"),"utf8");
 assert.equal(authData.includes("private@example.test"),false);
 assert.equal(authData.includes("firebase-user-1"),true);
 await fs.rm(parent,{recursive:true,force:true});
});

test("removes only its partial snapshot files when a read fails",async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),"zenura-export-cleanup-"));
 const output=path.join(parent,"private-export");
 let collectionCalls=0;
 const db={
  collection(name){
   return {
    orderBy(){
     return {
      limit(){
       return {
        async get(){
         collectionCalls++;
         if(collectionCalls===2)throw new Error("synthetic read failure");
         return {docs:[{id:"doc-1",ref:{path:name+"/doc-1"},data:()=>({cash:100})}]};
        }
       };
      }
     };
    }
   };
  }
 };
 await assert.rejects(
  ()=>exportSnapshot({db,auth:{listUsers:async()=>({users:[]})},outputDirectory:output,projectId:"synthetic-project"}),
  /synthetic read failure/
 );
 await assert.rejects(()=>fs.access(output),{code:"ENOENT"});
 assert.deepEqual(await fs.readdir(parent),[]);
 await fs.rm(parent,{recursive:true,force:true});
});
