"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");
const serviceWorker=fs.readFileSync("markets/service-worker.js","utf8");
const shellBlock=serviceWorker.match(/const SHELL=\[([\s\S]*?)\]\.map/);
assert.ok(shellBlock,"service worker shell precache list must exist");
const shellEntries=[...shellBlock[1].matchAll(/"([^"]*)"/g)].map(match=>match[1]);
assert.equal(new Set(shellEntries).size,shellEntries.length,"duplicate precache URLs prevent reliable service worker installation");
const axePath=require.resolve("axe-core/axe.min.js");

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const viewport of [{width:1440,height:900,name:"desktop"},{width:390,height:844,name:"android-mobile"},{width:360,height:800,name:"small-mobile"}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},isMobile:viewport.width<500,hasTouch:viewport.width<500,serviceWorkers:"allow"});
   const page=await context.newPage();
   const pageErrors=[];
   page.on("pageerror",error=>pageErrors.push(error.message));
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   assert.equal(await page.locator("#screen-nav button[data-screen]").count(),15,viewport.name+" screen count");
   for(const name of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]){
    await page.locator('#screen-nav button[data-screen="'+name+'"]').click();
    await page.locator("#screen-content > .screen-title h2").waitFor();
    assert.ok(await page.locator("#screen-content > .screen-title h2").isVisible(),viewport.name+" "+name+" heading");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,viewport.name+" horizontal document overflow on "+name);
   }
   if(viewport.name==="desktop"){
    await page.locator('#screen-nav button[data-screen="watchlists"]').click();
    assert.equal(await page.locator(".catalog-panel h3").filter({hasText:"Private Watchlists"}).count(),1,"private watchlist panel is present exactly once");
    const candidate=page.locator("#demo-watchlist-instrument option:not([disabled])").last();
    await page.locator("#demo-watchlist-instrument").selectOption(await candidate.getAttribute("value"));
    await page.getByRole("button",{name:"ADD TO WATCHLIST"}).click();
    const rows=page.locator(".catalog-results tbody tr"),afterAdd=await rows.count();assert.ok(afterAdd>0,"session watchlist add");
    const moveDown=page.getByRole("button",{name:/Move .* down/}).first();if(await moveDown.count())await moveDown.click();
    await page.getByRole("button",{name:"REMOVE"}).first().click();assert.equal(await rows.count(),afterAdd-1,"session watchlist remove");
    await page.locator('#screen-nav button[data-screen="charts"]').click();
    await page.locator('[data-demo-timeframe="1m"]').click();
    assert.equal(await page.locator('[data-demo-timeframe="1m"]').getAttribute("aria-pressed"),"true","chart timeframe ARIA state");
   }
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   await page.addScriptTag({path:axePath});
   const toggle=page.locator("#language-toggle");
   await toggle.click();assert.equal(await page.locator("html").getAttribute("lang"),"hi",viewport.name+" Hindi language metadata");
   assert.equal(await page.locator("#screen-nav button[data-screen=\"home\"]").textContent(),"होम",viewport.name+" Hindi nav translation");
   assert.equal(await toggle.evaluate(node=>getComputedStyle(node).position),"fixed",viewport.name+" language toggle fixed positioning");
   assert.equal(await toggle.getAttribute("aria-label"),"इंटरफ़ेस की भाषा हिंदी करें",viewport.name+" translated toggle accessibility label");
   await page.reload({waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   assert.equal(await page.locator("html").getAttribute("lang"),"hi",viewport.name+" language preference persists after reload");
   await page.locator("#language-toggle").click();assert.equal(await page.locator("html").getAttribute("lang"),"en",viewport.name+" English language metadata");
   await page.locator("#screen-nav button[data-screen=\"charts\"]").click();
   assert.equal(await page.locator("[data-demo-timeframe=\"5m\"]").getAttribute("aria-pressed"),"true",viewport.name+" selected chart timeframe state");
   await page.locator("[data-demo-timeframe=\"1m\"]").click();assert.equal(await page.locator("[data-demo-timeframe=\"1m\"]").getAttribute("aria-pressed"),"true",viewport.name+" chart control state");
   await page.locator("#screen-nav button[data-screen=\"options\"]").click();assert.ok(await page.locator(".catalog-results .table-wrap").count(),viewport.name+" option chain table region");
   if(viewport.width<500){const controls=await page.locator(".catalog-controls select").evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().width>0));assert.equal(controls,true,viewport.name+" option-chain controls remain visible");}
   const axe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}}));
   const serious=axe.violations.filter(v=>v.impact==="critical"||v.impact==="serious");
   if(serious.length) console.error(JSON.stringify(serious.map(v=>({id:v.id,help:v.help,nodes:v.nodes.map(n=>({target:n.target,html:n.html,failureSummary:n.failureSummary}))}))));
   assert.equal(serious.length,0,viewport.name+" serious/critical accessibility violations");
   const perf=await page.evaluate(()=>{
    const nav=performance.getEntriesByType("navigation")[0];
    return {domContentLoadedMs:Math.round(nav?.domContentLoadedEventEnd||0),loadMs:Math.round(nav?.loadEventEnd||0),
     transferBytes:performance.getEntriesByType("resource").reduce((sum,x)=>sum+(x.transferSize||0),0)};
   });
   assert.ok(perf.domContentLoadedMs<8000,viewport.name+" DOMContentLoaded performance budget");
   assert.ok(perf.transferBytes<5*1024*1024,viewport.name+" transfer budget");
   assert.deepEqual(pageErrors,[],viewport.name+" browser errors");
   assert.deepEqual(consoleErrors,[],viewport.name+" console errors");
   console.log(JSON.stringify({viewport:viewport.name,screens:15,perScreenAxe:true,keyboardNavigation:true,axeSeriousCritical:0,consoleErrors:0,...perf}));
   await context.close();
  }

  const pwa=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"allow"});
  const page=await pwa.newPage();
  page.on("console",message=>{if(message.type()==="warning"||message.type()==="error")console.log("PWA browser console:",message.text());});
  page.on("requestfailed",request=>console.log("PWA request failed:",request.url(),request.failure()?.errorText||"unknown"));
  console.log("PWA: opening market shell");
  await page.goto("http://127.0.0.1:4173/markets/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForLoadState("load",{timeout:10000});
  console.log("PWA: waiting for service worker activation");
  // navigator.serviceWorker.ready returns the registration that actually
  // controls this origin; avoid racing repeated getRegistrations() snapshots
  // while Chromium transitions installing -> activated.
  const workerState=await page.evaluate(async()=>{
   const timeout=new Promise(resolve=>setTimeout(()=>resolve(null),20000));
   const registration=await Promise.race([navigator.serviceWorker.ready,timeout]);
   if(!registration){
    return {state:"missing",scope:null,controller:!!navigator.serviceWorker.controller,
     registrations:(await navigator.serviceWorker.getRegistrations()).map(item=>({
      scope:item.scope,installing:item.installing?.state||null,
      waiting:item.waiting?.state||null,active:item.active?.state||null
     })),
     registerScript:!!document.querySelector('script[src="./pwa-register.js"]')};
   }
   return {state:registration.active?.state||"missing",scope:registration.scope,
    controller:!!navigator.serviceWorker.controller};
  });
  console.log("PWA registration result:",JSON.stringify(workerState));
  assert.equal(workerState.state,"activated","service worker must be active before controlled reload");
  console.log(JSON.stringify({pwaWorker:workerState.state,scope:workerState.scope}));
  // Wait for the activated registration before reloading into its controlled scope.
  console.log("PWA: reloading under active service worker");
  await page.reload({waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:15000});
  const controlledPage=await pwa.newPage();
  console.log("PWA: opening demo under service worker");
  await controlledPage.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
  await controlledPage.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:15000});
  await page.close();
  const demoPage=controlledPage;
  await demoPage.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
  const cached=await demoPage.evaluate(async()=>{
   const cache=await caches.open("zenura-markets-shell-v8");
   const paths=["market","account","equity","derivatives"].map(name=>new URL("../../market-gateway/mock/fixtures/"+name+".json",location.href).href);
   const found=[];
   for(const url of paths)found.push({url,found:!!(await cache.match(url))});
   return found;
  });
  assert.ok(cached.every(x=>x.found),"all four canonical fixture JSON files must be precached");
  console.log("PWA: validating offline cached fixtures");
  await pwa.setOffline(true);
  await demoPage.reload({waitUntil:"domcontentloaded",timeout:15000});
  await demoPage.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
  console.log(JSON.stringify({pwa:"offline demo fixture load PASS",cachedFixtures:cached.length}));
  await pwa.close();
 }finally{
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
