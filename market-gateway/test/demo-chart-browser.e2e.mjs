// Chromium-backed browser smoke test; CI runs this on the supported Ubuntu 24.04 image.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const server = spawn("python3", ["-m", "http.server", "4173", "--bind", "127.0.0.1"], {
  cwd: process.cwd(),
  stdio: "ignore"
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(origin + "/markets/stocks/");
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error("STATIC_TEST_SERVER_NOT_READY");
}

test("MOCK chart workspace renders and remains usable at desktop and mobile widths", {
  timeout: 120_000
}, async () => {
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await desktop.route("https://**/*", route => route.abort());
    await desktop.goto(origin + "/markets/stocks/", { waitUntil: "domcontentloaded" });
    await desktop.locator("#demo-content:not([hidden])").waitFor({ timeout: 15_000 });

    assert.match(await desktop.locator(".demo-badge").innerText(), /MOCK.*DEMO DATA.*NOT LIVE NSE\/BSE/);
    assert.match(await desktop.locator(".demo-disclaimer").innerText(), /read-only/i);

    const options = await desktop.locator("#demo-instrument option").evaluateAll(nodes =>
      nodes.map(node => ({ value: node.value, label: node.textContent }))
    );
    assert.ok(options.length >= 4, "shared fixtures should expose equity, futures and options chart instruments");
    assert.ok(options.every(option => option.value.startsWith("MOCK|")));

    assert.equal(await desktop.locator(".demo-depth-row.bid").count(), 5);
    assert.equal(await desktop.locator(".demo-depth-row.ask").count(), 5);
    assert.equal(await desktop.locator("#demo-chart-svg rect").count(), 128,
      "candlestick bodies and volume bars should render for 64 bars");

    const initialFiveMinuteChart = await desktop.locator("#demo-chart-svg").innerHTML();
    await desktop.locator('[data-demo-timeframe="1m"]').click();
    assert.equal(await desktop.locator(".demo-depth-row.bid").count(), 5);
    await desktop.locator('[data-demo-timeframe="5m"]').click();
    assert.equal(await desktop.locator("#demo-chart-svg").innerHTML(), initialFiveMinuteChart,
      "reselecting a timeframe must replay identical synthetic chart data");

    await desktop.locator('[data-demo-chart-type="LINE"]').click();
    assert.ok(await desktop.locator("#demo-chart-svg .demo-line").count() > 0,
      "line mode must render the synthetic close-price path");
    assert.equal(await desktop.locator("#demo-chart-svg rect").count(), 64,
      "line mode must retain the 64 volume bars");

    await desktop.locator("#demo-instrument").selectOption(options.find(option => option.value.includes("|FUT|"))?.value);
    assert.match(await desktop.locator("#demo-symbol").innerText(), /MOCK.*FUT/);
    assert.equal(await desktop.locator(".demo-depth-row.ask").count(), 5);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true });
    await mobile.route("https://**/*", route => route.abort());
    await mobile.goto(origin + "/markets/stocks/", { waitUntil: "domcontentloaded" });
    await mobile.locator("#demo-content:not([hidden])").waitFor({ timeout: 15_000 });
    const layout = await mobile.locator("#demo-market-lab").evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      chartWidth: element.querySelector("#demo-chart-svg").getBoundingClientRect().width,
      depthColumns: getComputedStyle(element.querySelector(".demo-depth-card")).gridTemplateColumns
    }));
    assert.ok(layout.chartWidth > 0, "mobile chart SVG must have a measurable visible width");
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1,
      "demo chart panel must not overflow horizontally on a 390px viewport");
    assert.equal(await mobile.locator(".demo-depth-row.bid").count(), 5);
    assert.equal(await mobile.locator(".demo-depth-row.ask").count(), 5);
    assert.match(await mobile.locator(".demo-badge").innerText(), /MOCK.*DEMO DATA/);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
});
