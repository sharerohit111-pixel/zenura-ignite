"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"stocks","index.html"),"utf8");
const worker=fs.readFileSync(path.join(root,"service-worker.js"),"utf8");
const shellBlock=worker.match(/const SHELL=\[([\s\S]*?)\]\.map\(/);
assert.ok(shellBlock,"service worker must declare a static shell list");
const shellPaths=[...shellBlock[1].matchAll(/"([^"]+)"/g)].map(match=>match[1]);
const normalizeShell=value=>path.posix.normalize(path.posix.join("markets",value)).replace(/^markets\//,"");
const normalizePageAsset=value=>path.posix.normalize(path.posix.join("markets","stocks",value)).replace(/^markets\//,"");
const shellSet=new Set(shellPaths.map(normalizeShell));
const localAssets=[];
for(const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)){
 const tag=match[0];
 const isLocalScript=/<script\b/i.test(tag);
 const isLocalLink=/<link\b/i.test(tag)&&/rel=["'](?:stylesheet|manifest)["']/i.test(tag);
 if(!isLocalScript&&!isLocalLink)continue;
 const attribute=isLocalScript?"src":"href";
 const value=tag.match(new RegExp(attribute+"=[\"']([^\"']+)[\"']","i"))?.[1];
 if(!value||/^(?:https?:|data:|#)/i.test(value))continue;
 localAssets.push(value);
}
const missing=[...new Set(localAssets.map(normalizePageAsset).filter(asset=>!shellSet.has(asset)))];
test("markets PWA install shell includes every local page script, stylesheet and manifest",()=>{
 assert.deepEqual(missing,[]);
});
test("markets PWA shell entries are unique",()=>{
 assert.equal(shellPaths.length,new Set(shellPaths).size);
});
test("markets PWA shell cache version is bumped",()=>{
 assert.match(worker,/CACHE_NAME="zenura-markets-shell-v3"/);
});

test("markets PWA manifest is valid JSON",()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.webmanifest"),"utf8"));
 assert.equal(manifest.start_url,"./");
 assert.equal(manifest.scope,"./");
});
