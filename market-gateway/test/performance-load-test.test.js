"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { parseStages, validateTarget, parsePaths, summarize } from "../performance/load-test.js";

test("accepts bounded ascending default concurrency ramp", () => assert.deepEqual(parseStages(), [10,25,50,100,250,500]));
test("rejects unsafe or unordered concurrency ramps", () => {
  for (const value of ["0,10","10,10","25,10","501","abc",""]) assert.throws(() => parseStages(value));
});
test("disposable targets are limited to loopback and private hosts", () => {
  assert.equal(validateTarget("http://127.0.0.1:8080","disposable").hostname, "127.0.0.1");
  assert.equal(validateTarget("http://192.168.1.20:8080","disposable").hostname, "192.168.1.20");
  for (const url of ["https://zenuraignite.com","https://example.com","http://8.8.8.8"]) assert.throws(() => validateTarget(url,"disposable"));
});
test("staging requires HTTPS and an exact hostname allowlist", () => {
  assert.equal(validateTarget("https://gateway.staging.example","staging","gateway.staging.example").hostname,"gateway.staging.example");
  assert.throws(() => validateTarget("https://gateway.staging.example","staging","*.example"));
  assert.throws(() => validateTarget("http://gateway.staging.example","staging","gateway.staging.example"));
});
test("rejects write paths and unknown endpoints", () => {
  assert.deepEqual(parsePaths("/health,/paper/orders"),["/health","/paper/orders"]);
  for (const value of ["/paper/orders,/paper/orders/submit","/paper/orders?limit=10","POST:/paper/orders",""]) assert.throws(() => parsePaths(value));
});
test("reports percentiles, status distribution and errors", () => {
  const result=summarize([{status:200,latencyMs:10},{status:200,latencyMs:20},{status:429,latencyMs:30},{status:null,latencyMs:40}],1000,4);
  assert.equal(result.requests,4); assert.equal(result.requestsPerSecond,4); assert.equal(result.errorRatePercent,50);
  assert.deepEqual(result.latencyMs,{p50:20,p95:40,p99:40,max:40});
  assert.deepEqual(result.statusCounts,{200:2,429:1}); assert.equal(result.transportErrors,1);
});
