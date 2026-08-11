import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const EXPECTED_COUNT = Number(process.env.RUNTIME_EXPECTED_JOBS_COUNT || 800);
const ROME_SUBDIR = process.env.RUNTIME_ROME_SUBDIR || `rome${EXPECTED_COUNT}-candidate`;
const APP_DIR = path.join(ROOT, "creations", "boussolepro");
const ROME_DIR = path.join(APP_DIR, "data", "generated", ROME_SUBDIR);
const MARKET_DIR = path.join(APP_DIR, "data", "generated", "market");
const OUTPUT_PATH = path.join(APP_DIR, "data", "generated", "active-runtime.json");

export async function main() {
  const [appBuild, runtime, market, sourceManifest] = await Promise.all([
    readBoussoleBuildMetadata(),
    readJson(path.join(ROME_DIR, "runtime-bundle-manifest.json")),
    readJson(path.join(MARKET_DIR, "market-package-identity.json")),
    readJson(path.join(ROME_DIR, "import-manifest.rome.json"))
  ]);
  if (runtime.status !== "coherent" || runtime.counts?.jobs !== EXPECTED_COUNT) {
    throw new Error(`Runtime ROME${EXPECTED_COUNT} incohérent ou incomplet.`);
  }
  const descriptor = {
    schemaVersion: "1.0.0",
    descriptorKind: "boussole_active_runtime",
    generatedAt: new Date().toISOString(),
    appSource: appBuild,
    runtime: {
      basePath: `data/generated/${ROME_SUBDIR}/`,
      marketBasePath: "data/generated/market/",
      label: `Corpus ROME${EXPECTED_COUNT} candidat consolidé`,
      corpusMode: "generated_rome_active",
      expectedJobsCount: EXPECTED_COUNT,
      datasetVersion: sourceManifest.datasetVersion || runtime.datasetIdentity?.sourceDatasetVersion,
      runtimeReleaseId: runtime.runtimeReleaseId || `${runtime.runtimeBundleRevision}-data`,
      runtimeBundleRevision: runtime.runtimeBundleRevision,
      runtimeBundleFingerprintSha256: runtime.fingerprintSha256,
      accessSummaryFilename: process.env.RUNTIME_ACCESS_SUMMARY_FILE || `access-summary.rome${EXPECTED_COUNT}.json`,
      officialConstraintSummaryFilename: process.env.RUNTIME_CONSTRAINT_SUMMARY_FILE || `official-constraint-summary.rome${EXPECTED_COUNT}.json`,
      marketFapEnrichmentFilename: process.env.RUNTIME_MARKET_ENRICHMENT_FILE || `market-fap-enrichment.rome${EXPECTED_COUNT}.json`,
      marketTrendsFilename: process.env.RUNTIME_MARKET_TRENDS_FILE || `market-trends.rome${EXPECTED_COUNT}.json`,
      expectedCounts: runtime.counts,
      ruleVersions: runtime.ruleVersions || {},
      validationScope: runtime.datasetIdentity?.validationScope || "validated_for_boussole_pro_v0_8"
    },
    market: {
      marketContractRevision: market.marketContractRevision,
      temporalContractRevision: market.temporalContractRevision || null,
      packageFingerprintSha256: market.packageFingerprintSha256,
      counts: market.counts || {},
      coverage: market.coverage || {}
    }
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Runtime actif ROME${EXPECTED_COUNT} publié dans les données, application source inchangée.`);
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
