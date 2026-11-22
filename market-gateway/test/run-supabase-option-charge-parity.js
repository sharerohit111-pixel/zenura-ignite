"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const fixturePath = path.join(__dirname, "..", "test", "fixtures", "supabase-option-charge-parity-vectors.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.vectors) || fixture.vectors.length === 0) {
  throw new Error("Unsupported or empty shared option charge vector fixture.");
}

function sqlLiteral(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^[A-Z_]+$/.test(value)) return "'" + value + "'";
  throw new Error("Unsafe fixture SQL value: " + String(value));
}

const queries = fixture.vectors.map((vector) => {
  const input = vector.input;
  if (!["NSE", "BSE"].includes(input.exchange) || !["BUY", "SELL"].includes(input.side)) {
    throw new Error("Unsupported exchange/side in vector " + vector.id);
  }
  const brokerage = input.brokeragePaise === undefined ? 2000 : input.brokeragePaise;
  const values = [
    sqlLiteral(input.grossPaise),
    sqlLiteral(input.exchange),
    sqlLiteral(input.side),
    sqlLiteral(brokerage)
  ];
  return `WITH input AS (
    SELECT ${values[0]}::numeric AS gross, ${values[1]}::text AS exchange,
           ${values[2]}::text AS side, ${values[3]}::numeric AS brokerage
  ), rates AS (
    SELECT *, CASE exchange WHEN 'NSE' THEN 0.0003553::numeric ELSE 0.000325::numeric END AS exchange_rate,
           CASE exchange WHEN 'NSE' THEN 0.000005::numeric ELSE 0::numeric END AS ipft_rate
    FROM input
  ), fees AS (
    SELECT *,
      floor(gross*exchange_rate+0.5)::bigint AS exchange_fee,
      floor(gross*ipft_rate+0.5)::bigint AS ipft,
      floor(gross*0.000001+0.5)::bigint AS sebi,
      CASE WHEN side='BUY' THEN floor(gross*0.00003+0.5)::bigint ELSE 0 END AS stamp,
      CASE WHEN side='SELL' THEN floor(gross*0.0015+0.5)::bigint ELSE 0 END AS stt
    FROM rates
  ), totals AS (
    SELECT *, floor((brokerage+exchange_fee+ipft)*0.18+0.5)::bigint AS gst FROM fees
  )
  SELECT jsonb_build_object(
    'brokeragePaise',brokerage::bigint,
    'exchangeTransactionPaise',exchange_fee,
    'ipftPaise',ipft,'sebiPaise',sebi,'stampDutyPaise',stamp,
    'gstPaise',gst,'sttPaise',stt,
    'totalChargesPaise',brokerage+exchange_fee+ipft+sebi+stamp+gst+stt,
    'totalDebitPaise',CASE WHEN side='BUY' THEN gross+brokerage+exchange_fee+ipft+sebi+stamp+gst+stt ELSE NULL END,
    'netCreditPaise',CASE WHEN side='SELL' THEN gross-(brokerage+exchange_fee+ipft+sebi+stamp+gst+stt) ELSE NULL END
  )::text
  FROM totals`;
}).join("\nUNION ALL\n");

const output = execFileSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", queries], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
}).trim().split(/\r?\n/).filter(Boolean);

if (output.length !== fixture.vectors.length) {
  throw new Error(`Expected ${fixture.vectors.length} PostgreSQL vector results, received ${output.length}.`);
}

for (let i = 0; i < fixture.vectors.length; i += 1) {
  const vector = fixture.vectors[i];
  const actual = JSON.parse(output[i]);
  for (const [field, expected] of Object.entries(vector.expected)) {
    if (actual[field] !== expected) {
      throw new Error(`${vector.id}: ${field} expected ${expected}, got ${actual[field]}`);
    }
  }
  const expectedKeys = Object.keys(vector.expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    throw new Error(`${vector.id}: SQL result field set differs from fixture.`);
  }
  process.stdout.write(`PASS ${vector.id}\n`);
}
process.stdout.write(`PASS all ${fixture.vectors.length} shared PostgreSQL option charge vectors\n`);
