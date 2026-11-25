"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../../markets/stocks/index.html"), "utf8");
const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*>/i);

test("authenticated Paper Trading workspace declares one CSP meta policy", () => {
  assert.ok(match, "CSP meta policy must be present on the authenticated workspace");
  assert.equal((html.match(/http-equiv=["']Content-Security-Policy["']/gi) || []).length, 1);
});

test("CSP blocks objects, base URL changes, child frames and external form destinations", () => {
  const directives = Object.fromEntries(match[1].split(";").map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  for (const name of ["default-src", "script-src", "style-src", "img-src", "font-src", "connect-src", "object-src", "base-uri", "form-action", "frame-src"]) {
    assert.ok(directives[name], `missing CSP directive: ${name}`);
  }
  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'self'"]);
  assert.deepEqual(directives["form-action"], ["'self'"]);
  assert.deepEqual(directives["frame-src"], ["'none'"]);
  assert.ok(!match[1].includes("'unsafe-eval'"), "unsafe-eval must never be enabled");
});

test("CSP permits only the required authenticated workspace script and API origins", () => {
  const directives = Object.fromEntries(match[1].split(";").map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  assert.deepEqual(directives["script-src"], ["'self'", "https://esm.sh", "https://cdn.jsdelivr.net", "https://unpkg.com"]);
  for (const origin of ["https://*.supabase.co", "wss://*.supabase.co", "https://*.run.app", "https://*.a.run.app"]) {
    assert.ok(directives["connect-src"].includes(origin), `missing required API origin: ${origin}`);
  }
});

test("CSP blocks inline styles and auth UI uses a same-origin stylesheet", () => {
  const directives = Object.fromEntries(match[1].split(";").map(part => {
    const [name, ...values] = part.trim().split(/\\s+/);
    return [name, values];
  }));
  assert.deepEqual(directives["style-src"], ["'self'"]);
  assert.ok(!match[1].includes("'unsafe-inline'"), "inline styles must not be enabled");
  const authScript = fs.readFileSync(path.join(__dirname, "../../markets/stocks/email-auth.js"), "utf8");
  const authStyles = fs.readFileSync(path.join(__dirname, "../../markets/stocks/email-auth.css"), "utf8");
  assert.match(authScript, /stylesheet\\.href = ["']\\.\\/email-auth\\.css["']/);
  assert.doesNotMatch(authScript, /createElement\\(["']style["']\\)/);
  assert.ok(authStyles.includes(".email-auth"), "same-origin auth stylesheet must exist");
});

test("meta CSP is not misrepresented as clickjacking protection", () => {
  const directives = Object.fromEntries(match[1].split(";").map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  // frame-ancestors is ignored in meta CSP. GitHub Pages cannot emit custom
  // response headers; clickjacking protection requires a header at a proxy/CDN
  // or a hosting platform that supports response headers.
  assert.equal(directives["frame-ancestors"], undefined);
});
