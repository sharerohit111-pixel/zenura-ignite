"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../../markets/stocks");
const auth = fs.readFileSync(path.join(root, "email-auth.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "email-auth.css"), "utf8");

test("authenticated email UI loads its styles from a same-origin stylesheet", () => {
  assert.match(auth, /stylesheet\.href\s*=\s*["']\.\/email-auth\.css["']/);
  assert.doesNotMatch(auth, /createElement\(\s*["']style["']\s*\)/i);
  assert.doesNotMatch(auth, /\.textContent\s*=\s*`[\s\S]*?\.email-auth/);
  assert.ok(styles.includes(".email-auth"), "external stylesheet must contain the auth UI rules");
});

test("authenticated email UI does not require inline style attributes or style blocks", () => {
  assert.doesNotMatch(auth, /<style\b/i);
  assert.doesNotMatch(auth, /\bstyle\s*=/i);
});


test("standalone demo page declares a restrictive same-origin CSP", () => {
  const demo = fs.readFileSync(path.join(root, "demo.html"), "utf8");
  const match = demo.match(/<meta\\s+http-equiv="Content-Security-Policy"\\s+content="([^"]+)"/i);
  assert.ok(match, "demo page must declare a CSP");
  const csp = match[1];
  for (const directive of [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'",
    "frame-src 'none'", "form-action 'self'", "script-src 'self'",
    "script-src-attr 'none'", "style-src 'self'", "style-src-attr 'none'",
    "connect-src 'self'"
  ]) assert.ok(csp.includes(directive), "demo CSP must include " + directive);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'|\\*/);
});
