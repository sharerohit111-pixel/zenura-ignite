"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {EXPORT_COLLECTIONS,EXCLUDED_COLLECTIONS,serializeFirestoreValue,sanitizeAuthUser,firestoreDocuments,parseArgs}=require("../scripts/firebase-readonly-export");
test("export scope is allowlisted and excludes broker credentials and operational state",()=>{
 assert.deepEqual(EXPORT_COLLECTIONS,["customerProfiles","users","indianPaperAccounts","indianPaperOrders","indianDerivativeOrders","indianMarketWatchlists"]);
 assert.ok(EXCLUDED_COLLECTIONS.some(x=>x.startsWith("upstoxConnections")));assert.ok(EXCLUDED_COLLECTIONS.includes("upstoxOAuthStates"));
});
test("serializes timestamps, bytes, dates and nested values with explicit type markers",()=>{
 const v=serializeFirestoreValue({createdAt:{_seconds:1700000000,_nanoseconds:123000000},payload:Buffer.from("hello"),nested:[new Date("2025-01-01T00:00:00.000Z"),42]});
 assert.deepEqual(v.createdAt,{__type:"timestamp",seconds:1700000000,nanoseconds:123000000});
 assert.deepEqual(v.payload,{__type:"bytes",base64:"aGVsbG8="});
 assert.deepEqual(v.nested[0],{__type:"date",iso:"2025-01-01T00:00:00.000Z"});assert.equal(v.nested[1],42);
});
test("auth export omits password hashes, salts and MFA secrets",()=>{
 const safe=sanitizeAuthUser({uid:"legacy-uid",email:"user@example.test",emailVerified:true,passwordHash:"never-export",passwordSalt:"never-export",metadata:{creationTime:"created",lastSignInTime:"signed-in"},providerData:[{providerId:"google.com",uid:"provider-uid",email:"user@example.test"}]});
 assert.equal(safe.uid,"legacy-uid");assert.equal(safe.emailVerified,true);assert.equal("passwordHash" in safe,false);assert.equal("passwordSalt" in safe,false);assert.equal(JSON.stringify(safe).includes("never-export"),false);
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
