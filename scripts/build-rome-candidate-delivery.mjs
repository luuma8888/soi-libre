import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const EXPECTED_COUNT = Number(process.env.ROME_DELIVERY_EXPECTED_COUNT || 1000);
const TARGET_SUBDIR = process.env.ROME_DELIVERY_SUBDIR || `rome${EXPECTED_COUNT}-candidate`;
const SOURCE_DIR = path.join(ROOT, "creations", "boussolepro");
const OUTPUT_DIR = path.resolve(ROOT, process.env.ROME_DELIVERY_DIR || `tmp/monde-pro/livraison-boussole-pro-rome${EXPECTED_COUNT}`);

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await copy("boussole-pro.html", "boussole-pro.html");
  await copy(`data/generated/${TARGET_SUBDIR}`, `data/generated/${TARGET_SUBDIR}`);
  await copy("data/generated/market", "data/generated/market");
  await copy("data/generated/active-runtime.json", "data/generated/active-runtime.json");
  await copy("data/local", "data/local");
  const sourceApp = await readFile(path.join(SOURCE_DIR, "boussole-pro.html"));
  const deliveredApp = await readFile(path.join(OUTPUT_DIR, "boussole-pro.html"));
  const sourceAppSha256 = sha256(sourceApp);
  const deliveredAppSha256 = sha256(deliveredApp);
  if (sourceAppSha256 !== deliveredAppSha256) throw new Error("La copie offline de l'application diffère du source du checkout.");
  const files = (await walk(OUTPUT_DIR)).filter(file => path.basename(file) !== "manifest.sha256.json").sort();
  const entries = await Promise.all(files.map(async file => {
    const buffer = await readFile(file);
    return { relativePath: path.relative(OUTPUT_DIR, file).replaceAll(path.sep, "/"), size: buffer.length, sha256: sha256(buffer) };
  }));
  const [appBuild, runtime, market] = await Promise.all([
    readBoussoleBuildMetadata(),
    readJson(path.join(OUTPUT_DIR, `data/generated/${TARGET_SUBDIR}/runtime-bundle-manifest.json`)),
    readJson(path.join(OUTPUT_DIR, "data/generated/market/market-package-identity.json"))
  ]);
  const manifest = {
    schemaVersion: "1.0.0",
    manifestKind: `boussole_pro_rome${EXPECTED_COUNT}_delivery`,
    generatedAt: new Date().toISOString(),
    appVersion: appBuild.appVersion,
    appSourceBoundary: { sourceSha256: sourceAppSha256, deliveredSha256: deliveredAppSha256, verdict: "byte_identical_to_checkout_source" },
    datasetVersion: runtime.datasetIdentity?.sourceDatasetVersion,
    runtimeBundleIdentity: { revision: runtime.runtimeBundleRevision, fingerprintSha256: runtime.fingerprintSha256 },
    marketLayerIdentity: { revision: market.marketContractRevision, fingerprintSha256: market.packageFingerprintSha256 },
    filesCount: entries.length,
    files: entries,
    privacy: "Paquet statique hors ligne, sans profil utilisateur, jeton ni secret."
  };
  await writeFile(path.join(OUTPUT_DIR, "manifest.sha256.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Livraison ROME${EXPECTED_COUNT} préparée : application byte-identique, ${entries.length} fichiers.`);
}

async function copy(source, target) {
  const from = path.join(SOURCE_DIR, source);
  const to = path.join(OUTPUT_DIR, target);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}
async function walk(directory) {
  const entries = await readdir(directory);
  const rows = await Promise.all(entries.map(async name => { const file = path.join(directory, name); return (await stat(file)).isDirectory() ? walk(file) : [file]; }));
  return rows.flat();
}
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
main().catch(error => { console.error(error); process.exit(1); });
