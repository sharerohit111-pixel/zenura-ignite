"use strict";

const {rankInstrumentSearchResults}=require("./instrument-search");
const VALID_KINDS=new Set(["all","equities","indices","futures","options"]);
const VALID_EXCHANGES=new Set(["NSE","BSE"]);

function catalogError(message){throw Object.assign(new Error(message),{status:400});}
function filterAndRankInstrumentCatalog(items,options={}){
  if(!Array.isArray(items))throw new TypeError("Instrument catalog must be an array.");
  const kind=String(options.kind||"all").toLowerCase();
  const exchange=String(options.exchange||"").toUpperCase();
  const query=String(options.q||"").trim().slice(0,60);
  const underlying=String(options.underlying||"").trim().toUpperCase();
  const expiry=options.expiry===undefined||options.expiry===null||options.expiry===""?"":String(options.expiry);
  const optionType=String(options.optionType||"").toUpperCase();
  const asOf=options.asOf===undefined||options.asOf===null?"":String(options.asOf);
  const limit=options.limit===undefined?100:Number(options.limit);
  if(!VALID_KINDS.has(kind))catalogError("Unsupported instrument kind.");
  if(exchange&&!VALID_EXCHANGES.has(exchange))catalogError("Exchange must be NSE or BSE.");
  if(expiry&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(expiry))catalogError("Expiry must use YYYY-MM-DD format.");
  if(asOf&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(asOf))catalogError("As-of date must use YYYY-MM-DD format.");
  if(optionType&&!["CE","PE"].includes(optionType))catalogError("Option type must be CE or PE.");
  if(!Number.isInteger(limit)||limit<1||limit>100)catalogError("Limit must be between 1 and 100.");
  const minStrike=options.minStrike===undefined?null:Number(options.minStrike);
  const maxStrike=options.maxStrike===undefined?null:Number(options.maxStrike);
  const exactStrike=options.strike===undefined?null:Number(options.strike);
  for(const value of [minStrike,maxStrike,exactStrike])if(value!==null&&(!Number.isFinite(value)||value<=0))catalogError("Strike filters must be positive numbers.");
  if(minStrike!==null&&maxStrike!==null&&minStrike>maxStrike)catalogError("Minimum strike must not exceed maximum strike.");
  const filtered=items.filter(item=>{
    if(!item||typeof item!=="object")return false;
    if(!["NSE","BSE"].includes(String(item.exchange||"").toUpperCase()))return false;
    const type=String(item.instrument_type||"").toUpperCase();
    const segment=String(item.segment||"").toUpperCase();
    if(kind==="equities"&&!(type==="EQ"&&["NSE_EQ","BSE_EQ"].includes(segment)))return false;
    if(kind==="indices"&&!(type==="INDEX"&&["NSE_INDEX","BSE_INDEX"].includes(segment)))return false;
    if(kind==="futures"&&!(type==="FUT"&&["NSE_FO","BSE_FO"].includes(segment)))return false;
    if(kind==="options"&&!((type==="CE"||type==="PE")&&["NSE_FO","BSE_FO"].includes(segment)))return false;
    if(exchange&&item.exchange!==exchange)return false;
    if(underlying&&String(item.underlying_symbol||"").toUpperCase()!==underlying)return false;
    if(expiry&&item.expiry!==expiry)return false;
    if(asOf&&item.expiry&&item.expiry<asOf)return false;
    if(optionType&&type!==optionType)return false;
    const strike=item.strike_price===null||item.strike_price===undefined?null:Number(item.strike_price);
    if(exactStrike!==null&&strike!==exactStrike)return false;
    if(minStrike!==null&&(strike===null||strike<minStrike))return false;
    if(maxStrike!==null&&(strike===null||strike>maxStrike))return false;
    return true;
  });
  return rankInstrumentSearchResults(filtered,query,limit);
}
module.exports={filterAndRankInstrumentCatalog};
