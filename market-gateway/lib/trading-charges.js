"use strict";

// Indicative Upstox NSE/BSE equity-option charges, in paise.
// These are paper-simulation estimates, not a broker contract note.
const RATES={
  NSE:{exchangeTransaction:0.0003553,ipft:0.000005}, // ₹0.50 per lakh of option premium
  BSE:{exchangeTransaction:0.000325,ipft:0}
};
const STAMP_DUTY_BUY=0.00003; // 0.003%
const SEBI_TURNOVER=0.000001; // Rs 10 per crore
const GST=0.18;
const DEFAULT_BROKERAGE_PAISE=2000; // Rs 20 per executed order

function roundPaise(value){
  if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)
    throw Object.assign(new Error("Trading charge exceeds supported calculation limits."),{status:400});
  return Math.round(value);
}
function calculateLongOptionTradeCharges({grossPaise,exchange,side="BUY",brokeragePaise=DEFAULT_BROKERAGE_PAISE}){
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    throw Object.assign(new Error("A valid option premium turnover is required."),{status:400});
  if(!["BUY","SELL"].includes(side))throw Object.assign(new Error("Option trade side must be BUY or SELL."),{status:400});
  const rates=RATES[String(exchange||"").toUpperCase()];
  if(!rates)throw Object.assign(new Error("Only NSE and BSE option charge schedules are supported."),{status:400});
  if(!Number.isSafeInteger(brokeragePaise)||brokeragePaise<0)
    throw Object.assign(new Error("Brokerage amount is invalid."),{status:400});
  const exchangePaise=roundPaise(grossPaise*rates.exchangeTransaction);
  const ipftPaise=roundPaise(grossPaise*rates.ipft);
  const sebiPaise=roundPaise(grossPaise*SEBI_TURNOVER);
  const stampDutyPaise=side==="BUY"?roundPaise(grossPaise*STAMP_DUTY_BUY):0;
  const sttPaise=side==="SELL"?roundPaise(grossPaise*0.0015):0;
  const gstPaise=roundPaise((brokeragePaise+exchangePaise+ipftPaise)*GST);
  const totalChargesPaise=brokeragePaise+exchangePaise+ipftPaise+sebiPaise+stampDutyPaise+gstPaise+sttPaise;
  if(!Number.isSafeInteger(totalChargesPaise)||!Number.isSafeInteger(grossPaise+totalChargesPaise))
    throw Object.assign(new Error("Total order debit exceeds supported calculation limits."),{status:400});
  return {
    grossPaise,brokeragePaise,exchangeTransactionPaise:exchangePaise,ipftPaise,sebiPaise,
    stampDutyPaise,gstPaise,sttPaise,totalChargesPaise,
    totalDebitPaise:side==="BUY"?grossPaise+totalChargesPaise:null,
    netCreditPaise:side==="SELL"?grossPaise-totalChargesPaise:null,
    exchange:String(exchange).toUpperCase(),side,segment:"EQUITY_OPTIONS",
    indicative:true,simulationOnly:true
  };
}
module.exports={calculateLongOptionTradeCharges,calculateLongOptionBuyCharges:args=>calculateLongOptionTradeCharges({...args,side:"BUY"}),DEFAULT_BROKERAGE_PAISE};
