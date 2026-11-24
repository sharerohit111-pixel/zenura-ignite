"use strict";

const instrumentsFixture=require("../fixtures/mock-instrument-master.json");
const snapshotsFixture=require("../fixtures/mock-market-snapshots.json");
const {rankInstrumentSearchResults}=require("./instrument-search");

const DEMO_AS_OF_DATE=instrumentsFixture.as_of;
const SOURCE="SYNTHETIC_MOCK_JSON";
const LABEL="DEMO DATA · SYNTHETIC ONLY";
const VALID_KINDS=new Set(["all","equities","indices","futures","options"]);
const VALID_EXCHANGES=new Set(["NSE","BSE"]);
const VALID_TYPES=new Set(["EQ","INDEX","FUT","CE","PE"]);
const INSTRUMENTS=Object.freeze(instrumentsFixture.instruments.map(x=>Object.freeze({...x})));
const BY_KEY=new Map(INSTRUMENTS.map(x=>[x.instrument_key,x]));
const REFERENCE_PRICES=snapshotsFixture.reference_prices_paise;

function validDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function normalizeDate(value, fallback=DEMO_AS_OF_DATE){
  const result=value===undefined||value===null?fallback:String(value);
  if(!validDate(result))throw Object.assign(new Error("Date must use YYYY-MM-DD format."),{status:400});
  return result;
}
function matchesKind(item,kind){
  if(kind==="all")return true;
  if(kind==="equities")return item.instrument_type==="EQ";
  if(kind==="indices")return item.instrument_type==="INDEX";
  if(kind==="futures")return item.instrument_type==="FUT";
  return item.instrument_type==="CE"||item.instrument_type==="PE";
}
function listInstruments(options={}){
  const kind=String(options.kind||"all").toLowerCase();
  const exchange=String(options.exchange||"").toUpperCase();
  const query=String(options.q||"").trim().slice(0,60);
  const underlying=String(options.underlying||"").trim().toUpperCase();
  const expiry=options.expiry?normalizeDate(options.expiry):"";
  const optionType=String(options.optionType||"").toUpperCase();
  const asOf=normalizeDate(options.asOf);
  const limit=options.limit===undefined?100:Number(options.limit);
  if(!VALID_KINDS.has(kind))throw Object.assign(new Error("Unsupported instrument kind."),{status:400});
  if(exchange&&!VALID_EXCHANGES.has(exchange))throw Object.assign(new Error("Exchange must be NSE or BSE."),{status:400});
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error("Limit must be between 1 and 100."),{status:400});
  if(optionType&&!["CE","PE"].includes(optionType))throw Object.assign(new Error("Option type must be CE or PE."),{status:400});
  const minStrike=options.minStrike===undefined?null:Number(options.minStrike);
  const maxStrike=options.maxStrike===undefined?null:Number(options.maxStrike);
  const exactStrike=options.strike===undefined?null:Number(options.strike);
  for(const n of [minStrike,maxStrike,exactStrike])if(n!==null&&(!Number.isFinite(n)||n<=0))throw Object.assign(new Error("Strike filters must be positive numbers."),{status:400});
  const filtered=INSTRUMENTS.filter(item=>{
    if(!matchesKind(item,kind))return false;
    if(exchange&&item.exchange!==exchange)return false;
    if(underlying&&item.underlying_symbol!==underlying)return false;
    if(expiry&&item.expiry!==expiry)return false;
    if(item.expiry&&item.expiry<asOf)return false;
    if(optionType&&item.instrument_type!==optionType)return false;
    if(exactStrike!==null&&item.strike_price!==exactStrike)return false;
    if(minStrike!==null&&(item.strike_price===null||item.strike_price<minStrike))return false;
    if(maxStrike!==null&&(item.strike_price===null||item.strike_price>maxStrike))return false;
    return true;
  });
  return rankInstrumentSearchResults(filtered,query,limit).map(item=>({...item}));
}
function listExpiries({underlying,exchange,kind="options",asOf}={}){
  const u=String(underlying||"").trim().toUpperCase();
  if(!u)throw Object.assign(new Error("Underlying is required."),{status:400});
  const e=exchange?String(exchange).toUpperCase():"";
  if(e&&!VALID_EXCHANGES.has(e))throw Object.assign(new Error("Exchange must be NSE or BSE."),{status:400});
  if(!["options","futures"].includes(kind))throw Object.assign(new Error("Expiry kind must be options or futures."),{status:400});
  const date=normalizeDate(asOf);
  return [...new Set(INSTRUMENTS.filter(x=>x.underlying_symbol===u&&(!e||x.exchange===e)&&x.expiry&&x.expiry>=date&&(kind==="futures"?x.instrument_type==="FUT":["CE","PE"].includes(x.instrument_type))).map(x=>x.expiry))].sort();
}
function getOptionChain({underlying,exchange,expiry,strike,optionType,asOf}={}){
  const u=String(underlying||"").trim().toUpperCase();
  if(!u)throw Object.assign(new Error("Underlying is required."),{status:400});
  const date=normalizeDate(asOf);
  const expiries=listExpiries({underlying:u,exchange,kind:"options",asOf:date});
  const selectedExpiry=expiry?normalizeDate(expiry):expiries[0];
  if(!selectedExpiry||!expiries.includes(selectedExpiry))return {source:SOURCE,isLive:false,label:LABEL,underlying:u,expiry:selectedExpiry||null,strikes:[]};
  const rows=listInstruments({kind:"options",underlying:u,exchange,expiry:selectedExpiry,strike,optionType,asOf:date,limit:100});
  const strikes=[...new Set(rows.map(x=>x.strike_price))].sort((a,b)=>a-b).map(value=>({
    strike:value,
    CE:rows.find(x=>x.strike_price===value&&x.instrument_type==="CE")||null,
    PE:rows.find(x=>x.strike_price===value&&x.instrument_type==="PE")||null
  }));
  return {source:SOURCE,isLive:false,label:LABEL,underlying:u,expiry:selectedExpiry,strikes};
}
function getQuote(instrumentKey){
  const item=BY_KEY.get(String(instrumentKey||""));
  if(!item)throw Object.assign(new Error("Unknown demo instrument."),{status:404});
  const lastPricePaise=REFERENCE_PRICES[item.instrument_key];
  if(!Number.isSafeInteger(lastPricePaise)||lastPricePaise<=0)throw new Error("Synthetic quote fixture is missing or invalid.");
  const tick=Math.max(1,Math.round(Number(item.tick_size)*100));
  const bids=[],asks=[];
  for(let i=0;i<5;i++){
    bids.push({pricePaise:lastPricePaise-tick*(i+1),quantity:1000+(i*250),orders:8+i});
    asks.push({pricePaise:lastPricePaise+tick*(i+1),quantity:900+(i*200),orders:7+i});
  }
  const open=lastPricePaise-tick*4,close=lastPricePaise-tick*2,high=lastPricePaise+tick*6,low=lastPricePaise-tick*7;
  return Object.freeze({
    source:SOURCE,isLive:false,label:LABEL,instrumentKey:item.instrument_key,exchange:item.exchange,
    timestamp:snapshotsFixture.as_of,lastPricePaise,changePaise:tick*3,volume:125000,
    ohlc:Object.freeze({openPaise:open,highPaise:high,lowPaise:low,closePaise:close}),
    bids:Object.freeze(bids.map(Object.freeze)),asks:Object.freeze(asks.map(Object.freeze))
  });
}
function getCandles(instrumentKey,{timeframe="5m",count=24}={}){
  const quote=getQuote(instrumentKey);
  if(!["1m","5m","15m","1h","1D","1W"].includes(timeframe))throw Object.assign(new Error("Unsupported demo timeframe."),{status:400});
  if(!Number.isInteger(count)||count<1||count>200)throw Object.assign(new Error("Candle count must be between 1 and 200."),{status:400});
  const tick=Math.max(1,Math.round(BY_KEY.get(instrumentKey).tick_size*100));
  const step={ "1m":1,"5m":2,"15m":3,"1h":5,"1D":8,"1W":13 }[timeframe];
  return Array.from({length:count},(_,i)=>{
    const base=quote.lastPricePaise+(i-count+1)*tick*step;
    const open=base+(i%3-1)*tick*2,close=base+((i%4)-1)*tick;
    return Object.freeze({index:i,openPaise:open,highPaise:Math.max(open,close)+tick*3,lowPaise:Math.min(open,close)-tick*3,closePaise:close,volume:10000+i*375});
  });
}
function getDemoMetadata(){
  return Object.freeze({source:SOURCE,isLive:false,label:LABEL,asOf:snapshotsFixture.as_of,instrumentCount:INSTRUMENTS.length});
}
module.exports={listInstruments,listExpiries,getOptionChain,getQuote,getCandles,getDemoMetadata,DEMO_AS_OF_DATE};
