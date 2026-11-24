"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
const axePath=require.resolve("axe-core/axe.min.js");

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const viewport of [{width:1440,height:900,name:"desktop"},{width:390,height:844,name:"android-mobile"},{width:360,height:800,name:"small-mobile"}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},isMobile:viewport.width<500,hasTouch:viewport.width<500,serviceWorkers:"allow"});
   const page=await context.newPage();
   const pageErrors=[];
   page.on("pageerror",error=>pageErrors.push(error.message));
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"networkidle"});
   await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   assert.equal(await page.locator("#screen-nav button[data-screen]").count(),15,viewport.name+" screen count");
   for(const name of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]){
    await page.locator('#screen-nav button[data-screen="'+name+'"]').click();
    await page.locator("#screen-content h2").waitFor();
    assert.ok(await page.locator("#screen-content h2").isVisible(),viewport.name+" "+name+" heading");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,viewport.name+" horizontal document overflow on "+name);
   }
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"networkidle"});
   await page.addScriptTag({path:axePath});
   const axe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}}));
   const serious=axe.violations.filter(v=>v.impact==="critical"||v.impact==="serious");
   assert.equal(serious.length,0,viewport.name+" serious/critical accessibility violations: "+JSON.stringify(serious.map(v=>({id:v.id,help:v.help,nodes:v.nodes.length}))));
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
  await page.goto("http://127.0.0.1:4173/markets/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>navigator.serviceWorker.getRegistration().then(r=>!!r?.active),null,{timeout:15000});
  await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
  const cached=await page.evaluate(async()=>{
   const cache=await caches.open("zenura-markets-shell-v4");
   const paths=["market","account","equity","derivatives"].map(name=>new URL("../../market-gateway/mock/fixtures/"+name+".json",location.href).href);
   const found=[];
   for(const url of paths)found.push({url,found:!!(await cache.match(url))});
   return found;
  });
  assert.ok(cached.every(x=>x.found),"all four canonical fixture JSON files must be precached");
  await pwa.setOffline(true);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
  console.log(JSON.stringify({pwa:"offline demo fixture load PASS",cachedFixtures:cached.length}));
  await pwa.close();
 }finally{
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
