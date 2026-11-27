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
 assert.ok(Array.isArray(manifest.icons)&&manifest.icons.length>=2);
 assert.ok(manifest.icons.some(icon=>icon.sizes==="192x192"&&icon.type==="image/png"));
 assert.ok(manifest.icons.some(icon=>icon.sizes==="512x512"&&icon.purpose==="maskable"&&icon.type==="image/png"));
 for(const icon of manifest.icons){
  const iconPath=resolve(root,"markets",icon.src.replace(/^\.\//,""));
  assert.ok(iconPath.startsWith(resolve(root,"markets")+"/"));
  if(icon.type==="image/png"){
   const png=await readFile(iconPath);
   assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
   assert.equal(png.readUInt32BE(16),Number(icon.sizes.split("x")[0]));
   assert.equal(png.readUInt32BE(20),Number(icon.sizes.split("x")[1]));
  }else{
   const svg=await readFile(iconPath,"utf8");
   assert.match(svg,/<svg[^>]*width="(?:192|512)"[^>]*height="(?:192|512)"/);
  }
 }
 assert.ok(Array.isArray(manifest.shortcuts));
 for(const shortcut of manifest.shortcuts){
  const scope=new URL("./","https://example.test/zenura-ignite/markets/");
  const target=new URL(shortcut.url,scope);
  assert.ok(target.pathname.startsWith(scope.pathname),"shortcut must stay inside the repository-scoped Markets PWA: "+shortcut.url);
 }
});

test("Markets service worker uses the current cache generation and precaches PWA icons and canonical event ledger",async()=>{
 const sw=await read("markets/service-worker.js");
 assert.match(sw,/zenura-markets-shell-v13/);
 assert.match(sw,/"shared\/paper-demo-event-ledger\.mjs"/);
 assert.ok(sw.includes('"icons/icon-192.png"'));
 assert.ok(sw.includes('"icons/icon-512.png"'));
 assert.ok(sw.includes('"icons/icon-512-maskable.png"'));
 assert.match(sw,/"icons\/icon-192\.svg"/);
 assert.match(sw,/"icons\/icon-512\.svg"/);
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


test("Stocks terminal static assets are all included in the Markets shell precache",async()=>{
 const sw=await read("markets/service-worker.js");
 const html=await read("markets/stocks/index.html");
 const block=sw.match(/const SHELL=\[([\s\S]*?)\]\.map/);
 assert.ok(block,"SHELL allowlist exists");
 const shell=new Set([...block[1].matchAll(/"([^"]*)"/g)].map(match=>new URL(match[1],"https://example.test/markets/").toString()));
 const tags=[...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map(match=>match[0]);
 const refs=tags.flatMap(tag=>{
  let value;
  if(/<script\b/i.test(tag))value=tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  else if(/<link\b/i.test(tag)&&/rel=["'](?:stylesheet|manifest)["']/i.test(tag))value=tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
  return value&&!/^(https?:|data:|#)/i.test(value)?[new URL(value,"https://example.test/markets/stocks/").toString()]:[];
 });
 assert.ok(refs.length>0,"Stocks terminal must expose local static references");
 for(const ref of refs)assert.ok(shell.has(ref),"Stocks terminal asset missing from PWA shell: "+ref);
});

test("PWA install omits ambient cookies and navigation HTML is never written to CacheStorage",async()=>{
 const sw=await read("markets/service-worker.js");
 assert.match(sw,/cache\.addAll\(SHELL\.map\(url=>new Request\(url,\{credentials:"omit"\}\)\)\)/);
 const nav=sw.match(/if\(request\.mode==="navigate"\)\{([\s\S]*?)\n  return;\n \}/);
 assert.ok(nav,"navigation handler exists");
 assert.doesNotMatch(nav[1],/cache\.put/,"network navigation responses must not be persisted");
 assert.match(nav[1],/fetch\(request\)/);
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
