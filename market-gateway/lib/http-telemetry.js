"use strict";

const crypto=require("node:crypto");

const TRACEPARENT=/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ZERO_TRACE="00000000000000000000000000000000";
const ZERO_SPAN="0000000000000000";

function parseTraceparent(value){
  if(typeof value!=="string"||value.length>128)return null;
  const match=TRACEPARENT.exec(value.trim());
  if(!match)return null;
  const traceId=match[1].toLowerCase(),parentSpanId=match[2].toLowerCase();
  if(traceId===ZERO_TRACE||parentSpanId===ZERO_SPAN)return null;
  return {traceId,parentSpanId,traceFlags:Number.parseInt(match[3],16)};
}

function createHttpTelemetry({
  logger=entry=>console.log(JSON.stringify(entry)),
  now=()=>process.hrtime.bigint(),
  projectId=process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT||null
}={}){
  if(typeof logger!=="function"||typeof now!=="function")
    throw new TypeError("HTTP telemetry logger and clock must be functions.");
  const safeProjectId=typeof projectId==="string"&&/^[a-z][a-z0-9:.-]{3,127}$/i.test(projectId)
    ?projectId:null;

  function middleware(req,res,next){
    const startedAt=now();
    const incoming=parseTraceparent(
      typeof req.get==="function"?req.get("traceparent"):req.headers?.traceparent
    );
    const traceId=incoming?.traceId||crypto.randomBytes(16).toString("hex");
    const spanId=crypto.randomBytes(8).toString("hex");
    req.traceId=traceId;
    req.spanId=spanId;
    req.parentSpanId=incoming?.parentSpanId||null;
    req.traceSampled=!!(incoming&&(incoming.traceFlags&1));
    res.set("X-Trace-Id",traceId);

    let emitted=false;
    const emit=(aborted)=>{
      if(emitted)return;
      emitted=true;
      const elapsed=now()-startedAt;
      const durationMs=typeof elapsed==="bigint"
        ?Number(elapsed)/1e6
        :Number(elapsed);
      const route=typeof req.route?.path==="string"?req.route.path:"unmatched";
      const status=Number.isInteger(res.statusCode)?res.statusCode:0;
      const record={
        severity:aborted||status>=500?"ERROR":status>=400?"WARNING":"INFO",
        event:"http_server_request",
        requestId:req.requestId||null,
        traceId,
        spanId,
        method:typeof req.method==="string"?req.method:"UNKNOWN",
        route,
        status,
        durationMs:Number.isFinite(durationMs)?Math.max(0,Math.round(durationMs*1000)/1000):null,
        outcome:aborted?"aborted":status>=500?"server_error":status>=400?"client_error":"success"
      };
      if(safeProjectId)record["logging.googleapis.com/trace"]="projects/"+safeProjectId+"/traces/"+traceId;
      logger(record);
    };
    res.once("finish",()=>emit(false));
    res.once("close",()=>{if(!res.writableEnded)emit(true);});
    next();
  }

  return {middleware,parseTraceparent};
}

module.exports={createHttpTelemetry,parseTraceparent};
