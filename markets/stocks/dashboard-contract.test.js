import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../dashboard/index.html");
const js = read("../dashboard/dashboard.js");
const model = read("../dashboard/dashboard-model.js");
const portal = read("../index.html");
const data = JSON.parse(read("../dashboard/mock-data.json"));

test("dashboard navigation includes all nine requested screens", () => {
  for (const screen of ["home","market","watchlist","orders","portfolio","positions","holdings","profile","settings"]) {
    assert.ok(model.includes('"'+screen+'"'), "missing screen "+screen);
  }
  assert.match(html, /id="sidebar-nav"/);
  assert.match(html, /id="mobile-nav"/);
  assert.match(html, /dashboard\.css/);
});

test("all screen data is local Dummy JSON and cannot be mistaken for live prices", () => {
  assert.equal(data.meta.provider, "DUMMY_JSON");
  assert.equal(data.meta.mode, "DEMO");
  assert.match(js, /fetch\("\.\/mock-data\.json"/);
  assert.doesNotMatch(js, /upstox|supabase|market-gateway|\/paper\/orders/i);
  assert.match(js, /No live market feed/);
});

test("portal exposes the demo dashboard and preserves the existing connected workspace", () => {
  assert.match(portal, /href="\.\/dashboard\//);
  assert.match(portal, /href="\.\/stocks\//);
});

test("demo fixture has virtual capital and Indian market-only instruments", () => {
  assert.equal(data.account.virtualCapital, 1000000);
  assert.ok(data.instruments.every(item => item.exchange === "NSE" || item.exchange === "BSE"));
  assert.ok(data.positions.every(item => ["FUTURES","OPTIONS"].includes(item.kind)));
});

test("dashboard assets and Dummy JSON fixture are included in the Markets PWA shell", () => {
  const serviceWorker = read("../service-worker.js");
  for (const asset of ["dashboard/index.html","dashboard/dashboard.css","dashboard/dashboard.js","dashboard/dashboard-model.js","dashboard/mock-data.json"]) {
    assert.ok(serviceWorker.includes('"'+asset+'"'), "PWA shell missing "+asset);
  }
  assert.match(serviceWorker, /zenura-markets-shell-v3/);
  assert.match(serviceWorker, /url\.pathname\.endsWith\("\.json"\)/);
});

test("mobile bottom navigation renders every requested destination", () => {
  assert.match(js, /id="mobile-nav"[^>]*>/);
  assert.match(js, /NAV_ITEMS\.map\(\(\[id,label,icon\]\)/);
  assert.doesNotMatch(js, /NAV_ITEMS\.slice\(0,5\)/);
  assert.match(css, /grid-template-columns:repeat\(9,minmax\(62px,1fr\)\)/);
  for (const screen of ["positions","holdings","profile","settings"]) assert.ok(model.includes('"'+screen+'"'));
});
