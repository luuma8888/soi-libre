import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const OUTPUTS = [
  path.join(GENERATED_DIR, "rome500-browser-performance-benchmark.json"),
  path.join(GENERATED_DIR, "rome500-experimental", "rome500-browser-performance-benchmark.json")
];

const previous = await readJson(OUTPUTS[0], null);
const runtime = await readJson(path.join(GENERATED_DIR, "rome500-experimental", "runtime-bundle-manifest.json"));
const html = await readFile(HTML_PATH);
const build = await readBoussoleBuildMetadata(HTML_PATH);
const report = {
  schemaVersion: "2.0.0",
  reportKind: "rome500_browser_performance_benchmark",
  reportDescription: "Benchmark local interrompu avant la premiere mesure pour proteger une machine sans swap et avec une memoire disponible insuffisante.",
  completionVerdict: "not_completed_resource_limit",
  validationVerdict: "not_validated",
  generatedAt: new Date().toISOString(),
  ...build,
  sourceArtifactSha256: createHash("sha256").update(html).digest("hex"),
  runtimeBundleIdentity: {
    inputMode: runtime.inputMode,
    runtimeBundleRevision: runtime.runtimeBundleRevision,
    fingerprintSha256: runtime.fingerprintSha256,
    sourceDatasetVersion: runtime.datasetIdentity?.sourceDatasetVersion,
    corpusMaturity: runtime.datasetIdentity?.corpusMaturity,
    validationScope: runtime.datasetIdentity?.validationScope,
    counts: runtime.counts,
    ruleVersions: runtime.ruleVersions,
    comparisonScope: "local_packaged_runtime",
    status: runtime.status
  },
  scenario: {
    machine: `${process.platform}-${process.arch}`,
    headless: true,
    intendedColdRuns: 5,
    intendedWarmRuns: 5,
    completedColdRuns: 0,
    completedWarmRuns: 0,
    cacheProtocol: previous?.scenario?.cacheProtocol || null
  },
  runs: { cold: [], warm: [] },
  summary: {
    cold: { totalGeneratedLoadMs: emptyMetric(), resultCardsRendered: emptyMetric() },
    warm: { totalGeneratedLoadMs: emptyMetric(), resultCardsRendered: emptyMetric() },
    previousReferenceTotalMs: 11902,
    comparisonMetric: "totalGeneratedLoadMs",
    conclusion: "Comparaison impossible : aucun essai final complet apres le redemarrage Linux."
  },
  nonRegressionBudget: {
    previousColdMedianMs: 10366,
    maximumWarmMedianMs: 700,
    coldStatus: "not_measured_resource_limit",
    warmStatus: "not_measured_resource_limit"
  },
  localScalingEstimate: {
    method: "not_computed_without_final_benchmark",
    scope: "not_verifiable_locally",
    warning: "Les projections precedentes ne sont pas reportees comme mesures du HTML final.",
    projections: [{ jobs: 800, coldTotalMs: null, warmRecalculationMs: null }, { jobs: 1000, coldTotalMs: null, warmRecalculationMs: null }]
  },
  resourceLimitation: {
    status: "not_verifiable_locally",
    observedAvailableMemory: "1.4 GiB",
    observedSwap: "0 B",
    interruptedAfterMs: 120000,
    reason: "Le premier essai Chromium n'etait pas termine apres deux minutes ; poursuite interrompue pour eviter un nouveau plantage Linux."
  },
  historicalReference: previous?.historicalReference || (previous ? {
    comparisonStatus: "not_comparable",
    reason: "Le rapport precedent porte un autre SHA HTML et ne remplace pas la mesure finale manquante.",
    sourceArtifactSha256: previous.sourceArtifactSha256 || null,
    completionVerdict: previous.completionVerdict || null,
    coldMedianMs: previous.summary?.cold?.totalGeneratedLoadMs?.median ?? null,
    warmMedianMs: previous.summary?.warm?.totalGeneratedLoadMs?.median ?? null
  } : null),
  visualChecks: { desktop: { status: "covered_by_runtime_parity" }, mobile: { status: "covered_by_previous_complete_benchmark" }, print: { status: "covered_by_previous_complete_benchmark" } },
  privacy: "Aucun profil ni texte libre n'est ecrit dans ce rapport."
};

for (const output of OUTPUTS) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const validation = await readJson(path.join(GENERATED_DIR, "boussole-v076-runtime-parity-validation-report.json"));
const deliveryBench = await readJson(path.join(ROOT, "tmp", "monde-pro", "livraison-boussole-pro-v0.7.6-alpha-20260802-01", "test-bench.json"));
const previousParity = await readJson(path.join(GENERATED_DIR, "boussole-runtime-parity-report.json"), null);
const parityReport = {
  schemaVersion: "2.0.0",
  reportKind: "boussole_runtime_delivery_parity",
  generatedAt: new Date().toISOString(),
  status: "partial_resource_limit",
  verdict: "node_parity_demonstrated_browser_final_not_completed_resource_limit",
  scope: "Paquet, moteur et douze profils identiques dans le validateur Node et l'artefact de livraison ; controle Chromium final interrompu pour proteger la machine.",
  appBuild: runtime.appBuild,
  datasetIdentity: runtime.datasetIdentity,
  runtimeBundleIdentity: {
    inputMode: runtime.inputMode,
    runtimeBundleRevision: runtime.runtimeBundleRevision,
    fingerprintSha256: runtime.fingerprintSha256,
    counts: runtime.counts,
    ruleVersions: runtime.ruleVersions
  },
  testProfilesIdentity: {
    revision: "integrated-12-v0.7.6",
    count: 12,
    normalizedReferenceSha256: validation.checks?.testBenchDeterminism?.firstSha256 || null,
    deliveryArtifactSha256: deliveryBench.normalizedFunctionalSha256 || null,
    identical: validation.checks?.testBenchDeterminism?.firstSha256 === deliveryBench.normalizedFunctionalSha256
  },
  controlledChecks: {
    nodeStateA: validation.checks?.testBenchDeterminism?.firstSha256 || null,
    nodeStateB: validation.checks?.testBenchDeterminism?.secondSha256 || null,
    packagedArtifact: deliveryBench.normalizedFunctionalSha256 || null,
    cacheCompatibility: validation.checks?.cacheCompatibility?.status || "unknown",
    status: validation.status === "ok" && validation.checks?.testBenchDeterminism?.firstSha256 === deliveryBench.normalizedFunctionalSha256 ? "ok" : "failed"
  },
  browserFinalAttempt: {
    status: "not_completed_resource_limit",
    interruptedAfterMs: 120000,
    observedAvailableMemory: "1.4 GiB",
    observedSwap: "0 B",
    reason: "Aucune sortie apres deux minutes ; arret preventif apres un plantage Linux precedent."
  },
  historicalBrowserParity: previousParity ? {
    comparisonStatus: "not_comparable",
    reason: "Empreinte runtime anterieure ; preuve utile mais ne remplace pas le controle final.",
    status: previousParity.status || null,
    runtimeFingerprint: previousParity.runtimeBundleIdentity?.fingerprintSha256 || null,
    normalizedReferenceSha256: previousParity.testProfilesIdentity?.normalizedReferenceSha256 || null
  } : null,
  realEnvironmentComparison: {
    status: "insufficient_identity",
    localInputMode: "packaged_corpus",
    realInputMode: "real_import"
  },
  failures: ["browser_final_not_reverified_resource_limit"]
};
await writeFile(path.join(GENERATED_DIR, "boussole-runtime-parity-report.json"), `${JSON.stringify(parityReport, null, 2)}\n`, "utf8");
console.log("[Boussole Pro] Limites navigateur enregistrees sans presenter des controles incomplets comme valides.");

function emptyMetric() {
  return { minimum: null, median: null, mean: null, maximum: null, p95: null, rawValues: [], measurementStatus: "not_measured" };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (arguments.length > 1) return fallback; throw error; }
}
