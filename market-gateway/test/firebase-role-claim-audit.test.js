"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {auditFirebaseRoleClaims,parseArgs}=require("../scripts/firebase-role-claim-audit");
test("counts role claim coverage across pages without collecting identities",async()=>{
 const calls=[];
 const pages=[{users:[{uid:"private-1",disabled:false,customClaims:{role:"authenticated",other:"secret"}},{uid:"private-2",disabled:true,customClaims:{}},{uid:"private-3",disabled:false,customClaims:{role:"admin"}}],pageToken:"next"},{users:[{uid:"private-4",disabled:false,customClaims:{role:"authenticated"}},{uid:"private-5",disabled:true}]}];
 const report=await auditFirebaseRoleClaims({projectId:"zenura-firebase-prod",pageSize:3,auth:{async listUsers(size,token){calls.push({size,token});return pages.shift();}}});
 assert.deepEqual(calls,[{size:3,token:undefined},{size:3,token:"next"}]);
 assert.deepEqual(report.totals,{users:5,enabledUsers:3,disabledUsers:2,roleAuthenticated:2,roleMissing:2,roleUnexpected:1});
 assert.equal(report.sourceMutated,false);assert.equal(report.customClaimsChanged,false);assert.equal(report.userIdentifiersCollected,false);
 assert.equal(JSON.stringify(report).includes("private-1"),false);assert.equal(JSON.stringify(report).includes("secret"),false);
});
test("counts empty custom claims as missing role",async()=>{
 const report=await auditFirebaseRoleClaims({projectId:"zenura-firebase-prod",auth:{async listUsers(){return {users:[{uid:"x"},{uid:"y",customClaims:null}]};}}});
 assert.equal(report.totals.users,2);assert.equal(report.totals.roleMissing,2);assert.equal(report.totals.roleAuthenticated,0);
});
test("rejects invalid inputs and malformed Auth pages",async()=>{
 await assert.rejects(auditFirebaseRoleClaims({auth:{listUsers:async()=>({users:[]})}}),/project ID/);
 await assert.rejects(auditFirebaseRoleClaims({projectId:"x",auth:{listUsers:async()=>({users:[]})},pageSize:1001}),/Page size/);
 await assert.rejects(auditFirebaseRoleClaims({projectId:"x",auth:{listUsers:async()=>({})}}),/invalid user page/);
});
test("parses only explicit read-only audit options",()=>{
 assert.deepEqual(parseArgs([]),{confirm:false,outputDirectory:null,pageSize:1000,help:false});
 assert.deepEqual(parseArgs(["--confirm-read-only-audit","--out-dir","./private-audit","--page-size","25"]),{confirm:true,outputDirectory:"./private-audit",pageSize:25,help:false});
 assert.throws(()=>parseArgs(["--apply-claims"]),/Unknown argument/);
});

test("rejects repeated pagination tokens instead of looping forever",async()=>{
 let calls=0;
 await assert.rejects(auditFirebaseRoleClaims({projectId:"zenura-firebase-prod",auth:{async listUsers(){calls++;return {users:[],pageToken:"same"};}}}),/repeated a pagination token/);
 assert.equal(calls,2);
});
