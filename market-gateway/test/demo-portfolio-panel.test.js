"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
let build;
test("portfolio uses canonical marks and shared signed position projection", async () => {
  ({ buildDemoPortfolioView: build } = await import("../../markets/stocks/demo-portfolio-panel.mjs"));
  const snapshot = { mode:"DEMO", simulationOnly:true, orders:[], trades:[], positions:[
    {assetClass:"EQUITY",product:"DELIVERY",instrumentKey:"MOCK|NSE|EQ|1",quantity:10,averagePricePaise:10000,costBasisPaise:100000,realizedPnlPaise:500},
    {assetClass:"FUTURE",product:"INTRADAY",instrumentKey:"MOCK|NSE|FUT|1",quantity:-2,averagePricePaise:20000,costBasisPaise:40000,realizedPnlPaise:1000},
    {assetClass:"OPTION",product:"DELIVERY",instrumentKey:"MOCK|NSE|OPT|1",quantity:5,averagePricePaise:5000,costBasisPaise:25000,realizedPnlPaise:-200},
    {assetClass:"EQUITY",product:"INTRADAY",instrumentKey:"MOCK|NSE|EQ|CLOSED",quantity:0,averagePricePaise:0,costBasisPaise:0,realizedPnlPaise:300}
  ]};
  const instruments = [
    {instrumentKey:"MOCK|NSE|EQ|1",symbol:"MOCKEQ",exchange:"NSE",assetClass:"EQUITY",lastPricePaise:11000,timestamp:"2026-11-25T09:30:00Z",simulated:true,stale:false},
    {instrumentKey:"MOCK|NSE|FUT|1",symbol:"MOCKFUT",exchange:"NSE",assetClass:"FUTURE",lastPricePaise:19000,timestamp:"2026-11-25T09:30:00Z",simulated:true,stale:false},
    {instrumentKey:"MOCK|NSE|OPT|1",symbol:"MOCKOPT",exchange:"NSE",assetClass:"OPTION",lastPricePaise:6000,timestamp:"2026-11-25T09:30:00Z",simulated:true,stale:false}
  ];
  const view = build(snapshot,instruments,"2026-11-25T09:31:00Z");
  assert.equal(view.positions.length,3);
  assert.equal(view.holdings.length,1);
  assert.equal(view.realizedPnlPaise,1600);
  assert.equal(view.unrealizedPnlPaise,17000);
  assert.equal(view.totalPnlPaise,18600);
  assert.equal(view.positions.find(p=>p.assetClass==="FUTURE").unrealizedPnlPaise,2000);
  assert.equal(view.ledgerReconciled,false);
});
test("missing or stale marks suppress aggregate unrealized and total P&L", async () => {
  if (!build) ({ buildDemoPortfolioView: build } = await import("../../markets/stocks/demo-portfolio-panel.mjs"));
  const snapshot = {mode:"DEMO",simulationOnly:true,orders:[],trades:[],positions:[
    {assetClass:"EQUITY",product:"DELIVERY",instrumentKey:"MOCK|NSE|EQ|1",quantity:1,averagePricePaise:100,costBasisPaise:100,realizedPnlPaise:0}
  ]};
  const stale = [{instrumentKey:"MOCK|NSE|EQ|1",symbol:"MOCKEQ",exchange:"NSE",lastPricePaise:120,timestamp:"2026-11-25T09:30:00Z",simulated:true,stale:true}];
  const view = build(snapshot,stale,"2026-11-25T09:31:00Z");
  assert.equal(view.positions[0].unrealizedPnlPaise,null);
  assert.equal(view.unrealizedPnlPaise,null);
  assert.equal(view.totalPnlPaise,null);
  assert.equal(view.ledgerReconciled,false);
});
