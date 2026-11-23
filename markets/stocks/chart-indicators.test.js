"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const I=require("./chart-indicators");
const bars=[
 {timestamp:Date.parse("2026-11-20T09:15:00+05:30"),open:9,high:12,low:8,close:10,volume:100},
 {timestamp:Date.parse("2026-11-20T09:16:00+05:30"),open:10,high:14,low:10,close:12,volume:100},
 {timestamp:Date.parse("2026-11-20T09:17:00+05:30"),open:12,high:15,low:11,close:14,volume:100}
];
test("VWAP is volume-weighted and resets on the India session date",()=>{
 const values=I.vwap(bars);
 assert.equal(values[0],10);
 assert.equal(values[1],11);
 assert.ok(values[2]>11&&values[2]<14);
 const next=I.vwap([...bars,{...bars[2],timestamp:Date.parse("2026-11-21T09:15:00+05:30"),close:20,high:21,low:19}]);
 assert.equal(next[3],20);
});
test("ATR uses true range and Wilder initialization",()=>{
 const values=I.atr(bars,2);
 assert.equal(values[0],null);
 assert.equal(values[1],4);
 assert.ok(values[2]>0);
});
test("Stochastic returns bounded %K and a smoothed %D",()=>{
 const values=I.stochastic(bars,2,2);
 assert.ok(values.k[1]>=0&&values.k[1]<=100);
 assert.ok(values.d[2]>=0&&values.d[2]<=100);
 assert.ok(Math.abs(values.d[2]-73.3333333333)<0.001);
});
test("MFI remains bounded and handles zero negative flow",()=>{
 const values=I.mfi(bars,2);
 assert.equal(values[2],100);
});
test("ADX and Supertrend produce finite values after warm-up",()=>{
 const series=Array.from({length:45},(_,i)=>({
   timestamp:Date.parse("2026-11-20T09:15:00+05:30")+i*60000,
   open:100+i,high:102+i,low:99+i,close:101+i,volume:1000+i
 }));
 const d=I.adx(series,14);
 assert.ok(Number.isFinite(d.adx[26]));
 assert.ok(Number.isFinite(d.plusDI[13]));
 const st=I.supertrend(series,10,3);
 assert.ok(Number.isFinite(st.supertrend[9]));
});
test("registers custom indicators without requiring browser globals",()=>{
 const names=[];
 const lib={registerIndicator:definition=>names.push(definition.name)};
 assert.equal(I.register(lib),true);
 assert.deepEqual(names,["VWAP","ATR","ADX","STOCH","SUPERTREND","MFI"]);
});
