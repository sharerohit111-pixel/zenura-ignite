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
 assert.match(worker,/zenura-markets-shell-v25/);
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
