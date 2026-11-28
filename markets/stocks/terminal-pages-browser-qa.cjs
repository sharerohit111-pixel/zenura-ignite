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
   const response=await page.goto("http://127.0.0.1:4173/markets/stocks/index.html",{waitUntil:"domcontentloaded",timeout:30000});
   const responseHtml=await response.text();
   assert.equal(response.status(),200,"terminal HTML must be served successfully");
   assert.match(responseHtml,/data-terminal-page="dashboard"/,"served HTML must contain dashboard navigation");
   await page.waitForSelector('nav.terminal-nav [data-terminal-page="dashboard"]',{timeout:10000}).catch(async error=>{
    const diagnostic=await page.evaluate(()=>({url:location.href,title:document.title,readyState:document.readyState,body:document.body?.innerHTML?.slice(0,5000),navCount:document.querySelectorAll("[data-terminal-page]").length}));
    throw new Error("Terminal navigation missing after valid HTML response: "+JSON.stringify({status:response.status(),url:response.url(),responseHasNav:/data-terminal-page="dashboard"/.test(responseHtml),diagnostic,errors})+"; "+error.message);
   });
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
    assert.equal(await page.locator('nav.terminal-nav [data-terminal-page="'+route+'"]').getAttribute("aria-current"),"page",route+" nav item must be current");
    const overflow=await page.evaluate(()=>({hasOverflow:document.documentElement.scrollWidth>window.innerWidth+1,scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,offenders:[...document.querySelectorAll("body *")].map(el=>({tag:el.tagName,id:el.id,cls:typeof el.className==="string"?el.className:"",left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)})).filter(x=>x.right>window.innerWidth+1||x.left< -1).slice(0,12)}));
    if(overflow.hasOverflow) console.log(JSON.stringify({viewport:viewport.name,route,overflow}));
    assert.equal(overflow.hasOverflow,false,viewport.name+" horizontal overflow on "+route);
   }
   const sidebarPages=["dashboard","chart","watchlist","derivatives","positions","orders","balance","pnl","settings","support"];
   for(const route of sidebarPages){
    await page.locator("#zenura-sidebar-toggle").click();
    assert.equal(await page.locator("#zenura-sidebar [data-sidebar-page]").count(),10,"sidebar must expose exactly ten destinations");
    assert.equal(await page.locator("#zenura-sidebar").getAttribute("aria-hidden"),"false","drawer must open accessibly");
    await page.locator("#zenura-sidebar [data-sidebar-page="+JSON.stringify(route)+"]").click();
    await page.waitForFunction(value=>document.body.dataset.terminalPage===value,route);
    assert.equal(await page.locator("#zenura-sidebar").getAttribute("aria-hidden"),"true","drawer must close after navigation");
   }
   assert.equal(await page.locator("#zenura-quick-actions a").count(),4,"existing four-item bottom bar must remain intact");
   await page.locator("nav.terminal-nav [data-terminal-page=\"settings\"]").click();
   assert.equal(await page.locator(".settings-feature").count(),6,"Settings must expose six requested controls");
   await page.locator("[data-settings-feature=\"theme\"]").click();
   assert.ok(["day","night"].includes(await page.locator("body").getAttribute("data-app-theme")),"theme setting must update the app");
   await page.locator("[data-settings-feature=\"chart\"]").click();
   assert.equal(await page.locator("body").getAttribute("data-terminal-page"),"chart","Chart Settings must open Chart & Trade");
   await page.locator('nav.terminal-nav [data-terminal-page="balance"]').click();
   assert.equal(await page.locator(".paper-ticket-controls").isVisible(),false,"wallet must not expose order-entry controls");
   await page.locator('nav.terminal-nav [data-terminal-page="positions"]').click();
   assert.equal(await page.locator("#paper-positions").isVisible(),true,"equity positions must be visible on Positions page");
   assert.equal(await page.locator("#paper-history").isVisible(),false,"equity order history must not leak into Positions page");
   assert.equal(await page.locator(".portfolio-metrics").isVisible(),false,"P&L summary must remain on P&L page");
   await page.locator('nav.terminal-nav [data-terminal-page="pnl"]').click();
   assert.equal(await page.locator(".portfolio-metrics").isVisible(),true,"P&L summary must be visible on P&L page");
   assert.equal(await page.locator("#paper-positions").isVisible(),false,"positions table must not leak into P&L summary");
   await page.locator('nav.terminal-nav [data-terminal-page="history"]').click();
   assert.equal(await page.locator("#paper-trades-workspace-body").isVisible(),true,"trade history table must be visible");
   assert.equal(await page.locator("#paper-orders-workspace-body").isVisible(),false,"pending order book must not leak into Trade History");
   assert.equal(await page.locator("#paper-positions").isVisible(),false,"positions table must not leak into trade history");
   assert.deepEqual(errors,[],viewport.name+" page runtime errors");
   console.log(JSON.stringify({viewport:viewport.name,pages:routes.length,overflow:false,pageErrors:errors.length,walletOrderControlsHidden:true,tradeHistoryIsolated:true}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
