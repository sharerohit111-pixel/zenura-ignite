import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createPaperDemoViewModel,isPaperDemoViewModel} from "../../markets/shared/paper-demo-adapter.mjs";

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
  assert.equal(model.market.instruments.length, 2);
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
test("adapter returns detached view data and preserves unreconciled wallet state", async () => {
  const fixtures = await allFixtures();
  const model = createPaperDemoViewModel(fixtures,{enabled:true});
  model.market.instruments[0].symbol = "MUTATED";
  assert.equal(fixtures.market.data.quotes[0].symbol, "MOCKALPHA");
  assert.equal(model.account.ledgerReconciled, false);
});
