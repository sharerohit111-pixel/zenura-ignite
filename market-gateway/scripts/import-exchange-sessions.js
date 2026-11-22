"use strict";
const fs=require("node:fs");
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");
const {parseExchangeSessionCsv}=require("../lib/exchange-session-import");
async function main(){
  const filePath=process.argv[2];
  if(!filePath)throw new Error("Usage: node scripts/import-exchange-sessions.js <verified-exchange-sessions.csv>");
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const sourceBytes=fs.readFileSync(filePath);
  const csv=sourceBytes.toString("utf8");
  const rows=parseExchangeSessionCsv(csv);
  const sha256=crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.rpc("import_paper_exchange_sessions",{p_source_sha256:sha256,p_rows:rows});
  if(error)throw new Error("Exchange session import failed: "+error.message);
  process.stdout.write(JSON.stringify({result:data,sha256,rows:rows.length})+"\n");
}
main().catch(error=>{process.stderr.write((error?.message||"Exchange session import failed.")+"\n");process.exitCode=1;});
