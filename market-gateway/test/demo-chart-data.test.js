"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fixture=require("../../markets/stocks/demo-market-data.json");
const demo=require("../../markets/stocks/demo-chart-data.js");
test("demo fixture is explicitly synthetic and not an exchange feed",()=>{
  assert.equal(demo.validateFixture(fixture).mode,"MOCK");
  assert.equal(fixture.simulated,true);
  assert.equal(fixture.meta.exchange,"NONE");
  assert.equal(fixture.meta.source,"SYNTHETIC_FIXTURE");
  assert.ok(fixture.data.instruments.every(x=>x.instrumentKey.startsWith("MOCK|")&&x.symbol.startsWith("MOCK")));
});
test("OHLC candles are deterministic for the same instrument and timeframe",()=>{
  const instrument=fixture.data.instruments[0];
  assert.deepEqual(demo.createDemoCandles(instrument,"5m"),demo.createDemoCandles(instrument,"5m"));
});
test("all supported timeframes return valid, ordered OHLCV bars",()=>{
  for(const timeframe of Object.keys(demo.INTERVALS)){
    const bars=demo.createDemoCandles(fixture.data.instruments[1],timeframe,40);
    assert.equal(bars.length,40);
    for(let i=0;i<bars.length;i++){
      const b=bars[i];
      assert.ok(b.high>=Math.max(b.open,b.close));
      assert.ok(b.low<=Math.min(b.open,b.close));
      assert.ok(b.volume>=500);
      if(i)assert.ok(b.timestamp>bars[i-1].timestamp);
    }
  }
});
test("depth levels are deterministic and ordered around synthetic reference price",()=>{
  const depth=demo.createDemoDepth(fixture.data.instruments[0],fixture);
  assert.equal(depth.bids.length,5);assert.equal(depth.asks.length,5);
  assert.ok(depth.bids[0].price<depth.asks[0].price);
  assert.ok(depth.bids.every((x,i,a)=>!i||x.price<a[i-1].price));
  assert.ok(depth.asks.every((x,i,a)=>!i||x.price>a[i-1].price));
});
test("rejects the old DEMO namespace and live-looking symbol names",()=>{
  const legacy=JSON.parse(JSON.stringify(fixture));
  legacy.data.instruments[0].instrumentKey="DEMO|INDEX|ALPHA50";
  assert.throws(()=>demo.validateFixture(legacy),/INVALID_SYNTHETIC_DEMO_INSTRUMENT/);
  const named=JSON.parse(JSON.stringify(fixture));
  named.data.instruments[0].symbol="RELIANCE";
  assert.throws(()=>demo.validateFixture(named),/INVALID_SYNTHETIC_DEMO_INSTRUMENT/);
});
test("invalid fixture, timeframe and candle counts fail closed",()=>{
  assert.throws(()=>demo.validateFixture({}),/INVALID_DEMO_MARKET_FIXTURE/);
  assert.throws(()=>demo.createDemoCandles(fixture.data.instruments[0],"2m"),/UNSUPPORTED_DEMO_TIMEFRAME/);
  assert.throws(()=>demo.createDemoCandles(fixture.data.instruments[0],"1m",501),/INVALID_DEMO_CANDLE_COUNT/);
});
