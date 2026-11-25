import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=path=>readFile(resolve(root,path),"utf8");

test("Markets PWA manifest remains installable and scoped away from Crypto",async()=>{
 const manifest=JSON.parse(await read("markets/manifest.webmanifest"));
 assert.equal(manifest.scope,"./");
 assert.equal(manifest.start_url,"./");
 assert.equal(manifest.display,"standalone");
 assert.ok(manifest.name && manifest.short_name);
 assert.ok(Array.isArray(manifest.icons) && manifest.icons.length>0);
 for(const icon of manifest.icons){
  assert.ok(icon.src && icon.sizes && icon.type,"each install icon declares source, size and MIME type");
 }
});

test("service worker cache generation is explicit and activation removes stale Markets generations",async()=>{
 const sw=await read("markets/service-worker.js");
 const cache=sw.match(/const CACHE_NAME="([^"]+)"/)?.[1];
 assert.equal(cache,"zenura-markets-shell-v11");
 assert.match(sw,/await self\.skipWaiting\(\)/);
 assert.match(sw,/await self\.clients\.claim\(\)/);
 assert.match(sw,/key\.startsWith\("zenura-markets-"\)&&key!==CACHE_NAME/);
 assert.match(sw,/caches\.delete\(key\)/);
});

test("install precache is a unique static allowlist, with no authenticated payload or token URL",async()=>{
 const sw=await read("markets/service-worker.js");
 const block=sw.match(/const SHELL=\[([\s\S]*?)\]\.map/);
 assert.ok(block,"static shell allowlist exists");
 const entries=[...block[1].matchAll(/"([^"]+)"/g)].map(match=>match[1]);
 assert.ok(entries.length>0);
 assert.equal(new Set(entries).size,entries.length,"duplicate precache URLs are forbidden");
 for(const path of entries){
  assert.doesNotMatch(path,/([?&](token|access_token|session)=|\/api\/|\/auth\/|\/private\/)/i,
   "authenticated resources must never be precached: "+path);
 }
});

test("fetch handler fails closed for authorization, token URLs and non-allowlisted navigation",async()=>{
 const sw=await read("markets/service-worker.js");
 assert.match(sw,/request\.method!==\"GET\"\|\|request\.headers\.has\(\"authorization\"\)/);
 assert.match(sw,/url\.searchParams\.has\(\"token\"\)/);
 assert.match(sw,/if\(request\.mode===\"navigate\"\)\{[\s\S]*?if\(!shellAsset\)return;/);
 assert.match(sw,/Only explicitly listed static shell documents may be cached/);
 assert.match(sw,/if\(shellAsset\)\{/);
});

test("offline navigation has a deterministic cached-shell or 503 fallback",async()=>{
 const sw=await read("markets/service-worker.js");
 assert.match(sw,/caches\.match\(request\)\|\|await caches\.match\(new URL\("\.\/",BASE\)\.toString\(\)\)/);
 assert.match(sw,/status:503/);
 assert.match(sw,/ZENURA IGNITE is offline/);
});

test("all 15 named demo screens remain keyboard-operable native navigation buttons",async()=>{
 const html=await read("markets/stocks/demo.html");
 const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];
 for(const screen of screens){
  const match=html.match(new RegExp('<button\\s+data-screen="'+screen+'"'));
  assert.ok(match,"native button navigation exists for "+screen);
 }
 assert.match(html,/<nav[^>]*aria-label="Demo screens"/);
 assert.match(html,/<button type="button" id="paper-language-toggle"[^>]*aria-label="Switch to Hindi"/);
});
