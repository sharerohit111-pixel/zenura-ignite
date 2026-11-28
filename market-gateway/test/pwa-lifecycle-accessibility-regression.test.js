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
 assert.equal(cache,"zenura-markets-shell-v20");
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

test("paper terminal mobile bottom bar exposes the four requested functional shortcuts",()=>{
 const html=read("markets/stocks/index.html");
 const shell=read("markets/stocks/premium-shell.js");
 const nav=read("markets/stocks/page-navigation.js");
 const css=read("markets/stocks/premium-shell.css");
 assert.match(shell,/bottom\.dataset\.appBottomNav=""/);
 for(const page of ["derivatives","positions","watchlist","support"])assert.ok(shell.includes('["'+page+'"'));
 assert.match(shell,/\["derivatives","Option Chain"\],\["positions","Live Pos\. \/ P&L"\],\["watchlist","Quick Watchlist"\],\["support","Help & Support"\]/);
 assert.match(nav,/support:\["\.support-page"\]/);
 assert.match(nav,/pageRoot\.append\(support\)/);
 assert.match(nav,/support-save-draft/);
 assert.match(css,/\.stocks-page \.app-bottom-nav\{[\s\S]*?position:fixed!important/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(css,/z-index:9999!important/);
 assert.match(css,/visibility:visible!important/);
 assert.match(css,/env\(safe-area-inset-bottom\)/);
 assert.match(html,/<nav class="terminal-nav"/);
});

test("S-TRADE sidebar exposes exactly ten main destinations and six functional Settings actions",()=>{
 const html=read("markets/stocks/index.html");
 const sidebar=read("markets/stocks/sidebar.js");
 const css=read("markets/stocks/sidebar.css");
 const sw=read("markets/service-worker.js");
 const expected=["Dashboard","Chart & Trade","Watchlist","Option Chain","Portfolio & Positions","Orders & Trade History","Virtual Wallet","P&L","Settings","Help & Support"];
 for(const label of expected)assert.ok(sidebar.includes('"'+label+'"'),"missing sidebar destination: "+label);
 for(const action of ["theme","language","chart","notifications","account","security"])assert.ok(sidebar.includes('["'+action+'"')||sidebar.includes('data-settings-feature="'+action+'"')||sidebar.includes('if(id==="'+action+'")'),"missing Settings action: "+action);
 assert.match(html,/href="\.\/sidebar\.css"/);
 assert.match(html,/src="\.\/sidebar\.js"/);
 assert.match(sw,/"stocks\/sidebar\.css","stocks\/sidebar\.js"/);
 assert.match(css,/width:min\(360px,70vw\)/);
 assert.match(css,/\.sidebar-overlay/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(sidebar,/requestPermission\(\)/);
 assert.match(sidebar,/email-sign-out/);
});
