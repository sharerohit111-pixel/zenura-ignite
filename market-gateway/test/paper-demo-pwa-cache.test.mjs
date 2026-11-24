import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const workerUrl=new URL("../../markets/service-worker.js",import.meta.url);
const demoUrl=new URL("../../markets/stocks/demo.js",import.meta.url);

test("Markets PWA shell pins a new cache and precaches all four canonical demo fixtures",async()=>{
 const worker=await readFile(workerUrl,"utf8");
 assert.match(worker,/CACHE_NAME\s*=\s*["']zenura-markets-shell-v4["']/);
 for(const name of ["market","account","equity","derivatives"]){
  assert.match(worker,new RegExp("\\.\\./market-gateway/mock/fixtures/"+name+"\\.json"));
 }
 assert.match(worker,/cache\.addAll\(SHELL\)/);
});

test("service worker serves only allowlisted synthetic fixture JSON cache-first and fails closed offline",async()=>{
 const worker=await readFile(workerUrl,"utf8");
 assert.match(worker,/const DEMO_FIXTURE_PATHS\s*=\s*new Set\(/);
 assert.match(worker,/DEMO_FIXTURE_PATHS\.has\(url\.pathname\)/);
 assert.match(worker,/if\(cached\)return cached/);
 assert.match(worker,/Synthetic demo fixture unavailable offline/);
 assert.match(worker,/request\.headers\.has\(["']authorization["']\)\)return/);
 assert.match(worker,/url\.searchParams\.has\(["']token["']\)\)return/);
});

test("demo loads only the four versioned shared fixtures without a live fallback",async()=>{
 const demo=await readFile(demoUrl,"utf8");
 for(const name of ["market","account","equity","derivatives"]){
  assert.ok(demo.includes('"'+name+'"'),"missing fixture "+name);
 }
 assert.match(demo,/credentials:"omit"/);
 assert.match(demo,/cache:"no-store"/);
 assert.match(demo,/No live-data fallback is attempted/);
});
