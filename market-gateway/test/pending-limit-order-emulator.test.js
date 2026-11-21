"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  placePendingLimitOrder,
  cancelPendingLimitOrder,
  executePendingLimitOrder
} = require("../lib/pending-limit-order-transaction");

test("Firestore Emulator persists LIMIT reservations, cancellation and fills transactionally", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
  const app = initializeApp({
    projectId: process.env.GCLOUD_PROJECT || "demo-zenura-ignite"
  }, "paper-limit-emulator-" + randomUUID());
  const db = getFirestore(app);
  const uid = "emulator-" + randomUUID();
  const accountRef = db.collection("indianPaperAccounts").doc(uid);
  const buyCancelRef = db.collection("indianPaperOrders").doc(uid + "-buy-cancel");
  const buyFillRef = db.collection("indianPaperOrders").doc(uid + "-buy-fill");
  const sellFillRef = db.collection("indianPaperOrders").doc(uid + "-sell-fill");
  const serverTimestamp = () => new Date("2026-11-20T10:00:00.000Z");

  const makeOrder = (side, patch = {}) => ({
    uid,
    instrumentKey: "NSE_EQ|EMULATOR_TEST",
    tradingSymbol: "EMULATOR_TEST",
    exchange: "NSE",
    side,
    quantity: 2,
    orderType: "LIMIT",
    limitPricePaise: 10000,
    status: "PENDING",
    simulationOnly: true,
    requestFingerprint: side + "-" + randomUUID(),
    ...patch
  });

  try {
    await accountRef.create({
      cashPaise: 100000,
      realizedPnlPaise: 0,
      positions: {},
      reservedCashPaise: 0,
      reservedMarginPaise: 0,
      reservedPositions: {},
      version: 1
    });

    const cancelOrder = makeOrder("BUY");
    const cancelArgs = {
      db, accountRef, orderRef: buyCancelRef, uid,
      order: cancelOrder, serverTimestamp
    };
    const reserved = await placePendingLimitOrder(cancelArgs);
    assert.equal(reserved.status, "PENDING");
    assert.equal((await accountRef.get()).data().reservedCashPaise, 20000);

    const replay = await placePendingLimitOrder(cancelArgs);
    assert.equal(replay.idempotentReplay, true);
    assert.equal((await accountRef.get()).data().reservedCashPaise, 20000);

    const cancelled = await cancelPendingLimitOrder({
      db, accountRef, orderRef: buyCancelRef, uid, serverTimestamp
    });
    assert.equal(cancelled.reservationReleased, true);
    assert.equal((await accountRef.get()).data().reservedCashPaise, 0);
    const cancelReplay = await cancelPendingLimitOrder({
      db, accountRef, orderRef: buyCancelRef, uid, serverTimestamp
    });
    assert.equal(cancelReplay.idempotentReplay, true);
    assert.equal((await accountRef.get()).data().reservedCashPaise, 0);

    const buyOrder = makeOrder("BUY");
    await placePendingLimitOrder({
      db, accountRef, orderRef: buyFillRef, uid,
      order: buyOrder, serverTimestamp
    });
    const buyQuoteTime = Date.now();
    const buyFill = await executePendingLimitOrder({
      db, accountRef, orderRef: buyFillRef, uid,
      quote: { pricePaise: 9000, timestampMs: buyQuoteTime },
      nowMs: buyQuoteTime + 1000,
      serverTimestamp
    });
    assert.equal(buyFill.status, "FILLED");
    const afterBuy = (await accountRef.get()).data();
    assert.equal(afterBuy.cashPaise, 82000);
    assert.equal(afterBuy.reservedCashPaise, 0);
    assert.equal(afterBuy.positions["NSE_EQ|EMULATOR_TEST"].quantity, 2);
    assert.equal((await buyFillRef.get()).data().reservationReleased, true);

    await accountRef.update({
      positions: {
        "NSE_EQ|EMULATOR_TEST": {
          quantity: 3,
          averagePricePaise: 4000,
          costBasisPaise: 12000
        }
      },
      reservedCashPaise: 0,
      reservedPositions: {},
      cashPaise: 82000,
      version: afterBuy.version + 1
    });
    const sellOrder = makeOrder("SELL", {
      limitPricePaise: 9000,
      requestFingerprint: "sell-" + randomUUID()
    });
    await placePendingLimitOrder({
      db, accountRef, orderRef: sellFillRef, uid,
      order: sellOrder, serverTimestamp
    });
    assert.equal(
      (await accountRef.get()).data().reservedPositions["NSE_EQ|EMULATOR_TEST"],
      2
    );

    const sellQuoteTime = Date.now();
    const sellFill = await executePendingLimitOrder({
      db, accountRef, orderRef: sellFillRef, uid,
      quote: { pricePaise: 9500, timestampMs: sellQuoteTime },
      nowMs: sellQuoteTime + 1000,
      serverTimestamp
    });
    assert.equal(sellFill.status, "FILLED");
    const afterSell = (await accountRef.get()).data();
    assert.equal(afterSell.positions["NSE_EQ|EMULATOR_TEST"].quantity, 1);
    assert.equal(afterSell.cashPaise, 101000);
    assert.equal(afterSell.reservedPositions["NSE_EQ|EMULATOR_TEST"], undefined);
    assert.equal(afterSell.realizedPnlPaise, 11000);
    assert.equal((await sellFillRef.get()).data().reservationReleased, true);
  } finally {
    await Promise.all([
      buyCancelRef.delete().catch(() => {}),
      buyFillRef.delete().catch(() => {}),
      sellFillRef.delete().catch(() => {}),
      accountRef.delete().catch(() => {})
    ]);
    await deleteApp(app);
  }
});
