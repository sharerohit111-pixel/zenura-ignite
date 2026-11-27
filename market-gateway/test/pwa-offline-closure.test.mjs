import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve,relative,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=path=>readFile(resolve(root,path),"utf8");
const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];

test("Markets web app manifest is strict JSON and has a valid standalone scope",async()=>{
 const manifest=JSON.parse(await read("markets/manifest.webmanifest"));
 assert.equal(manifest.scope,"./");
 assert.equal(manifest.start_url,"./");
 assert.equal(manifest.display,"standalone");
 assert.ok(Array.isArray(manifest.icons)&&manifest.icons.length>0);
 assert.ok(Array.isArray(manifest.shortcuts));
 for(const shortcut of manifest.shortcuts){
  const scope=new URL("./","https://example.test/zenura-ignite/markets/");
  const target=new URL(shortcut.url,scope);
  assert.ok(target.pathname.startsWith(scope.pathname),"shortcut must stay inside the repository-scoped Markets PWA: "+shortcut.url);
 }
});

test("Markets service worker uses a new cache generation and precaches the canonical event ledger",async()=>{
 const sw=await read("markets/service-worker.js");
 assert.match(sw,/zenura-markets-shell-v14/);
 assert.match(sw,/"shared\/paper-demo-event-ledger\.mjs"/);
 assert.doesNotMatch(sw,/zenura-markets-shell-v9/);
});

test("all static transitive imports from the 15-screen demo entrypoint are in the shell precache",async()=>{
 const sw=await read("markets/service-worker.js");
 const block=sw.match(/const SHELL=\[([\s\S]*?)\]\.map/);
 assert.ok(block,"SHELL allowlist exists");
 const shell=new Set([...block[1].matchAll(/"([^"]*)"/g)].map(match=>relative(root,resolve(root,"markets",match[1])).split("\\\\").join("/")));
 const visited=new Set();
 async function walk(path){
  if(visited.has(path))return;
  visited.add(path);
  const source=await read(path);
  const imports=[...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match=>match[1]).filter(value=>value.startsWith("."));
  for(const specifier of imports){
   const target=resolve(dirname(resolve(root,path)),specifier);
   const rel=relative(root,target).split("\\").join("/");
   assert.ok(!rel.startsWith("../"),"demo import remains inside repository: "+rel);
   assert.ok(shell.has(rel),"missing transitive shell precache entry: "+rel);
   await walk(rel);
  }
 }
 await walk("markets/stocks/demo.js");
 assert.ok(visited.has("markets/shared/paper-demo-event-ledger.mjs"));
 const html=await read("markets/stocks/demo.html");
 for(const screen of screens)assert.ok(html.includes('data-screen="'+screen+'"'),"missing screen "+screen);
});

test("service worker never caches arbitrary authenticated or private navigation responses",async()=>{
 const sw=await read("markets/service-worker.js");
 assert.match(sw,/request\.headers\.has\("authorization"\)/);
 assert.match(sw,/url\.searchParams\.has\("token"\)/);
 assert.match(sw,/if\(request\.mode==="navigate"\)\{[\s\S]*?if\(!shellAsset\)return;/);
 assert.match(sw,/Only explicitly listed static shell documents may be cached/);
 assert.match(sw,/if\(shellAsset\)\{/);
 assert.doesNotMatch(sw,/request\.destination/,"dynamic same-origin scripts, styles, images and fonts must not be cached implicitly");
});
