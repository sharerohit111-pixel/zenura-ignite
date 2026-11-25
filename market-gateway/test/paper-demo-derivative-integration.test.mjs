import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("Futures and Options Demo screens mount the shared local simulator", async () => {
  const js = await read("markets/stocks/demo.js");
  const html = await read("markets/stocks/demo.html");
  const panel = await read("markets/stocks/demo-derivative-panel.mjs");
  assert.match(js, /mountDerivativeDemo\(content,name\)/);
  assert.match(js, /appendDerivativeSummary\(content,name\)/);
  assert.match(panel, /LOCAL FUTURES & OPTIONS POSITIONS/);
  assert.match(panel, /LOCAL FUTURES & OPTIONS FILLS/);
  assert.match(js, /from "\.\/demo-derivative-panel\.mjs"/);
  assert.match(html, /derivative-position\.js/);
  assert.match(html, /derivative-mock-simulator\.js/);
  assert.match(panel, /createDerivativeMockSimulator/);
});

test("Demo execution is manual, synthetic and isolated from production routes", async () => {
  const panel = await read("markets/stocks/demo-derivative-panel.mjs");
  const sw = await read("markets/service-worker.js");
  const gateway = await read("market-gateway/supabase-server.js");
  assert.match(panel, /DEMO DATA · MOCK/);
  assert.match(panel, /credentials:"omit"/);
  assert.match(panel, /processLimitFills/);
  assert.ok(panel.includes("engine.cancel"));
  assert.match(sw, /stocks\/demo-derivative-panel\.mjs/);
  assert.doesNotMatch(gateway, /derivative-mock-simulator|paper-demo-adapter|paper-mock-fixtures/);
});

test("Futures product, option expiry/strike and MARKET/LIMIT controls are exposed", async () => {
  const panel = await read("markets/stocks/demo-derivative-panel.mjs");
  assert.match(panel, /INTRADAY/);
  assert.match(panel, /DELIVERY/);
  assert.match(panel, /optionType/);
  assert.match(panel, /expiry/);
  assert.match(panel, /strike/);
  assert.match(panel, /MARKET/);
  assert.match(panel, /LIMIT/);
});


test("Demo controls retain native labels, mobile breakpoints and PWA shell coverage", async () => {
  const panel = await read("markets/stocks/demo-derivative-panel.mjs");
  const css = await read("markets/stocks/demo.css");
  const html = await read("markets/stocks/demo.html");
  const sw = await read("markets/service-worker.js");

  // Every input/select is nested in a native label so assistive technology
  // can identify its purpose without relying on placeholder text.
  assert.match(panel, /const field=\(label,node\)=>\{const l=el\("label","demo-fo-field",label\);l\.append\(node\);return l;\}/);
  for (const control of ["contract", "expiry", "optionType", "strike", "side", "orderType", "lots", "product", "limit"]) {
    assert.match(panel, new RegExp("field\\([^\\n]*" + control + "\\)"));
  }
  assert.match(panel, /limit\.disabled=true/);
  assert.match(panel, /limit\.disabled=orderType\.value!=="LIMIT"/);
  assert.match(panel, /cancel\.addEventListener\("click"/);

  // Responsive rules must cover tablet and narrow-phone widths.
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /\.demo-fo-controls\{grid-template-columns:1fr\}/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);

  // The PWA shell must cache the exact simulator assets, not just the parent page.
  assert.match(sw, /stocks\/demo-derivative-panel\.mjs/);
  assert.match(sw, /stocks\/derivative-mock-simulator\.js/);
  assert.match(sw, /mock\/fixtures\/derivatives\.json/);
});

test("PWA shell cache manifest contains no duplicate request URLs", async () => {
  const sw = await read("markets/service-worker.js");
  const match = sw.match(/const SHELL=\[([\s\S]*?)\]\.map\(path=>new URL\(path,BASE\)\.toString\(\)\);/);
  assert.ok(match, "service-worker shell manifest must remain statically auditable");
  const paths = [...match[1].matchAll(/"([^"]*)"/g)].map(entry => entry[1]);
  assert.ok(paths.length > 0, "PWA shell must include assets");
  assert.equal(new Set(paths).size, paths.length, "cache.addAll must not receive duplicate asset URLs");
});
