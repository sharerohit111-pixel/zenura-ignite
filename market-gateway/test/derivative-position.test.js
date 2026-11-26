"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {applyDerivativeFill}=require("../lib/derivative-position");
const run=(x)=>applyDerivativeFill({...x,now:1_800_000_000_000});
test("opens and averages a long futures position without premium cash debit",()=>{
 let r=run({instrumentType:"FUT",side:"BUY",quantity:50,pricePaise:10000});
 assert.equal(r.netQuantity,50);assert.equal(r.averagePricePaise,10000);assert.equal(r.cashDeltaPaise,0);
 r=run({instrumentType:"FUT",side:"BUY",quantity:50,pricePaise:12000,position:{netQuantity:50,averagePricePaise:10000}});
 assert.equal(r.netQuantity,100);assert.equal(r.averagePricePaise,11000);assert.equal(r.openedQuantity,50);
});
test("partially closes long futures and settles realized P&L",()=>{
 const r=run({instrumentType:"FUT",side:"SELL",quantity:40,pricePaise:13000,position:{netQuantity:100,averagePricePaise:11000}});
 assert.equal(r.netQuantity,60);assert.equal(r.averagePricePaise,11000);assert.equal(r.closedQuantity,40);assert.equal(r.realizedPnlPaise,80000);assert.equal(r.cashDeltaPaise,80000);
});
test("reverses long futures into short at the new fill price",()=>{
 const r=run({instrumentType:"FUT",side:"SELL",quantity:120,pricePaise:9000,position:{netQuantity:100,averagePricePaise:10000}});
 assert.equal(r.netQuantity,-20);assert.equal(r.averagePricePaise,9000);assert.equal(r.closedQuantity,100);assert.equal(r.openedQuantity,20);assert.equal(r.realizedPnlPaise,-100000);assert.equal(r.cashDeltaPaise,-100000);
});
test("long option buy debits premium and sell credits premium",()=>{
 let r=run({instrumentType:"CE",side:"BUY",quantity:25,pricePaise:5000});
 assert.equal(r.cashDeltaPaise,-125000);assert.equal(r.optionPremiumCashDeltaPaise,-125000);
 r=run({instrumentType:"CE",side:"SELL",quantity:10,pricePaise:7000,position:{netQuantity:25,averagePricePaise:5000}});
 assert.equal(r.netQuantity,15);assert.equal(r.realizedPnlPaise,20000);assert.equal(r.cashDeltaPaise,70000);
});
test("opens and closes short options with premium cash movements",()=>{
 let r=run({instrumentType:"PE",side:"SELL",quantity:25,pricePaise:4000});
 assert.equal(r.netQuantity,-25);assert.equal(r.cashDeltaPaise,100000);
 r=run({instrumentType:"PE",side:"BUY",quantity:25,pricePaise:2500,position:{netQuantity:-25,averagePricePaise:4000}});
 assert.equal(r.netQuantity,0);assert.equal(r.averagePricePaise,0);assert.equal(r.realizedPnlPaise,37500);assert.equal(r.cashDeltaPaise,-62500);
});
test("rejects invalid inputs, malformed positions and unsafe values",()=>{
 assert.throws(()=>run({instrumentType:"EQ",side:"BUY",quantity:1,pricePaise:100}));
 assert.throws(()=>run({instrumentType:"FUT",side:"BUY",quantity:0,pricePaise:100}));
 assert.throws(()=>run({instrumentType:"FUT",side:"BUY",quantity:1,pricePaise:100,position:{netQuantity:1,averagePricePaise:0}}));
 assert.throws(()=>run({instrumentType:"FUT",side:"BUY",quantity:1000000,pricePaise:Number.MAX_SAFE_INTEGER}));
});
test("supports a closed position reopening on the opposite side",()=>{
 const r=run({instrumentType:"FUT",side:"SELL",quantity:10,pricePaise:15000,position:{netQuantity:10,averagePricePaise:12000}});
 assert.equal(r.netQuantity,0);assert.equal(r.averagePricePaise,0);assert.equal(r.realizedPnlPaise,30000);
});
