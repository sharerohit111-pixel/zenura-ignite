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
test("screen rendering is read-only and clearly discloses synthetic and unreconciled data",async()=>{
 const html=await read("demo.html"),js=await read("demo.js");
 assert.match(html,/DEMO DATA · SYNTHETIC FIXTURES/);
 assert.match(js,/READ ONLY · MOCK/);
 assert.match(js,/ledgerReconciled/);
 assert.match(js,/No MARKET\/LIMIT submission/);
 assert.match(js,/No margin reservation/);
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
 assert.equal(model.market.instruments.length,2);
 assert.equal(model.orders.length,3);
 assert.equal(model.account.ledgerReconciled,false);
});
test("responsive demo assets are included in the Markets PWA shell",async()=>{
 const css=await read("demo.css");
 const sw=await readFile(new URL("../../markets/service-worker.js",import.meta.url),"utf8");
 assert.match(css,/@media\(max-width:900px\)/);
 assert.match(css,/@media\(max-width:520px\)/);
 assert.match(sw,/zenura-markets-shell-v4/);
 for(const asset of ["stocks/demo.html","stocks/demo.css","stocks/demo.js","shared/paper-demo-adapter.mjs"])assert.ok(sw.includes(asset));
});
