"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {resolveFuturesMarketExecution}=require("../lib/futures-market-execution");

const NOW=Date.parse("2026-11-23T05:00:00.000Z");
const book={
  timestampMs:NOW-1000,ageMs:1000,
  bidPricePaise:9895,bidQuantity:50,
  askPricePaise:9900,askQuantity:75
};

test("Futures MARKET BUY executes at best ask and SELL at best bid",()=>{
  const buy=resolveFuturesMarketExecution({quote:book,side:"BUY",quantity:50,tickSizePaise:5,nowMs:NOW});
  const sell=resolveFuturesMarketExecution({quote:book,side:"SELL",quantity:25,tickSizePaise:5,nowMs:NOW});
  assert.equal(buy.pricePaise,9900);
  assert.equal(buy.grossPaise,495000);
  assert.equal(buy.executionPolicy,"BEST_ASK_FOR_BUY_BEST_BID_FOR_SELL");
  assert.equal(sell.pricePaise,9895);
  assert.equal(sell.grossPaise,247375);
});

test("rejects insufficient displayed depth instead of pretending to fill the whole MARKET order",()=>{
  assert.throws(
    ()=>resolveFuturesMarketExecution({quote:book,side:"BUY",quantity:100,tickSizePaise:5,nowMs:NOW}),
    {status:409}
  );
});

test("rejects stale, future-dated, incomplete and off-tick Futures books",()=>{
  assert.throws(()=>resolveFuturesMarketExecution({quote:book,side:"BUY",quantity:25,tickSizePaise:5,nowMs:NOW+20000}),{status:409});
  assert.throws(()=>resolveFuturesMarketExecution({quote:{...book,timestampMs:NOW+1},side:"BUY",quantity:25,tickSizePaise:5,nowMs:NOW}),{status:409});
  assert.throws(()=>resolveFuturesMarketExecution({quote:{...book,askQuantity:0},side:"BUY",quantity:25,tickSizePaise:5,nowMs:NOW}),{status:409});
  assert.throws(()=>resolveFuturesMarketExecution({quote:{...book,askPricePaise:9902},side:"BUY",quantity:25,tickSizePaise:5,nowMs:NOW}),{status:409});
  assert.throws(()=>resolveFuturesMarketExecution({quote:{...book,bidPricePaise:9905},side:"BUY",quantity:25,tickSizePaise:5,nowMs:NOW}),{status:409});
});
