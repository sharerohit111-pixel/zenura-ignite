import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("markets/stocks/index.html", "utf8");
const modal = readFileSync("markets/stocks/broker-connect-modal.js", "utf8");
const referrals = readFileSync("markets/stocks/broker-referrals.js", "utf8");
const connector = readFileSync("markets/stocks/connect.js", "utf8");

test("broker modal markup and scripts are present in safe load order", () => {
  assert.match(html, /id="broker-connect-overlay"/);
  assert.match(html, /data-broker-login-grid/);
  assert.match(html, /data-broker-account-grid/);
  assert.match(html, /data-demo-mode/);
  const referralScript = html.indexOf('<script src="./broker-referrals.js"></script>');
  const modalScript = html.indexOf('<script src="./broker-connect-modal.js"></script>');
  const connectorScript = html.indexOf('<script type="module" src="./connect.js"></script>');
  assert.ok(referralScript >= 0 && modalScript > referralScript);
  assert.ok(connectorScript > modalScript);
});

test("only the approved broker providers and referral destinations are configured", () => {
  for (const provider of ['"upstox"', '"fyers"', '"angel_one"']) {
    assert.ok(modal.includes(provider), `missing provider ${provider}`);
  }
  assert.match(referrals, /https:\/\/upstox\.onelink\.me\//);
  assert.match(referrals, /https:\/\/fyers\.onelink\.me\//);
  assert.match(referrals, /https:\/\/angel-one\.onelink\.me\//);
  assert.doesNotMatch(modal + referrals, /dhan|zerodha/i);
});

test("referral links open safely and show commission disclosure", () => {
  assert.match(modal, /link\.target = "_blank"/);
  assert.match(modal, /noopener noreferrer sponsored/);
  assert.match(html, /S-TRADE may receive a referral commission or benefit/);
});

test("FYERS authorization is restricted to the official HTTPS auth endpoint", () => {
  assert.match(connector, /url\.protocol !== "https:"/);
  assert.match(connector, /url\.hostname !== "api-t1\.fyers\.in"/);
  assert.match(connector, /url\.pathname !== "\/api\/v3\/generate-authcode"/);
});

test("Angel One PIN and TOTP are cleared from fields and local credentials", () => {
  assert.match(modal, /pin\.value = "";\s*totp\.value = ""/);
  assert.match(modal, /credentials\.pin = ""; credentials\.totp = ""/);
  assert.match(modal, /finally \\(\\) => \\{[\\s\\S]*?credentials\\.pin = ""; credentials\\.totp = "";[\\s\\S]*?pin\\.value = ""; totp\\.value = ""/);
});

test("demo action closes the broker modal and requests demo mode without a broker order", () => {
  assert.match(modal, /if \(target\.closest\("\[data-demo-mode\]"\)\)/);
  assert.match(modal, /window\.dispatchEvent\(new CustomEvent\("zenura-demo-mode-requested"\)\)/);
  assert.match(html, /No Broker Login Required/);
});
