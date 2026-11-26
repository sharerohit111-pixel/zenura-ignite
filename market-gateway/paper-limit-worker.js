"use strict";
const {runPaperLimitWorker}=require("./supabase-server");
runPaperLimitWorker({maxOrders:50}).then(summary=>{
  process.stdout.write(JSON.stringify({service:"zenura-paper-limit-worker",...summary})+"\n");
}).catch(error=>{
  process.stderr.write(JSON.stringify({service:"zenura-paper-limit-worker",error:error?.message||"Worker failed"})+"\n");
  process.exitCode=1;
});
