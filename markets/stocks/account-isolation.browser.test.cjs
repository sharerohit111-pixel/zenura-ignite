"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function waitForRequest(requests, predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const found = requests.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for " + label + "; seen: " +
    JSON.stringify(requests.map(r => ({path:r.path, authorization:r.authorization}))));
}
async function waitForCount(page, selector, count) {
  await page.waitForFunction(({selector,count}) =>
    document.querySelectorAll(selector).length === count, {selector,count}, {timeout:10000});
}
async function openTerminal(browser, requests) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__isolationTestUser = null;
    window.ZENURA_MARKET_CONNECTOR = {
      getUserId: () => window.__isolationTestUser,
      getIdToken: async () => "token-" + window.__isolationTestUser
    };
  });
  const page = await context.newPage();
  await page.route("https://**/*", route => route.abort());
  await page.route("**/markets/stocks/index.html", async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      '<meta name="market-gateway-url" content="">',
      '<meta name="market-gateway-url" content="http://127.0.0.1:4173/__test_gateway">'
    );
    await route.fulfill({ response, body: html });
  });
  await page.route("**/__test_gateway/paper/**", async route => {
    const request = route.request();
    const requestPath = new URL(request.url()).pathname;
    if (!requestPath.endsWith("/paper/account") && !requestPath.endsWith("/paper/orders") && !requestPath.endsWith("/paper/orders/order-A/cancel")) return route.continue();
    const item = {
      path: requestPath,
      method: request.method(),
      authorization: request.headers().authorization || "",
      respond: async body => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(body)
      })
    };
    requests.push(item);
    const hold = deferred();
    item.release = hold.resolve;
    await hold.promise;
  });
  await page.goto("http://127.0.0.1:4173/markets/stocks/index.html", {
    waitUntil: "domcontentloaded", timeout: 30000
  });
  await page.locator("#paper-orders-workspace-body").waitFor();
  return { context, page };
}
async function switchUser(page, userId) {
  await page.evaluate(uid => {
    window.__isolationTestUser = uid;
    window.dispatchEvent(new CustomEvent("zenura-market-auth-ready", {
      detail: { signedIn: !!uid, userId: uid }
    }));
  }, userId);
}
function account(cashPaise, positions, reservedPositions = {}) {
  return { cashPaise, reservedCashPaise: 0, reservedMarginPaise: 0,
    positions, reservedPositions };
}
function orders(symbol, status = "FILLED", orderType = "MARKET", id = "order-id") {
  return { orders: [{
    id, tradingSymbol: symbol, product: "DELIVERY", side: "BUY", orderType,
    quantity: 1, status, createdAt: Date.now(), executionPricePaise: 10000,
    limitPricePaise: 10000, chargesPaise: 0, realizedPnlPaise: 0
  }], nextCursor: null, hasMore: false };
}
async function respondPair(requests, user, accountBody, ordersBody) {
  const accountRequest = await waitForRequest(requests,
    r => r.path.endsWith("/paper/account") && r.authorization === "Bearer token-" + user,
    user + " account request");
  const ordersRequest = await waitForRequest(requests,
    r => r.path.endsWith("/paper/orders") && r.authorization === "Bearer token-" + user,
    user + " orders request");
  await accountRequest.respond(accountBody);
  await ordersRequest.respond(ordersBody);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    {
      const requests = [];
      const { context, page } = await openTerminal(browser, requests);
      await switchUser(page, "user-A");
      const aAccount = await waitForRequest(requests,
        r => r.path.endsWith("/paper/account") && r.authorization === "Bearer token-user-A",
        "User A balance request");
      const aOrders = await waitForRequest(requests,
        r => r.path.endsWith("/paper/orders") && r.authorization === "Bearer token-user-A",
        "User A order request");

      await switchUser(page, "user-B");
      await respondPair(requests, "user-B",
        account(900000, { "BSE|BETA": { quantity: 7 } }, { "BSE|BETA": 2 }),
        orders("B-PRIVATE-SYMBOL"));
      await page.waitForFunction(() =>
        document.querySelector("#paper-orders-workspace-body")?.innerText.includes("B-PRIVATE-SYMBOL") &&
        document.querySelector("#paper-shares-available")?.textContent === "5" &&
        document.querySelector("#paper-shares-reserved")?.textContent === "2",
        null, { timeout: 10000 });

      await aAccount.respond(account(100000, { "NSE|ALPHA": { quantity: 99 } }));
      await aOrders.respond(orders("A-PRIVATE-SECRET-SYMBOL"));
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => ({
        orders: document.querySelector("#paper-orders-workspace-body").innerText,
        availableCash: document.querySelector("#paper-cash-available").textContent,
        availableShares: document.querySelector("#paper-shares-available").textContent,
        reservedShares: document.querySelector("#paper-shares-reserved").textContent,
        status: document.querySelector("#paper-orders-workspace-status").textContent
      }));
      assert.ok(state.orders.includes("B-PRIVATE-SYMBOL"), "User B order must remain visible");
      assert.ok(!state.orders.includes("A-PRIVATE-SECRET-SYMBOL"), "late User A order must never render");
      assert.equal(state.availableShares, "5", "late User A holdings must not replace User B holdings");
      assert.equal(state.reservedShares, "2", "late User A reservations must not replace User B reservations");
      assert.ok(!state.availableCash.includes("1,000"), "late User A cash must not replace User B cash");
      assert.ok(state.status.includes("refreshed from your private paper account") ||
        state.status.includes("orders loaded from backend"), "User B owns the final private-account status");
      await context.close();
    }

    {
      const requests = [];
      const { context, page } = await openTerminal(browser, requests);
      await switchUser(page, "user-A");
      await respondPair(requests, "user-A",
        account(500000, {}),
        orders("A-PENDING-ORDER", "PENDING", "LIMIT", "order-A"));
      await waitForCount(page, "#paper-orders-workspace-body .paper-cancel-button", 1);
      await page.locator("#paper-orders-workspace-body .paper-cancel-button").click();
      const cancel = await waitForRequest(requests,
        r => r.method === "POST" && r.path.endsWith("/paper/orders/order-A/cancel") &&
          r.authorization === "Bearer token-user-A", "User A cancellation request");

      await switchUser(page, "user-B");
      await respondPair(requests, "user-B", account(700000, {}),
        orders("B-ONLY-ORDER"));
      await page.waitForFunction(() =>
        document.querySelector("#paper-orders-workspace-body")?.innerText.includes("B-ONLY-ORDER"),
        null, { timeout: 10000 });
      const countBeforeLateCancel = requests.length;
      await cancel.respond({ orderId: "order-A", status: "CANCELLED", reservationReleased: true });
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => ({
        orders: document.querySelector("#paper-orders-workspace-body").innerText,
        status: document.querySelector("#paper-orders-workspace-status").textContent
      }));
      assert.ok(state.orders.includes("B-ONLY-ORDER"), "User B orders remain visible after stale cancel response");
      assert.ok(!state.orders.includes("A-PENDING-ORDER"), "User A order must not leak into User B view");
      assert.ok(!state.status.includes("reservation released"), "stale User A cancel cannot publish success in User B session");
      assert.equal(requests.length, countBeforeLateCancel, "stale cancel must not trigger a refresh under User B credentials");
      await context.close();
    }
    console.log("PASS: real Chromium account switch rejects delayed User A balances/orders and stale User A cancellation.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
