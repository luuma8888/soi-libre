import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const deliveryDir = path.resolve(process.argv[2] || path.join(ROOT, "tmp", "monde-pro", "livraison-boussole-pro-v0.7.7-alpha-20260802-market-phase1-01"));
const manifest = await readJson(path.join(deliveryDir, "manifest.sha256.json"));
const failures = [];

for (const file of manifest.files || []) {
  const filePath = path.join(deliveryDir, file.relativePath);
  try {
    const buffer = await readFile(filePath);
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash !== file.sha256) failures.push(`sha256:${file.relativePath}`);
    if (buffer.length !== file.size) failures.push(`size:${file.relativePath}`);
  } catch {
    failures.push(`missing:${file.relativePath}`);
  }
}

const required = [
  "boussole-pro.html",
  "runtime-bundle-identity.json",
  "data/generated/rome500-experimental/jobs.rome.json",
  "data/generated/rome500-experimental/skills-engine.rome.json",
  "data/generated/market/market-package-identity.json",
  "data/generated/market/market-contract.json",
  "data/generated/market/bmo-fap2021.json",
  "data/generated/market/dares-tension-fap2021.json",
  "market-truth-cases-report.json",
  "market-influence-and-performance-audit.json"
];
const listed = new Set((manifest.files || []).map(file => file.relativePath));
for (const file of required) if (!listed.has(file)) failures.push(`manifest_missing:${file}`);

const [html, runtime, market] = await Promise.all([
  readFile(path.join(deliveryDir, "boussole-pro.html"), "utf8"),
  readJson(path.join(deliveryDir, "runtime-bundle-identity.json")),
  readJson(path.join(deliveryDir, "data", "generated", "market", "market-package-identity.json"))
]);
if (!html.includes('appVersion: "v0.7.7-alpha"') || !html.includes('buildId: "20260802-market-phase1-01"')) failures.push("html_build_marker");
if (runtime.fingerprintSha256 !== manifest.runtimeBundleIdentity?.fingerprintSha256) failures.push("runtime_identity_mismatch");
if (market.packageFingerprintSha256 !== manifest.marketLayerIdentity?.packageFingerprintSha256) failures.push("market_identity_mismatch");
if (/FT_CLIENT_SECRET\s*[:=]\s*["'][^"']+/i.test(html)) failures.push("secret_in_html");

const verdict = failures.length ? "failed" : "passed";
console.log(JSON.stringify({ verdict, deliveryDir, filesChecked: manifest.files?.length || 0, runtimeFingerprint: runtime.fingerprintSha256, marketFingerprint: market.packageFingerprintSha256, failures }, null, 2));
if (failures.length) process.exitCode = 1;

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
