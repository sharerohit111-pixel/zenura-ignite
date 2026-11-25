import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createPaperDemoViewModel} from "../../markets/shared/paper-demo-adapter.mjs";

const root=new URL("../../markets/stocks/",import.meta.url);
const read=async name=>readFile(new URL(name,root),"utf8");
const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];

test("demo route loads the canonical shared adapter and exposes all 15 screens",async()=>{
 const html=await read("demo.html"),js=await read("demo.js"),index=await read("index.html");
 assert.match(html,/type="module" src="\.\/demo.js"/);
 assert.match(js,/from "\.\.\/shared\/paper-demo-adapter\.mjs"/);
 for(const screen of screens)assert.match(html,new RegExp('data-screen="'+screen+'"'));
 assert.match(index,/href="\.\/demo\.html">OPEN DEMO MODE/);
});
test("demo route loads only shared synthetic fixtures with explicit opt-in",async()=>{
 const js=await read("demo.js");
 for(const name of ["market","account","equity","derivatives"])assert.ok(js.includes('"'+name+'"'));
 assert.match(js,/credentials:"omit"/);
 assert.match(js,/createPaperDemoViewModel\(\{market,account,equity,derivatives\},\{enabled:true,production:false\}\)/);
 assert.match(js,/No live-data fallback/);
});
test("Demo screens disclose synthetic data and isolate local Equity execution from Wallet",async()=>{
 const html=await read("demo.html"),js=await read("demo.js"),panel=await read("demo-derivative-panel.mjs");
 assert.match(html,/DEMO DATA · SYNTHETIC FIXTURES/);
 assert.match(js,/MOCK · LOCAL DEMO/);
 assert.match(js,/local Equity\/F&O simulation only/);
 assert.match(js,/Order execution","Local simulation only/);
 assert.doesNotMatch(js,/order actions disabled/);
 assert.match(js,/appendWalletSummary\\(content\\)/);
 const walletPanel=await read("demo-unified-ledger-panel.mjs");
 assert.match(walletPanel,/ledgerReconciled/);
 assert.match(walletPanel,/projectPaperDemoWallet/);
 assert.match(js,/mountEquityDemo\(content\)/);
 assert.match(js,/searchPaperDemoInstruments/);
 assert.match(js,/getPaperDemoExpiries/);
 assert.match(js,/getPaperDemoOptionChain/);
 assert.match(js,/mountDemoChart\(chart\)/);
 assert.match(js,/renderInstrumentCatalog\(catalog\)/);
 assert.match(js,/renderOptionsCatalog\(catalog\)/);
 assert.match(js,/renderMarketDashboard\(content\)/);
 assert.match(js,/renderDemoWatchlists\(content\)/);
 assert.match(js,/wrap\.tabIndex=0/);
 assert.match(js,/Scrollable data table/);
 assert.match(js,/Scrollable demo watchlist/);
 assert.match(js,/Move .* up/);
 assert.match(js,/current-page memory only/);
 assert.match(js,/list\.length>=50/);
 assert.match(js,/searchPaperDemoInstruments/);
 assert.match(js,/getPaperDemoExpiries/);
 assert.match(js,/getPaperDemoOptionChain/);
 assert.match(js,/renderInstrumentCatalog\(catalog\)/);
 assert.match(js,/renderOptionsCatalog\(catalog\)/);
 const equityPanel=await read("demo-equity-panel.mjs");
 assert.match(equityPanel,/DEMO DATA · MOCK · SYNTHETIC ONLY/);
 assert.match(equityPanel,/wallet reconciliation remains false/);
 assert.match(equityPanel,/manual fill action to simulate execution/);
 assert.match(panel,/No production RPC, cash ledger, margin reservation, charges, broker API or background worker is called/);
 assert.doesNotMatch(js,/fetch\s*\([^)]*(?:\/orders|\/portfolio|\/watchlist)/i);
});
test("demo screen does not load production authentication, live quote or order modules",async()=>{
 const html=await read("demo.html");
 assert.doesNotMatch(html,/connect\.js|email-auth\.js|stocks\.js|order-workspace\.js|live-quote\.js/);
});
test("canonical adapter can build the dashboard view model from shared fixtures",async()=>{
 const base=new URL("../../market-gateway/mock/fixtures/",import.meta.url);
 const fixture=async name=>JSON.parse(await readFile(new URL(name+".json",base),"utf8"));
 const [market,account,equity,derivatives]=await Promise.all(["market","account","equity","derivatives"].map(fixture));
 const model=createPaperDemoViewModel({market,account,equity,derivatives},{enabled:true,production:false});
 assert.equal(model.meta.provider,"DUMMY_JSON");
 assert.equal(model.market.instruments.length,20);
 assert.equal(model.market.instruments.filter(item=>item.assetClass==="INDEX").length,2);
 assert.equal(model.market.instruments.filter(item=>item.assetClass==="EQUITY").length,2);
 assert.equal(model.market.instruments.filter(item=>item.assetClass==="FUTURE").length,4);
 assert.equal(model.market.instruments.filter(item=>item.assetClass==="OPTION").length,12);
 assert.equal(model.orders.length,3);
 assert.equal(model.account.ledgerReconciled,false);
});
test("chart fixture requests omit account credentials",async()=>{
 const chart=await read("demo-chart-panel.mjs");
 assert.match(chart,/credentials: "omit"/);
 assert.match(chart,/No synthetic chart data is displayed/);
});
test("dashboard does not infer BSE market status from the NSE-only market fixture",async()=>{
 const js=await read("demo.js");
 assert.match(js,/model\.market\.exchange===exchange\?model\.market\.marketStatus:"NOT SUPPLIED"/);
});
test("responsive demo assets are included in the Markets PWA shell",async()=>{
 const css=await read("demo.css");
 const sw=await readFile(new URL("../../markets/service-worker.js",import.meta.url),"utf8");
 assert.match(css,/@media\(max-width:900px\)/);
 assert.match(css,/@media\(max-width:520px\)/);
 assert.match(sw,/zenura-markets-shell-v9/);
 for(const asset of ["stocks/demo.html","stocks/demo.css","stocks/demo.js","stocks/demo-chart-panel.mjs","stocks/demo-chart-data.mjs","shared/paper-demo-adapter.mjs"])assert.ok(sw.includes(asset));
});

test("Equity Demo runtime guard defaults to production and never hardcodes development",async()=>{
 const panel=await read("demo-equity-panel.mjs");
 assert.match(panel,/window\.ZENURA_RUNTIME_ENV/);
 assert.match(panel,/:"production"\}/);
 assert.doesNotMatch(panel,/env:\{NODE_ENV:"development"\}/);
});
test("service worker caches only explicitly allowlisted navigation documents",async()=>{
 const sw=await readFile(new URL("../../markets/service-worker.js",import.meta.url),"utf8");
 assert.match(sw,/if\(request\.mode==="navigate"\)\{[\s\S]*?if\(!shellAsset\)return;/);
 assert.match(sw,/Only explicitly listed static shell documents may be cached/);
});
test("Demo entrypoint excludes authenticated, broker and production order modules",async()=>{
 const html=await read("demo.html"),js=await read("demo.js"),equity=await read("demo-equity-panel.mjs"),fo=await read("demo-derivative-panel.mjs");
 const scriptTags=html.split("\n").filter(line=>line.includes("<script")&&line.includes("src=")).join("\n");
 assert.doesNotMatch(scriptTags,/(?:supabase-client|connect\.js|email-auth|live-quote|order-workspace|stocks\.js)/i);
 assert.doesNotMatch(js,/fetch\s*\([^)]*(?:\/paper\/|\/s-trade\/|\/orders)/i);
 assert.doesNotMatch(equity,/fetch\s*\([^)]*(?:\/paper\/|\/s-trade\/|\/orders)/i);
 assert.doesNotMatch(fo,/fetch\s*\([^)]*(?:\/paper\/|\/s-trade\/|\/orders)/i);
});

test("production gateway entrypoints never import Demo adapters, engines or fixtures",async()=>{
 const [supabaseServer,legacyServer]=await Promise.all([
  readFile(new URL("../../market-gateway/supabase-server.js",import.meta.url),"utf8"),
  readFile(new URL("../../market-gateway/server.js",import.meta.url),"utf8")
 ]);
 for(const source of [supabaseServer,legacyServer]){
  assert.doesNotMatch(source,/(?:paper-demo-adapter|equity-demo-execution-engine|derivative-mock-simulator|mock\/fixtures)/i);
 }
});
