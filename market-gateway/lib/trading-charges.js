"use strict";

// Indicative Upstox NSE/BSE equity-option charges, in paise.
// These are paper-simulation estimates, not a broker contract note.
const RATES={
  NSE:{exchangeTransaction:0.0003552,ipft:0.000000001}, // ₹3,552 + ₹0.01 IPFT per crore from 1 Mar 2026
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

const FUTURES_RATES={
  NSE:{exchangeTransaction:0.000018299,ipft:0.000000001}, // ₹182.99 + ₹0.01 IPFT per crore
  BSE:{exchangeTransaction:0,ipft:0}
};
const FUTURES_STT_SELL=0.0005; // 0.05% from 1 April 2026
const FUTURES_STAMP_BUY=0.00002; // 0.002%
const SEBI_TURNOVER_RATE=0.000001; // Rs 10 per crore
const FUTURES_BROKERAGE_RATE=0.0005; // 0.05%, capped at Rs 20 per executed order

function calculateFuturesTradeCharges({grossPaise,exchange,side="BUY",brokerageCapPaise=2000}){
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    throw Object.assign(new Error("A valid futures turnover is required."),{status:400});
  if(!["BUY","SELL"].includes(side))throw Object.assign(new Error("Futures trade side must be BUY or SELL."),{status:400});
  const market=String(exchange||"").toUpperCase(),rates=FUTURES_RATES[market];
  if(!rates)throw Object.assign(new Error("Only NSE and BSE futures charge schedules are supported."),{status:400});
  if(!Number.isSafeInteger(brokerageCapPaise)||brokerageCapPaise<0)
    throw Object.assign(new Error("Brokerage cap is invalid."),{status:400});
  const brokeragePaise=Math.min(brokerageCapPaise,roundPaise(grossPaise*FUTURES_BROKERAGE_RATE));
  const exchangeTransactionPaise=roundPaise(grossPaise*rates.exchangeTransaction);
  const ipftPaise=roundPaise(grossPaise*rates.ipft);
  const sebiPaise=roundPaise(grossPaise*SEBI_TURNOVER_RATE);
  const stampDutyPaise=side==="BUY"?roundPaise(grossPaise*FUTURES_STAMP_BUY):0;
  const sttPaise=side==="SELL"?roundPaise(grossPaise*FUTURES_STT_SELL):0;
  const gstPaise=roundPaise((brokeragePaise+exchangeTransactionPaise+ipftPaise)*GST);
  const totalChargesPaise=brokeragePaise+exchangeTransactionPaise+ipftPaise+sebiPaise+stampDutyPaise+sttPaise+gstPaise;
  if(!Number.isSafeInteger(totalChargesPaise)||!Number.isSafeInteger(grossPaise+totalChargesPaise))
    throw Object.assign(new Error("Futures charges exceed supported calculation limits."),{status:400});
  return {
    grossPaise,brokeragePaise,exchangeTransactionPaise,ipftPaise,sebiPaise,
    stampDutyPaise,sttPaise,gstPaise,totalChargesPaise,exchange:market,side,
    segment:"EQUITY_FUTURES",scheduleVersion:"2026-04-01",
    indicative:true,simulationOnly:true
  };
}


/* NSE/Upstox equity-delivery schedule from 2026-03-01: transaction ₹306.99/crore + IPFT ₹0.01/crore,
 * SEBI ₹10/crore, STT 0.10% each side and delivery stamp duty 0.015% buy side
 * from the current FY26 schedule. Upstox brokerage is ₹20/order; GST is applied to brokerage,
 * exchange/IPFT and DP components. DP is transparently estimated per sell order (not aggregated
 * by scrip/day yet). BSE is blocked because its exact scrip-group schedule is not represented.
 */
function calculateEquityDeliveryCharges({grossPaise,exchange,side="BUY"}){
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    throw Object.assign(new Error("A valid equity delivery turnover is required."),{status:400});
  if(!["BUY","SELL"].includes(side))throw Object.assign(new Error("Equity delivery side must be BUY or SELL."),{status:400});
  const market=String(exchange||"").toUpperCase();
  if(market!=="NSE")throw Object.assign(new Error("BSE delivery transaction charges depend on the official scrip group; this order is blocked until that exact group rate is available."),{status:422});
  const brokeragePaise=2000;
  const exchangeTransactionPaise=roundPaise(grossPaise*0.000030699);
  const ipftPaise=roundPaise(grossPaise*0.000000001);
  const sebiPaise=roundPaise(grossPaise*0.000001);
  const sttPaise=roundPaise(grossPaise*0.001);
  const stampDutyPaise=side==="BUY"?roundPaise(grossPaise*0.00015):0;
  const dpChargesPaise=side==="SELL"?2000:0;
  const gstPaise=roundPaise((brokeragePaise+exchangeTransactionPaise+ipftPaise+dpChargesPaise)*GST);
  const totalChargesPaise=brokeragePaise+exchangeTransactionPaise+ipftPaise+sebiPaise+sttPaise+stampDutyPaise+dpChargesPaise+gstPaise;
  if(!Number.isSafeInteger(totalChargesPaise)||!Number.isSafeInteger(grossPaise+totalChargesPaise))
    throw Object.assign(new Error("Equity delivery charges exceed supported calculation limits."),{status:400});
  if(side==="SELL"&&grossPaise-totalChargesPaise<=0)
    throw Object.assign(new Error("NSE delivery SELL proceeds must remain positive after estimated charges."),{status:422});
  return {grossPaise,brokeragePaise,exchangeTransactionPaise,ipftPaise,sebiPaise,sttPaise,
    stampDutyPaise,dpChargesPaise,gstPaise,totalChargesPaise,exchange:market,side,
    segment:"EQUITY_DELIVERY",scheduleVersion:"2026-03-01",indicative:true,simulationOnly:true,
    note:"NSE delivery schedule; DP charge is estimated per sell order. BSE scrip-group charges are not estimated."};
}

/* NSE cash-equity intraday schedule (indicative Upstox-style simulation).
 * Brokerage: lower of 0.10% turnover or ₹20 per executed order.
 * STT: 0.025% sell side; stamp duty: 0.003% buy side.
 * NSE transaction ₹306.99/crore + IPFT ₹0.01/crore; SEBI ₹10/crore.
 * GST 18% applies to brokerage + exchange transaction + IPFT.
 * BSE is intentionally blocked until the applicable scrip-group rate is known.
 */
function calculateEquityIntradayCharges({grossPaise,exchange,side="BUY",brokerageCapPaise=DEFAULT_BROKERAGE_PAISE}){
  if(!Number.isSafeInteger(grossPaise)||grossPaise<1)
    throw Object.assign(new Error("A valid equity intraday turnover is required."),{status:400});
  if(!["BUY","SELL"].includes(side))
    throw Object.assign(new Error("Equity intraday side must be BUY or SELL."),{status:400});
  const market=String(exchange||"").toUpperCase();
  if(market!=="NSE")
    throw Object.assign(new Error("BSE intraday charges require the official scrip-group rate; this order is blocked until that rate is available."),{status:422});
  if(!Number.isSafeInteger(brokerageCapPaise)||brokerageCapPaise<0)
    throw Object.assign(new Error("Brokerage cap is invalid."),{status:400});
  const brokeragePaise=Math.min(brokerageCapPaise,roundPaise(grossPaise*0.001));
  const exchangeTransactionPaise=roundPaise(grossPaise*0.000030699);
  const ipftPaise=roundPaise(grossPaise*0.000000001);
  const sebiPaise=roundPaise(grossPaise*0.000001);
  const sttPaise=side==="SELL"?roundPaise(grossPaise*0.00025):0;
  const stampDutyPaise=side==="BUY"?roundPaise(grossPaise*0.00003):0;
  const gstPaise=roundPaise((brokeragePaise+exchangeTransactionPaise+ipftPaise)*GST);
  const totalChargesPaise=brokeragePaise+exchangeTransactionPaise+ipftPaise+sebiPaise+sttPaise+stampDutyPaise+gstPaise;
  if(!Number.isSafeInteger(totalChargesPaise)||!Number.isSafeInteger(grossPaise+totalChargesPaise))
    throw Object.assign(new Error("Equity intraday charges exceed supported calculation limits."),{status:400});
  return {
    grossPaise,brokeragePaise,exchangeTransactionPaise,ipftPaise,sebiPaise,
    sttPaise,stampDutyPaise,gstPaise,totalChargesPaise,exchange:market,side,
    segment:"EQUITY_INTRADAY",scheduleVersion:"2026-03-01",
    indicative:true,simulationOnly:true,
    totalDebitPaise:side==="BUY"?grossPaise+totalChargesPaise:null,
    netCreditPaise:side==="SELL"?grossPaise-totalChargesPaise:null
  };
}

module.exports={calculateLongOptionTradeCharges,calculateLongOptionBuyCharges:args=>calculateLongOptionTradeCharges({...args,side:"BUY"}),calculateFuturesTradeCharges,calculateEquityDeliveryCharges,calculateEquityIntradayCharges,DEFAULT_BROKERAGE_PAISE};
