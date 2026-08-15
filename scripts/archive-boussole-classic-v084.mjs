import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_ROOT = path.join(ROOT, "creations/boussolepro");
const OUTPUT = path.resolve(process.argv[2] || path.join(ROOT, "tmp/monde-pro/livraison-boussole-pro-v0.8.4-classic-frozen"));
const AUDIT_DIR = path.resolve(process.env.BOUSSOLE_PROOF_DIR || path.join(ROOT, "tmp/monde-pro/audit-v0.8.4-closure-final"));
const FINAL_REPORT = path.resolve(process.env.BOUSSOLE_FINAL_REPORT || path.join(ROOT, "tmp/monde-pro/AUDIT_BOUSSOLE_PRO_CLOTURE_DEFINITIVE_V0_8_4.md"));
const MARKET_DIR = path.join(APP_ROOT, "data/generated/market");
const run = promisify(execFile);
const MARKET_ARCHIVE_EXCLUSIONS = new Set([
  "sync-error.json",
  "market-etape-lasuite.zip",
  "market-fap-enrichment.rome500.json",
  "market-fap-enrichment.rome800.json"
]);

try {
  const existing = await readdir(OUTPUT);
  if (existing.length) throw new Error(`Le dossier de livraison doit être neuf ou vide : ${OUTPUT}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const requiredSources = [
  [path.join(APP_ROOT, "boussole-pro.html"), "app/boussole-pro.html"],
  [path.join(APP_ROOT, "data/generated/active-runtime.json"), "app/data/generated/active-runtime.json"],
  [path.join(APP_ROOT, "data/generated/rome1000-candidate"), "app/data/generated/rome1000-candidate"],
  [path.join(APP_ROOT, "data/generated/market"), "app/data/generated/market"],
  [path.join(APP_ROOT, "data/local"), "app/data/local"],
  [AUDIT_DIR, "reports"],
  [FINAL_REPORT, "reports/AUDIT_BOUSSOLE_PRO_CLOTURE_DEFINITIVE_V0_8_4.md"],
  [path.join(ROOT, "scripts/boussole-build-metadata.mjs"), "scripts/boussole-build-metadata.mjs"],
  [path.join(ROOT, "scripts/boussole-runtime-identity.mjs"), "scripts/boussole-runtime-identity.mjs"],
  [path.join(ROOT, "scripts/boussole-semantic-v084-core.mjs"), "scripts/boussole-semantic-v084-core.mjs"],
  [path.join(ROOT, "scripts/validate-boussole-semantic-v084.mjs"), "scripts/validate-boussole-semantic-v084.mjs"],
  [path.join(ROOT, "scripts/validate-boussole-v073.mjs"), "scripts/validate-boussole-v073.mjs"],
  [path.join(ROOT, "scripts/test-boussole-compact-roundtrip.mjs"), "scripts/test-boussole-compact-roundtrip.mjs"],
  [path.join(ROOT, "scripts/measure-boussole-rome500-browser.mjs"), "scripts/measure-boussole-rome500-browser.mjs"],
  [path.join(ROOT, "scripts/build-boussole-v084-closure-proofs.mjs"), "scripts/build-boussole-v084-closure-proofs.mjs"],
  [path.join(ROOT, "scripts/archive-boussole-classic-v084.mjs"), "scripts/archive-boussole-classic-v084.mjs"]
];

for (const [source, relativeTarget] of requiredSources) {
  const target = path.join(OUTPUT, relativeTarget);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: sourcePath => !sourcePath.startsWith(`${MARKET_DIR}${path.sep}`) || !MARKET_ARCHIVE_EXCLUSIONS.has(path.basename(sourcePath))
  });
}

const activeRuntime = JSON.parse(await readFile(path.join(APP_ROOT, "data/generated/active-runtime.json"), "utf8"));
const sourceCommit = process.env.BOUSSOLE_SOURCE_COMMIT || "";
const sourceTag = process.env.BOUSSOLE_SOURCE_TAG || "";
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("BOUSSOLE_SOURCE_COMMIT doit contenir le SHA Git complet figé.");
if (!sourceTag) throw new Error("BOUSSOLE_SOURCE_TAG doit contenir le tag final réellement utilisé.");
const currentCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
const taggedCommit = (await run("git", ["rev-list", "-n", "1", sourceTag], { cwd: ROOT })).stdout.trim();
if (currentCommit !== sourceCommit || taggedCommit !== sourceCommit) {
  throw new Error(`Source non figée : HEAD=${currentCommit}, tag=${taggedCommit}, attendu=${sourceCommit}.`);
}
const metadata = {
  schemaVersion: "1.0.0",
  deliveryKind: "boussole_pro_classic_frozen",
  version: activeRuntime.appSource?.appVersion || "v0.8.4",
  gitTag: sourceTag,
  sourceBranch: process.env.BOUSSOLE_SOURCE_BRANCH || "soi-libre-codex",
  sourceCommit,
  generatedAt: new Date().toISOString(),
  applicationSource: activeRuntime.appSource,
  runtime: {
    datasetVersion: activeRuntime.runtime?.datasetVersion,
    jobs: activeRuntime.runtime?.expectedCounts?.jobs,
    fingerprintSha256: activeRuntime.runtime?.runtimeBundleFingerprintSha256
  },
  market: {
    fingerprintSha256: activeRuntime.market?.packageFingerprintSha256,
    coverage: activeRuntime.market?.coverage,
    counts: activeRuntime.market?.counts
  },
  notes: [
    "Photographie autonome de la dernière interface classique avant refonte.",
    "Le HTML contient son repli embarqué hors ligne et les paquets JSON exacts sont inclus dans app/data.",
    "L’archive a été générée depuis le commit exact désigné par gitTag et sourceCommit.",
    "Les rapports not_measured antérieurs ne font pas partie du paquet de preuves final."
  ],
  excludedHistoricalArtifacts: [...MARKET_ARCHIVE_EXCLUSIONS].sort()
};
await writeFile(path.join(OUTPUT, "FREEZE_METADATA.json"), `${JSON.stringify(metadata, null, 2)}\n`);

const files = await listFiles(OUTPUT);
const entries = [];
for (const file of files.filter(file => path.basename(file) !== "SHA256SUMS")) {
  const buffer = await readFile(file);
  entries.push(`${createHash("sha256").update(buffer).digest("hex")}  ${path.relative(OUTPUT, file).split(path.sep).join("/")}`);
}
entries.sort();
await writeFile(path.join(OUTPUT, "SHA256SUMS"), `${entries.join("\n")}\n`);

for (const entry of entries) {
  const [expected, relative] = entry.split(/\s{2}/);
  const actual = createHash("sha256").update(await readFile(path.join(OUTPUT, relative))).digest("hex");
  if (actual !== expected) throw new Error(`Empreinte invalide après relecture indépendante : ${relative}`);
}

const totalBytes = await directorySize(OUTPUT);
console.log(JSON.stringify({ status: "ok", output: OUTPUT, files: entries.length + 1, totalBytes, metadata }, null, 2));

async function listFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(target));
    else output.push(target);
  }
  return output;
}

async function directorySize(directory) {
  let bytes = 0;
  for (const file of await listFiles(directory)) bytes += (await stat(file)).size;
  return bytes;
}
