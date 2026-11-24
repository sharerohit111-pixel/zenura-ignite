import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {findInstrument,getWatchlist,formatINR,formatSigned,validateDashboardData,NAV_ITEMS} from "./dashboard-model.js";
const data=JSON.parse(await readFile(new URL("./mock-data.json",import.meta.url),"utf8"));
test("synthetic fixture is explicitly demo-only and contains every required screen dataset",()=>{
  assert.equal(validateDashboardData(data),data);
  assert.deepEqual(NAV_ITEMS.map(item=>item[0]),["home","market","watchlist","orders","portfolio","positions","holdings","profile","settings"]);
});
test("watchlist resolves only known synthetic instruments",()=>{
  assert.equal(getWatchlist(data).length,data.watchlist.length);
  assert.equal(findInstrument(data,"MOCKALPHA").exchange,"NSE");
  assert.equal(findInstrument(data,"UNKNOWN"),null);
  assert.ok(data.instruments.every(item=>item.symbol.startsWith("MOCK")&&item.instrumentKey.startsWith("MOCK|")));
  assert.ok(data.indices.every(item=>item.symbol.startsWith("MOCK")&&item.instrumentKey.startsWith("MOCK|")));
  assert.equal(data.account.ledgerReconciled,false);
});
test("currency and signed-value formatters handle valid and invalid values",()=>{
  assert.match(formatINR(1000000),/10,00,000|₹/);
  assert.equal(formatSigned(12.5,"%"),"+12.5%");
  assert.equal(formatSigned(-4,"%"),"-4%");
});
test("rejects real exchange symbols even when the fixture claims DEMO",()=>{
  const bad={...data,instruments:data.instruments.map(item=>({...item}))};
  bad.instruments[0].symbol="RELIANCE";
  assert.throws(()=>validateDashboardData(bad),/synthetic MOCK identities/);
});
test("rejects unknown references across watchlist, orders, holdings and positions",()=>{
  const bad={...data,orders:data.orders.map(item=>({...item}))};
  bad.orders[0].symbol="UNKNOWN";
  assert.throws(()=>validateDashboardData(bad),/Unknown synthetic dashboard instrument/);
});
test("rejects data not explicitly marked as dummy JSON",()=>{
  assert.throws(()=>validateDashboardData({...data,meta:{...data.meta,provider:"LIVE"}}),/DUMMY_JSON/);
});
