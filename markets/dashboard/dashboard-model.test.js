import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {findInstrument,getWatchlist,formatINR,formatSigned,validateDashboardData,NAV_ITEMS} from "./dashboard-model.js";
const data=JSON.parse(await readFile(new URL("./mock-data.json",import.meta.url),"utf8"));
test("dummy fixture is explicitly demo-only and contains every required screen dataset",()=>{
  assert.equal(validateDashboardData(data),data);
  assert.deepEqual(NAV_ITEMS.map(item=>item[0]),["home","market","watchlist","orders","portfolio","positions","holdings","profile","settings"]);
});
test("watchlist resolves only known Indian market instruments",()=>{
  assert.equal(getWatchlist(data).length,data.watchlist.length);
  assert.equal(findInstrument(data,"RELIANCE").exchange,"NSE");
  assert.equal(findInstrument(data,"UNKNOWN"),null);
});
test("currency and signed-value formatters handle valid and invalid values",()=>{
  assert.match(formatINR(1000000),/10,00,000|₹/);
  assert.equal(formatSigned(12.5,"%"),"+12.5%");
  assert.equal(formatSigned(-4,"%"),"-4%");
});
test("rejects data not explicitly marked as dummy JSON",()=>{
  assert.throws(()=>validateDashboardData({...data,meta:{...data.meta,provider:"LIVE"}}),/DUMMY_JSON/);
});
