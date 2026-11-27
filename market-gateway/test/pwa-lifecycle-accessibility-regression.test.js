"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");

test("Markets PWA manifest provides scoped standalone install metadata and dedicated icon sizes",()=>{
 const manifest=JSON.parse(read("markets/manifest.webmanifest"));
 assert.equal(manifest.scope,"./");
 assert.equal(manifest.start_url,"./");
 assert.equal(manifest.display,"standalone");
 assert.ok(manifest.name && manifest.short_name);
 assert.ok(Array.isArray(manifest.icons) && manifest.icons.length>=2);
 const icon192=manifest.icons.find(icon=>icon.sizes==="192x192"&&icon.type==="image/png");
 const icon512=manifest.icons.find(icon=>icon.sizes==="512x512"&&icon.purpose==="any"&&icon.type==="image/png");
 const maskable=manifest.icons.find(icon=>icon.sizes==="512x512"&&icon.purpose==="maskable"&&icon.type==="image/png");
 assert.ok(icon192&&icon512&&maskable,"192px, 512px and maskable icon declarations are required");
 for(const icon of [icon192,icon512,maskable]){
  assert.ok(icon.src&&icon.type==="image/png");
  const pathOnDisk=path.resolve(root,"markets",icon.src.replace(/^\.\//,""));
  assert.ok(pathOnDisk.startsWith(path.resolve(root,"markets")+path.sep));
  assert.ok(fs.existsSync(pathOnDisk),"manifest icon must exist: "+icon.src);
  const png=fs.readFileSync(pathOnDisk);
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),Number(icon.sizes.split("x")[0]));
  assert.equal(png.readUInt32BE(20),Number(icon.sizes.split("x")[1]));
 }
});

test("service worker cache generation is explicit and activation removes stale Markets generations",()=>{
 const sw=read("markets/service-worker.js");
 const cache=sw.match(/const CACHE_NAME="([^"]+)"/)?.[1];
 assert.equal(cache,"zenura-markets-shell-v13");
 assert.match(sw,/await self\.skipWaiting\(\)/);
 assert.match(sw,/await self\.clients\.claim\(\)/);
 assert.match(sw,/key\.startsWith\("zenura-markets-"\)&&key!==CACHE_NAME/);
 assert.match(sw,/caches\.delete\(key\)/);
});

test("install precache is a unique static allowlist without authenticated payloads or token URLs",()=>{
 const sw=read("markets/service-worker.js");
 const block=sw.match(/const SHELL=\[([\s\S]*?)\]\.map/);
 assert.ok(block);
 const entries=[...block[1].matchAll(/"([^"]*)"/g)].map(match=>match[1]);
 assert.ok(entries.length>0);
 assert.equal(new Set(entries).size,entries.length);
 for(const entry of entries)assert.doesNotMatch(entry,/([?&](token|access_token|session)=|\/api\/|\/auth\/|\/private\/)/i);
 assert.ok(entries.includes("icons/icon-192.png"));
 assert.ok(entries.includes("icons/icon-512.png"));
 assert.ok(entries.includes("icons/icon-512-maskable.png"));
 assert.ok(entries.includes("icons/icon-192.svg"));
 assert.ok(entries.includes("icons/icon-512.svg"));
});

test("fetch handler fails closed for authorization, token URLs and non-allowlisted navigation",()=>{
 const sw=read("markets/service-worker.js");
 assert.match(sw,/request\.method!=="GET"\|\|request\.headers\.has\("authorization"\)/);
 assert.match(sw,/url\.searchParams\.has\("token"\)/);
 assert.match(sw,/if\(request\.mode==="navigate"\)\{[\s\S]*?if\(!shellAsset\)return;/);
 assert.match(sw,/Only explicitly listed static shell documents may be cached/);
 assert.match(sw,/if\(shellAsset\)\{/);
});

test("offline navigation has deterministic cached-shell or 503 fallback",()=>{
 const sw=read("markets/service-worker.js");
 assert.match(sw,/caches\.match\(request\)\|\|await caches\.match\(new URL\("\.\/",BASE\)\.toString\(\)\)/);
 assert.match(sw,/status:503/);
 assert.match(sw,/ZENURA IGNITE is offline/);
});

test("all 15 demo screens retain native keyboard-operable navigation buttons",()=>{
 const html=read("markets/stocks/demo.html");
 const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];
 for(const screen of screens)assert.match(html,new RegExp('<button\\s+data-screen="'+screen+'"'));
 assert.match(html,/<nav[^>]*aria-label="Demo screens"/);
 assert.match(html,/<button type="button" id="paper-language-toggle"[^>]*aria-label="Switch to Hindi"/);
});

test("Markets portal favicon uses the Markets-owned PWA icon instead of the Crypto app icon",()=>{
 const html=read("markets/index.html");
 assert.ok(html.includes('<link rel="icon" href="./icons/icon-192.png" type="image/png">'));
 assert.match(html,/<link rel="icon" href="\.\/icons\/icon-192\.svg" type="image\/svg\+xml">/);
 assert.doesNotMatch(html,/<link rel="icon" href="\.\.\/crypto\/icon\.svg"/);
});
