"use strict";
function paise(value, field) {
  const parsed = typeof value === "string" && /^\\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw Object.assign(new Error("Paper wallet contains an invalid " + field + "."), { status: 503, code: "PAPER_WALLET_STATE_INVALID" });
  }
  return parsed;
}
function buildPaperWalletSnapshot(account) {
  if (!account || typeof account !== "object") {
    throw Object.assign(new Error("Paper wallet account is unavailable."), { status: 503, code: "PAPER_WALLET_UNAVAILABLE" });
  }
  const startingCashPaise = paise(account.starting_cash_paise, "starting capital");
  const cashPaise = paise(account.cash_paise, "cash balance");
  const reservedCashPaise = paise(account.reserved_cash_paise ?? 0, "reserved cash");
  const reservedMarginPaise = paise(account.reserved_margin_paise ?? 0, "reserved margin");
  const blockedFundsPaise = reservedCashPaise + reservedMarginPaise;
  if (!Number.isSafeInteger(blockedFundsPaise)) {
    throw Object.assign(new Error("Paper wallet reservations exceed the safe integer range."), { status: 503, code: "PAPER_WALLET_STATE_INVALID" });
  }
  const availableCashPaise = cashPaise - blockedFundsPaise;
  const marginDeficitPaise = Math.max(0, -availableCashPaise);
  if (Object.prototype.hasOwnProperty.call(account, "margin_deficit_paise")) {
    const storedMarginDeficitPaise = paise(account.margin_deficit_paise, "margin deficit");
    if (storedMarginDeficitPaise !== marginDeficitPaise) {
      throw Object.assign(new Error("Paper wallet margin deficit does not reconcile to cash and reservations."), { status: 503, code: "PAPER_WALLET_STATE_INVALID" });
    }
  }
  return Object.freeze({
    startingCashPaise, cashPaise, reservedCashPaise, reservedMarginPaise,
    blockedFundsPaise, availableCashPaise, marginDeficitPaise,
    walletSource: "paper_accounts", ledgerReconciled: false, simulationOnly: true
  });
}
module.exports = { buildPaperWalletSnapshot };
