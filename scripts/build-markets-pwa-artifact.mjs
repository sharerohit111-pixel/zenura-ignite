import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "dist", "markets-pwa");
const sourceMarkets = path.join(root, "markets");
const workerPath = path.join(sourceMarkets, "service-worker.js");
const worker = fs.readFileSync(workerPath, "utf8");
const match = worker.match(/const SHELL=\[([\s\S]*?)\]\.map/);
if (!match) throw new Error("Could not read the canonical PWA SHELL allowlist");
const shellPaths = [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
if (!shellPaths.length) throw new Error("PWA shell allowlist is empty");

fs.rmSync(out, { recursive: true, force: true });
const siteRoot = path.join(out, "site");
const outMarkets = path.join(siteRoot, "markets");
fs.mkdirSync(outMarkets, { recursive: true });

const excludedMarketDirectories = new Set(["investing", "crypto", "__tests__", "tests"]);
function copyPublicTree(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && excludedMarketDirectories.has(entry.name.toLowerCase())) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyPublicTree(from, to);
      continue;
    }
    if (!entry.isFile() || /\.test\./i.test(entry.name) || /\.cjs$/i.test(entry.name)) continue;
    if (!/\.(html|css|js|mjs|json|webmanifest|svg)$/i.test(entry.name)) continue;
    fs.copyFileSync(from, to);
  }
}
copyPublicTree(sourceMarkets, outMarkets);

const externalAssets = [...worker.matchAll(/"(..\/market-gateway\/[^"]+)"/g)].map((m) => m[1].slice("../".length));
for (const relative of externalAssets) {
  if (relative.includes("..") || path.isAbsolute(relative)) throw new Error("Unsafe external PWA asset path: " + relative);
}
if (!externalAssets.length) throw new Error("No explicitly allowlisted public demo assets found");

for (const relative of externalAssets) {
  const src = path.join(root, relative);
  const dest = path.join(siteRoot, relative);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error("Missing allowlisted PWA dependency: " + relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

for (const item of shellPaths) {
  if (!item) continue;
  const isExternal = item.startsWith("../market-gateway/");
  const relative = isExternal ? item.slice("../".length) : path.join("markets", item);
  const target = path.join(siteRoot, relative);
  const resolved = item.endsWith("/") ? path.join(target, "index.html") : target;
  if (!fs.existsSync(resolved)) throw new Error("PWA shell dependency missing from artifact: " + item);
}

const artifactFiles = [];
function collectArtifactFiles(dir, prefix = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === "crypto") throw new Error("Crypto directory leaked into public PWA artifact: " + relative);
      collectArtifactFiles(path.join(dir, entry.name), relative);
    } else if (entry.isFile()) {
      artifactFiles.push({ absolute: path.join(dir, entry.name), relative });
    }
  }
}
collectArtifactFiles(siteRoot);
const cryptoPathReference = /(?:\.\.?\/)+crypto\/|(?:^|["'(])\/?crypto\//i;
for (const file of artifactFiles) {
  if (/\.(html|css|js|mjs|json|webmanifest|svg)$/i.test(file.relative)) {
    const source = fs.readFileSync(file.absolute, "utf8");
    if (cryptoPathReference.test(source)) throw new Error("Crypto asset reference found in public PWA artifact: " + file.relative);
  }
}
const gatewayFiles = [];
function walk(dir, prefix = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    else gatewayFiles.push(rel);
  }
}
walk(path.join(siteRoot, "market-gateway"));
const allowed = new Set(externalAssets);
for (const file of gatewayFiles) {
  if (!allowed.has("market-gateway/" + file)) throw new Error("Unexpected backend file leaked into public artifact: " + file);
}
console.log(JSON.stringify({
  output: "dist/markets-pwa/site",
  shellEntries: shellPaths.length,
  copiedMarketGatewayAssets: gatewayFiles.length,
  gatewayAllowlist: gatewayFiles.sort(),
  cryptoReferences: 0,
  deploymentPerformed: false
}, null, 2));
