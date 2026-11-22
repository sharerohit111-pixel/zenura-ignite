"use strict";
const crypto=require("node:crypto");
const fs=require("node:fs/promises");
const path=require("node:path");
const TABLES=Object.freeze(["paper_user_identity_map","paper_accounts","paper_equity_positions","paper_derivative_positions","paper_orders","paper_derivative_orders","paper_watchlists"]);
function fail(message){throw Object.assign(new Error(message),{code:"RECONCILIATION_INPUT_INVALID"});}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object"){const out={};for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);return out;}return value;}
function digest(value){return crypto.createHash("sha256").update(value).digest("hex");}
function keyFor(table,row){
 switch(table){
 case "paper_user_identity_map":return row.supabase_user_id;
 case "paper_accounts":return row.user_id;
 case "paper_equity_positions":return [row.user_id,row.product,row.instrument_key].join("|");
 case "paper_derivative_positions":return [row.user_id,row.instrument_key].join("|");
 case "paper_orders":case "paper_derivative_orders":return row.order_id;
 case "paper_watchlists":return [row.user_id,row.name].join("|");
 default:fail("Unsupported reconciliation table: "+table);
 }
}
async function readTable(directory,table,meta){
 const file=path.join(directory,table+".jsonl"),raw=await fs.readFile(file,"utf8");
 if(digest(raw)!==meta.sha256)fail("Checksum mismatch for "+table);
 const lines=raw.split("\n").filter(Boolean);
 if(lines.length!==meta.count)fail("Row count mismatch for "+table);
 const map=new Map();
 for(const line of lines){let row;try{row=JSON.parse(line);}catch{fail("Invalid JSONL in "+table);}
 const key=keyFor(table,row);if(typeof key!=="string"||!key)fail("Missing primary key in "+table);
 if(map.has(key))fail("Duplicate primary key in "+table);
 map.set(key,digest(JSON.stringify(canonical(row))));
 }
 return map;
}
async function reconcileSnapshots({expectedDirectory,actualDirectory,reportPath}){
 if(!expectedDirectory||!actualDirectory||!reportPath)throw new TypeError("Expected, actual and report paths are required");
 const expectedRoot=path.resolve(expectedDirectory),actualRoot=path.resolve(actualDirectory),out=path.resolve(reportPath);
 if(out===expectedRoot||out===actualRoot||out.startsWith(expectedRoot+path.sep)||out.startsWith(actualRoot+path.sep))fail("Report must be outside source snapshot directories");
 const expectedReport=JSON.parse(await fs.readFile(path.join(expectedRoot,"transform-report.json"),"utf8"));
 const actualManifest=JSON.parse(await fs.readFile(path.join(actualRoot,"snapshot-manifest.json"),"utf8"));
 if(expectedReport.format!=="zenura-supabase-transform-v1"||expectedReport.importPerformed!==false||expectedReport.supabaseWrites!==0)fail("Expected directory is not an offline transform output");
 if(!expectedReport.importAllowed||expectedReport.errorCount!==0)fail("Transformation report contains rejected records");
 if(actualManifest.format!=="zenura-supabase-read-only-snapshot-v1"||actualManifest.readOnly!==true)fail("Actual snapshot must be explicitly marked read-only");
 const tables={};let totalExpected=0,totalActual=0,totalMissing=0,totalExtra=0,totalChanged=0;
 for(const table of TABLES){
  const em=expectedReport.files?.[table],am=actualManifest.tables?.[table];
  if(!em||!am)fail("Snapshot manifest missing required table "+table);
  const [expected,actual]=await Promise.all([readTable(expectedRoot,table,em),readTable(actualRoot,table,am)]);
  const missing=[],extra=[],changed=[];
  for(const [key,hash] of expected){if(!actual.has(key))missing.push(key);else if(actual.get(key)!==hash)changed.push(key);}
  for(const key of actual.keys())if(!expected.has(key))extra.push(key);
  const result={expected_count:expected.size,actual_count:actual.size,missing_count:missing.length,extra_count:extra.length,changed_count:changed.length,
   missing_keys:missing.sort(),extra_keys:extra.sort(),changed_keys:changed.sort(),match:missing.length===0&&extra.length===0&&changed.length===0};
  tables[table]=result;totalExpected+=expected.size;totalActual+=actual.size;totalMissing+=missing.length;totalExtra+=extra.length;totalChanged+=changed.length;
 }
 const report={format:"zenura-paper-trading-reconciliation-v1",createdAt:new Date().toISOString(),mode:"offline-snapshot-comparison-no-writes",
  expectedSource:expectedReport.sourceProjectId||null,actualSnapshot:actualManifest.projectRef||null,tables,
  totals:{expected_rows:totalExpected,actual_rows:totalActual,missing_rows:totalMissing,extra_rows:totalExtra,changed_rows:totalChanged},
  passed:totalMissing===0&&totalExtra===0&&totalChanged===0,sourceMutated:false,supabaseWrites:0,importPerformed:false};
 await fs.writeFile(out,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
 return report;
}
module.exports={TABLES,canonical,keyFor,reconcileSnapshots};