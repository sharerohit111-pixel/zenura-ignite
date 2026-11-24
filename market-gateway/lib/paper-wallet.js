"use strict";
function paise(value, field) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
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
  if (!Number.isSafeInteger(blockedFundsPaise) || blockedFundsPaise > cashPaise) {
    throw Object.assign(new Error("Paper wallet reservations exceed its cash balance."), { status: 503, code: "PAPER_WALLET_STATE_INVALID" });
  }
  return Object.freeze({
    startingCashPaise, cashPaise, reservedCashPaise, reservedMarginPaise,
    blockedFundsPaise, availableCashPaise: cashPaise - blockedFundsPaise,
    walletSource: "paper_accounts", ledgerReconciled: false, simulationOnly: true
  });
}
module.exports = { buildPaperWalletSnapshot };
