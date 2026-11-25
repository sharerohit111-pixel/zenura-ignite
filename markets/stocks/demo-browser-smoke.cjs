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

async function scanTextContrast(page){
 return page.evaluate(()=>{
  const rgb=value=>{const m=String(value).match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(",").map(x=>Number.parseFloat(x.trim()));return p.length>=3&&p.slice(0,3).every(Number.isFinite)?{r:p[0],g:p[1],b:p[2],a:p.length>3&&Number.isFinite(p[3])?p[3]:1}:null;};
  const blend=(front,back)=>({r:front.r*front.a+back.r*(1-front.a),g:front.g*front.a+back.g*(1-front.a),b:front.b*front.a+back.b*(1-front.a),a:1});
  const luminance=c=>{const channel=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};return .2126*channel(c.r)+.7152*channel(c.g)+.0722*channel(c.b);};
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const bodyStyle=getComputedStyle(document.body),bodyColor=rgb(bodyStyle.backgroundColor);
  const rootColor=rgb(getComputedStyle(document.documentElement).backgroundColor);
  const cssFallback=rgb(bodyStyle.getPropertyValue("--bg").trim())||{r:7,g:17,b:31,a:1};
  const failures=[],measured=[];
  for(const node of document.querySelectorAll("body *")){
   if(node.children.length||!node.textContent.trim())continue;
   const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
   if(!rect.width||!rect.height||style.visibility==="hidden"||style.display==="none")continue;
   if(node.closest(':disabled,[aria-disabled="true"]'))continue;
   let opacity=1;const chain=[];
   for(let el=node;el&&el!==document.documentElement;el=el.parentElement){chain.push(el);opacity*=Number.parseFloat(getComputedStyle(el).opacity)||0;}
   if(opacity===0)continue;
   let bg={...(rootColor&&rootColor.a>0?rootColor:cssFallback)};
   if(bodyColor&&bodyColor.a>0)bg=blend(bodyColor,bg);
   for(const el of chain.reverse()){const layer=rgb(getComputedStyle(el).backgroundColor);if(layer&&layer.a>0)bg=blend(layer,bg);}
   const fg=rgb(style.color);if(!fg)continue;
   const effectiveFg=blend({...fg,a:fg.a*opacity},bg);
   const value=ratio(effectiveFg,bg),size=parseFloat(style.fontSize)||16,weight=parseInt(style.fontWeight,10)||400;
   const large=size>=24||(size>=18.66&&weight>=700),minimum=large?3:4.5;
   const record={text:node.textContent.trim().slice(0,70),foreground:style.color,background:"rgb("+Math.round(bg.r)+", "+Math.round(bg.g)+", "+Math.round(bg.b)+")",ratio:Number(value.toFixed(2)),minimum};
   measured.push(record);if(value+0.01<minimum)failures.push(record);
  }
  return {textNodes:measured.length,minimumRatio:measured.length?Math.min(...measured.map(x=>x.ratio)):null,failures:failures.slice(0,30)};
 });
}

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const viewport of [{width:1440,height:900,name:"desktop"},{width:390,height:844,name:"android-mobile"},{width:360,height:800,name:"small-mobile"}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},isMobile:viewport.width<500,hasTouch:viewport.width<500,serviceWorkers:"allow"});
   const page=await context.newPage();
   const pageErrors=[],consoleErrors=[];
   page.on("pageerror",error=>pageErrors.push(error.message));
   page.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text());});
   await page.goto("http://127.0.0.1:4173/markets/stocks/demo.html",{waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   await page.addScriptTag({path:axePath});
   assert.equal(await page.locator("#screen-nav button[data-screen]").count(),15,viewport.name+" screen count");
   const firstNav=page.locator("#screen-nav button[data-screen=\"home\"]");await firstNav.focus();
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.screen),"home",viewport.name+" keyboard focus reaches navigation");
   await page.keyboard.press("Tab");assert.equal(await page.evaluate(()=>document.activeElement?.dataset.screen),"market",viewport.name+" Tab moves through screen navigation");
   const contrastReports=[];
   for(const name of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]){
    await page.locator('#screen-nav button[data-screen="'+name+'"]').click();
    await page.locator("#screen-content > .screen-title h2").waitFor();
    assert.ok(await page.locator("#screen-content > .screen-title h2").isVisible(),viewport.name+" "+name+" heading");
    assert.equal(await page.locator("#screen-nav button[aria-current=\"page\"]").getAttribute("data-screen"),name,viewport.name+" active navigation semantics");
    assert.ok((await page.locator("#screen-content .read-only").textContent())?.includes("MOCK"),viewport.name+" "+name+" visible MOCK identity");
    const screenAxe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}}));
    const seriousScreen=screenAxe.violations.filter(v=>v.impact==="critical"||v.impact==="serious");const screenDetails=seriousScreen.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,html:n.html}))}));assert.equal(seriousScreen.length,0,viewport.name+" "+name+" serious/critical accessibility violations: "+JSON.stringify(screenDetails));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,viewport.name+" horizontal document overflow on "+name);
    const contrast=await scanTextContrast(page);
    assert.ok(contrast.textNodes>0,viewport.name+" "+name+" contrast scan found visible text");
    assert.equal(contrast.failures.length,0,viewport.name+" "+name+" WCAG text contrast failures: "+JSON.stringify(contrast.failures));
    contrastReports.push({screen:name,textNodes:contrast.textNodes,minimumRatio:contrast.minimumRatio});
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
   const hindiContrastReports=[];
   for(const name of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]){
    await page.locator('#screen-nav button[data-screen="'+name+'"]').click();
    await page.locator("#screen-content > .screen-title h2").waitFor();
    const contrast=await scanTextContrast(page);
    assert.ok(contrast.textNodes>0,viewport.name+" Hindi "+name+" contrast scan found visible text");
    assert.equal(contrast.failures.length,0,viewport.name+" Hindi "+name+" WCAG text contrast failures: "+JSON.stringify(contrast.failures));
    hindiContrastReports.push({screen:name,textNodes:contrast.textNodes,minimumRatio:contrast.minimumRatio});
   }
   contrastReports.push(...hindiContrastReports.map(item=>({...item,language:"hi"})));
   await page.reload({waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForFunction(()=>document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"),null,{timeout:10000});
   await page.addScriptTag({path:axePath});
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
   console.log(JSON.stringify({viewport:viewport.name,screens:15,perScreenAxe:true,keyboardNavigation:true,axeSeriousCritical:0,contrastScreens:15,contrastLanguages:["en","hi"],contrastChecks:contrastReports.length,contrastTextNodes:contrastReports.reduce((sum,item)=>sum+item.textNodes,0),minimumObservedTextContrast:Math.min(...contrastReports.map(item=>item.minimumRatio)),contrastReports,consoleErrors:0,...perf}));
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
  await page.waitForFunction(async()=>{const registration=await navigator.serviceWorker.ready;return registration.active?.state==="activated";},null,{timeout:20000});
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
