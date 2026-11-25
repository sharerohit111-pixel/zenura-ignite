import { createPaperDemoEventLedger } from "./paper-demo-event-ledger.mjs";

function createIdentity() {
  const token = globalThis.crypto?.randomUUID?.() ||
    (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
  return "demo-" + token;
}

export function createPaperDemoLedgerSession({ accountId, cashBalancePaise, blockedFundsPaise = 0 } = {}) {
  if (typeof accountId !== "string" || !accountId.startsWith("mock-") ||
      !Number.isSafeInteger(cashBalancePaise) || cashBalancePaise < 0 ||
      !Number.isSafeInteger(blockedFundsPaise) || blockedFundsPaise < 0 ||
      blockedFundsPaise > cashBalancePaise) {
    throw new TypeError("INVALID_SHARED_DEMO_LEDGER_SESSION");
  }
  const sessionId = createIdentity();
  const ledger = createPaperDemoEventLedger({ accountId, sessionId, cashBalancePaise, blockedFundsPaise });
  let lastTimestamp = -Infinity;
  return Object.freeze({
    accountId, sessionId, ledger,
    nextTimestamp: () => {
      lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
      return lastTimestamp;
    }
  });
}

let sharedSession = null;
export function getSharedPaperDemoLedgerSession(opening) {
  if (!sharedSession) sharedSession = createPaperDemoLedgerSession(opening);
  else if (sharedSession.accountId !== opening.accountId ||
      sharedSession.ledger.snapshot().account.openingCashPaise !== opening.cashBalancePaise ||
      sharedSession.ledger.snapshot().account.blockedFundsPaise !== opening.blockedFundsPaise) {
    throw new TypeError("DEMO_LEDGER_SESSION_SCOPE_MISMATCH");
  }
  return sharedSession;
}
