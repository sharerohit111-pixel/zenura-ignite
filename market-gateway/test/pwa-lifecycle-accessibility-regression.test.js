"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");

test("Markets PWA manifest remains installable and scoped away from Crypto",()=>{
 const manifest=JSON.parse(read("markets/manifest.webmanifest"));
 assert.equal(manifest.scope,"./");
 assert.equal(manifest.start_url,"./");
 assert.equal(manifest.display,"standalone");
 assert.ok(manifest.name && manifest.short_name);
 assert.ok(Array.isArray(manifest.icons) && manifest.icons.length>0);
 for(const icon of manifest.icons)assert.ok(icon.src && icon.sizes && icon.type);
});

test("service worker cache generation is explicit and activation removes stale Markets generations",()=>{
 const sw=read("markets/service-worker.js");
 const cache=sw.match(/const CACHE_NAME="([^"]+)"/)?.[1];
 assert.equal(cache,"zenura-markets-shell-v15");
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
});

test("fetch handler fails closed for authorization, token URLs and non-allowlisted navigation",()=>{
 const sw=read("markets/service-worker.js");
 assert.match(sw,/request\.method!==\"GET\"\|\|request\.headers\.has\(\"authorization\"\)/);
 assert.match(sw,/url\.searchParams\.has\(\"token\"\)/);
 assert.match(sw,/if\(request\.mode===\"navigate\"\)\{[\s\S]*?if\(!shellAsset\)return;/);
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

test("paper terminal has separate navigation destinations and offline page routing",()=>{
 const html=read("markets/stocks/index.html");
 const nav=read("markets/stocks/page-navigation.js");
 const sw=read("markets/service-worker.js");
 const pages=["dashboard","chart","watchlist","balance","positions","orders","history","pnl","derivatives","settings"];
 for(const page of pages)assert.match(html,new RegExp('data-terminal-page="'+page+'"'));
 assert.match(nav,/pageSections/);
 assert.match(nav,/configureWorkspace/);
 assert.match(nav,/configureOrderBook/);
 assert.match(nav,/configurePortfolio/);
 assert.ok(sw.includes('"stocks/page-navigation.js"'));
 assert.match(nav,/data-settings-action/);
});

test("broken image artifacts at the mobile viewport bottom are removed without hiding the main page",()=>{
 const guard=read("markets/bottom-artifact-guard.js");
 const portal=read("markets/index.html");
 const terminal=read("markets/stocks/index.html");
 assert.match(portal,/bottom-artifact-guard\.js/);
 assert.match(terminal,/bottom-artifact-guard\.js/);
 assert.match(guard,/img\.naturalWidth===0/);
 assert.match(guard,/r\.bottom>h-220/);
 assert.match(guard,/zenura-empty-bottom-asset-wrap/);
 assert.match(guard,/MutationObserver/);
});

test("PWA registration checks for updates on launch and when the app returns to foreground",()=>{
 const registration=read("markets/pwa-register.js");
 assert.match(registration,/updateViaCache:"none"/);
 assert.match(registration,/registration\.update\\(\\)/);
 assert.match(registration,/controllerchange/);
 assert.match(registration,/visibilitychange/);
});
