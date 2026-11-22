"use strict";

// BSE equity cash fee metadata is sourced from the daily standardized BSE scrip master.
// Field positions follow BSE's published BSE_EQ_SCRIP_DDMMYYYY.csv format:
// 1 Scrip Code, 2 Instrument Code, 3 Group Name, 4 Scrip Name, 5 ISIN,
// 59 BSE Exclusive, 60 Instrument Status, 64 Instrument Type.
const FIELD={
  scripCode:0,instrumentCode:1,groupName:2,scripName:3,isin:4,
  exclusiveFlag:58,status:59,instrumentType:63
};
const MAX_CSV_BYTES=64*1024*1024;
const MAX_ROWS=100000;
const CRORE_PAISE=1_000_000_000;
const GST=0.18;

function parseCsvRows(input){
  if(typeof input!=="string"||Buffer.byteLength(input,"utf8")>MAX_CSV_BYTES)
    throw new Error("BSE scrip master CSV is missing or exceeds the safe size limit.");
  input=input.replace(/^\uFEFF/,"");
  const rows=[];let row=[],field="",quoted=false,afterQuote=false;
  function finishField(){row.push(field);field="";afterQuote=false;}
  function finishRow(){
    finishField();
    if(row.some(value=>value.trim()!==""))rows.push(row);
    row=[];
    if(rows.length>MAX_ROWS)throw new Error("BSE scrip master contains too many rows.");
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
      }else throw new Error("Malformed BSE CSV characters after a quoted field.");
    }else if(ch==='"'){
      if(field.length)throw new Error("Malformed BSE CSV quote placement.");
      quoted=true;
    }else if(ch===","){
      finishField();
    }else if(ch==="\n"||ch==="\r"){
      if(ch==="\r"&&input[i+1]==="\n")i++;
      finishRow();
    }else field+=ch;
  }
  if(quoted)throw new Error("BSE scrip master CSV contains an unterminated quoted field.");
  if(field.length||row.length||afterQuote){
    finishField();
    if(row.some(value=>value.trim()!==""))rows.push(row);
  }
  if(rows.length>MAX_ROWS)throw new Error("BSE scrip master contains too many rows.");
  return rows;
}
function parseBseStandardizedScripMaster(csvText,{sourceDate}={}){
  if(typeof sourceDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
    ||Number.isNaN(Date.parse(sourceDate+"T00:00:00Z"))
    ||new Date(sourceDate+"T00:00:00Z").toISOString().slice(0,10)!==sourceDate)
    throw new Error("A valid BSE master source date is required.");
  const rows=parseCsvRows(csvText);
  if(rows.length&& !/^\d+$/.test(String(rows[0][FIELD.scripCode]||"").trim()))rows.shift();
  if(!rows.length)throw new Error("BSE scrip master contains no data rows.");
  const byIsin=new Map();
  for(let line=0;line<rows.length;line++){
    const cells=rows[line];
    if(cells.length<=FIELD.instrumentType)
      throw new Error("BSE scrip master row "+(line+1)+" has fewer than 64 fields.");
    const instrumentType=String(cells[FIELD.instrumentType]||"").trim().toUpperCase();
    const status=String(cells[FIELD.status]||"").trim().toUpperCase();
    if(instrumentType!=="E"||status!=="A")continue;
    const record={
      scripCode:String(cells[FIELD.scripCode]||"").trim(),
      instrumentCode:String(cells[FIELD.instrumentCode]||"").trim().toUpperCase(),
      groupName:String(cells[FIELD.groupName]||"").trim().toUpperCase(),
      scripName:String(cells[FIELD.scripName]||"").trim(),
      isin:String(cells[FIELD.isin]||"").trim().toUpperCase(),
      exclusiveFlag:String(cells[FIELD.exclusiveFlag]||"").trim().toUpperCase(),
      status,instrumentType,sourceDate
    };
    const invalid={
      scripCode:! /^[0-9]{1,12}$/.test(record.scripCode),
      instrumentCode:!record.instrumentCode||record.instrumentCode.length>12,
      isin:! /^[A-Z]{2}[A-Z0-9]{10}$/.test(record.isin),
      groupName:!record.groupName||record.groupName.length>3,
      exclusiveFlag:!["Y","N"].includes(record.exclusiveFlag)
    };
    if(Object.values(invalid).some(Boolean))
      throw new Error("BSE active equity row "+(line+1)+" has invalid scrip metadata: "+JSON.stringify({invalid,record,fieldCount:cells.length}));
    const prior=byIsin.get(record.isin);
    if(prior){
      if(prior.groupName!==record.groupName||prior.exclusiveFlag!==record.exclusiveFlag)
        throw new Error("Conflicting BSE fee classifications exist for ISIN "+record.isin+".");
      continue;
    }
    byIsin.set(record.isin,record);
  }
  if(!byIsin.size)throw new Error("BSE scrip master has no active equity records.");
  return [...byIsin.values()];
}
function bseRatePerCrore(groupName,exclusiveFlag){
  const group=String(groupName||"").trim().toUpperCase();
  const exclusive=String(exclusiveFlag||"").trim().toUpperCase();
  if(["P","ZP"].includes(group))
    throw Object.assign(new Error("BSE P/ZP charges require the applicable demat-settlement offset; this scrip is blocked."),{status:422});
  if(["A","B","NS","NT"].includes(group))return 375;
  if(["E","F","FC","G","GC","I","W","T"].includes(group)){
    if(!["Y","N"].includes(exclusive))
      throw Object.assign(new Error("BSE exclusive classification is missing."),{status:422});
    return exclusive==="Y"?275:375;
  }
  if(["M","MT","TS","MS","IF","IT","R"].includes(group))return 275;
  if(["X","XT","Z"].includes(group))return 10000;
  throw Object.assign(new Error("Unsupported BSE equity scrip group: "+(group||"missing")),{status:422});
}
function calculateBseEquityCharges({grossPaise,product,side,groupName,exclusiveFlag,brokerageCapPaise=2000,sourceDate}){
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    throw Object.assign(new Error("A valid BSE equity turnover in paise is required."),{status:400});
  if(!["DELIVERY","INTRADAY"].includes(product)||!["BUY","SELL"].includes(side))
    throw Object.assign(new Error("BSE equity product or side is invalid."),{status:400});
  if(!Number.isSafeInteger(brokerageCapPaise)||brokerageCapPaise<0)
    throw Object.assign(new Error("BSE brokerage cap is invalid."),{status:400});
  const ratePerCrore=bseRatePerCrore(groupName,exclusiveFlag);
  const brokeragePaise=product==="DELIVERY"?2000:Math.min(brokerageCapPaise,Math.round(grossPaise*0.001));
  const exchangeNumerator=BigInt(grossPaise)*BigInt(ratePerCrore)*100n;
  const exchangeTransactionPaise=Number((exchangeNumerator+BigInt(CRORE_PAISE)/2n)/BigInt(CRORE_PAISE));
  const sebiPaise=Math.round(grossPaise*0.000001);
  const sttPaise=product==="DELIVERY"?Math.round(grossPaise*0.001):(side==="SELL"?Math.round(grossPaise*0.00025):0);
  const stampDutyPaise=side==="BUY"?(product==="DELIVERY"?Math.round(grossPaise*0.00015):Math.round(grossPaise*0.00003)):0;
  const dpChargesPaise=product==="DELIVERY"&&side==="SELL"?2000:0;
  const gstPaise=Math.round((brokeragePaise+exchangeTransactionPaise+dpChargesPaise)*GST);
  const totalChargesPaise=brokeragePaise+exchangeTransactionPaise+sebiPaise+sttPaise+stampDutyPaise+dpChargesPaise+gstPaise;
  const netCreditPaise=side==="SELL"?grossPaise-totalChargesPaise:null;
  if(!Number.isSafeInteger(totalChargesPaise)||!Number.isSafeInteger(grossPaise+totalChargesPaise)
    ||(side==="SELL"&&netCreditPaise<=0))
    throw Object.assign(new Error("BSE equity charges exceed supported net settlement limits."),{status:400});
  return {
    grossPaise,brokeragePaise,exchangeTransactionPaise,ipftPaise:0,sebiPaise,sttPaise,
    stampDutyPaise,dpChargesPaise,gstPaise,totalChargesPaise,
    totalDebitPaise:side==="BUY"?grossPaise+totalChargesPaise:null,
    netCreditPaise,exchange:"BSE",product,side,segment:"EQUITY_CASH",
    scripGroup:String(groupName).trim().toUpperCase(),exclusiveFlag:String(exclusiveFlag).trim().toUpperCase(),
    exchangeRateRupeesPerCrore:ratePerCrore,exchangeRatePaisePerCrore:ratePerCrore*100,
    ipftIncludedInExchangeCharge:true,bseIpfIncluded:true,
    scheduleVersion:"BSE-2025-04-29",sourceDate:sourceDate||null,
    simulationBillingBasis:"indicative_per_fill_allocation",indicative:true,simulationOnly:true
  };
}
module.exports={
  parseBseStandardizedScripMaster,
  calculateBseEquityCharges,
  bseRatePerCrore,
  MAX_CSV_BYTES,
  MAX_ROWS
};
