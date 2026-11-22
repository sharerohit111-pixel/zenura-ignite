"use strict";
const CACHE_NAME="zenura-markets-shell-v1";
const SHELL=[
 "/markets/","/markets/index.html","/markets/portal.css","/markets/pwa-register.js",
 "/markets/stocks/","/markets/stocks/index.html","/markets/stocks/stocks.css",
 "/markets/stocks/order-workspace.css","/markets/stocks/chart-theme.css",
 "/markets/stocks/sse-parser.js","/markets/stocks/live-quote.js",
 "/markets/stocks/reconnect-policy.js","/markets/stocks/paper-order-retry-policy.js",
 "/markets/stocks/chart-indicators.js","/markets/stocks/chart-engine.js",
 "/markets/stocks/stocks.js","/markets/stocks/order-workspace.js","/markets/stocks/chart-theme.js",
 "/markets/stocks/supabase-client.js","/markets/stocks/connect.js","/markets/stocks/email-auth.js",
 "/markets/investing/","/markets/investing/index.html","/markets/investing/investing.css","/markets/investing/investing.js",
 "/markets/manifest.webmanifest","/crypto/icon.svg"
];
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
 if(url.origin!==self.location.origin||!url.pathname.startsWith("/markets/"))return;
 if(url.pathname.startsWith("/markets/api/")||url.searchParams.has("token"))return;
 if(request.mode==="navigate"){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    if(response.ok){const cache=await caches.open(CACHE_NAME);cache.put(request,response.clone()).catch(()=>{});}
    return response;
   }catch(_){
    const cached=await caches.match(request)||await caches.match("/markets/");
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
