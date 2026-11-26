"use strict";
const fs=require("node:fs");
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");
const {parseBseStandardizedScripMaster}=require("../lib/bse-equity-fee-master");

async function main(){
  const filePath=process.argv[2];
  const sourceDate=process.argv[3];
  if(!filePath||!sourceDate){
    throw new Error("Usage: node scripts/import-bse-scrip-master.js <BSE_EQ_SCRIP_DDMMYYYY.csv> <YYYY-MM-DD>");
  }
  const supabaseUrl=process.env.SUPABASE_URL;
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabaseUrl||!serviceRoleKey)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const sourceBytes=fs.readFileSync(filePath);
  const csv=sourceBytes.toString("utf8");
  const sourceSha256=crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const parsed=parseBseStandardizedScripMaster(csv,{sourceDate});
  const rows=parsed.map(row=>({
    scrip_code:row.scripCode,
    instrument_code:row.instrumentCode,
    group_name:row.groupName,
    scrip_name:row.scripName,
    isin:row.isin,
    exclusive_flag:row.exclusiveFlag,
    status:row.status,
    instrument_type:row.instrumentType
  }));
  const client=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const sourceReference=process.env.BSE_SCRIP_MASTER_SOURCE_URL||"https://www.bseindia.com/";
  const {data,error}=await client.rpc("import_bse_equity_fee_master",{
    p_source_date:sourceDate,
    p_source_sha256:sourceSha256,
    p_source_reference:sourceReference,
    p_rows:rows
  });
  if(error)throw new Error("BSE master import failed: "+error.message);
  process.stdout.write(JSON.stringify({result:data,sha256:sourceSha256,activeEquityRows:rows.length})+"\n");
}
main().catch(error=>{process.stderr.write((error?.message||"BSE master import failed.")+"\n");process.exitCode=1;});
