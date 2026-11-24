"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {EventEmitter}=require("node:events");
const {createHttpTelemetry,parseTraceparent}=require("../lib/http-telemetry");

function makeResponse(){
  const response=new EventEmitter();
  response.headers={};
  response.statusCode=200;
  response.writableEnded=false;
  response.set=(name,value)=>{response.headers[name]=value;};
  return response;
}

test("accepts only valid W3C version-00 traceparent values",()=>{
  assert.deepEqual(parseTraceparent("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"),{
    traceId:"0123456789abcdef0123456789abcdef",
    parentSpanId:"0123456789abcdef",
    traceFlags:1
  });
  for(const value of [
    null,"","00-00000000000000000000000000000000-0123456789abcdef-01",
    "00-0123456789abcdef0123456789abcdef-0000000000000000-01",
    "01-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    "00-not-a-trace-0123456789abcdef-01",
    "00-0123456789abcdef0123456789abcdef-0123456789abcdef-gg"
  ])assert.equal(parseTraceparent(value),null);
});

test("creates trace context and emits a bounded request metric record on finish",()=>{
  const logs=[];
  let tick=10n;
  const telemetry=createHttpTelemetry({
    logger:entry=>logs.push(entry),
    now:()=>{tick+=2_500_000n;return tick;},
    projectId:"zenura-prod-123"
  });
  const req={
    requestId:"request-123",method:"GET",headers:{},
    get:name=>name==="traceparent"?"00-0123456789abcdef0123456789abcdef-0123456789abcdef-01":undefined,
    route:{path:"/paper/orders"}
  };
  const res=makeResponse();
  let nextCalled=false;
  telemetry.middleware(req,res,()=>{nextCalled=true;});
  assert.equal(nextCalled,true);
  assert.equal(req.traceId,"0123456789abcdef0123456789abcdef");
  assert.match(req.spanId,/^[a-f0-9]{16}$/);
  assert.equal(req.parentSpanId,"0123456789abcdef");
  assert.equal(req.traceSampled,true);
  assert.equal(res.headers["X-Trace-Id"],req.traceId);
  res.statusCode=200;
  res.writableEnded=true;
  res.emit("finish");
  res.emit("close");
  assert.equal(logs.length,1);
  assert.equal(logs[0].event,"http_server_request");
  assert.equal(logs[0].requestId,"request-123");
  assert.equal(logs[0].traceId,req.traceId);
  assert.equal(logs[0].route,"/paper/orders");
  assert.equal(logs[0].durationMs,2.5);
  assert.equal(logs[0].outcome,"success");
  assert.equal(logs[0]["logging.googleapis.com/trace"],"projects/zenura-prod-123/traces/"+req.traceId);
  assert.equal("url" in logs[0],false);
  assert.equal("headers" in logs[0],false);
  assert.equal("userId" in logs[0],false);
});

test("does not log raw paths or duplicate completion when a response closes after finish",()=>{
  const logs=[];
  const telemetry=createHttpTelemetry({logger:entry=>logs.push(entry),now:(()=>{let n=0n;return()=>{n+=1_000_000n;return n;};})()});
  const req={requestId:"r2",method:"GET",url:"/paper/orders/private-order-id?token=secret",headers:{}};
  const res=makeResponse();
  telemetry.middleware(req,res,()=>{});
  res.statusCode=404;
  res.writableEnded=true;
  res.emit("finish");
  res.emit("close");
  assert.equal(logs.length,1);
  assert.equal(logs[0].route,"unmatched");
  assert.equal(JSON.stringify(logs[0]).includes("private-order-id"),false);
  assert.equal(JSON.stringify(logs[0]).includes("secret"),false);
});

test("marks premature response close as aborted and records a server error severity",()=>{
  const logs=[];
  const telemetry=createHttpTelemetry({logger:entry=>logs.push(entry),now:(()=>{let n=0n;return()=>{n+=1_000_000n;return n;};})()});
  const req={requestId:"r3",method:"POST",headers:{},route:{path:"/paper/orders"}};
  const res=makeResponse();
  telemetry.middleware(req,res,()=>{});
  res.statusCode=503;
  res.writableEnded=false;
  res.emit("close");
  assert.equal(logs.length,1);
  assert.equal(logs[0].outcome,"aborted");
  assert.equal(logs[0].severity,"ERROR");
});

test("replaces malformed incoming trace context with a fresh trace identifier",()=>{
  const logs=[];
  const telemetry=createHttpTelemetry({logger:entry=>logs.push(entry)});
  const req={requestId:"r4",method:"GET",headers:{traceparent:"not-valid"}};
  const res=makeResponse();
  telemetry.middleware(req,res,()=>{});
  assert.match(req.traceId,/^[a-f0-9]{32}$/);
  assert.equal(req.parentSpanId,null);
  assert.equal(req.traceSampled,false);
  assert.equal(res.headers["X-Trace-Id"],req.traceId);
  res.writableEnded=true;
  res.emit("finish");
  assert.equal(logs.length,1);
  assert.equal(logs[0].traceId,req.traceId);
});
