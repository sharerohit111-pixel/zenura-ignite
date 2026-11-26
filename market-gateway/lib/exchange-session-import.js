"use strict";
const MAX_BYTES=2*1024*1024;
const MAX_ROWS=2000;
const REQUIRED=["exchange","session_date","is_trading_day","open_minute","close_minute","session_kind","source_reference","verified_at"];
function parseCsv(input){
  if(typeof input!=="string"||Buffer.byteLength(input,"utf8")>MAX_BYTES)
    throw new Error("Exchange session CSV is missing or exceeds the safe size limit.");
  input=input.replace(/^\uFEFF/,"");
  const rows=[];let row=[],field="",quoted=false,afterQuote=false;
  function finishField(){row.push(field);field="";afterQuote=false;}
  function finishRow(){
    finishField();
    if(row.some(value=>value.trim()!==""))rows.push(row);
    row=[];
    if(rows.length>MAX_ROWS+1)throw new Error("Exchange session CSV contains too many rows.");
  }
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}
      else if(ch==='"'){quoted=false;afterQuote=true;}
      else field+=ch;
    }else if(afterQuote){
      if(ch===",")finishField();
      else if(ch==="\n"||ch==="\r"){
        if(ch==="\r"&&input[i+1]==="\n")i++;
        finishRow();
      }else throw new Error("Malformed exchange session CSV characters after a quoted field.");
    }else if(ch==='"'){
      if(field.length)throw new Error("Malformed exchange session CSV quote placement.");
      quoted=true;
    }else if(ch===","){finishField();}
    else if(ch==="\n"||ch==="\r"){
      if(ch==="\r"&&input[i+1]==="\n")i++;
      finishRow();
    }else field+=ch;
  }
  if(quoted)throw new Error("Exchange session CSV contains an unterminated quoted field.");
  if(field.length||row.length||afterQuote){
    finishField();
    if(row.some(value=>value.trim()!==""))rows.push(row);
  }
  if(rows.length>MAX_ROWS+1)throw new Error("Exchange session CSV contains too many rows.");
  return rows;
}
function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function officialReference(exchange,value){
  let url;try{url=new URL(value);}catch(_){return false;}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash)return false;
  if(exchange==="NSE")return host==="nseindia.com"||host.endsWith(".nseindia.com");
  if(exchange==="BSE")return host==="bseindia.com"||host.endsWith(".bseindia.com");
  return false;
}
function parseMinute(value){
  if(value==null||String(value).trim()==="")return null;
  if(!/^[0-9]{1,4}$/.test(String(value).trim()))return NaN;
  const n=Number(value);
  return Number.isInteger(n)?n:NaN;
}
function parseExchangeSessionCsv(csvText){
  const rows=parseCsv(csvText);
  if(rows.length<2)throw new Error("Exchange session CSV must contain a header and at least one session.");
  const headers=rows.shift().map(value=>value.trim().toLowerCase());
  if(headers.length!==REQUIRED.length||REQUIRED.some(name=>!headers.includes(name)))
    throw new Error("Exchange session CSV header does not match the required schema.");
  const index=Object.fromEntries(REQUIRED.map(name=>[name,headers.indexOf(name)]));
  const seen=new Set(),result=[];
  for(let i=0;i<rows.length;i++){
    const cells=rows[i];
    if(cells.length!==headers.length)throw new Error("Exchange session row "+(i+2)+" has the wrong number of columns.");
    const get=name=>String(cells[index[name]]??"").trim();
    const exchange=get("exchange").toUpperCase();
    const sessionDate=get("session_date");
    const rawTrading=get("is_trading_day").toLowerCase();
    const isTradingDay=rawTrading==="true"?true:rawTrading==="false"?false:null;
    const openMinute=parseMinute(get("open_minute"));
    const closeMinute=parseMinute(get("close_minute"));
    const sessionKind=get("session_kind").toUpperCase();
    const sourceReference=get("source_reference");
    const verifiedAt=get("verified_at");
    const verifiedAtMs=Date.parse(verifiedAt);
    if(!["NSE","BSE"].includes(exchange)||!validDate(sessionDate)||isTradingDay===null
      ||!["REGULAR","SPECIAL","CLOSED"].includes(sessionKind)
      ||!officialReference(exchange,sourceReference)
      ||!Number.isFinite(verifiedAtMs)||verifiedAtMs>Date.now())
      throw new Error("Exchange session row "+(i+2)+" has invalid exchange, date, provenance or verification timestamp.");
    if(isTradingDay){
      if(!["REGULAR","SPECIAL"].includes(sessionKind)||!Number.isInteger(openMinute)
        ||!Number.isInteger(closeMinute)||openMinute<0||openMinute>1439
        ||closeMinute<1||closeMinute>1440||openMinute>=closeMinute
        ||(sessionKind==="REGULAR"&&(openMinute!==555||closeMinute!==930)))
        throw new Error("Exchange session row "+(i+2)+" has an invalid open/close window.");
    }else if(sessionKind!=="CLOSED"||openMinute!==null||closeMinute!==null){
      throw new Error("Closed exchange session row "+(i+2)+" must use CLOSED with blank minutes.");
    }
    const key=exchange+"|"+sessionDate;
    if(seen.has(key))throw new Error("Duplicate exchange session row: "+key);
    seen.add(key);
    result.push({
      exchange,session_date:sessionDate,is_trading_day:isTradingDay,
      open_minute:openMinute,close_minute:closeMinute,session_kind:sessionKind,
      source_reference:sourceReference,verified_at:new Date(verifiedAtMs).toISOString()
    });
  }
  if(!result.length)throw new Error("Exchange session CSV contains no session rows.");
  return result;
}
module.exports={parseExchangeSessionCsv,officialReference,MAX_BYTES,MAX_ROWS};
