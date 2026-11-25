import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";

const require=createRequire(import.meta.url);
const fixture=require("../mock/fixtures/derivatives.json");
const {createDerivativeMockSimulator}=require("../../markets/stocks/derivative-mock-simulator.js");
const history=require("../lib/demo-trade-history-store.js");
global.window={ZenuraDemoTradeHistory:history};

test("CE and PE demo fills flow once into canonical events, positions and realized P&L",async()=>{
  const now=Date.parse(fixture.asOf);
  const engine=createDerivativeMockSimulator(fixture,{now});
  const contracts=engine.contracts().filter(x=>x.assetClass==="OPTION"&&x.exchange==="NSE"&&x.expiry==="2026-11-26"&&x.strikePaise===2500000);
  assert.deepEqual(contracts.map(x=>x.optionType).sort(),["CE","PE"]);
  for(const contract of contracts){
    const opened=engine.submit({instrumentKey:contract.instrumentKey,side:"BUY",orderType:"MARKET",lots:1});
    assert.equal(opened.status,"FILLED");
    assert.equal(opened.quantity,contract.lotSize);
    assert.equal(opened.fills[0].quantity,contract.lotSize);
    const closed=engine.submit({instrumentKey:contract.instrumentKey,side:"SELL",orderType:"MARKET",lots:1});
    assert.equal(closed.status,"FILLED");
    assert.equal(closed.fills[0].quantity,contract.lotSize);
  }
  const snapshot=engine.snapshot();
  assert.equal(snapshot.positions.length,0);
  const {syncDemoProjection}=await import("../../markets/stocks/demo-trade-projection.mjs");
  const first=syncDemoProjection("DERIVATIVES",snapshot);
  const second=syncDemoProjection("DERIVATIVES",snapshot);
  assert.equal(first.orders.length,4);
  assert.equal(first.trades.length,4);
  assert.deepEqual(second.orders,first.orders);
  assert.deepEqual(second.trades,first.trades);
  assert.equal(first.positions.length,2);
  for(const position of first.positions){
    assert.equal(position.assetClass,"OPTION");
    assert.equal(position.quantity,0);
    assert.equal(position.costBasisPaise,0);
    assert.ok(position.realizedPnlPaise<0);
  }
  const replayed=history.createDemoTradeHistoryStore({env:{NODE_ENV:"test"}}).replay(first.events);
  assert.deepEqual(replayed.orders,first.orders);
  assert.deepEqual(replayed.trades,first.trades);
  assert.deepEqual(replayed.positions,first.positions);
});

test("Options demo order receipts preserve contract identity, lot quantity and synthetic-only markers",()=>{
  const engine=createDerivativeMockSimulator(fixture,{now:Date.parse(fixture.asOf)});
  const contract=engine.contracts().find(x=>x.assetClass==="OPTION"&&x.optionType==="PE");
  const receipt=engine.submit({instrumentKey:contract.instrumentKey,side:"BUY",orderType:"MARKET",lots:2});
  assert.equal(receipt.instrumentKey,contract.instrumentKey);
  assert.equal(receipt.optionType,"PE");
  assert.equal(receipt.expiry,contract.expiry);
  assert.equal(receipt.strikePaise,contract.strikePaise);
  assert.equal(receipt.lotSize,contract.lotSize);
  assert.equal(receipt.quantity,2*contract.lotSize);
  assert.equal(receipt.simulationOnly,true);
  assert.equal(receipt.status,"FILLED");
});
