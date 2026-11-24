"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildOptionsAccountingSnapshot}=require("../lib/options-accounting-read-model");

const base={
 account:{cash_paise:1_000_000,reserved_cash_paise:100_000,reserved_margin_paise:50_000,realized_pnl_paise:900},
 positions:[{instrument_key:"NSE_FO|NIFTY_CE",trading_symbol:"NIFTY CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",expiry:"2026-12-31",lot_size:65,net_quantity:65,reserved_quantity:65,cost_basis_paise:82_771,average_price_paise:1_273}],
 limitOrders:[{order_id:"buy1",instrument_key:"NSE_FO|NIFTY_PE",exchange:"NSE",segment:"NSE_FO",instrument_type:"PE",side:"BUY",status:"PENDING",lot_size:65,filled_quantity:0,remaining_quantity:65,reserved_cash_paise:70_000,reserved_close_quantity:0,quantity:65,created_at:"2026-11-24T10:00:00Z"},{order_id:"sell1",instrument_key:"NSE_FO|NIFTY_CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",side:"SELL",status:"PARTIALLY_FILLED",lot_size:65,reserved_cash_paise:0,reserved_close_quantity:65,quantity:130,filled_quantity:65,remaining_quantity:65,cumulative_gross_paise:97_500,cumulative_charges_paise:100,created_at:"2026-11-24T10:01:00Z"}],
 limitFills:[{order_id:"sell1",execution_id:"exec1",fill_sequence:1,fill_quantity:65,execution_price_paise:1500,gross_paise:97_500,incremental_charges_paise:100,realized_pnl_paise:14_629}],
 marketOrders:[{order_id:"m1",exchange:"NSE",segment:"NSE_FO",instrument_type:"PE",side:"SELL",status:"FILLED",quantity:65,gross_paise:50_000,charges_paise:100,realized_pnl_paise:-500,created_at:"2026-11-24T09:00:00Z"}],
 quotes:[{instrumentKey:"NSE_FO|NIFTY_CE",pricePaise:1500,observedAtMs:1_800_000_000_000}],
 now:1_800_000_001_000
};

test("reconciles available cash, blocked premium, invested basis and fresh mark-to-market in paise",()=>{
 const r=buildOptionsAccountingSnapshot(base);
 assert.equal(r.availableCashPaise,850_000);
 assert.equal(r.blockedPremiumPaise,70_000);
 assert.equal(r.premiumInvestedPaise,82_771);
 assert.equal(r.reservedCloseQuantity,65);
 assert.equal(r.marketValuePaise,97_500);
 assert.equal(r.unrealizedPnlPaise,14_729);
 assert.equal(r.realizedPnlPaise,14_129);
 assert.equal(r.chargesPaidPaise,200);
 assert.equal(r.valuationStatus,"fresh");
 assert.equal(r.positions[0].availableCloseQuantity,0);
});

test("does not publish a misleading aggregate when any position quote is stale or absent",()=>{
 const r=buildOptionsAccountingSnapshot({...base,quotes:[]});
 assert.equal(r.positions[0].marketValuePaise,null);
 assert.equal(r.marketValuePaise,null);
 assert.equal(r.unrealizedPnlPaise,null);
 assert.equal(r.valuationStatus,"partial_stale");
});

test("does not count futures or non-NSE option records as NSE options",()=>{
 const r=buildOptionsAccountingSnapshot({...base,positions:[{...base.positions[0],instrument_type:"FUT"}],limitOrders:[],limitFills:[],marketOrders:[],quotes:[]});
 assert.equal(r.positions.length,0);
 assert.equal(r.premiumInvestedPaise,0);
 assert.equal(r.blockedPremiumPaise,0);
});

test("rejects non-integer paise, broken lot sizes, over-reserved closes and reservation drift",()=>{
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,account:{...base.account,cash_paise:1.5}}),/safe integer/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,positions:[{...base.positions[0],net_quantity:64}]}),/lot-size/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,positions:[{...base.positions[0],reserved_quantity:66}]}),/inconsistent/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,positions:[{...base.positions[0],reserved_quantity:0}]}),/does not reconcile/);
});

test("rejects blocked premium beyond account reservation and fill-ledger drift",()=>{
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,account:{...base.account,reserved_cash_paise:50_000}}),/exceeds the account/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:base.limitOrders.map(order=>order.order_id==="sell1"?{...order,cumulative_charges_paise:99}:order)}),/do not reconcile/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitFills:[...base.limitFills,{...base.limitFills[0],order_id:"missing"}]}),/orphaned/);
});

test("rejects stale future quotes and unsafe arithmetic",()=>{
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,quotes:[{instrumentKey:"NSE_FO|NIFTY_CE",pricePaise:Number.MAX_SAFE_INTEGER,observedAtMs:1_800_000_000_000}]}),/safe integer/);
 const future=buildOptionsAccountingSnapshot({...base,quotes:[{instrumentKey:"NSE_FO|NIFTY_CE",pricePaise:1500,observedAtMs:1_800_000_002_000}]});
 assert.equal(future.valuationStatus,"partial_stale");
});


test("rejects LIMIT lifecycle quantity and reservation drift before presenting a snapshot",()=>{
  const mutate=(id,changes)=>base.limitOrders.map(order=>order.order_id===id?{...order,...changes}:order);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("buy1",{remaining_quantity:64})}),/do not reconcile/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("buy1",{reserved_cash_paise:0})}),/BUY reservation/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("sell1",{reserved_close_quantity:64})}),/SELL reservation/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("sell1",{lot_size:64})}),/lot size/);
});

test("rejects duplicate positions and account-reservation integer overflow",()=>{
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,positions:[...base.positions,{...base.positions[0]}]}),/duplicate instrument key/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,account:{...base.account,reserved_cash_paise:Number.MAX_SAFE_INTEGER,reserved_margin_paise:1}}),/safe integer/);
});

test("rejects LIMIT fill notional drift and BUY rows with realized P&L",()=>{
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitFills:[{...base.limitFills[0],gross_paise:97_499}]}),/execution price multiplied/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,marketOrders:[{...base.marketOrders[0],side:"BUY",realized_pnl_paise:1}]}),/cannot realize P&L/);
});

test("rejects duplicate MARKET order identities and overfilled LIMIT orders",()=>{
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,marketOrders:[...base.marketOrders,{...base.marketOrders[0]}]}),/duplicate order/);
  const orders=base.limitOrders.map(order=>order.order_id==="sell1"?{...order,filled_quantity:130,remaining_quantity:0}:order);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:orders}),/quantity, fills, remaining/);
});
