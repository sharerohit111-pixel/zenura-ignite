(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZenuraPaperDemoAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FIXTURES = Object.freeze({
    market: "market.json",
    account: "account.json",
    equity: "equity.json",
    derivatives: "derivatives.json",
    error: "error.json"
  });

  const SCREEN_FIXTURES = Object.freeze({
    home: "market",
    market: "market",
    watchlists: "market",
    charts: "market",
    account: "account",
    profile: "account",
    settings: "account",
    equity: "equity",
    orders: "equity",
    trades: "equity",
    portfolio: "equity",
    positions: "equity",
    holdings: "equity",
    futures: "derivatives",
    options: "derivatives",
    error: "error"
  });

  const DEMO_LABEL = "DEMO DATA — SYNTHETIC FIXTURE";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function validateEnvelope(value, expectedName) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        value.schemaVersion !== "1.0.0" || value.mode !== "MOCK" ||
        value.simulated !== true || typeof value.requestId !== "string" ||
        !value.requestId || typeof value.asOf !== "string" ||
        !Number.isFinite(Date.parse(value.asOf)) ||
        !value.meta || value.meta.source !== "SYNTHETIC_FIXTURE" ||
        !value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
      throw new Error("INVALID_MOCK_FIXTURE_ENVELOPE");
    }
    if (expectedName === "market" && !Array.isArray(value.data.quotes)) {
      throw new Error("INVALID_MOCK_MARKET_FIXTURE");
    }
    if (expectedName === "account" &&
        (value.data.currency !== "INR" || !Number.isSafeInteger(value.data.startingCapitalPaise))) {
      throw new Error("INVALID_MOCK_ACCOUNT_FIXTURE");
    }
    return value;
  }

  function createDemoClient(options) {
    const config = options || {};
    if (config.allowDemo !== true) {
      throw new Error("MOCK_DEMO_MODE_REQUIRES_EXPLICIT_OPT_IN");
    }

    const fetchImpl = config.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== "function") throw new Error("MOCK_DEMO_FETCH_UNAVAILABLE");

    const fixturesBasePath = config.fixturesBasePath || "../../market-gateway/mock/fixtures";
    const cache = new Map();

    async function readFixture(name) {
      const filename = FIXTURES[name];
      if (!filename) throw new Error("UNKNOWN_MOCK_FIXTURE");
      if (cache.has(name)) return clone(cache.get(name));

      const response = await fetchImpl(fixturesBasePath + "/" + filename, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response || response.ok !== true) throw new Error("MOCK_FIXTURE_FETCH_FAILED");
      const payload = validateEnvelope(await response.json(), name);
      const detached = clone(payload);
      cache.set(name, detached);
      return clone(detached);
    }

    async function readScreen(screenName) {
      if (typeof screenName !== "string" || !Object.prototype.hasOwnProperty.call(SCREEN_FIXTURES, screenName)) {
        throw new Error("UNKNOWN_MOCK_SCREEN");
      }
      const fixtureName = SCREEN_FIXTURES[screenName];
      return Object.freeze({
        screen: screenName,
        fixture: fixtureName,
        label: DEMO_LABEL,
        envelope: await readFixture(fixtureName),
        canSubmitOrders: false
      });
    }

    return Object.freeze({
      label: DEMO_LABEL,
      mode: "MOCK",
      simulated: true,
      canSubmitOrders: false,
      readFixture,
      readScreen,
      assertOrderSubmissionDisabled: function () {
        throw new Error("MOCK_DEMO_ORDER_SUBMISSION_DISABLED");
      }
    });
  }

  return Object.freeze({
    DEMO_LABEL,
    FIXTURES,
    SCREEN_FIXTURES,
    createDemoClient,
    validateEnvelope
  });
});
