"use strict";

import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Keep this list aligned with actual Express GET routes. /paper/account is
// intentionally excluded: its handler invokes initialize_paper_trading_account,
// which may create/write an account and is therefore not a read-only load target.
export const READ_ONLY_PATHS = Object.freeze([
  "/health", "/instruments", "/paper/orders", "/paper/portfolio",
  "/paper/derivative/orders", "/paper/derivatives/portfolio", "/paper/futures/orders",
  "/paper/futures/portfolio", "/watchlists"
]);
const PRIVATE_PATHS = new Set(READ_ONLY_PATHS.filter(path => !["/health", "/instruments"].includes(path)));
const CONFIRMATION = "DISPOSABLE_OR_APPROVED_STAGING";

export function parseStages(value = "10,25,50,100,250,500") {
  const stages = String(value).split(",").map(part => Number(part.trim()));
  if (!stages.length || stages.some(n => !Number.isInteger(n) || n < 1 || n > 500))
    throw new Error("LOAD_STAGES must be ascending comma-separated integers from 1 to 500.");
  if (stages.some((n, i) => i > 0 && n <= stages[i - 1]))
    throw new Error("LOAD_STAGES must be strictly ascending.");
  return stages;
}
function isPrivateIpv4(host) {
  const p = host.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}
export function validateTarget(rawUrl, targetEnv, allowlist = "") {
  if (!["disposable", "staging"].includes(targetEnv)) throw new Error("TARGET_ENV must be exactly disposable or staging.");
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("BASE_URL must be a valid absolute URL."); }
  if (url.username || url.password || url.search || url.hash) throw new Error("BASE_URL must not contain credentials, query parameters or a fragment.");
  const host = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
  if (targetEnv === "disposable") {
    const local = ["localhost", "127.0.0.1", "::1"].includes(host) || isPrivateIpv4(host) || host.endsWith(".test") || host.endsWith(".local");
    if (!local) throw new Error("Disposable runs are restricted to localhost, private IPv4, .test or .local hosts.");
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Disposable BASE_URL must use HTTP or HTTPS.");
  } else {
    const allowed = String(allowlist).split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    if (url.protocol !== "https:" || !allowed.includes(host)) throw new Error("Staging runs require HTTPS and an exact hostname in STAGING_HOST_ALLOWLIST.");
  }
  return url;
}
export function parsePaths(value = "/health") {
  const paths = String(value).split(",").map(x => x.trim()).filter(Boolean);
  if (!paths.length || paths.some(path => !READ_ONLY_PATHS.includes(path)))
    throw new Error("LOAD_PATHS may contain only documented, side-effect-free GET paths.");
  return [...new Set(paths)];
}
export function summarize(samples, elapsedMs, vus) {
  const latencies = samples.map(x => x.latencyMs).sort((a, b) => a - b);
  const percentile = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)] : null;
  const statuses = {};
  let errors = 0;
  for (const sample of samples) {
    if (sample.status === null || sample.status < 200 || sample.status >= 300) errors++;
    if (sample.status !== null) statuses[sample.status] = (statuses[sample.status] || 0) + 1;
  }
  return {
    vus, requests: samples.length,
    requestsPerSecond: elapsedMs > 0 ? Number((samples.length * 1000 / elapsedMs).toFixed(2)) : 0,
    errorRatePercent: samples.length ? Number((errors * 100 / samples.length).toFixed(2)) : 0,
    latencyMs: { p50: percentile(0.50), p95: percentile(0.95), p99: percentile(0.99), max: latencies.length ? latencies.at(-1) : null },
    statusCounts: statuses, transportErrors: samples.filter(x => x.status === null).length
  };
}
function loadTokens(filePath, needed) {
  if (!needed) return [];
  if (!filePath) throw new Error("AUTH_TOKEN_FILE is required when any authenticated read path is selected.");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.some(token =>
    typeof token !== "string" || token.length < 40 || token.split(".").length !== 3))
    throw new Error("AUTH_TOKEN_FILE must contain a JSON array of JWT strings; token values are never printed.");
  return parsed;
}
function safeConfig(env) {
  if (env.ZENURA_LOAD_TEST_CONFIRM !== CONFIRMATION) throw new Error("Set ZENURA_LOAD_TEST_CONFIRM=DISPOSABLE_OR_APPROVED_STAGING to acknowledge the target boundary.");
  const baseUrl = validateTarget(env.BASE_URL, env.TARGET_ENV, env.STAGING_HOST_ALLOWLIST || "");
  const paths = parsePaths(env.LOAD_PATHS || "/health");
  const stages = parseStages(env.LOAD_STAGES);
  const durationSeconds = Number(env.STAGE_SECONDS || 10);
  const timeoutMs = Number(env.REQUEST_TIMEOUT_MS || 10000);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) throw new Error("STAGE_SECONDS must be an integer from 1 to 60.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30000) throw new Error("REQUEST_TIMEOUT_MS must be an integer from 250 to 30000.");
  const tokens = loadTokens(env.AUTH_TOKEN_FILE, paths.some(path => PRIVATE_PATHS.has(path)));
  return { baseUrl, paths, stages, durationSeconds, timeoutMs, tokens };
}
export async function runLoadTest(env = process.env, fetchImpl = fetch, output = console.log) {
  const config = safeConfig(env);
  const results = [];
  output(JSON.stringify({ event: "load_test_start", targetEnv: env.TARGET_ENV, host: config.baseUrl.host,
    paths: config.paths, stages: config.stages, stageSeconds: config.durationSeconds,
    tokenCount: config.tokens.length, method: "GET",
    note: "No request bodies, writes, order submissions or credentials are emitted." }));
  for (const vus of config.stages) {
    const started = Date.now(), deadline = started + config.durationSeconds * 1000;
    const samples = [];
    let nextPath = 0;
    const workers = Array.from({ length: vus }, async (_, vu) => {
      while (Date.now() < deadline) {
        const path = config.paths[nextPath++ % config.paths.length];
        const url = new URL(path, config.baseUrl);
        const headers = { Accept: "application/json" };
        if (PRIVATE_PATHS.has(path)) {
          headers.Authorization = "Bearer " + config.tokens[vu % config.tokens.length];
          if (env.SUPABASE_PUBLISHABLE_KEY) headers.apikey = env.SUPABASE_PUBLISHABLE_KEY;
        }
        const requestStarted = performance.now();
        try {
          const response = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(config.timeoutMs), redirect: "error" });
          samples.push({ status: response.status, latencyMs: Number((performance.now() - requestStarted).toFixed(2)) });
          if (response.body) await response.body.cancel().catch(() => {});
        } catch {
          samples.push({ status: null, latencyMs: Number((performance.now() - requestStarted).toFixed(2)) });
        }
      }
    });
    await Promise.all(workers);
    const elapsedMs = Date.now() - started;
    const result = { stage: results.length + 1, ...summarize(samples, elapsedMs, vus), elapsedMs };
    results.push(result);
    output(JSON.stringify({ event: "load_test_stage", ...result }));
  }
  const final = { event: "load_test_complete", targetEnv: env.TARGET_ENV, host: config.baseUrl.host,
    totalRequests: results.reduce((n, x) => n + x.requests, 0), stages: results };
  output(JSON.stringify(final));
  return final;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLoadTest().catch(error => { console.error("LOAD TEST ABORTED:", error.message); process.exitCode = 1; });
}
