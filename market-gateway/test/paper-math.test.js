"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {calculatePaperFill}=require("../lib/paper-math");

test("BUY deducts cash and computes weighted average cost",()=>{
 const r=calculatePaperFill({side:"BUY",quantity:2,pricePaise:10000,cashPaise:100000,position:{quantity:2,averagePricePaise:8000}});
 assert.deepEqual(r,{cashPaise:80000,realizedPnlPaise:0,orderRealizedPnlPaise:0,grossPaise:20000,position:{quantity:4,averagePricePaise:9000}});
});
test("BUY rejects insufficient cash",()=>assert.throws(()=>calculatePaperFill({side:"BUY",quantity:2,pricePaise:10000,cashPaise:19999}),{status:409}));
test("SELL credits cash and realizes profit",()=>{
 const r=calculatePaperFill({side:"SELL",quantity:2,pricePaise:12000,cashPaise:50000,realizedPnlPaise:1000,position:{quantity:3,averagePricePaise:10000}});
 assert.equal(r.cashPaise,74000);assert.equal(r.realizedPnlPaise,5000);assert.equal(r.orderRealizedPnlPaise,4000);assert.equal(r.position.quantity,1);
});
test("SELL rejects insufficient holdings",()=>assert.throws(()=>calculatePaperFill({side:"SELL",quantity:2,pricePaise:10000,cashPaise:1,position:{quantity:1,averagePricePaise:10000}}),{status:409}));
test("rejects unsafe gross order value",()=>assert.throws(()=>calculatePaperFill({side:"BUY",quantity:1000000,pricePaise:Number.MAX_SAFE_INTEGER,cashPaise:Number.MAX_SAFE_INTEGER}),{status:400}));
test("rejects malformed legacy position",()=>assert.throws(()=>calculatePaperFill({side:"BUY",quantity:1,pricePaise:100,cashPaise:1000,position:{quantity:-1,averagePricePaise:100}}),{status:409}));

test("allows negative cumulative realized P&L after a prior loss",()=>{
 const r=calculatePaperFill({side:"BUY",quantity:1,pricePaise:100,cashPaise:1000,realizedPnlPaise:-3500});
 assert.equal(r.realizedPnlPaise,-3500);
 assert.equal(r.cashPaise,900);
});
test("rejects SELL when average cost is zero",()=>assert.throws(()=>calculatePaperFill({side:"SELL",quantity:1,pricePaise:100,cashPaise:1000,position:{quantity:1,averagePricePaise:0}}),{status:409}));
test("rejects SELL when existing quantity is zero",()=>assert.throws(()=>calculatePaperFill({side:"SELL",quantity:1,pricePaise:100,cashPaise:1000,position:{quantity:0,averagePricePaise:100}}),{status:409}));
test("rejects existing position cost overflow before BUY",()=>assert.throws(()=>calculatePaperFill({side:"BUY",quantity:1,pricePaise:100,cashPaise:1000,position:{quantity:1000000,averagePricePaise:Number.MAX_SAFE_INTEGER}}),{status:409}));
test("SELL permits a loss and records negative order P&L",()=>{
 const r=calculatePaperFill({side:"SELL",quantity:2,pricePaise:8000,cashPaise:1000,realizedPnlPaise:500,position:{quantity:2,averagePricePaise:10000}});
 assert.equal(r.cashPaise,17000);assert.equal(r.orderRealizedPnlPaise,-4000);assert.equal(r.realizedPnlPaise,-3500);
});

test("a losing account can process a later SELL and update cumulative realized P&L",()=>{
 const r=calculatePaperFill({side:"SELL",quantity:1,pricePaise:900,cashPaise:1000,realizedPnlPaise:-3500,position:{quantity:1,averagePricePaise:1000}});
 assert.equal(r.orderRealizedPnlPaise,-100);
 assert.equal(r.realizedPnlPaise,-3600);
});
