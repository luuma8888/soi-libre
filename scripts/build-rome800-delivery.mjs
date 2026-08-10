import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "creations", "boussolepro");
const OUTPUT_DIR = path.resolve(ROOT, process.env.ROME800_DELIVERY_DIR || "tmp/monde-pro/livraison-boussole-pro-v0.8.1-alpha-rome800");

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await copy("boussole-pro.html", "boussole-pro.html");
  await copy("data/generated/rome800-candidate", "data/generated/rome800-candidate");
  await copy("data/generated/market", "data/generated/market");
  await copy("data/local", "data/local");
  const files = (await walk(OUTPUT_DIR))
    .filter(file => path.basename(file) !== "manifest.sha256.json")
    .sort();
  const entries = await Promise.all(files.map(async file => {
    const buffer = await readFile(file);
    return { relativePath: path.relative(OUTPUT_DIR, file).replaceAll(path.sep, "/"), size: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  }));
  const [runtime, market] = await Promise.all([
    readJson(path.join(OUTPUT_DIR, "data/generated/rome800-candidate/runtime-bundle-manifest.json")),
    readJson(path.join(OUTPUT_DIR, "data/generated/market/market-package-identity.json"))
  ]);
  const manifest = {
    schemaVersion: "1.0.0", manifestKind: "boussole_pro_rome800_delivery", generatedAt: new Date().toISOString(),
    appVersion: "v0.8.1-alpha", datasetVersion: runtime.datasetIdentity?.sourceDatasetVersion,
    runtimeBundleIdentity: { revision: runtime.runtimeBundleRevision, fingerprintSha256: runtime.fingerprintSha256 },
    marketLayerIdentity: { revision: market.marketContractRevision, fingerprintSha256: market.packageFingerprintSha256 },
    filesCount: entries.length, files: entries,
    privacy: "Paquet statique hors ligne, sans profil utilisateur, jeton ni secret."
  };
  await writeFile(path.join(OUTPUT_DIR, "manifest.sha256.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Livraison ROME800 préparée : ${entries.length} fichiers dans ${path.relative(ROOT, OUTPUT_DIR)}.`);
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
main().catch(error => { console.error(error); process.exit(1); });
