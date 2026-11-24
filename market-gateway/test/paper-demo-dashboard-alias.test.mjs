import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root = new URL("../../markets/dashboard/", import.meta.url);
test("legacy dashboard URL redirects to the canonical 15-screen demo", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /location\.replace\("\.\.\/stocks\/demo\.html"\s*\+\s*window\.location\.hash\)/);
  assert.match(html, /href="\.\.\/stocks\/demo\.html"/);
  assert.doesNotMatch(html, /dashboard\.js|mock-data\.json|paper-demo-adapter/);
});
test("canonical demo route remains the only active browser demo entry point", async () => {
  const html = await readFile(new URL("../stocks/demo.html", root), "utf8");
  const js = await readFile(new URL("../stocks/demo.js", root), "utf8");
  for (const screen of ["home","market","watchlists","charts","equity","futures","options","orders","trades","portfolio","positions","holdings","account","profile","settings"]) {
    assert.match(html, new RegExp('data-screen="' + screen + '"'));
  }
  assert.match(js, /createPaperDemoViewModel\(\{market,account,equity,derivatives\},\{enabled:true,production:false\}\)/);
});
