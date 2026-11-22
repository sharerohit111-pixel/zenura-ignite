"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=__dirname;
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const js=fs.readFileSync(path.join(root,"investing.js"),"utf8");
const css=fs.readFileSync(path.join(root,"investing.css"),"utf8");
const gateway=fs.readFileSync(path.join(root,"../../market-gateway/supabase-server.js"),"utf8");
const migration=fs.readFileSync(path.join(root,"../../supabase/migrations/202611220010_paper_investing_market_order.sql"),"utf8");
const schema=fs.readFileSync(path.join(root,"../../supabase/migrations/202611220007_professional_futures_investing_charts.sql"),"utf8");
const pwaRoot=path.join(root,"..");
const serviceWorker=fs.readFileSync(path.join(pwaRoot,"service-worker.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(pwaRoot,"manifest.webmanifest"),"utf8"));
const portal=fs.readFileSync(path.join(pwaRoot,"index.html"),"utf8");
const languageToggle=fs.readFileSync(path.join(pwaRoot,"language-toggle.js"),"utf8");
const chartTheme=fs.readFileSync(path.join(root,"../stocks/chart-theme.js"),"utf8");
const sharedCss=fs.readFileSync(path.join(root,"../stocks/stocks.css"),"utf8");
test("Paper Investing page includes all locally referenced modules and styles",()=>{
 const assetRefs=[
  ...[...html.matchAll(/<script[^>]*src="([^"]+)"/gi)].map(match=>match[1]),
  ...[...html.matchAll(/<link[^>]*>/gi)].map(match=>{
   const tag=match[0],href=tag.split('href="')[1]?.split('"')[0];
   return tag.includes('rel="stylesheet"')?href:null;
  }).filter(Boolean)
 ];
 for(const ref of assetRefs){
  if(/^https?:|^#|^mailto:/.test(ref))continue;
  assert.ok(fs.existsSync(path.resolve(root,ref)), "Missing Paper Investing asset: "+ref);
 }
});
test("Paper Investing keeps an independent account, portfolio, order history and two-mode navigation",()=>{
 for(const id of ["investing-cash","investing-positions","investing-orders","investing-buy","investing-sell","investing-search","market-chart","chart-add-indicator","chart-remove-indicator","chart-undo","chart-redo","paper-language-toggle","paper-chart-theme-toggle"])
  assert.match(html,new RegExp('id="'+id+'"'),"Missing required UI control "+id);
 assert.match(html,/PAPER TRADING/);assert.match(html,/PAPER INVESTING/);
 assert.match(html,/NSE · BSE/);
 assert.match(html,/Upstox V3/);
});
test("Paper Investing client uses authenticated Supabase session and idempotent virtual orders",()=>{
 assert.match(js,/getIdToken/);assert.match(js,/idempotency_key/);assert.match(js,/zenura-paper-investing-order-v1/);
 assert.match(js,/\/paper\/investing\/account/);assert.match(js,/\/paper\/investing\/portfolio/);
 assert.match(js,/\/paper\/investing\/orders/);assert.match(js,/ZenuraProfessionalChart\.mount/);
 assert.doesNotMatch(js,/firebase/i);
});
test("Paper Investing clears private state and rejects late responses after account changes",()=>{
 assert.match(js,/function clearPrivateSession\(\)/);
 assert.match(js,/dataRequestSeq\+\+/);
 assert.match(js,/c\.getUserId\(\)!==uid/);
 assert.match(js,/if\(connector\(\)\?\.getUserId\?\.\(\)===uid\)/);
 assert.match(js,/positionsBody\.replaceChildren\(\)/);
 assert.match(js,/ordersBody\.replaceChildren\(\)/);
 assert.match(js,/uid!==authUserId/);
});
test("Paper Investing server routes and SQL ledger are independent from Paper Trading",()=>{
 for(const route of ['"/paper/investing/account"','"/paper/investing/portfolio"','"/paper/investing/orders"'])
  assert.ok(gateway.includes(route),"Missing gateway route "+route);
 assert.match(migration,/paper_investing_accounts/);assert.match(migration,/paper_investing_positions/);
 assert.match(migration,/paper_investing_orders/);assert.match(migration,/execute_paper_investing_market_order/);
 assert.match(schema,/100000000/);
});
test("Paper Investing responsive styles include compact tablet and mobile layouts",()=>{
 assert.match(css,/@media\s*\(max-width:\s*1050px\)/);
 assert.match(css,/@media\s*\(max-width:\s*700px\)/);
});

test("Professional chart maps LINE to line and freehand tool to native brush",()=>{
 const chart=fs.readFileSync(path.join(root,"../stocks/chart-engine.js"),"utf8");
 assert.match(chart,/chartType==="LINE"\?"line"/);
 assert.match(chart,/brush:"BRUSH"/);
 assert.match(schema,/'BRUSH'/);
});

test("Trading and Investing expose the broad built-in technical indicator set",()=>{
 const trading=fs.readFileSync(path.join(root,"../stocks/index.html"),"utf8");
 const investing=html;
 for(const name of ["MA","EMA","SMA","BBI","BIAS","BRAR","BOLL","CCI","DMI","CR","PSY","DMA","TRIX","OBV","VR","WR","MTM","SAR","AO","ROC","PVT","MACD","KDJ","RSI","VOL","VWAP","ATR","ADX","STOCH","SUPERTREND","MFI"])
  assert.match(trading,new RegExp('option value="'+name+'"'),"Trading is missing "+name);
 for(const name of ["MA","EMA","SMA","BBI","BIAS","BRAR","BOLL","CCI","DMI","CR","PSY","DMA","TRIX","OBV","VR","WR","MTM","SAR","AO","ROC","PVT","MACD","KDJ","RSI","VOL","VWAP","ATR","ADX","STOCH","SUPERTREND","MFI"])
  assert.match(investing,new RegExp('option value="'+name+'"'),"Investing is missing "+name);
});

test("Chart workspace restores isolated per-symbol chart type and indicator preferences",()=>{
 const engine=fs.readFileSync(path.join(root,"../stocks/chart-engine.js"),"utf8");
 assert.match(engine,/async function loadPreferences\(\)/);
 assert.match(engine,/paper_chart_preferences/);
 assert.match(engine,/activeIndicators\.clear\(\)/);
 assert.match(engine,/await loadPreferences\(\)/);
});

test("Paper Trading workspace also references only existing local assets",()=>{
 const trading=fs.readFileSync(path.join(root,"../stocks/index.html"),"utf8");
 for(const match of trading.matchAll(/(?:src|href)="([^"]+)"/g)){
  const ref=match[1];if(/^https?:|^#|^mailto:/.test(ref))continue;
  assert.ok(fs.existsSync(path.resolve(root,"../stocks",ref)), "Missing Paper Trading asset: "+ref);
 }
});

test("Market terminal is installable and its service worker never caches private or external data",()=>{
 assert.equal(manifest.start_url,"./");
 assert.equal(manifest.scope,"./");
 assert.equal(manifest.display,"standalone");
 assert.match(portal,/Paper Trading/);assert.match(portal,/Paper Investing/);
 assert.match(html,/manifest\.webmanifest/);assert.match(html,/pwa-register\.js/);
 assert.match(serviceWorker,/request\.headers\.has\("authorization"\)/);
 assert.match(serviceWorker,/url\.origin!==BASE\.origin/);
 assert.match(serviceWorker,/request\.method!=="GET"/);
 assert.match(serviceWorker,/zenura-markets-shell-v2/);
 assert.match(serviceWorker,/BASE=new URL/);
 assert.doesNotMatch(serviceWorker,/supabase\.co|api\.upstox\.com/);
});

test("Hindi-English toggle is shared, persistent and updates both modes",()=>{
 const trading=fs.readFileSync(path.join(root,"../stocks/index.html"),"utf8");
 assert.match(html,/language-toggle\.js/);assert.match(trading,/language-toggle\.js/);
 assert.match(languageToggle,/zenura-language-v1/);
 assert.match(languageToggle,/zenura-language-change/);
 assert.match(languageToggle,/MutationObserver/);
 assert.match(languageToggle,/data-en/);assert.match(languageToggle,/data-hi/);
 assert.match(serviceWorker,/"language-toggle\.js"/);
});

test("Bilingual labels use one persistent translator and keep live chart status dynamic",()=>{
 const trading=fs.readFileSync(path.join(root,"../stocks/index.html"),"utf8");
 assert.match(trading,/id="paper-language-toggle"/);
 assert.match(html,/id="paper-language-toggle"/);
 assert.match(languageToggle,/localStorage\.getItem\(KEY\)/);
 assert.match(languageToggle,/getAttribute\(language==="hi"\?"data-hi":"data-en"\)/);
 assert.match(languageToggle,/"Futures":"फ्यूचर्स"/);
 assert.match(languageToggle,/"Options":"ऑप्शंस"/);
 assert.match(chartTheme,/zenura-language-change/);
 assert.doesNotMatch(html,/<span id="chart-status"[^>]*data-hi=/);
});

test("Chart users can add and remove indicators and load templates as replacements",()=>{
 const engine=fs.readFileSync(path.join(root,"../stocks/chart-engine.js"),"utf8");
 assert.match(html,/id="chart-remove-indicator"/);
 const trading=fs.readFileSync(path.join(root,"../stocks/index.html"),"utf8");
 assert.match(trading,/id="chart-remove-indicator"/);
 assert.match(engine,/function removeIndicator\(name\)/);
 assert.match(engine,/chart\.removeIndicator\(\{name\}\)/);
 assert.match(engine,/activeIndicators\.clear\(\)/);
});

test("Professional chart editing toolbar is styled for desktop and touch screens",()=>{
 assert.match(sharedCss,/\.chart-toolbar\s*\{/);
 assert.match(sharedCss,/@media\s*\(max-width:\s*650px\)/);
 assert.match(sharedCss,/chart-remove-indicator/);
});

test("Every install-time PWA shell asset exists in the repository",()=>{
 const match=serviceWorker.match(/const SHELL=\[([\s\S]*?)\]\.map/);
 assert.ok(match,"PWA shell asset list is missing");
 const entries=[...match[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
 const projectRoot=path.resolve(root,"../..");
 for(const entry of entries){
  const target=path.resolve(pwaRoot,entry);
  assert.ok(fs.existsSync(target),"Missing PWA shell asset: "+entry);
 }
 const icon=path.resolve(pwaRoot,manifest.icons[0].src);
 assert.ok(fs.existsSync(icon),"PWA manifest icon does not exist");
});

test("Chart library loading has a second CDN and a bounded timeout",()=>{
 const engine=fs.readFileSync(path.join(root,"../stocks/chart-engine.js"),"utf8");
 assert.match(engine,/unpkg\.com\/klinecharts@10\.1\.1/);
 assert.match(engine,/setTimeout\(failAttempt,8000\)/);
 assert.match(engine,/attemptFinished/);
});
