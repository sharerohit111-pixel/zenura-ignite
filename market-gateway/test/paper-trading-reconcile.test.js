"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {TABLES,keyFor,reconcileSnapshots}=require("../scripts/paper-trading-reconcile");
const digest=s=>crypto.createHash("sha256").update(s).digest("hex");
const rows={
 paper_user_identity_map:[{supabase_user_id:"123e4567-e89b-42d3-a456-426614174000",firebase_uid:"legacy"}],
 paper_accounts:[{user_id:"123e4567-e89b-42d3-a456-426614174000",cash_paise:9000}],
 paper_equity_positions:[{user_id:"123e4567-e89b-42d3-a456-426614174000",product:"DELIVERY",instrument_key:"NSE|ABC",quantity:2}],
 paper_derivative_positions:[],
 paper_orders:[{order_id:"a".repeat(64),user_id:"123e4567-e89b-42d3-a456-426614174000"}],
 paper_derivative_orders:[],
 paper_watchlists:[{user_id:"123e4567-e89b-42d3-a456-426614174000",name:"My Stocks",instrument_keys:["NSE|ABC"]}]
};
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"zenura-reconcile-")),expected=path.join(root,"expected"),actual=path.join(root,"actual"),report=path.join(root,"reconciliation.json");
 await fs.mkdir(expected);await fs.mkdir(actual);
 const expectedFiles={},actualTables={};
 for(const table of TABLES){const raw=rows[table].map(x=>JSON.stringify(x)).join("\n")+(rows[table].length?"\n":"");
  await fs.writeFile(path.join(expected,table+".jsonl"),raw);await fs.writeFile(path.join(actual,table+".jsonl"),raw);
  expectedFiles[table]={count:rows[table].length,sha256:digest(raw)};actualTables[table]={count:rows[table].length,sha256:digest(raw)};
 }
 await fs.writeFile(path.join(expected,"transform-report.json"),JSON.stringify({format:"zenura-supabase-transform-v1",sourceProjectId:"synthetic",importPerformed:false,supabaseWrites:0,importAllowed:true,errorCount:0,files:expectedFiles}));
 await fs.writeFile(path.join(actual,"snapshot-manifest.json"),JSON.stringify({format:"zenura-supabase-read-only-snapshot-v1",readOnly:true,projectRef:"synthetic",tables:actualTables}));
 return {root,expected,actual,report,actualTables};
}
test("uses stable composite primary keys for positions and watchlists",()=>{
 assert.equal(keyFor("paper_equity_positions",{user_id:"u",product:"DELIVERY",instrument_key:"i"}),"u|DELIVERY|i");
 assert.equal(keyFor("paper_watchlists",{user_id:"u",name:"My Stocks"}),"u|My Stocks");
});
test("passes exact matching snapshots across every table",async()=>{
 const f=await fixture();const r=await reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.report});
 assert.equal(r.passed,true);assert.equal(r.totals.expected_rows,5);assert.equal(r.supabaseWrites,0);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("detects a missing row",async()=>{
 const f=await fixture(),file=path.join(f.actual,"paper_orders.jsonl");await fs.writeFile(file,"");
 f.actualTables.paper_orders={count:0,sha256:digest("")};
 await fs.writeFile(path.join(f.actual,"snapshot-manifest.json"),JSON.stringify({format:"zenura-supabase-read-only-snapshot-v1",readOnly:true,tables:f.actualTables}));
 const r=await reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.report});
 assert.equal(r.passed,false);assert.equal(r.totals.missing_rows,1);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("detects extra rows",async()=>{
 const f=await fixture(),file=path.join(f.actual,"paper_accounts.jsonl");
 const extra={user_id:"223e4567-e89b-42d3-a456-426614174000",cash_paise:1},raw=JSON.stringify(rows.paper_accounts[0])+"\n"+JSON.stringify(extra)+"\n";
 await fs.writeFile(file,raw);f.actualTables.paper_accounts={count:2,sha256:digest(raw)};
 await fs.writeFile(path.join(f.actual,"snapshot-manifest.json"),JSON.stringify({format:"zenura-supabase-read-only-snapshot-v1",readOnly:true,tables:f.actualTables}));
 const r=await reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.report});
 assert.equal(r.totals.extra_rows,1);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("detects changed financial values under the same primary key",async()=>{
 const f=await fixture(),raw=JSON.stringify({...rows.paper_accounts[0],cash_paise:8999})+"\n";
 await fs.writeFile(path.join(f.actual,"paper_accounts.jsonl"),raw);f.actualTables.paper_accounts={count:1,sha256:digest(raw)};
 await fs.writeFile(path.join(f.actual,"snapshot-manifest.json"),JSON.stringify({format:"zenura-supabase-read-only-snapshot-v1",readOnly:true,tables:f.actualTables}));
 const r=await reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.report});
 assert.equal(r.totals.changed_rows,1);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("rejects a target snapshot not marked read-only",async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.actual,"snapshot-manifest.json"),JSON.stringify({format:"zenura-supabase-read-only-snapshot-v1",readOnly:false,tables:f.actualTables}));
 await assert.rejects(()=>reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.report}),/read-only/);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("rejects missing table snapshots and checksum tampering",async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.actual,"paper_accounts.jsonl"),"{}");
 await assert.rejects(()=>reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.report}),/Checksum mismatch/);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("refuses to overwrite report or write report into input snapshots",async()=>{
 const f=await fixture();await assert.rejects(()=>reconcileSnapshots({expectedDirectory:f.expected,actualDirectory:f.actual,reportPath:f.expected+"/unsafe.json"}),/outside source/);
 await fs.rm(f.root,{recursive:true,force:true});
});
