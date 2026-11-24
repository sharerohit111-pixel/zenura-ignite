"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildOptionsAccountingSnapshot}=require("../lib/options-accounting-read-model");

const base={
 account:{cash_paise:1_000_000,reserved_cash_paise:100_000,reserved_margin_paise:50_000,realized_pnl_paise:900},
 positions:[{instrument_key:"NSE_FO|NIFTY_CE",trading_symbol:"NIFTY CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",expiry:"2026-12-31",lot_size:65,net_quantity:65,reserved_quantity:65,cost_basis_paise:82_771,average_price_paise:1_273}],
 limitOrders:[{order_id:"buy1",instrument_key:"NSE_FO|NIFTY_PE",trading_symbol:"NIFTY PE",exchange:"NSE",segment:"NSE_FO",instrument_type:"PE",side:"BUY",status:"PENDING",lot_size:65,filled_quantity:0,remaining_quantity:65,reserved_cash_paise:70_000,reserved_close_quantity:0,quantity:65,created_at:"2026-11-24T10:00:00Z"},{order_id:"sell1",instrument_key:"NSE_FO|NIFTY_CE",trading_symbol:"NIFTY CE",exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",side:"SELL",status:"PARTIALLY_FILLED",lot_size:65,reserved_cash_paise:0,reserved_close_quantity:65,quantity:130,filled_quantity:65,remaining_quantity:65,cumulative_gross_paise:97_500,cumulative_charges_paise:100,created_at:"2026-11-24T10:01:00Z"}],
 limitFills:[{order_id:"sell1",execution_id:"exec1",fill_sequence:1,fill_quantity:65,execution_price_paise:1500,gross_paise:97_500,incremental_charges_paise:100,realized_pnl_paise:14_629}],
 marketOrders:[{order_id:"m1",instrument_key:"NSE_FO|BANKNIFTY_PE",trading_symbol:"BANKNIFTY PE",exchange:"NSE",segment:"NSE_FO",instrument_type:"PE",side:"SELL",status:"FILLED",quantity:65,execution_price_paise:1000,gross_paise:65_000,charges_paise:100,realized_pnl_paise:-500,created_at:"2026-11-24T09:00:00Z"}],
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


test("rejects impossible LIMIT lifecycle states and reservation-release flags",()=>{
  const mutate=(id,changes)=>base.limitOrders.map(order=>order.order_id===id?{...order,...changes}:order);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("buy1",{status:"FILLED",reservation_released:true})}),/status, or lot size/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("buy1",{status:"UNKNOWN"})}),/status, or lot size/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("sell1",{reservation_released:true})}),/release flag/);
  assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitOrders:mutate("sell1",{status:"PARTIALLY_FILLED",filled_quantity:0})}),/status, or lot size/);
});


test("includes contract identity in the reconciled MARKET and LIMIT history read model",()=>{
 const snapshot=buildOptionsAccountingSnapshot(base);
 const market=snapshot.history.find(row=>row.source==="MARKET");
 const limit=snapshot.history.find(row=>row.source==="LIMIT");
 assert.equal(market.tradingSymbol,base.marketOrders[0].trading_symbol);
 assert.equal(market.instrumentKey,base.marketOrders[0].instrument_key);
 assert.equal(limit.tradingSymbol,base.limitOrders[0].trading_symbol);
 assert.equal(limit.instrumentKey,base.limitOrders[0].instrument_key);
});


const expirySettlement={
 settlement_id:"a".repeat(64),instrument_key:"NSE_FO|NIFTY_CE",trading_symbol:"NIFTY CE",
 exchange:"NSE",segment:"NSE_FO",instrument_type:"CE",underlying_type:"INDEX",
 settlement_type:"CASH_SETTLED",expiry:"2026-11-20",strike_price_paise:250000,
 settlement_price_paise:260000,settled_quantity:65,entry_cost_basis_paise:500000,
 intrinsic_value_paise:10000,gross_payout_paise:650000,exercise_stt_paise:1000,
 net_payout_paise:649000,realized_pnl_paise:149000,
 settlement_source:"https://www.nseindia.com/reports/settlement-price",
 settlement_source_sha256:"b".repeat(64),settlement_timestamp_ms:1795150000000,
 verified_at_ms:1795150100000,charge_schedule_version:"NSE_EXERCISE_STT_2026_04_V1",
 created_at:"2026-11-20T12:00:00Z"
};

test("includes immutable cash-settled index expiry receipts in realized P&L and charges",()=>{
 const r=buildOptionsAccountingSnapshot({...base,expirySettlements:[expirySettlement]});
 assert.equal(r.realizedPnlPaise,163129);
 assert.equal(r.chargesPaidPaise,1200);
 assert.equal(r.history.some(x=>x.source==="EXPIRY"&&x.id===expirySettlement.settlement_id&&x.status==="SETTLED"),true);
});

test("rejects physical settlement and expiry payout or source tampering",()=>{
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,expirySettlements:[{...expirySettlement,settlement_type:"PHYSICAL"}]}),/classification/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,expirySettlements:[{...expirySettlement,gross_payout_paise:649999}]}),/does not reconcile/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,expirySettlements:[{...expirySettlement,settlement_source:"https://attacker.example/settlement"}]}),/does not reconcile/);
});


test("rejects partial or arithmetically inconsistent immutable fill charge breakdowns",()=>{
 const chargeFill={...base.limitFills[0],brokerage_paise:100,exchange_transaction_paise:0,
  ipft_paise:0,sebi_paise:0,stamp_duty_paise:0,stt_paise:0,gst_paise:0,
  charge_schedule_version:"NSE_OPTIONS_SIM_V1_2026_11"};
 const valid=buildOptionsAccountingSnapshot({...base,limitFills:[chargeFill]});
 assert.equal(valid.history.some(order=>order.source==="LIMIT"&&order.fills?.[0]?.chargeBreakdownPaise?.brokerage===100),true);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitFills:[{...chargeFill,gst_paise:1}]}),/do not reconcile/);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,limitFills:[{...chargeFill,stt_paise:undefined}]}),/incomplete charge breakdown/);
});


test("validates and exposes the existing Options MARKET receipt charge breakdown",()=>{
 const market={...base.marketOrders[0],charges_breakdown:{
  grossPaise:65000,brokeragePaise:20,exchangeTransactionPaise:10,ipftPaise:0,
  sebiPaise:5,stampDutyPaise:0,gstPaise:5,sttPaise:60,totalChargesPaise:100,
  exchange:"NSE",side:"SELL",chargeScheduleVersion:"NSE_OPTIONS_MARKET_SIM_V1_2026_11",indicative:true,simulationOnly:true
 }};
 const r=buildOptionsAccountingSnapshot({...base,marketOrders:[market]});
 const row=r.history.find(item=>item.source==="MARKET");
 assert.equal(row.chargeBreakdownPaise.stt,60);
 assert.equal(row.chargeScheduleVersion,"NSE_OPTIONS_MARKET_SIM_V1_2026_11");
 assert.equal(row.chargesPaise,100);
 assert.throws(()=>buildOptionsAccountingSnapshot({...base,marketOrders:[{...market,charges_breakdown:{...market.charges_breakdown,sttPaise:61}}]}),/does not reconcile/);
});
