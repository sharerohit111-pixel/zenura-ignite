"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperWalletSnapshot } = require("../lib/paper-wallet");

test("projects starting, blocked and available balances in integer paise", () => {
  const wallet = buildPaperWalletSnapshot({
    starting_cash_paise: "100000000", cash_paise: "97500000",
    reserved_cash_paise: "1500000", reserved_margin_paise: "2500000"
  });
  assert.deepEqual(wallet, {
    startingCashPaise: 100000000, cashPaise: 97500000,
    reservedCashPaise: 1500000, reservedMarginPaise: 2500000,
    blockedFundsPaise: 4000000, availableCashPaise: 93500000,
    walletSource: "paper_accounts", ledgerReconciled: false, simulationOnly: true
  });
});

test("defaults missing reservation fields to zero", () => {
  const wallet = buildPaperWalletSnapshot({
    starting_cash_paise: 100000000, cash_paise: 100000000
  });
  assert.equal(wallet.availableCashPaise, 100000000);
  assert.equal(wallet.blockedFundsPaise, 0);
});

test("rejects unsafe, negative, fractional and malformed paise values", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1.2", "abc"]) {
    assert.throws(() => buildPaperWalletSnapshot({
      starting_cash_paise: 100000000, cash_paise: value
    }), error => error.code === "PAPER_WALLET_STATE_INVALID");
  }
});

test("rejects reservations greater than wallet cash", () => {
  assert.throws(() => buildPaperWalletSnapshot({
    starting_cash_paise: 100000000, cash_paise: 1000,
    reserved_cash_paise: 800, reserved_margin_paise: 300
  }), error => error.code === "PAPER_WALLET_STATE_INVALID");
});
