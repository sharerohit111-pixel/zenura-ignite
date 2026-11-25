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
  assert.match(panel, /CANONICAL FUTURES & OPTIONS POSITIONS/);
  assert.match(panel, /CANONICAL FUTURES & OPTIONS FILLS/);
  assert.match(js, /from "\.\/demo-derivative-panel\.mjs"/);
  assert.match(html, /derivative-position\.js/);
  assert.match(html, /derivative-mock-simulator\.js/);
  assert.match(panel, /createDerivativeMockSimulator/);
  assert.match(panel, /createDerivativeDemoLedgerBridge/);
  assert.match(panel, /ledgerBridge\\.snapshot/);
  const positionHelper=await read("market-gateway/lib/derivative-position.js");
  assert.match(positionHelper,/root\.ZENURA_DERIVATIVE_POSITION=api/);
  assert.match(positionHelper,/typeof module==="object"&&module\.exports/);
});

test("Demo execution is manual, synthetic and isolated from production routes", async () => {
  const panel = await read("markets/stocks/demo-derivative-panel.mjs");
  const sw = await read("markets/service-worker.js");
  const gateway = await read("market-gateway/supabase-server.js");
  assert.match(panel, /DEMO DATA · MOCK/);
  assert.match(panel, /credentials:"omit"/);
  assert.match(panel, /processLimitFills/);
  assert.ok(panel.includes("ledgerBridge.cancel"));
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

test("PWA shell serves explicitly cached root-level Demo assets offline and rejects private navigations", async () => {
  const sw = await read("markets/service-worker.js");
  assert.ok(sw.includes("const shellAsset=SHELL.includes(url.toString())"));
  assert.ok(sw.includes("!url.pathname.startsWith(BASE.pathname)&&!shellAsset"));
  assert.ok(sw.includes('if(request.mode==="navigate"){'));
  assert.ok(sw.includes("if(!shellAsset)return;"), "non-allowlisted navigation must never enter the offline cache");
  assert.ok(sw.includes('url.pathname.endsWith(".webmanifest")'));
  assert.ok(sw.includes('"../market-gateway/lib/derivative-position.js"'));
  assert.ok(sw.includes('"../market-gateway/mock/fixtures/derivatives.json"'));
});

test("PWA shell cache manifest contains no duplicate request URLs", async () => {
  const sw = await read("markets/service-worker.js");
  const start = sw.indexOf("const SHELL=[");
  const end = sw.indexOf("].map(path=>new URL(path,BASE).toString());", start);
  assert.ok(start >= 0 && end > start, "service-worker shell manifest must remain statically auditable");
  const paths = [...sw.slice(start, end).matchAll(/"([^"]*)"/g)].map(entry => entry[1]);
  assert.ok(paths.length > 0, "PWA shell must include assets");
  assert.equal(new Set(paths).size, paths.length, "cache.addAll must not receive duplicate asset URLs");
});

test("Standalone Demo exposes the shared persistent Hindi/English language toggle", async () => {
  const html = await read("markets/stocks/demo.html");
  const css = await read("markets/stocks/demo.css");
  const language = await read("markets/language-toggle.js");
  assert.match(html, /id="paper-language-toggle"/);
  assert.match(html, /src="\.\.\/language-toggle\.js"/);
  assert.match(css, /\.paper-language-toggle\{position:fixed/);
  assert.match(language, /"FUTURES · LOCAL PAPER SIMULATOR"/);
  assert.match(language, /"SIMULATE LIMIT MATCH"/);
  assert.match(language, /"DEMO ORDER RECEIPTS"/);
  assert.doesNotThrow(() => new Function(language), "shared language-toggle script must remain valid JavaScript");
  assert.match(language, /localStorage\.setItem\(KEY,language\)/, "language choice must persist across reloads");
});
