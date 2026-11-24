"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {publicErrorCode}=require("../lib/api-error-contract");

test("maps supported HTTP statuses to stable public API error codes",()=>{
 const expected={400:"INVALID_REQUEST",401:"UNAUTHENTICATED",403:"FORBIDDEN",404:"NOT_FOUND",
  408:"REQUEST_TIMEOUT",409:"CONFLICT",413:"PAYLOAD_TOO_LARGE",422:"VALIDATION_FAILED",
  429:"RATE_LIMITED",502:"UPSTREAM_ERROR",503:"SERVICE_UNAVAILABLE",504:"UPSTREAM_TIMEOUT",
  500:"INTERNAL_ERROR",501:"INTERNAL_ERROR"};
 for(const [status,code] of Object.entries(expected))assert.equal(publicErrorCode(Number(status)),code);
});

test("uses safe fallback codes for unknown statuses",()=>{
 assert.equal(publicErrorCode(418),"REQUEST_FAILED");
 assert.equal(publicErrorCode(599),"INTERNAL_ERROR");
});
