(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.ZenuraDemoCharts=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const INTERVALS={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"1D":86400000,"1W":604800000,"1M":2592000000};
  const ANCHOR=Date.parse("2026-11-24T09:30:00+05:30");
  function hash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function createDemoCandles(instrument,timeframe="5m",count=64){
    if(!instrument||typeof instrument.instrumentKey!=="string"||!Number.isInteger(instrument.basePricePaise)||instrument.basePricePaise<=0)throw new TypeError("INVALID_DEMO_INSTRUMENT");
    const interval=INTERVALS[timeframe];if(!interval)throw new RangeError("UNSUPPORTED_DEMO_TIMEFRAME");
    if(!Number.isInteger(count)||count<2||count>500)throw new RangeError("INVALID_DEMO_CANDLE_COUNT");
    let state=(hash(instrument.instrumentKey+"|"+timeframe)+Number(instrument.seed||0))>>>0;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const bars=[];let previous=instrument.basePricePaise/100*(1+(Number(instrument.changeBps||0)/10000));
    const end=Math.floor(ANCHOR/interval)*interval;
    for(let i=count-1;i>=0;i--){
      const drift=(random()-.49)*.0035,open=previous,close=Math.max(.01,open*(1+drift));
      const spread=Math.max(.01,open*(.0005+random()*.0012));
      const high=Math.max(open,close)+spread*random(),low=Math.max(.01,Math.min(open,close)-spread*random());
      bars.push({timestamp:end-i*interval,open,high,low,close,volume:Math.round(500+random()*9500)});
      previous=close;
    }
    return bars;
  }
  function createDemoDepth(instrument,fixture){
    const price=instrument.basePricePaise/100;
    const map=side=>fixture.data.depth[side].map(level=>({price:Math.round(price*(1+level.priceOffsetBps/10000)*100)/100,quantity:level.quantity}));
    return {bids:map("bids"),asks:map("asks")};
  }
  function validateFixture(fixture){
    if(!fixture||fixture.schemaVersion!=="1.0.0"||fixture.mode!=="MOCK"||fixture.simulated!==true||fixture.meta?.source!=="SYNTHETIC_FIXTURE"||fixture.meta?.exchange!=="NONE"||!Array.isArray(fixture.data?.instruments)||!fixture.data?.depth)throw new Error("INVALID_DEMO_MARKET_FIXTURE");
    for(const instrument of fixture.data.instruments){
      if(typeof instrument.instrumentKey!=="string"||!instrument.instrumentKey.startsWith("MOCK|")||
         typeof instrument.symbol!=="string"||!/^MOCK[A-Z0-9 -]*$/.test(instrument.symbol)||
         !Number.isSafeInteger(instrument.basePricePaise)||instrument.basePricePaise<=0)throw new Error("INVALID_SYNTHETIC_DEMO_INSTRUMENT");
    }
    return fixture;
  }
  return Object.freeze({INTERVALS,validateFixture,createDemoCandles,createDemoDepth});
});