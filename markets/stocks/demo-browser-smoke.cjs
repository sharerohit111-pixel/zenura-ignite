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
   const pageErrors=[],pageConsole=[];
   page.on("pageerror",error=>pageErrors.push(error.message));
   page.on("console",message=>{if(message.type()==="error")pageConsole.push(message.text());});
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
   try{await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});}
   catch(error){const diagnostic=await page.locator("#demo-status").textContent().catch(()=>" (missing status)");throw new Error("Demo fixture bootstrap failed: status="+diagnostic+"; pageErrors="+pageErrors.join(" | ")+"; console="+pageConsole.join(" | ")+"; "+error.message);}
   assert.equal(await page.locator("#screen-nav button[data-screen]").count(),15,viewport.name+" screen count");
   for(const name of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]){
    await page.locator('#screen-nav button[data-screen="'+name+'"]').click();
    await page.locator("#screen-content > .screen-title h2").waitFor();
    assert.ok(await page.locator("#screen-content > .screen-title h2").isVisible(),viewport.name+" "+name+" heading");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,viewport.name+" horizontal document overflow on "+name);
   }
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
   await page.addScriptTag({path:axePath});
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
   console.log(JSON.stringify({viewport:viewport.name,screens:15,axeSeriousCritical:0,...perf}));
   await context.close();
  }

  const pwa=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"allow"});
  const page=await pwa.newPage();
  const pwaConsole=[];
  page.on("console",message=>pwaConsole.push(message.type()+": "+message.text()));
  page.on("pageerror",error=>pwaConsole.push("pageerror: "+error.message));
  console.log("PWA: opening market shell");
  await page.goto("http://127.0.0.1:4173/markets/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForLoadState("load",{timeout:10000});
  const workerState=await page.evaluate(async()=>{
   const deadline=Date.now()+20000;
   let registrations=[];
   while(Date.now()<deadline){
    registrations=await navigator.serviceWorker.getRegistrations();
    const active=registrations.find(item=>item.active?.state==="activated");
    if(active)return {state:active.active.state,scope:active.scope};
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   return {state:"missing",registrations:registrations.map(item=>({scope:item.scope,installing:item.installing?.state||null,waiting:item.waiting?.state||null,active:item.active?.state||null}))};
  });
  console.log("PWA: waiting for service worker activation");
  assert.equal(workerState.state,"activated","service worker activation state: "+JSON.stringify(workerState));
  console.log(JSON.stringify({pwaWorker:workerState.state,scope:workerState.scope}));
  // clients.claim() in the activate handler controls existing same-scope clients.
  // Open a fresh same-scope tab rather than forcing a navigation reload race.
  const controlledPage=await pwa.newPage();
  console.log("PWA: opening demo under service worker");
  await controlledPage.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
  await controlledPage.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:15000});
  await page.close();
  const demoPage=controlledPage;
  await demoPage.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
  const cached=await demoPage.evaluate(async()=>{
   const cache=await caches.open("zenura-markets-shell-v7");
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
