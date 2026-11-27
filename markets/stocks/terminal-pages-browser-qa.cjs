"use strict";
const assert=require("node:assert/strict");
const {chromium}=require("playwright");

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const viewport of [{name:"desktop",width:1365,height:900},{name:"android-mobile",width:390,height:844},{name:"small-mobile",width:360,height:800}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:"block"});
   const page=await context.newPage();
   const errors=[];
   page.on("pageerror",error=>errors.push(error.message));
   await page.goto("http://127.0.0.1:4173/markets/stocks/index.html",{waitUntil:"domcontentloaded",timeout:30000});
   await page.waitForSelector('nav.terminal-nav [data-terminal-page="dashboard"]',{timeout:10000});
   const routes=[
    ["dashboard",".dashboard-overview"],
    ["chart",".chart-panel"],
    ["watchlist",".watch"],
    ["balance",".order-panel"],
    ["positions",".portfolio-panel"],
    ["orders",".paper-order-book"],
    ["history",".paper-order-book"],
    ["pnl",".portfolio-panel"],
    ["derivatives",".option-panel"],
    ["settings",".settings-page"]
   ];
   for(const [route,selector] of routes){
    await page.locator('nav.terminal-nav [data-terminal-page="'+route+'"]').click();
    await page.waitForFunction(value=>document.body.dataset.terminalPage===value,route);
    assert.equal(await page.locator(selector).isVisible(),true,route+" page must show its own panel");
    assert.equal(await page.locator('[data-terminal-page="'+route+'"]').getAttribute("aria-current"),"page",route+" nav item must be current");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,viewport.name+" horizontal overflow on "+route);
   }
   await page.locator('nav.terminal-nav [data-terminal-page="balance"]').click();
   assert.equal(await page.locator(".paper-ticket-controls").isVisible(),false,"wallet must not expose order-entry controls");
   await page.locator('nav.terminal-nav [data-terminal-page="history"]').click();
   assert.equal(await page.locator("#paper-trades-workspace-body").isVisible(),true,"trade history table must be visible");
   assert.equal(await page.locator("#paper-positions").isVisible(),false,"positions table must not leak into trade history");
   assert.deepEqual(errors,[],viewport.name+" page runtime errors");
   console.log(JSON.stringify({viewport:viewport.name,pages:routes.length,overflow:false,pageErrors:errors.length,walletOrderControlsHidden:true,tradeHistoryIsolated:true}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
