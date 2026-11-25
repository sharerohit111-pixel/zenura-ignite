import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createPaperDemoViewModel} from "../../markets/shared/paper-demo-adapter.mjs";

const root=new URL("../../markets/stocks/",import.meta.url);
const read=async name=>readFile(new URL(name,root),"utf8");
const screens=["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];

test("demo route loads the canonical shared adapter and exposes all 15 screens",async()=>{
 const html=await read("demo.html"),js=await read("demo.js"),index=await read("index.html");
 assert.ok(html.includes('type="module" src="./demo.js"'));
 assert.ok(js.includes('from "../shared/paper-demo-adapter.mjs"'));
 for(const screen of screens)assert.ok(html.includes('data-screen="'+screen+'"'));
 assert.ok(index.includes('href="./demo.html">OPEN DEMO MODE'));
});
test("demo route loads only shared synthetic fixtures with explicit opt-in",async()=>{
 const js=await read("demo.js");
 for(const name of ["market","account","equity","derivatives"])assert.ok(js.includes('"'+name+'"'));
 assert.ok(js.includes('credentials:"omit"'));
 assert.ok(js.includes('createPaperDemoViewModel({market,account,equity,derivatives},{enabled:true,production:false})'));
 assert.ok(js.includes("No live-data fallback"));
});
test("screen rendering is read-only and clearly discloses synthetic and unreconciled data",async()=>{
 const html=await read("demo.html"),js=await read("demo.js");
 assert.ok(html.includes("DEMO DATA · SYNTHETIC FIXTURES"));
 assert.ok(js.includes("READ ONLY · MOCK"));
 assert.ok(js.includes("ledgerReconciled"));
 assert.ok(js.includes("No MARKET/LIMIT submission"));
 assert.ok(js.includes("No margin reservation"));
 assert.equal(/fetch\s*\([^)]*(?:\/orders|\/portfolio|\/watchlist)/i.test(js),false);
});
test("demo screen does not load production authentication, live quote or order modules",async()=>{
 const html=await read("demo.html");
 for(const forbidden of ["connect.js","email-auth.js","stocks.js","order-workspace.js","live-quote.js"])assert.equal(html.includes(forbidden),false);
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
test("responsive demo assets are included in the Markets PWA shell exactly once",async()=>{
 const css=await read("demo.css");
 const sw=await readFile(new URL("../../markets/service-worker.js",import.meta.url),"utf8");
 assert.ok(css.includes("@media(max-width:900px)"));
 assert.ok(css.includes("@media(max-width:520px)"));
 assert.ok(sw.includes('const CACHE_NAME="zenura-markets-shell-v4"'));
 for(const asset of ["stocks/demo.html","stocks/demo.css","stocks/demo.js","shared/paper-demo-adapter.mjs"])assert.ok(sw.includes(asset));
 assert.equal((sw.match(/"language-toggle\.js"/g)||[]).length,1,"shared language toggle must be cached once");
});
test("Demo route exposes account return navigation and shared Hindi/English toggle without loading production auth", async () => {
 const html=await read("demo.html");
 assert.ok(html.includes('href="./#connection"'));
 assert.ok(html.includes('id="paper-language-toggle"'));
 assert.ok(html.includes('../language-toggle.js'));
 for(const forbidden of ["account-settings.js","supabase-client.js","email-auth.js"])assert.equal(html.includes(forbidden),false);
});
test("shared language toggle includes Hindi strings for Demo and authenticated account UI", async () => {
 const language = await readFile(new URL("../../markets/language-toggle.js", import.meta.url), "utf8");
 for(const entry of ['"USER ACCOUNT & WALLET":"यूज़र खाता और वॉलेट"','"Home Overview":"होम ओवरव्यू"','"VERIFY & SIGN IN":"सत्यापित करें और साइन इन करें"'])assert.ok(language.includes(entry));
});
