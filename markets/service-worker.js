"use strict";
const BASE=new URL("./",self.registration.scope);
const CACHE_NAME="zenura-markets-shell-v3";
const SHELL=[
 "", "index.html","portal.css","pwa-register.js","language-toggle.js",
 "stocks/","stocks/index.html","stocks/stocks.css","stocks/order-workspace.css",
 "stocks/options-limit-workspace.css","stocks/chart-theme.css","stocks/futures-limit-workspace.css",
 "stocks/sse-parser.js","stocks/live-quote.js","stocks/reconnect-policy.js","stocks/paper-order-retry-policy.js",
 "stocks/chart-indicators.js","stocks/chart-engine.js","stocks/stocks.js","stocks/futures-limit-policy.js",
 "stocks/futures-limit-workspace.js","stocks/order-workspace.js","stocks/options-limit-workspace.js",
 "stocks/protective-orders.js","stocks/chart-theme.js","stocks/supabase-client.js","stocks/connect.js",
 "stocks/email-auth.js","manifest.webmanifest","../crypto/icon.svg"
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
 if(url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
 if(url.searchParams.has("token"))return;
 if(request.mode==="navigate"){
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
 if(["style","script","image","font"].includes(request.destination)||url.pathname.endsWith(".webmanifest")){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME),cached=await cache.match(request);
   const network=fetch(request).then(response=>{
    if(response.ok)cache.put(request,response.clone()).catch(()=>{});
    return response;
   }).catch(()=>null);
   if(cached){event.waitUntil(network.then(()=>{}));return cached;}
   return await network||new Response("",{status:504});
  })());
 }
});
