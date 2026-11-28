"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const css=fs.readFileSync(path.join(root,"markets/stocks/premium-shell.css"),"utf8");
const html=fs.readFileSync(path.join(root,"markets/stocks/index.html"),"utf8");
const shell=fs.readFileSync(path.join(root,"markets/stocks/premium-shell.js"),"utf8");
const worker=fs.readFileSync(path.join(root,"markets/service-worker.js"),"utf8");
const guard=fs.readFileSync(path.join(root,"markets/stocks/android-bottom-dock-guard.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"markets/manifest.webmanifest"),"utf8"));

test("Android dock has one authoritative final viewport and safe-area contract",()=>{
 const start=css.lastIndexOf("/* FINAL ANDROID DOCK CONTRACT");
 assert.ok(start>=0,"final dock contract must be present");
 const final=css.slice(start);
 assert.match(final,/position:fixed!important/);
 assert.match(final,/inset:auto 0 0 0!important/);
 assert.match(final,/bottom:0!important/);
 assert.match(final,/height:calc\(72px \+ env\(safe-area-inset-bottom,0px\)\)!important/);
 assert.match(final,/padding:6px max\(8px,env\(safe-area-inset-right,0px\)\) calc\(6px \+ env\(safe-area-inset-bottom,0px\)\) max\(8px,env\(safe-area-inset-left,0px\)\)!important/);
 assert.match(final,/background:var\(--app-surface,#fff\)!important/);
 assert.match(final,/background-image:none!important/);
 assert.match(final,/transform:none!important/);
 assert.match(final,/::before[\s\S]*?content:none!important/);
 assert.doesNotMatch(final,/max-height:calc\(/);
});

test("five-item dock remains generated from the existing five functional routes",()=>{
 assert.match(shell,/\[\["dashboard","Home"\],\["derivatives","Option Chain"\],\["positions","Live Pos\. \/ P&L"\],\["watchlist","Quick Watchlist"\],\["support","Help & Support"\]\]/);
 assert.match(html,/viewport-fit=cover/);
 assert.match(worker,/zenura-markets-shell-v28/);
 assert.match(worker,/"stocks\/premium-shell\.css"/);
});


test("Android dock guard removes only broken images overlapping the bottom dock",()=>{
 assert.match(html,/android-bottom-dock-guard\.js/);
 assert.match(worker,/"stocks\/android-bottom-dock-guard\.js"/);
 assert.match(guard,/img\.complete/);
 assert.match(guard,/img\.naturalWidth!==0/);
 assert.match(guard,/r\.bottom>h-190/);
 assert.match(guard,/zenura-broken-bottom-image/);
 assert.match(css,/zenura-broken-bottom-image-wrap\{display:none!important/);
});


test("installed app launches directly into the main Paper Trading dashboard",()=>{
 assert.match(html,/<meta name="zenura-entry-redirect" content="stocks\/">);
 assert.match(html,/<meta http-equiv="refresh" content="0;url=\.\/stocks\/">);
 assert.match(html,/location\.replace\(new URL\("\.\/stocks\/",location\.href\)\.href\)/);
 assert.equal(manifest.start_url,"./stocks/");
 assert.equal(manifest.id,"./");
 assert.match(worker,/zenura-markets-shell-v28/);
});


test("Android dock guard collapses empty wrappers around failed bottom images",()=>{
 assert.match(guard,/function hideEmptyImageWrappers\(img\)/);
 assert.match(guard,/parent\.textContent\.trim\(\)\.length>0/);
 assert.match(guard,/depth<5/);
 assert.match(css,/zenura-broken-bottom-image-wrap\{display:none!important/);
});


test("installed PWA checks for updates and refreshes stale shell assets",()=>{
 const registration=fs.readFileSync(path.join(root,"markets/pwa-register.js"),"utf8");
 assert.match(registration,/updateViaCache:"none"/);
 assert.match(registration,/registration\.update\(\)/);
 assert.match(registration,/visibilitychange/);
 assert.match(registration,/controllerchange/);
 assert.match(worker,/zenura-markets-shell-v28/);
 assert.match(worker,/fetch\(request,\{cache:"no-store"\}\)/);
 assert.match(worker,/Network-first prevents an installed PWA/);
 assert.doesNotMatch(worker,/const network=fetch\(request\)/);
});
