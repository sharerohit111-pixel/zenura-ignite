"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseRetryAfter,upstoxHttpError,MAX_RETRY_AFTER_SECONDS}=require("../lib/upstox-http-policy");

function response(status,retryAfter){
 return {status,headers:{get(name){return name==="retry-after"?retryAfter:null;}}};
}
test("maps expired provider authorization to a stable reconnect-required error without provider details",()=>{
 const error=upstoxHttpError(response(401));
 assert.equal(error.status,401);
 assert.equal(error.code,"upstox_reconnect_required");
 assert.match(error.message,/Reconnect/);
});
test("maps provider rate limiting and parses bounded Retry-After seconds",()=>{
 const error=upstoxHttpError(response(429,"12"));
 assert.equal(error.status,429);
 assert.equal(error.code,"upstox_rate_limited");
 assert.equal(error.retryAfterSeconds,12);
});
test("supports HTTP-date Retry-After and clamps excessive delays",()=>{
 const now=Date.parse("2026-11-23T10:00:00Z");
 assert.equal(parseRetryAfter("Mon, 23 Nov 2026 10:00:20 GMT",now),20);
 assert.equal(parseRetryAfter("999999",now),MAX_RETRY_AFTER_SECONDS);
});
test("rejects invalid and past Retry-After values",()=>{
 assert.equal(parseRetryAfter("not-a-date"),null);
 assert.equal(parseRetryAfter("Mon, 23 Nov 2026 09:59:00 GMT",Date.parse("2026-11-23T10:00:00Z")),null);
});
test("maps other provider statuses to a generic 502 without exposing body",()=>{
 const error=upstoxHttpError(response(500));
 assert.equal(error.status,502);
 assert.equal(error.code,"upstream_provider_error");
 assert.equal(error.message,"Upstox market-data request failed.");
});
