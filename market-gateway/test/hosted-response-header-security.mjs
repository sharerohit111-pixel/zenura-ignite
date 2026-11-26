import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright";

test("staging header configuration is strict and scoped", async () => {
  const headersFile = await readFile(new URL("../../_headers", import.meta.url), "utf8");
  assert.match(headersFile, /^\\/markets\\/stocks\\/\\*/m, "headers must be scoped to the Indian Market workspace");
  assert.match(headersFile, /frame-ancestors 'none'/);
  assert.match(headersFile, /object-src 'none'/);
  assert.match(headersFile, /form-action 'self'/);
  assert.match(headersFile, /X-Frame-Options: DENY/);
  assert.match(headersFile, /X-Content-Type-Options: nosniff/);
  assert.doesNotMatch(headersFile, /'unsafe-inline'|'unsafe-eval'|\\s\\*/);
});
import { chromium } from "playwright";

const target = process.env.S_TRADE_STAGING_URL;

test("hosted staging sends strict CSP response headers and blocks framing", {
  skip: !target ? "Set S_TRADE_STAGING_URL to an isolated staging page; never use production here." : false
}, async () => {
  const parsed = new URL(target);
  assert.equal(parsed.protocol, "https:", "staging target must use HTTPS");
  assert.match(parsed.pathname, /\/markets\/stocks\/index\.html$/, "target must be the Indian Market workspace HTML");

  const response = await fetch(target, { redirect: "manual" });
  assert.equal(response.status, 200, "staging workspace must return HTTP 200 without redirect");
  const headers = response.headers;
  const csp = headers.get("content-security-policy");
  assert.ok(csp, "CSP must be delivered as an HTTP response header, not only as meta markup");
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "*"]) {
    assert.ok(!csp.includes(forbidden), `HTTP CSP must not contain ${forbidden}`);
  }
  for (const required of [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-src 'none'",
    "frame-ancestors 'none'", "form-action 'self'", "script-src 'self' https://esm.sh",
    "script-src-attr 'none'", "style-src 'self'", "style-src-attr 'none'",
    "img-src 'self' data:", "font-src 'self'",
    "https://atvbjibhunvzpmfagagm.supabase.co", "wss://atvbjibhunvzpmfagagm.supabase.co"
  ]) {
    assert.ok(csp.includes(required), `HTTP CSP missing required policy fragment: ${required}`);
  }
  assert.equal(headers.get("x-frame-options")?.toLowerCase(), "deny");
  assert.equal(headers.get("x-content-type-options")?.toLowerCase(), "nosniff");
  assert.equal(headers.get("referrer-policy")?.toLowerCase(), "strict-origin-when-cross-origin");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto("data:text/html,<title>untrusted-ancestor</title><body>test</body>");
    await page.evaluate(url => {
      const frame = document.createElement("iframe");
      frame.id = "hosted-workspace";
      frame.src = url;
      document.body.append(frame);
    }, target);
    await page.waitForTimeout(700);
    const embedded = page.frames().some(frame => frame.url().startsWith(parsed.origin + parsed.pathname));
    assert.equal(embedded, false, "workspace must not load as a child frame of an unrelated ancestor");
    assert.ok(
      consoleErrors.some(message => /frame-ancestors/i.test(message)),
      `Chromium must report frame-ancestors enforcement; observed: ${consoleErrors.join(" | ")}`
    );
  } finally {
    await browser.close();
  }
});
