"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); }
  catch { res.writeHead(400).end("Bad URL"); return; }
  let target = path.resolve(root, "." + pathname);
  if (!target.startsWith(root + path.sep) && target !== root) {
    res.writeHead(403).end("Forbidden"); return;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404).end("Not found"); return;
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(target).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(4173, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto("http://127.0.0.1:4173/markets/dashboard/", { waitUntil: "networkidle" });
    await page.locator("#demo-asof").waitFor();
    assert.match(await page.title(), /S-TRADE Dashboard/);
    assert.equal(await page.locator(".demo-badge").innerText(), "DUMMY JSON");

    const screens = ["home","market","watchlist","orders","portfolio","positions","holdings","profile","settings"];
    for (const screen of screens) {
      await page.locator('#sidebar-nav [data-screen="' + screen + '"]').click();
      assert.equal(await page.locator("#screen-title").innerText(), screen[0].toUpperCase() + screen.slice(1));
      assert.ok(await page.locator("#view").innerText());
    }

    await page.locator('#sidebar-nav [data-screen="market"]').click();
    await page.locator("#market-search").fill("RELIANCE");
    assert.equal(await page.locator("#view tbody tr").count(), 1);
    await page.locator("#market-search").fill("");
    await page.locator('[data-segment="FUTURES"]').click();
    assert.ok((await page.locator("#view").innerText()).includes("NIFTY26NOVFUT"));
    await page.locator('[data-segment="ALL"]').click();
    await page.locator('.watch-toggle[data-symbol="SBIN"]').click();
    await page.locator('#sidebar-nav [data-screen="watchlist"]').click();
    assert.ok((await page.locator("#view").innerText()).includes("SBIN"));
    await page.locator('.watch-toggle[data-symbol="SBIN"]').click();
    assert.equal(await page.locator('.watch-toggle[data-symbol="SBIN"]').count(), 0, "removed symbol must no longer be in the watchlist");
    assert.equal(await page.locator(".empty-state").count(), 1, "empty watchlist state should be shown after removing its last item");

    await page.locator('#sidebar-nav [data-screen="orders"]').click();
    await page.locator('[data-order-filter="PENDING"]').click();
    assert.equal(await page.locator("#view tbody tr").count(), 1);

    await page.locator('#sidebar-nav [data-screen="settings"]').click();
    await page.locator("#theme-setting").click();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "light");
    await page.locator("#language-setting").click();
    assert.equal(await page.locator("#screen-title").innerText(), "सेटिंग्स");

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on("pageerror", error => pageErrors.push(error.message));
    await mobile.goto("http://127.0.0.1:4173/markets/dashboard/", { waitUntil: "networkidle" });
    const nav = mobile.locator("#mobile-nav");
    assert.equal(await nav.locator("[data-screen]").count(), 9);
    const navMetrics = await nav.evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(navMetrics.scrollWidth > navMetrics.clientWidth, "mobile nav should scroll horizontally to expose all nine destinations");
    await nav.locator('[data-screen="settings"]').scrollIntoViewIfNeeded();
    await nav.locator('[data-screen="settings"]').click();
    assert.equal(await mobile.locator("#screen-title").innerText(), "Settings");
    const pageWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(pageWidth <= 390, "mobile page must not overflow horizontally outside the navigation scroller");
    assert.deepEqual(pageErrors, [], "dashboard should not emit browser runtime errors");
    console.log("S-TRADE browser smoke passed: nine screens, filters, watchlist, settings, desktop and mobile navigation.");
    await mobile.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
