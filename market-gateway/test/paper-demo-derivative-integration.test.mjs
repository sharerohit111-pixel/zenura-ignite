import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const root=new URL("../../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");
test("Futures and Options Demo screens mount the shared local simulator",async()=>{
 const js=await read("markets/stocks/demo.js"),html=await read("markets/stocks/demo.html"),panel=await read("markets/stocks/demo-derivative-panel.mjs");
 assert.match(js,/mountDerivativeDemo\(content,name\)/);
 assert.match(js,/from "\.\/demo-derivative-panel\.mjs"/);
 assert.match(html,/derivative-position\.js/);
 assert.match(html,/derivative-mock-simulator\.js/);
 assert.match(panel,/createDerivativeMockSimulator/);
});
test("Demo execution is manual, synthetic and isolated from production routes",async()=>{
 const panel=await read("markets/stocks/demo-derivative-panel.mjs"),sw=await read("markets/service-worker.js"),gateway=await read("market-gateway/supabase-server.js");
 assert.match(panel,/DEMO DATA · MOCK/);
 assert.match(panel,/credentials:"omit"/);
 assert.match(panel,/processLimitFills/);\n assert.match(panel,/engine\\.cancel/);
 assert.match(panel,/engine\.cancel/);
 assert.match(sw,/stocks\/demo-derivative-panel\.mjs/);
 assert.doesNotMatch(gateway,/derivative-mock-simulator|paper-demo-adapter|paper-mock-fixtures/);
});
test("Futures product, option expiry/strike and MARKET/LIMIT controls are exposed",async()=>{
 const panel=await read("markets/stocks/demo-derivative-panel.mjs");
 assert.match(panel,/INTRADAY/);assert.match(panel,/DELIVERY/);
 assert.match(panel,/optionType/);assert.match(panel,/expiry/);assert.match(panel,/strike/);
 assert.match(panel,/MARKET/);assert.match(panel,/LIMIT/);
});
