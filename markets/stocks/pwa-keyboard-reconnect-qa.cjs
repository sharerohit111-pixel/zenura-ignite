"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const ORIGIN = "http://127.0.0.1:4173";
const MARKET = ORIGIN + "/markets/";
const DEMO = ORIGIN + "/markets/stocks/demo.html";
const SCREENS = ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"];

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const pwaContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const pwaPage = await pwaContext.newPage();
    await pwaPage.goto(MARKET + "manifest.webmanifest", { waitUntil: "domcontentloaded" });
    await pwaPage.evaluate(async () => {
      const old = await caches.open("zenura-markets-shell-v10");
      await old.put(new Request(new URL("stale-marker.txt", location.href)), new Response("stale-v10"));
    });
    await pwaPage.goto(MARKET, { waitUntil: "load", timeout: 30000 });
    await pwaPage.waitForFunction(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find(item => item.scope === new URL("/markets/", location.origin).href);
      return registration?.active?.state === "activated" && !registration.installing;
    }, null, { timeout: 30000 });
    const activationInfo = await pwaPage.evaluate(async () => ({
      keys: await caches.keys(),
      controller: navigator.serviceWorker.controller?.scriptURL || null
    }));
    assert.ok(activationInfo.keys.includes("zenura-markets-shell-v11"), "current v11 cache must be active: " + JSON.stringify(activationInfo));
    await pwaPage.reload({ waitUntil: "domcontentloaded" });
    await pwaPage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await pwaPage.waitForFunction(async () => !(await caches.keys()).includes("zenura-markets-shell-v10"), null, { timeout: 10000 });
    const upgradeInfo = await pwaPage.evaluate(async () => ({
      keys: await caches.keys(),
      controller: navigator.serviceWorker.controller?.scriptURL || null
    }));
    assert.ok(!upgradeInfo.keys.includes("zenura-markets-shell-v10"), "activated worker must remove the seeded v10 cache after taking control: " + JSON.stringify(upgradeInfo));
    await pwaPage.evaluate(async () => {
      await fetch("/markets/private-session-qa-probe", { headers: { Authorization: "Bearer synthetic-qa-only" } }).catch(() => null);
    });
    const privateCacheEntries = await pwaPage.evaluate(async () => {
      const cache = await caches.open("zenura-markets-shell-v11");
      return (await cache.keys()).map(request => request.url).filter(url => url.includes("private-session-qa-probe"));
    });
    assert.deepEqual(privateCacheEntries, [], "authorized private probe must not enter the shell cache");

    await pwaContext.setOffline(true);
    await pwaPage.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 15000 });
    await pwaPage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await pwaPage.waitForFunction(() => document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"), null, { timeout: 10000 });
    assert.equal(await pwaPage.locator("#screen-nav button[data-screen]").count(), 15, "offline demo must expose all 15 navigation controls");
    await pwaPage.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
    await pwaPage.waitForFunction(() => document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"), null, { timeout: 10000 });
    console.log(JSON.stringify({ pwaUpgrade: "PASS", staleCacheRemoved: "v10", activeCache: "v11", privateAuthCacheProbe: "PASS", offlineNavigation: "PASS", offlineReload: "PASS" }));

    await pwaContext.setOffline(false);
    await pwaPage.waitForFunction(() => navigator.onLine === true, null, { timeout: 10000 });
    const response = await pwaPage.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
    assert.ok(response && response.ok(), "reconnected page reload must return a successful network response");
    await pwaPage.waitForFunction(() => document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"), null, { timeout: 10000 });
    console.log(JSON.stringify({ reconnect: "PASS", online: true, reloadStatus: response.status() }));
    await pwaContext.close();

    const keyboardContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await keyboardContext.newPage();
    await page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => document.querySelector("#demo-status")?.textContent.includes("4 canonical fixtures validated"), null, { timeout: 10000 });
    const navButtons = page.locator("#screen-nav button[data-screen]");
    assert.equal(await navButtons.count(), SCREENS.length);
    for (let index = 0; index < SCREENS.length; index++) {
      if (index === 0) {
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.className), "brand", "first tab stop must be the brand link");
        await page.keyboard.press("Tab");
      } else {
        await page.keyboard.press("Tab");
      }
      const active = await page.evaluate(() => document.activeElement?.getAttribute("data-screen"));
      assert.equal(active, SCREENS[index], "Tab order must reach " + SCREENS[index]);
      const focusStyle = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      assert.notEqual(focusStyle.outlineStyle, "none", "visible focus outline required for " + SCREENS[index]);
      assert.notEqual(focusStyle.outlineWidth, "0px", "non-zero focus outline required for " + SCREENS[index]);
      await page.keyboard.press("Enter");
      await page.locator("#screen-content > .screen-title h2").waitFor();
      assert.ok(await page.locator("#screen-content > .screen-title h2").isVisible(), "keyboard activation must render " + SCREENS[index]);
    }
    const labels = await navButtons.evaluateAll(nodes => nodes.map(node => (node.getAttribute("aria-label") || node.innerText || "").trim()));
    assert.ok(labels.every(Boolean), "every screen navigation button must have an accessible name");
    const languageToggle = page.locator("#paper-language-toggle");
    assert.ok((await languageToggle.getAttribute("aria-label") || "").trim(), "language toggle must have an accessible name");
    console.log(JSON.stringify({ keyboardNavigation: "PASS", screens: SCREENS.length, sequence: "Tab + Enter", focusIndicator: "PASS", accessibleNames: "PASS" }));
    await keyboardContext.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
