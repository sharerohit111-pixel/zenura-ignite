import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createPaperDemoViewModel,isPaperDemoViewModel,searchPaperDemoInstruments,getPaperDemoExpiries,getPaperDemoOptionChain} from "../../markets/shared/paper-demo-adapter.mjs";

const root = new URL("../mock/fixtures/", import.meta.url);
async function fixture(name) { return JSON.parse(await readFile(new URL(name + ".json", root), "utf8")); }
async function allFixtures() {
  const [market,account,equity,derivatives] = await Promise.all(["market","account","equity","derivatives"].map(fixture));
  return {market,account,equity,derivatives};
}

test("explicit demo selection maps canonical fixtures into one shared screen model", async () => {
  const model = createPaperDemoViewModel(await allFixtures(), {enabled:true});
  assert.equal(isPaperDemoViewModel(model), true);
  assert.equal(model.meta.provider, "DUMMY_JSON");
  assert.equal(model.meta.simulated, true);
  assert.equal(model.account.startingCapitalPaise, 100000000);
  assert.equal(model.market.instruments.length, 20);
  assert.deepEqual(model.orders.map(x => x.assetClass), ["EQUITY","FUTURE","OPTION"]);
  assert.ok(model.meta.disclaimer.includes("not live NSE/BSE"));
});
test("demo adapter requires explicit opt-in and refuses production", async () => {
  const fixtures = await allFixtures();
  assert.throws(() => createPaperDemoViewModel(fixtures), /PAPER_DEMO_NOT_EXPLICITLY_ENABLED/);
  assert.throws(() => createPaperDemoViewModel(fixtures,{enabled:true,production:true}), /PAPER_DEMO_DISABLED_IN_PRODUCTION/);
});
test("adapter rejects a non-MOCK or live-labelled quote", async () => {
  const fixtures = await allFixtures();
  fixtures.market.data.quotes[0].provider = "UPSTOX";
  assert.throws(() => createPaperDemoViewModel(fixtures,{enabled:true}), /INVALID_SYNTHETIC_QUOTE/);
});
test("adapter rejects real exchange symbols and malformed money", async () => {
  const fixtures = await allFixtures();
  fixtures.equity.data.symbol = "RELIANCE";
  assert.throws(() => createPaperDemoViewModel(fixtures,{enabled:true}), /NON_SYNTHETIC_INSTRUMENT_SYMBOL/);
  const next = await allFixtures();
  next.account.data.availableFundsPaise = 1;
  assert.throws(() => createPaperDemoViewModel(next,{enabled:true}), /INVALID_MOCK_ACCOUNT_SNAPSHOT/);
});
test("adapter returns detached deeply frozen view data and preserves unreconciled wallet state", async () => {
  const fixtures = await allFixtures();
  const model = createPaperDemoViewModel(fixtures,{enabled:true});
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.market.instruments));
  assert.ok(Object.isFrozen(model.market.instruments[0]));
  assert.throws(() => { model.market.instruments[0].symbol = "MUTATED"; }, TypeError);
  assert.equal(fixtures.market.data.quotes[0].symbol, "MOCKALPHA");
  assert.equal(model.account.ledgerReconciled, false);
});

test("adapter rejects cross-fixture timestamp drift and Equity identity mismatch", async () => {
  const stale = await allFixtures();
  stale.derivatives.asOf = "2026-11-23T09:30:00+05:30";
  assert.throws(() => createPaperDemoViewModel(stale,{enabled:true}),/MOCK_FIXTURE_SNAPSHOT_MISMATCH/);
  const wrongEquity = await allFixtures();
  wrongEquity.equity.data.symbol = "MOCKBETA";
  assert.throws(() => createPaperDemoViewModel(wrongEquity,{enabled:true}),/MOCK_EQUITY_INSTRUMENT_MISMATCH/);
});

test("adapter rejects non-synthetic account IDs and personal profile fields", async () => {
  const invalidId = await allFixtures();
  invalidId.account.data.accountId = "customer-123";
  assert.throws(() => createPaperDemoViewModel(invalidId,{enabled:true}),/INVALID_MOCK_ACCOUNT_IDENTITY/);
  const personal = await allFixtures();
  personal.account.data.fullName = "Private Customer";
  assert.throws(() => createPaperDemoViewModel(personal,{enabled:true}),/INVALID_MOCK_ACCOUNT_IDENTITY/);
});

test("adapter rejects envelopes outside the canonical synthetic source contract", async () => {
  const fixtures = await allFixtures();
  delete fixtures.market.meta.source;
  assert.throws(() => createPaperDemoViewModel(fixtures,{enabled:true}), /INVALID_MOCK_META:market/);
  const negative = await allFixtures();
  negative.account.data.availableFundsPaise = -1;
  negative.account.data.blockedFundsPaise = 100000001;
  assert.throws(() => createPaperDemoViewModel(negative,{enabled:true}), /INVALID_MOCK_ACCOUNT_SNAPSHOT/);
});

test("canonical catalog includes NSE/BSE equity, indices, Futures and CE/PE Options", async () => {
 const model=createPaperDemoViewModel(await allFixtures(),{enabled:true});
 const counts=Object.fromEntries(["EQUITY","INDEX","FUTURE","OPTION"].map(kind=>[kind,model.market.instruments.filter(x=>x.assetClass===kind).length]));
 assert.deepEqual(counts,{EQUITY:2,INDEX:2,FUTURE:4,OPTION:12});
 assert.ok(model.market.instruments.every(x=>x.instrumentKey.startsWith("MOCK|")&&x.symbol.startsWith("MOCK")));
 assert.equal(new Set(model.market.instruments.map(x=>x.instrumentKey)).size,model.market.instruments.length);
});
test("instrument search ranks exact symbol and filters by exchange, asset class and underlying", async () => {
 const model=createPaperDemoViewModel(await allFixtures(),{enabled:true});
 assert.equal(searchPaperDemoInstruments(model,{query:"MOCKSENSEX",assetClass:"INDEX",exchange:"BSE"})[0].symbol,"MOCKSENSEX");
 assert.ok(searchPaperDemoInstruments(model,{assetClass:"FUTURE",underlying:"MOCKNIFTY"}).every(x=>x.exchange==="NSE"));
 assert.equal(searchPaperDemoInstruments(model,{assetClass:"OPTION",exchange:"BSE"}).length,4);
});
test("Futures and Options sample receipts reuse exact canonical catalog contracts and quote prices", async () => {
  const fixtures = await allFixtures();
  const model = createPaperDemoViewModel(fixtures,{enabled:true});
  const future = model.market.instruments.find(item => item.instrumentKey === model.derivatives.futures.instrumentKey);
  const option = model.market.instruments.find(item => item.instrumentKey === model.derivatives.options.instrumentKey);
  assert.ok(future && option);
  assert.equal(future.symbol,model.derivatives.futures.symbol);
  assert.equal(future.expiry,model.derivatives.futures.expiry);
  assert.equal(future.lotSize,model.derivatives.futures.lotSize);
  assert.equal(model.derivatives.futures.order.limitPricePaise,future.bidPricePaise);
  assert.equal(option.symbol,model.derivatives.options.symbol);
  assert.equal(option.expiry,model.derivatives.options.expiry);
  assert.equal(option.strikePaise,model.derivatives.options.strikePaise);
  assert.equal(model.derivatives.options.order.averagePricePaise,option.askPricePaise);
  const mismatch = await allFixtures();
  mismatch.derivatives.data.futures.instrumentKey = "MOCK|NSE|FUT|LEGACY";
  assert.throws(() => createPaperDemoViewModel(mismatch,{enabled:true}),/MOCK_FUTURES_ORDER_INSTRUMENT_MISMATCH/);
});

test("expiry discovery is sorted and supports both Futures and Options", async () => {
 const model=createPaperDemoViewModel(await allFixtures(),{enabled:true});
 assert.deepEqual(getPaperDemoExpiries(model,{underlying:"MOCKNIFTY",assetClass:"OPTION"}),["2026-11-26","2026-12-31"]);
 assert.deepEqual(getPaperDemoExpiries(model,{underlying:"MOCKSENSEX",assetClass:"FUTURE",exchange:"BSE"}),["2026-12-29"]);
});
test("option chain groups CE/PE by strike and supports exact strike and side filters", async () => {
 const model=createPaperDemoViewModel(await allFixtures(),{enabled:true});
 const chain=getPaperDemoOptionChain(model,{underlying:"MOCKNIFTY",expiry:"2026-11-26"});
 assert.equal(chain.length,2);
 assert.ok(chain.every(row=>row.CE&&row.PE));
 const selected=getPaperDemoOptionChain(model,{underlying:"MOCKSENSEX",expiry:"2026-12-29",exchange:"BSE",strikePaise:8200000,optionType:"CE"});
 assert.equal(selected.length,1);assert.ok(selected[0].CE);assert.equal(selected[0].PE,null);
});
test("catalog rejects duplicate derivative identities and missing derivative quotes", async () => {
 const fixtures=await allFixtures();
 fixtures.derivatives.data.contracts.push({...fixtures.derivatives.data.contracts[0]});
 fixtures.derivatives.data.quotes.push({...fixtures.derivatives.data.quotes[0],instrumentKey:"MOCK|NSE|FUT|ORPHAN"});
 assert.throws(()=>createPaperDemoViewModel(fixtures,{enabled:true}),/DUPLICATE_MOCK_INSTRUMENT_KEY/);
 const missing=await allFixtures();missing.derivatives.data.quotes.pop();
 assert.throws(()=>createPaperDemoViewModel(missing,{enabled:true}),/MOCK_DERIVATIVE_CATALOG_REQUIRED/);
});

test("catalog rejects derivative keys whose exchange, type, underlying, strike, side or expiry disagree", async () => {
  const mutations = [
    c => { c.instrumentKey = c.instrumentKey.replace("|NSE|", "|BSE|"); },
    c => { c.instrumentKey = c.instrumentKey.replace("|OPT|", "|FUT|"); },
    c => { c.instrumentKey = c.instrumentKey.replace("|MOCKNIFTY|", "|MOCKBANK|"); },
    c => { c.instrumentKey = c.instrumentKey.replace("|25000|", "|25100|"); },
    c => { c.instrumentKey = c.instrumentKey.replace("|CE|", "|PE|"); },
    c => { c.instrumentKey = c.instrumentKey.replace("|2026-11-26", "|2026-12-31"); }
  ];
  for (const mutate of mutations) {
    const fixtures = await allFixtures();
    const option = fixtures.derivatives.data.contracts.find(item => item.assetClass === "OPTION" && item.optionType === "CE");
    mutate(option);
    assert.throws(() => createPaperDemoViewModel(fixtures,{enabled:true}), /MOCK_DERIVATIVE_INSTRUMENT_IDENTITY_MISMATCH/);
  }
  const wrongFuture = await allFixtures();
  wrongFuture.derivatives.data.contracts.find(item => item.assetClass === "FUTURE").instrumentKey =
    "MOCK|NSE|OPT|MOCKNIFTY|25000|CE|2026-12-31";
  assert.throws(() => createPaperDemoViewModel(wrongFuture,{enabled:true}), /MOCK_DERIVATIVE_INSTRUMENT_IDENTITY_MISMATCH/);
});

test("catalog rejects malformed market keys and Equity snapshots that point to an index", async () => {
  const malformed = await allFixtures();
  malformed.market.data.quotes[0].instrumentKey = "MOCK|NSE|EQ|bad";
  assert.throws(() => createPaperDemoViewModel(malformed,{enabled:true}), /MOCK_MARKET_INSTRUMENT_IDENTITY_MISMATCH/);
  const wrongEquity = await allFixtures();
  wrongEquity.equity.data.instrumentKey = "MOCK|NSE|INDEX|0003";
  wrongEquity.equity.data.symbol = "MOCKNIFTY50";
  assert.throws(() => createPaperDemoViewModel(wrongEquity,{enabled:true}), /MOCK_EQUITY_INSTRUMENT_MISMATCH/);
});
