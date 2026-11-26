"use strict";

const DEFAULT_PAPER_STARTING_CASH_PAISE=100000000; // ₹10,00,000 in paise

function paperStartingCashPaise(env=process.env){
  const raw=env?.INDIAN_PAPER_STARTING_CASH_PAISE;
  if(raw===undefined||raw==="")return DEFAULT_PAPER_STARTING_CASH_PAISE;
  if(typeof raw!=="string"||!/^[0-9]+$/.test(raw))return null;
  const value=Number(raw);
  return Number.isSafeInteger(value)&&value>0?value:null;
}

module.exports={DEFAULT_PAPER_STARTING_CASH_PAISE,paperStartingCashPaise};
