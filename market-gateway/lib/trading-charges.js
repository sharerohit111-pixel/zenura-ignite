"use strict";

// Indicative Upstox NSE/BSE equity-option BUY charges, in paise.
// These are paper-simulation estimates, not a broker contract note.
const RATES={
  NSE:{exchangeTransaction:0.0003552,ipft:0.00000000001},
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
function calculateLongOptionBuyCharges({grossPaise,exchange,brokeragePaise=DEFAULT_BROKERAGE_PAISE}){
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    throw Object.assign(new Error("A valid option premium turnover is required."),{status:400});
  const rates=RATES[String(exchange||"").toUpperCase()];
  if(!rates)throw Object.assign(new Error("Only NSE and BSE option charge schedules are supported."),{status:400});
  if(!Number.isSafeInteger(brokeragePaise)||brokeragePaise<0)
    throw Object.assign(new Error("Brokerage amount is invalid."),{status:400});
  const exchangePaise=roundPaise(grossPaise*rates.exchangeTransaction);
  const ipftPaise=roundPaise(grossPaise*rates.ipft);
  const sebiPaise=roundPaise(grossPaise*SEBI_TURNOVER);
  const stampDutyPaise=roundPaise(grossPaise*STAMP_DUTY_BUY);
  const gstPaise=roundPaise((brokeragePaise+exchangePaise+ipftPaise)*GST);
  const totalChargesPaise=brokeragePaise+exchangePaise+ipftPaise+sebiPaise+stampDutyPaise+gstPaise;
  if(!Number.isSafeInteger(totalChargesPaise)||!Number.isSafeInteger(grossPaise+totalChargesPaise))
    throw Object.assign(new Error("Total order debit exceeds supported calculation limits."),{status:400});
  return {
    brokeragePaise,exchangeTransactionPaise:exchangePaise,ipftPaise,sebiPaise,
    stampDutyPaise,gstPaise,sttPaise:0,totalChargesPaise,
    totalDebitPaise:grossPaise+totalChargesPaise,
    exchange:String(exchange).toUpperCase(),side:"BUY",segment:"EQUITY_OPTIONS",
    indicative:true,simulationOnly:true
  };
}
module.exports={calculateLongOptionBuyCharges,DEFAULT_BROKERAGE_PAISE};
