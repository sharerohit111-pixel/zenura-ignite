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
   // Browser QA explicitly opts into the local simulator; production remains fail-closed by default.
   await context.addInitScript(()=>{window.ZENURA_RUNTIME_ENV="test";});
   const page=await context.newPage();
   const pageErrors=[];
   const browserDiagnostics=[];
   page.on("pageerror",error=>pageErrors.push(error.message));
   page.on("console",message=>{if(message.type()==="error")browserDiagnostics.push("console: "+message.text());});
   page.on("requestfailed",request=>browserDiagnostics.push("request failed: "+request.url()+" "+(request.failure()?.errorText||"")));
   page.on("response",response=>{if(response.status()>=400)browserDiagnostics.push("HTTP "+response.status()+": "+response.url());});
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
   try {
    await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   } catch(error) {
    const state=await page.evaluate(()=>({status:document.querySelector("#demo-status")?.textContent||null,heading:document.querySelector("#screen-content")?.innerText?.slice(0,500)||null,readyState:document.readyState}));
    throw new Error("Demo fixture startup timed out: "+JSON.stringify({state,pageErrors,browserDiagnostics})+"; "+error.message);
   }
   assert.equal(await page.locator("#screen-nav button[data-screen]").count(),15,viewport.name+" screen count");
   for(const name of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]){
    await page.locator('#screen-nav button[data-screen="'+name+'"]').click();
    await page.locator("#screen-content > .screen-title h2").waitFor();
    assert.ok(await page.locator("#screen-content > .screen-title h2").isVisible(),viewport.name+" "+name+" heading");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,viewport.name+" horizontal document overflow on "+name);
   }
   // Exercise chart interactions on desktop and both mobile viewports.
   await page.locator('#screen-nav button[data-screen="charts"]').click();
   assert.ok(await page.locator(".demo-badge").textContent().then(value=>value.includes("MOCK")&&value.includes("DEMO DATA")&&value.includes("NOT LIVE")),"chart MOCK / DEMO DATA identity");
   await page.waitForFunction(()=>document.querySelector("#demo-depth-status")?.textContent.includes("3 bid / 3 ask levels"),null,{timeout:10000});
   assert.ok((await page.locator("#demo-depth-status").textContent()).includes("3 bid / 3 ask levels"),"canonical matching instrument exposes fixture depth");
   const chartInstrument=page.locator("#demo-instrument");
   await chartInstrument.selectOption({index:1});
   assert.ok((await page.locator("#demo-depth-status").textContent()).includes("Depth unavailable"),"unmatched instrument must not inherit another instrument's depth");
   await chartInstrument.selectOption({index:0});
   assert.ok((await page.locator("#demo-depth-status").textContent()).includes("3 bid / 3 ask levels"),"fixture depth returns only for its exact instrument");
   await page.locator('[data-demo-timeframe="1m"]').click();
   assert.ok(await page.locator('[data-demo-timeframe="1m"]').evaluate(node=>node.classList.contains("active")),"chart timeframe control");
   await page.locator('[data-demo-chart-type="LINE"]').click();
   assert.ok(await page.locator('[data-demo-chart-type="LINE"]').evaluate(node=>node.classList.contains("active")),"chart style control");
   assert.equal(await page.locator("#demo-chart-svg").getAttribute("aria-label"),"Synthetic candlestick or line chart with volume","chart accessible description");

   if(viewport.name==="desktop"){
    // Watchlist add / reorder / remove must mutate only the session Demo list.
    await page.locator('#screen-nav button[data-screen="watchlists"]').click();
    const candidate=page.locator("#demo-watchlist-instrument option:not([disabled])").last();
    await page.locator("#demo-watchlist-instrument").selectOption(await candidate.getAttribute("value"));
    await page.getByRole("button",{name:"ADD TO WATCHLIST"}).click();
    const watchRows=page.locator(".catalog-results tbody tr");
    const countAfterAdd=await watchRows.count();
    assert.ok(countAfterAdd>0,"watchlist add should create a row");
    const moveDown=page.getByRole("button",{name:/Move .* down/}).first();
    if(await moveDown.count()) await moveDown.click();
    await page.getByRole("button",{name:"REMOVE"}).first().click();
    assert.equal(await watchRows.count(),countAfterAdd-1,"watchlist remove should remove one row");

    // Option chain filters and paired CE/PE rows must render from canonical MOCK catalog.
    await page.locator('#screen-nav button[data-screen="options"]').click();
    await page.locator("#options-expiry").waitFor();
    assert.ok(await page.locator(".catalog-results tbody tr").count()>0,"option chain rows");
    await page.locator("#options-side").selectOption("CE");
    assert.ok(await page.locator(".catalog-results tbody tr").count()>0,"filtered CE option chain rows");

    // Equity market order -> manual deterministic fill -> immutable receipt.
    await page.locator('#screen-nav button[data-screen="equity"]').click();
    await page.waitForFunction(()=>document.querySelector(".demo-eq-status")?.textContent.includes("simulator ready"));
    await page.getByRole("button",{name:"PLACE DEMO ORDER"}).click();
    await page.getByRole("button",{name:"SIMULATE NEXT FILL"}).click();
    assert.ok((await page.locator(".demo-eq-status").textContent()).includes("Synthetic fill"),"Equity order fill flow");
    assert.ok(await page.locator(".demo-eq-table-wrap").nth(2).locator("tbody tr").count()>0,"Equity immutable fill receipt");

    // Futures and Options MARKET order entry must accept a local synthetic order.
    await page.locator('#screen-nav button[data-screen="futures"]').click();
    await page.waitForFunction(()=>{const status=document.querySelector(".demo-fo-status")?.textContent||"";return status&&!status.includes("Loading deterministic");});
    const futureStatus=await page.locator(".demo-fo-status").textContent();
    console.log("Futures Demo status:",futureStatus);
    assert.ok(futureStatus.includes("MOCK quote selected"),futureStatus);
    await page.getByRole("button",{name:"BUY",exact:true}).last().click();
    assert.ok((await page.locator(".demo-fo-status").textContent()).includes("DEMO receipt"),"Futures order entry");
    await page.locator('#screen-nav button[data-screen="options"]').click();
    await page.waitForFunction(()=>{const status=document.querySelector(".demo-fo-status")?.textContent||"";return status&&!status.includes("Loading deterministic");});
    const optionsStatus=await page.locator(".demo-fo-status").textContent();
    console.log("Options Demo status:",optionsStatus);
    assert.ok(optionsStatus.includes("MOCK quote selected"),optionsStatus);
    await page.getByRole("button",{name:"BUY",exact:true}).last().click();
    assert.ok((await page.locator(".demo-fo-status").textContent()).includes("DEMO receipt"),"Options order entry");
    // Unified Trade History and Portfolio must project all three asset classes from the same ledger.
    await page.locator('#screen-nav button[data-screen="trades"]').click();
    await page.locator(".demo-unified-ledger").waitFor();
    const tradeRows=await page.locator(".demo-unified-table-wrap tbody tr").allTextContents();
    assert.ok(tradeRows.some(row=>row.includes("EQUITY")),"unified history includes Equity fills");
    assert.ok(tradeRows.some(row=>row.includes("FUTURE")),"unified history includes Futures fills");
    assert.ok(tradeRows.some(row=>row.includes("OPTION")),"unified history includes Options fills");
    await page.locator('#screen-nav button[data-screen="portfolio"]').click();
    await page.locator(".demo-unified-ledger").waitFor();
    const portfolioRows=await page.locator(".demo-unified-table-wrap tbody tr").allTextContents();
    assert.ok(portfolioRows.some(row=>row.includes("EQUITY")),"unified portfolio includes Equity");
    assert.ok(portfolioRows.some(row=>row.includes("FUTURE")),"unified portfolio includes Futures");
    assert.ok(portfolioRows.some(row=>row.includes("OPTION")),"unified portfolio includes Options");
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
   // Keep viewport contexts alive until browser.close() in finally. Closing an\n   // individual Chromium context here intermittently stalls CI after all checks\n   // have passed, preventing the PWA phase from starting.\n   console.log("Viewport QA complete; retaining context for final browser cleanup: "+viewport.name);
  }

  const pwa=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"allow"});
  // Keep the PWA fixture smoke in explicit test mode, never an implicit development default.
  await pwa.addInitScript(()=>{window.ZENURA_RUNTIME_ENV="test";});
  const page=await pwa.newPage();
  console.log("PWA: opening market shell");
  await page.goto("http://127.0.0.1:4173/markets/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForLoadState("load",{timeout:10000});
  await page.waitForFunction(async()=>{
   const registrations=await navigator.serviceWorker.getRegistrations();
   return registrations.some(registration=>registration.active?.state==="activated");
  },null,{timeout:20000});
  console.log("PWA: waiting for service worker activation");
  // navigator.serviceWorker.ready may resolve while the active worker is
  // still transitioning through "activating"; wait for the actual state.
  await page.waitForFunction(async()=>{
   const registration=await navigator.serviceWorker.ready;
   return registration.active?.state==="activated";
  },null,{timeout:20000});
  const workerState=await page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.ready;
   return {state:registration.active?.state||"missing",scope:registration.scope||null};
  });
  assert.equal(workerState.state,"activated","service worker must be active before controlled reload");
  assert.ok(workerState.scope.endsWith("/markets/"),"Markets service worker scope must not capture Crypto or production routes");
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
   const cache=await caches.open("zenura-markets-shell-v9");
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
