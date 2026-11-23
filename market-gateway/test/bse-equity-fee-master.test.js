"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {
  parseBseStandardizedScripMaster,
  calculateBseEquityCharges,
  bseRatePerCrore
}=require("../lib/bse-equity-fee-master");

function makeRow({code="500325",symbol="RELIANCE",group="A",name="RELIANCE INDUSTRIES LIMITED",isin="INE002A01018",exclusive="N",status="A",type="E"}={}){
  const row=Array(120).fill("");
  row[0]=code;row[1]=symbol;row[2]=group;row[3]=name;row[4]=isin;
  row[58]=exclusive;row[59]=status;row[63]=type;
  return row;
}
test("parses BSE standardized master fields 1-5, 59, 60 and 64",()=>{
  const rows=parseBseStandardizedScripMaster(makeRow().join(",")+"\r\n",{sourceDate:"2026-11-23"});
  assert.equal(rows.length,1);
  assert.deepEqual(
    {scripCode:rows[0].scripCode,instrumentCode:rows[0].instrumentCode,groupName:rows[0].groupName,isin:rows[0].isin,exclusiveFlag:rows[0].exclusiveFlag,sourceDate:rows[0].sourceDate},
    {scripCode:"500325",instrumentCode:"RELIANCE",groupName:"A",isin:"INE002A01018",exclusiveFlag:"N",sourceDate:"2026-11-23"}
  );
});
test("keeps BSE fee fields stable with the 2026 CAS marker in field 24",()=>{
  const row=makeRow({group:"E",exclusive:"Y"});
  row[23]="1";
  const rows=parseBseStandardizedScripMaster(row.join(","),{sourceDate:"2026-11-23"});
  assert.equal(rows[0].groupName,"E");
  assert.equal(rows[0].exclusiveFlag,"Y");
  assert.equal(rows[0].instrumentType,"E");
});
test("strips a UTF-8 BOM from the standardized BSE CSV",()=>{
  const rows=parseBseStandardizedScripMaster("\uFEFF"+makeRow().join(","),{sourceDate:"2026-11-23"});
  assert.equal(rows[0].isin,"INE002A01018");
});
test("parses quoted commas and ignores non-equity or inactive instruments",()=>{
  const active=makeRow({name:"ACME, INDUSTRIES LIMITED"});
  const debt=makeRow({code:"900001",symbol:"DEBT",isin:"INE000A01011",type:"D"});
  const inactive=makeRow({code:"900002",symbol:"OLD",isin:"INE000A01012",status:"S"});
  const rows=parseBseStandardizedScripMaster([active,debt,inactive].map(x=>x.map(v=>/[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v).join(",")).join("\n"),{sourceDate:"2026-11-23"});
  assert.equal(rows.length,1);
  assert.equal(rows[0].scripName,"ACME, INDUSTRIES LIMITED");
});
test("rejects invalid dates, malformed rows and conflicting duplicate ISIN classifications",()=>{
  assert.throws(()=>parseBseStandardizedScripMaster(makeRow().join(","),{sourceDate:"23-11-2026"}),/source date/);
  assert.throws(()=>parseBseStandardizedScripMaster("1,2,3",{sourceDate:"2026-11-23"}),/fewer than 64/);
  const one=makeRow(),two=makeRow({code:"500326",symbol:"OTHER",group:"B"});
  assert.throws(()=>parseBseStandardizedScripMaster([one,two].map(x=>x.join(",")).join("\n"),{sourceDate:"2026-11-23"}),/Conflicting BSE fee classifications/);
});
test("rejects malformed characters after a quoted BSE CSV field",()=>{
  const malformed=makeRow({name:'"ACME"suffix'}).join(",");
  assert.throws(()=>parseBseStandardizedScripMaster(malformed,{sourceDate:"2026-11-23"}),/characters after a quoted field/);
  const stray=makeRow({name:'AC"ME'}).join(",");
  assert.throws(()=>parseBseStandardizedScripMaster(stray,{sourceDate:"2026-11-23"}),/quote placement/);
});
test("BSE fee schedule applies group and exclusive flag rules",()=>{
  assert.equal(bseRatePerCrore("A","N"),375);
  assert.equal(bseRatePerCrore("B","Y"),375);
  assert.equal(bseRatePerCrore("E","N"),375);
  assert.equal(bseRatePerCrore("E","Y"),275);
  assert.equal(bseRatePerCrore("FC","Y"),275);
  assert.equal(bseRatePerCrore("M","N"),275);
  assert.equal(bseRatePerCrore("IF","N"),275);
  assert.equal(bseRatePerCrore("X","N"),10000);
  assert.throws(()=>bseRatePerCrore("P","N"),/demat-settlement offset/);
  assert.throws(()=>bseRatePerCrore("UNKNOWN","N"),/Unsupported BSE/);
});
test("BSE Delivery BUY charges use scrip-group exchange rate and no separate IPFT",()=>{
  const c=calculateBseEquityCharges({grossPaise:1000000000,product:"DELIVERY",side:"BUY",groupName:"A",exclusiveFlag:"N",sourceDate:"2026-11-23"});
  assert.equal(c.exchangeTransactionPaise,37500);
  assert.equal(c.exchangeRateRupeesPerCrore,375);
  assert.equal(c.exchangeRatePaisePerCrore,37500);
  assert.equal(c.brokeragePaise,2000);
  assert.equal(c.sebiPaise,1000);
  assert.equal(c.stampDutyPaise,150000);
  assert.equal(c.sttPaise,1000000);
  assert.equal(c.gstPaise,7110);
  assert.equal(c.totalChargesPaise,1197610);
  assert.equal(c.ipftIncludedInExchangeCharge,true);
  assert.equal(c.ipftPaise,0);
  assert.equal(c.scheduleVersion,"BSE-2025-04-29");
  assert.equal(c.simulationBillingBasis,"indicative_per_fill_allocation");
  assert.equal(c.totalDebitPaise,c.grossPaise+c.totalChargesPaise);
  assert.equal(c.sourceDate,"2026-11-23");
});
test("BSE Intraday SELL uses group fee, STT and net proceeds",()=>{
  const c=calculateBseEquityCharges({grossPaise:1000000000,product:"INTRADAY",side:"SELL",groupName:"E",exclusiveFlag:"Y"});
  assert.equal(c.exchangeTransactionPaise,27500);
  assert.equal(c.brokeragePaise,2000);
  assert.equal(c.sttPaise,250000);
  assert.equal(c.stampDutyPaise,0);
  assert.equal(c.totalChargesPaise,285810);
  assert.equal(c.netCreditPaise,c.grossPaise-c.totalChargesPaise);
});
test("P/ZP and non-positive SELL settlement fail closed",()=>{
  assert.throws(()=>calculateBseEquityCharges({grossPaise:1000000000,product:"DELIVERY",side:"BUY",groupName:"P",exclusiveFlag:"N"}),/demat-settlement offset/);
  assert.throws(()=>calculateBseEquityCharges({grossPaise:1,product:"DELIVERY",side:"SELL",groupName:"A",exclusiveFlag:"N"}),/net settlement/);
});
