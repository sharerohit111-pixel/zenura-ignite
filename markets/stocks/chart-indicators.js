/* Custom technical indicators for KLineChart 10.x. Pure O(n) calculations. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.ZenuraChartIndicators=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  function sessionKey(timestamp){
    return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(timestamp));
  }
  function vwap(data){
    let day="",pv=0,volume=0;
    return data.map((bar)=>{
      const nextDay=sessionKey(bar.timestamp);
      if(nextDay!==day){day=nextDay;pv=0;volume=0;}
      const v=Number(bar.volume)||0,tp=(bar.high+bar.low+bar.close)/3;
      pv+=tp*v;volume+=v;
      return volume>0?pv/volume:null;
    });
  }
  function trueRanges(data){
    return data.map((bar,i)=>{
      if(i===0)return bar.high-bar.low;
      const prev=data[i-1].close;
      return Math.max(bar.high-bar.low,Math.abs(bar.high-prev),Math.abs(bar.low-prev));
    });
  }
  function wilder(values,period){
    const out=Array(values.length).fill(null);
    if(!Number.isInteger(period)||period<1||values.length<period)return out;
    let sum=0;
    for(let i=0;i<period;i++)sum+=values[i]||0;
    let current=sum/period;out[period-1]=current;
    for(let i=period;i<values.length;i++){current=(current*(period-1)+(values[i]||0))/period;out[i]=current;}
    return out;
  }
  function atr(data,period=14){return wilder(trueRanges(data),period);}
  function adx(data,period=14){
    const tr=trueRanges(data),plus=Array(data.length).fill(0),minus=Array(data.length).fill(0);
    for(let i=1;i<data.length;i++){
      const up=data[i].high-data[i-1].high,down=data[i-1].low-data[i].low;
      plus[i]=up>down&&up>0?up:0;minus[i]=down>up&&down>0?down:0;
    }
    const smoothTR=wilder(tr,period),smoothPlus=wilder(plus,period),smoothMinus=wilder(minus,period);
    const plusDI=Array(data.length).fill(null),minusDI=Array(data.length).fill(null),dx=Array(data.length).fill(null);
    for(let i=0;i<data.length;i++){
      if(!smoothTR[i]||smoothTR[i]<=0)continue;
      plusDI[i]=100*smoothPlus[i]/smoothTR[i];minusDI[i]=100*smoothMinus[i]/smoothTR[i];
      const total=plusDI[i]+minusDI[i];
      dx[i]=total>0?100*Math.abs(plusDI[i]-minusDI[i])/total:0;
    }
    const firstValid=dx.findIndex(Number.isFinite);
    const shifted=Array(data.length).fill(0);
    if(firstValid<0)return {adx:shifted.map(()=>null),plusDI,minusDI};
    const adxValues=Array(data.length).fill(null);
    const first=dx.slice(firstValid).findIndex(v=>v!==null&&Number.isFinite(v));
    const start=firstValid+first;
    if(start+period>data.length)return {adx:adxValues,plusDI,minusDI};
    let seed=0;for(let i=start;i<start+period;i++)seed+=dx[i]||0;
    let current=seed/period;adxValues[start+period-1]=current;
    for(let i=start+period;i<data.length;i++){current=(current*(period-1)+(dx[i]||0))/period;adxValues[i]=current;}
    return {adx:adxValues,plusDI,minusDI};
  }
  function stochastic(data,period=14,smooth=3){
    const k=Array(data.length).fill(null),d=Array(data.length).fill(null);
    for(let i=period-1;i<data.length;i++){
      let high=-Infinity,low=Infinity;
      for(let j=i-period+1;j<=i;j++){high=Math.max(high,data[j].high);low=Math.min(low,data[j].low);}
      k[i]=high===low?50:100*(data[i].close-low)/(high-low);
    }
    for(let i=period+smooth-2;i<data.length;i++){
      const values=k.slice(i-smooth+1,i+1);
      if(values.every(Number.isFinite))d[i]=values.reduce((a,b)=>a+b,0)/smooth;
    }
    return {k,d};
  }
  function supertrend(data,period=10,multiplier=3){
    const ranges=atr(data,period),line=Array(data.length).fill(null),direction=Array(data.length).fill(0);
    let upper=null,lower=null,trend=1;
    for(let i=0;i<data.length;i++){
      if(!Number.isFinite(ranges[i]))continue;
      const mid=(data[i].high+data[i].low)/2,basicUpper=mid+multiplier*ranges[i],basicLower=mid-multiplier*ranges[i];
      const prevClose=i?data[i-1].close:data[i].close;
      const finalUpper=upper===null||basicUpper<upper||prevClose>upper?basicUpper:upper;
      const finalLower=lower===null||basicLower>lower||prevClose<lower?basicLower:lower;
      if(data[i].close>finalUpper)trend=1;
      else if(data[i].close<finalLower)trend=-1;
      line[i]=trend===1?finalLower:finalUpper;direction[i]=trend;
      upper=finalUpper;lower=finalLower;
    }
    return {supertrend:line,direction};
  }
  function mfi(data,period=14){
    const positive=Array(data.length).fill(0),negative=Array(data.length).fill(0),out=Array(data.length).fill(null);
    for(let i=1;i<data.length;i++){
      const prev=(data[i-1].high+data[i-1].low+data[i-1].close)/3;
      const current=(data[i].high+data[i].low+data[i].close)/3;
      const flow=current*(Number(data[i].volume)||0);
      if(current>prev)positive[i]=flow;else if(current<prev)negative[i]=flow;
    }
    for(let i=period;i<data.length;i++){
      let pos=0,neg=0;
      for(let j=i-period+1;j<=i;j++){pos+=positive[j];neg+=negative[j];}
      out[i]=neg===0?100:100-(100/(1+pos/neg));
    }
    return out;
  }
  function resultMap(data,values,key){
    const out={};
    data.forEach((bar,index)=>{out[bar.timestamp]={[key]:values[index]};});
    return out;
  }
  function register(lib){
    if(!lib||typeof lib.registerIndicator!=="function")return false;
    const defs=[
      {name:"VWAP",shortName:"VWAP",series:"price",calcParams:[],figures:[{key:"vwap",title:"VWAP: ",type:"line"}],calc:(d)=>resultMap(d,vwap(d),"vwap")},
      {name:"ATR",shortName:"ATR",series:"normal",calcParams:[14],figures:[{key:"atr",title:"ATR: ",type:"line"}],calc:(d,i)=>resultMap(d,atr(d,i.calcParams?.[0]||14),"atr")},
      {name:"ADX",shortName:"ADX",series:"normal",calcParams:[14],figures:[{key:"adx",title:"ADX: ",type:"line"},{key:"plusDI",title:"+DI: ",type:"line"},{key:"minusDI",title:"-DI: ",type:"line"}],calc:(d,i)=>{const x=adx(d,i.calcParams?.[0]||14);return d.reduce((o,b,n)=>(o[b.timestamp]={adx:x.adx[n],plusDI:x.plusDI[n],minusDI:x.minusDI[n]},o),{});}},
      {name:"STOCH",shortName:"STOCH",series:"normal",calcParams:[14,3],figures:[{key:"k",title:"%K: ",type:"line"},{key:"d",title:"%D: ",type:"line"}],calc:(d,i)=>{const x=stochastic(d,i.calcParams?.[0]||14,i.calcParams?.[1]||3);return d.reduce((o,b,n)=>(o[b.timestamp]={k:x.k[n],d:x.d[n]},o),{});}},
      {name:"SUPERTREND",shortName:"ST",series:"price",calcParams:[10,3],figures:[{key:"supertrend",title:"Supertrend: ",type:"line"}],calc:(d,i)=>resultMap(d,supertrend(d,i.calcParams?.[0]||10,i.calcParams?.[1]||3).supertrend,"supertrend")},
      {name:"MFI",shortName:"MFI",series:"normal",calcParams:[14],figures:[{key:"mfi",title:"MFI: ",type:"line"}],calc:(d,i)=>resultMap(d,mfi(d,i.calcParams?.[0]||14),"mfi")}
    ];
    for(const definition of defs){
      try{lib.registerIndicator(definition);}catch(error){
        if(!String(error?.message||"").toLowerCase().includes("exist"))throw error;
      }
    }
    return true;
  }
  return {sessionKey,vwap,trueRanges,wilder,atr,adx,stochastic,supertrend,mfi,register};
});
