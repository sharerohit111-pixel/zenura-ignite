"use strict";
const BASE=new URL("./",self.registration.scope);
const CACHE_NAME="zenura-markets-shell-v28";
const SHELL=[
 "", "index.html","portal.css","pwa-register.js","language-toggle.js",
 "stocks/","stocks/index.html","stocks/demo.html","stocks/demo.css","stocks/demo.js","stocks/demo-watchlist-persistence.mjs","stocks/demo-derivative-panel.mjs","stocks/demo-derivative-ledger-bridge.mjs","stocks/demo-equity-panel.mjs","stocks/demo-equity-ledger-bridge.mjs","stocks/demo-unified-ledger-panel.mjs","stocks/demo-chart-panel.mjs","stocks/demo-chart-data.mjs","stocks/derivative-mock-simulator.js","shared/paper-demo-adapter.mjs","shared/paper-demo-ledger-session.mjs","shared/paper-demo-event-ledger.mjs","../market-gateway/lib/derivative-position.js","../market-gateway/lib/equity-demo-execution-engine.js","../market-gateway/mock/fixtures/market.json","../market-gateway/mock/fixtures/account.json","../market-gateway/mock/fixtures/equity.json","../market-gateway/mock/fixtures/derivatives.json","../market-gateway/mock/fixtures/equity-execution.json","stocks/stocks.css","stocks/page-navigation.js","stocks/premium-shell.css","stocks/premium-shell.js","stocks/sidebar.css","stocks/sidebar.js","stocks/android-bottom-dock-guard.js","stocks/demo-premium.css","stocks/demo-premium.js","stocks/order-workspace.css","stocks/chart-theme.css","stocks/futures-limit-workspace.css","stocks/options-limit-workspace.css",
 "stocks/sse-parser.js","stocks/live-quote.js","stocks/reconnect-policy.js","stocks/paper-order-retry-policy.js",
 "stocks/chart-indicators.js","stocks/chart-engine.js","stocks/stocks.js","stocks/order-workspace.js","stocks/futures-limit-policy.js","stocks/futures-limit-workspace.js","stocks/options-limit-workspace.js","stocks/protective-orders.js","stocks/chart-theme.js",
 "stocks/supabase-client.js","stocks/connect.js","stocks/email-auth.js",
 "manifest.webmanifest","icons/icon-192.svg","icons/icon-512.svg"
].map(path=>new URL(path,BASE).toString());
self.addEventListener("install",event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  await cache.addAll(SHELL);
  await self.skipWaiting();
 })());
});
self.addEventListener("activate",event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith("zenura-markets-")&&key!==CACHE_NAME).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET"||request.headers.has("authorization"))return;
 const url=new URL(request.url);
 const shellAsset=SHELL.includes(url.toString());
 if(url.origin!==BASE.origin||(!url.pathname.startsWith(BASE.pathname)&&!shellAsset))return;
 if(url.searchParams.has("token"))return;
 if(request.mode==="navigate"){
  // Only explicitly listed static shell documents may be cached. Never cache
  // arbitrary same-origin navigation responses that could become user-specific.
  if(!shellAsset)return;
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    if(response.ok){const cache=await caches.open(CACHE_NAME);cache.put(request,response.clone()).catch(()=>{});}
    return response;
   }catch(_){
    const cached=await caches.match(request)||await caches.match(new URL("./",BASE).toString());
    return cached||new Response("ZENURA IGNITE is offline. Reconnect to load the latest market terminal.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
   }
  })());
  return;
 }
 if(shellAsset){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   // Network-first prevents an installed PWA from serving yesterday's
   // JavaScript/CSS/HTML after a new deployment. Fall back only when offline.
   try{
    const response=await fetch(request,{cache:"no-store"});
    if(response.ok)await cache.put(request,response.clone()).catch(()=>{});
    return response;
   }catch(_){
    const cached=await cache.match(request);
    return cached||new Response("",{status:504});
   }
  })());
});
