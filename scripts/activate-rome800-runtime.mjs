import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const ROME_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome800-candidate");
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");

async function main() {
  const [html, runtime, market, manifest] = await Promise.all([
    readFile(HTML_PATH, "utf8"), readJson(path.join(ROME_DIR, "runtime-bundle-manifest.json")),
    readJson(path.join(MARKET_DIR, "market-package-identity.json")), readJson(path.join(ROME_DIR, "import-manifest.rome.json"))
  ]);
  const values = {
    appVersion: "v0.8.1-alpha",
    buildId: process.env.RUNTIME_BUILD_ID || "20260810-rome800-market-continuity-01",
    buildDate: process.env.RUNTIME_BUILD_DATE || "2026-08-10",
    defaultDatasetVersion: manifest.datasetVersion || "rome800-candidate-v0.1",
    runtimeBundleRevision: runtime.runtimeBundleRevision || "rome800-runtime-v0.1-r1",
    runtimeBundleFingerprintSha256: runtime.fingerprintSha256,
    marketPackageFingerprintSha256: market.packageFingerprintSha256,
    validationScope: "validated_for_boussole_pro_v0_8",
    testProfilesRevision: "integrated-12-v0.8.1"
  };
  const counts = runtime.counts || {};
  let next = replaceBuildInfo(html, values);
  next = replaceNumericBuildInfo(next, {
    expectedJobsCount: counts.jobs,
    expectedSkillsEngineCount: counts.skillsEngine,
    expectedAccessSummaryCount: counts.accessSummary
  });
  await writeFile(HTML_PATH, next, "utf8");
  console.log(`[Boussole Pro] Runtime ROME800 activé : ${values.buildId}, empreinte ${values.runtimeBundleFingerprintSha256}.`);
}

function replaceBuildInfo(html, values) {
  return inBuildInfo(html, block => Object.entries(values).reduce((text, [key, value]) => {
    if (!value) throw new Error(`Valeur BUILD_INFO absente : ${key}.`);
    const pattern = new RegExp(`(${key}:\\s*)["'][^"']*["']`);
    if (!pattern.test(text)) throw new Error(`Champ BUILD_INFO introuvable : ${key}.`);
    return text.replace(pattern, `$1${JSON.stringify(value)}`);
  }, block));
}

function replaceNumericBuildInfo(html, values) {
  return inBuildInfo(html, block => Object.entries(values).reduce((text, [key, value]) => {
    if (!Number.isFinite(Number(value))) throw new Error(`Compteur BUILD_INFO invalide : ${key}.`);
    const pattern = new RegExp(`(${key}:\\s*)\\d+`);
    if (!pattern.test(text)) throw new Error(`Compteur BUILD_INFO introuvable : ${key}.`);
    return text.replace(pattern, `$1${Number(value)}`);
  }, block));
}

function inBuildInfo(html, transform) {
  const start = html.indexOf("const BUILD_INFO = Object.freeze({");
  const end = html.indexOf("});", start);
  if (start < 0 || end < 0) throw new Error("Bloc BUILD_INFO introuvable.");
  return `${html.slice(0, start)}${transform(html.slice(start, end + 3))}${html.slice(end + 3)}`;
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
main().catch(error => { console.error(error); process.exit(1); });
