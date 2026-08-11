import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_ROOT = path.join(ROOT, "creations/boussolepro");
const OUTPUT = path.resolve(process.argv[2] || path.join(ROOT, "tmp/monde-pro/livraison-boussole-pro-v0.8.4-classic-frozen"));
const AUDIT_DIR = path.join(ROOT, "tmp/monde-pro/audit-v0.8.4");
const FINAL_REPORT = path.join(ROOT, "tmp/monde-pro/AUDIT_BOUSSOLE_PRO_CONSOLIDATION_SEMANTIQUE_V0_8_4.md");

const requiredSources = [
  [path.join(APP_ROOT, "boussole-pro.html"), "app/boussole-pro.html"],
  [path.join(APP_ROOT, "data/generated/active-runtime.json"), "app/data/generated/active-runtime.json"],
  [path.join(APP_ROOT, "data/generated/rome1000-candidate"), "app/data/generated/rome1000-candidate"],
  [path.join(APP_ROOT, "data/generated/market"), "app/data/generated/market"],
  [path.join(APP_ROOT, "data/local"), "app/data/local"],
  [AUDIT_DIR, "reports"],
  [FINAL_REPORT, "reports/AUDIT_BOUSSOLE_PRO_CONSOLIDATION_SEMANTIQUE_V0_8_4.md"]
];

for (const [source, relativeTarget] of requiredSources) {
  const target = path.join(OUTPUT, relativeTarget);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

const activeRuntime = JSON.parse(await readFile(path.join(APP_ROOT, "data/generated/active-runtime.json"), "utf8"));
const metadata = {
  schemaVersion: "1.0.0",
  deliveryKind: "boussole_pro_classic_frozen",
  version: "v0.8.4-alpha",
  proposedGitTag: "v0.8.4-classic-frozen",
  proposedArchiveBranch: "archive/boussole-pro-v0.8.4-classic-frozen",
  sourceBranch: "soi-libre-codex",
  sourceCommit: process.env.BOUSSOLE_SOURCE_COMMIT || "pending_commit",
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
    "Le tag et la branche d'archive restent à créer après le commit fonctionnel validé."
  ]
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
