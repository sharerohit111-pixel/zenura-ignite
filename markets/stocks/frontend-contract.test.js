import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("./index.html");
const stocks = read("./stocks.js");
const equityOrders = read("./order-workspace.js");
const futuresLimits = read("./futures-limit-workspace.js");
const optionsLimits = read("./options-limit-workspace.js");
const language = read("../language-toggle.js");

test("Indian Market page mounts each paper-trading workspace module", () => {
  for (const id of [
    "paper-order-ticket", "paper-orders-workspace-body", "paper-trades-workspace-body",
    "paper-positions", "paper-market-value", "futures-order-buy", "futures-limit-buy",
    "futures-positions", "options-limit-buy", "option-chain-body", "derivative-positions"
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  for (const script of [
    "./stocks.js", "./order-workspace.js", "./futures-limit-workspace.js",
    "./options-limit-workspace.js", "../language-toggle.js"
  ]) assert.ok(html.includes('src="' + script + '"'), "missing script " + script);
});

test("Equity, Futures and Options screens call authenticated backend routes", () => {
  for (const route of ["/paper/orders", "/paper/orders/", "/paper/account"]) assert.ok(equityOrders.includes(route));
  for (const route of ["/paper/futures/orders", "/paper/futures/portfolio", "/paper/derivative/orders", "/paper/derivatives/portfolio", "/paper/portfolio"]) {
    assert.ok(stocks.includes(route), "missing route " + route);
  }
  for (const route of ["/paper/futures/limit-orders", "/paper/futures/orders/"]) assert.ok(futuresLimits.includes(route));
  for (const route of ["/paper/derivative/limit-orders", "/paper/derivative/limit-orders/"]) assert.ok(optionsLimits.includes(route));
});

test("Options MARKET lot entry is an in-page control, not a browser prompt", () => {
  assert.match(html, /id="option-order-lots"/);
  assert.doesNotMatch(stocks, /window\.prompt\s*\(/);
  assert.match(language, /"Lots to trade":"[^"]+"/);
});

test("new Futures and Options accounting labels have Hindi translations", () => {
  for (const key of [
    "Futures LIMIT Ticket", "BUY LIMIT", "SELL LIMIT", "Futures Positions & History",
    "Options LIMIT Ticket", "SEARCH CONTRACTS", "Options Positions & Accounting",
    "AVAILABLE BALANCE", "BLOCKED PREMIUM · OPEN LIMITS (LATEST 100)",
    "PREMIUM INVESTED", "EXIT RESERVED", "AVAILABLE TO EXIT"
  ]) assert.ok(language.includes('"' + key + '"'), "missing translation key: " + key);
});

test("frontend does not invent a modify endpoint for pending orders", () => {
  for (const source of [equityOrders, futuresLimits, optionsLimits]) {
    assert.doesNotMatch(source, /\/modify(?:-order)?(?:\/|["'])/i);
  }
});
