"use strict";

function availablePaperCash(account){
  if(!account||typeof account!=="object")throw new TypeError("Paper account is required.");
  const cash=account.cash_paise,reservedCash=account.reserved_cash_paise,reservedMargin=account.reserved_margin_paise;
  for(const [name,value] of [["cash_paise",cash],["reserved_cash_paise",reservedCash],["reserved_margin_paise",reservedMargin]]){
    if(!Number.isSafeInteger(value)||value<0)throw new RangeError("Paper account "+name+" is invalid.");
  }
  if(reservedCash+reservedMargin>cash)throw new RangeError("Paper account reservations exceed cash.");
  return cash-reservedCash-reservedMargin;
}

module.exports={availablePaperCash};
