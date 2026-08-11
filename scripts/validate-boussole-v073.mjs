import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";
import { canonicalSha256 } from "./boussole-runtime-identity.mjs";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const EXPECTED_JOBS_COUNT = Number(process.env.BOUSSOLE_EXPECTED_JOBS_COUNT || 500);
const TARGET_SUBDIR = process.env.BOUSSOLE_ROME_SUBDIR || "rome500-experimental";
const ROME500_DIR = path.join(GENERATED_DIR, TARGET_SUBDIR);
const ACCESS_SUMMARY_FILE = process.env.BOUSSOLE_ACCESS_SUMMARY_FILE || `access-summary.rome${EXPECTED_JOBS_COUNT}.json`;
const CONSTRAINT_SUMMARY_FILE = process.env.BOUSSOLE_CONSTRAINT_SUMMARY_FILE || `official-constraint-summary.rome${EXPECTED_JOBS_COUNT}.json`;
const MARKET_ENRICHMENT_FILE = process.env.BOUSSOLE_MARKET_ENRICHMENT_FILE || `market-fap-enrichment.rome${EXPECTED_JOBS_COUNT}.json`;
const MARKET_DIR = path.join(GENERATED_DIR, "market");
const ACTIVE_RUNTIME_PATH = path.resolve(process.env.BOUSSOLE_ACTIVE_RUNTIME_DESCRIPTOR || path.join(GENERATED_DIR, "active-runtime.json"));
const CEDRIC_PROFILE_PATH = path.join(ROOT, "tmp", "monde-pro", "profils tests", "boussole-pro-profil-cedric-2026-07-10.json");
const REPORT_PATH = process.env.BOUSSOLE_VALIDATION_REPORT || path.join(GENERATED_DIR, "boussole-v080-market-phase2-validation-report.json");

const SECTOR_EXPECTATIONS = {
  G1201: { primary: "hotellerie_hebergement", boussoleDomainLabel: "Restauration, hôtellerie, tourisme et accueil", forbidden: ["education_enfance"] },
  G1202: { primary: "culture_communication", secondary: ["education_enfance"], boussoleDomainLabel: "Culture, création, loisirs et animation", forbidden: ["hotellerie_hebergement"] },
  G1203: { primary: "education_enfance", forbidden: ["hotellerie_hebergement"] },
  G1235: { primary: "education_enfance" },
  G1238: { primary: "education_enfance" },
  G1703: { primary: "hotellerie_hebergement" },
  G1803: { primary: "restauration_alimentation" },
  M1501: { primary: "administratif_support" },
  H1210: { primary: "industrie_production" },
  J1407: { primary: "sante_soin" },
  B1101: { forbidden: ["batiment_construction"] },
  B1201: { forbidden: ["batiment_construction"] },
  B1303: { forbidden: ["batiment_construction"] },
  B1401: { forbidden: ["batiment_construction"] },
  B1502: { forbidden: ["batiment_construction"] },
  B1604: { forbidden: ["batiment_construction"] },
  B1701: { forbidden: ["batiment_construction"] },
  B1803: { forbidden: ["batiment_construction"] },
  B1805: { forbidden: ["batiment_construction"] },
  B1806: { forbidden: ["batiment_construction"] },
  B1808: { forbidden: ["batiment_construction"] },
  B1816: { forbidden: ["batiment_construction"] }
};

const NEGATION_CASES = ["D1424", "D1429", "E1210", "F1144", "G1501", "G1809", "K2111", "M1830", "N1210"];
const NO_DIPLOMA_CASES = ["D1442", "N1210"];
const CAPACITY_CASES = ["A1408", "C1103", "C1112", "G1210", "I1606", "J1506", "J1510", "K2116"];
const RANGE_CASES = {
  G1201: { min: 4, max: 5, mandatory: false },
  M1501: { min: 5, max: 7 },
  B1805: { min: 5, max: 7 },
  A1206: { min: 6, max: 7 }
};

async function main() {
  const html = await readFile(HTML_PATH, "utf8");
  const htmlSha256 = createHash("sha256").update(html).digest("hex");
  const buildMetadata = await readBoussoleBuildMetadata(HTML_PATH);
  const app = loadBoussoleEngine(html);
  const generated = await loadGeneratedBundle();
  const activeRuntimeDescriptor = await readJson(ACTIVE_RUNTIME_PATH, null);
  const baselineSubdir = process.env.BOUSSOLE_BASELINE_SUBDIR || (EXPECTED_JOBS_COUNT === 800 ? "rome500-experimental" : EXPECTED_JOBS_COUNT > 800 ? `rome${EXPECTED_JOBS_COUNT - 200}-candidate` : "");
  const baselineDirectory = baselineSubdir ? path.join(GENERATED_DIR, baselineSubdir) : GENERATED_DIR;
  const baselineSize = Number(process.env.BOUSSOLE_BASELINE_JOBS_COUNT || (EXPECTED_JOBS_COUNT === 800 ? 500 : EXPECTED_JOBS_COUNT > 800 ? EXPECTED_JOBS_COUNT - 200 : EXPECTED_JOBS_COUNT));
  const generatedBaseline = await loadGeneratedBundle(baselineDirectory, {
    accessSummaryFile: `access-summary.rome${baselineSize}.json`,
    constraintSummaryFile: `official-constraint-summary.rome${baselineSize}.json`,
    marketEnrichmentFile: `market-fap-enrichment.rome${baselineSize}.json`,
    marketTrendsFile: `market-trends.rome${baselineSize}.json`
  });
  const cedricEnvelope = await readJson(CEDRIC_PROFILE_PATH, null);
  app.App.state.activeRuntimeDescriptor = activeRuntimeDescriptor;
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);

  const report = {
    schemaVersion: "1.0.0",
    reportKind: `boussole_v08x_rome${EXPECTED_JOBS_COUNT}_validation`,
    generatedAt: new Date().toISOString(),
    appVersion: buildMetadata.appVersion,
    buildId: buildMetadata.buildId,
    buildDate: buildMetadata.buildDate,
    sourceArtifactSha256: htmlSha256,
    datasetVersion: app.App.state.dataset.datasetVersion,
    jobsCount: app.App.state.dataset.jobs.length,
    checks: {},
    failures: [],
    status: "ok"
  };

  report.checks.activeRuntimeDescriptor = validateActiveRuntimeDescriptor({ activeRuntimeDescriptor, generated, buildMetadata, htmlSha256 });
  report.checks.sectors = validateSectors(app);
  report.checks.jobDisplay = validateJobDisplay(app);
  report.checks.access = validateAccess(app);
  report.checks.accessQuality = validateAccessQuality(generated);
  report.checks.training = validateTraining(app);
  report.checks.context = validateContext(app);
  report.checks.constraintsEvidence = validateConstraintEvidence(app);
  report.checks.sectorExclusions = validateSectorExclusions(app);
  report.checks.corpusMaturity = validateCorpusMaturity(app, generated);
  report.checks.runtimeBundleIdentity = validateRuntimeBundleIdentity(app, generated);
  report.checks.cacheCompatibility = validateCacheCompatibility(app);
  report.checks.accessLabels = validateAccessLabels(generated);
  report.checks.testBenchDeterminism = validateTestBenchDeterminism(app);
  report.checks.top5ThemeContract = validateTop5ThemeContract(app);
  report.checks.technicalProfileScenario = validateCedricScenario(app, cedricEnvelope);
  report.checks.corpusConsistency = validateCorpusConsistency(app, generated, generatedBaseline);
  report.checks.marketPhase1 = validateMarketPhase1(app);
  report.checks.marketInterpretationMatrix = validateMarketInterpretationMatrix(app);
  report.checks.performanceSemantics = validatePerformanceSemantics(app);

  for (const group of Object.values(report.checks)) {
    for (const failure of group.failures || []) report.failures.push(failure);
  }
  report.status = report.failures.length ? "failed" : "ok";

  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.status !== "ok") {
    throw new Error(`[Boussole Pro] Validation v0.8.x échouée: ${report.failures.join(", ")}`);
  }
  console.log(`[Boussole Pro] Validation v0.8.x OK (${report.jobsCount} métiers, SHA ${htmlSha256.slice(0, 12)}...).`);
}

export function validateActiveRuntimeDescriptor({ activeRuntimeDescriptor, generated, buildMetadata, htmlSha256 }) {
  const failures = [];
  const descriptorRuntime = activeRuntimeDescriptor?.runtime || {};
  const descriptorMarket = activeRuntimeDescriptor?.market || {};
  const generatedRuntime = generated.runtimeBundleManifest || {};
  const generatedMarket = generated.marketPackageIdentity || {};
  const expectedBasePath = `data/generated/${TARGET_SUBDIR}/`;
  if (!activeRuntimeDescriptor || activeRuntimeDescriptor.descriptorKind !== "boussole_active_runtime") failures.push("active-runtime:descriptor_missing_or_invalid");
  if (descriptorRuntime.basePath !== expectedBasePath) failures.push("active-runtime:target_path_mismatch");
  if (Number(descriptorRuntime.expectedJobsCount) !== EXPECTED_JOBS_COUNT) failures.push("active-runtime:expected_jobs_count_mismatch");
  if (descriptorRuntime.datasetVersion !== generatedRuntime.datasetIdentity?.sourceDatasetVersion) failures.push("active-runtime:dataset_version_mismatch");
  if (descriptorRuntime.runtimeBundleRevision !== generatedRuntime.runtimeBundleRevision) failures.push("active-runtime:runtime_revision_mismatch");
  if (descriptorRuntime.runtimeBundleFingerprintSha256 !== generatedRuntime.fingerprintSha256) failures.push("active-runtime:runtime_fingerprint_mismatch");
  if (canonicalSha256(descriptorRuntime.expectedCounts || {}) !== canonicalSha256(generatedRuntime.counts || {})) failures.push("active-runtime:runtime_counts_mismatch");
  if (canonicalSha256(descriptorRuntime.ruleVersions || {}) !== canonicalSha256(generatedRuntime.ruleVersions || {})) failures.push("active-runtime:rule_versions_mismatch");
  if (descriptorRuntime.validationScope !== generatedRuntime.datasetIdentity?.validationScope) failures.push("active-runtime:validation_scope_mismatch");
  if (descriptorMarket.marketContractRevision !== generatedMarket.marketContractRevision) failures.push("active-runtime:market_contract_revision_mismatch");
  if (descriptorMarket.temporalContractRevision !== generatedMarket.temporalContractRevision) failures.push("active-runtime:temporal_contract_revision_mismatch");
  if (descriptorMarket.packageFingerprintSha256 !== generatedMarket.packageFingerprintSha256) failures.push("active-runtime:market_fingerprint_mismatch");
  if (activeRuntimeDescriptor?.appSource?.appVersion !== buildMetadata.appVersion) failures.push("active-runtime:app_version_mismatch");
  if (activeRuntimeDescriptor?.appSource?.buildId !== buildMetadata.buildId) failures.push("active-runtime:app_build_mismatch");
  if (activeRuntimeDescriptor?.appSource?.sourceArtifactSha256 !== htmlSha256) failures.push("active-runtime:app_source_sha256_mismatch");
  return {
    status: failures.length ? "failed" : "ok",
    descriptorKind: activeRuntimeDescriptor?.descriptorKind || null,
    targetBasePath: descriptorRuntime.basePath || null,
    expectedJobsCount: descriptorRuntime.expectedJobsCount || null,
    runtimeBundleRevision: descriptorRuntime.runtimeBundleRevision || null,
    runtimeFingerprintSha256: descriptorRuntime.runtimeBundleFingerprintSha256 || null,
    marketFingerprintSha256: descriptorMarket.packageFingerprintSha256 || null,
    applicationSourceSha256: activeRuntimeDescriptor?.appSource?.sourceArtifactSha256 || null,
    failures
  };
}

function validateMarketPhase1(app) {
  const failures = [];
  const job = findJobByCode(app.App.state.dataset.jobs, "G1201") || app.App.state.dataset.jobs[0];
  app.App.state.profile = app.normalizeProfile({ profileName: "Validation marché", hasRequestedResults: true });
  const synthesis = app.getJobMarketSynthesis(job, app.App.state.dataset, { territory: "DEP-11" });
  const summary = app.renderMarketOneLineSummary(job, {});
  const detail = app.renderMarketDetailModal(job, {});
  const identity = app.getMarketLayerIdentity(app.App.state.dataset);
  const compatibility = app.assessMarketLayerCompatibility(app.App.state.dataset);
  if (!compatibility.compatible) failures.push(...compatibility.issues.map(issue => `market:${issue}`));
  if (synthesis.dimensions.tension.status !== "unknown") failures.push("market:false_tension_from_offers");
  if (!summary.includes("tension non disponible")) failures.push("market:summary_missing_unknown_tension");
  if (!summary.includes("difficulté BMO non disponible")) failures.push("market:summary_missing_unknown_bmo");
  if (!detail.includes("Tension réelle") || !detail.includes("Projets de recrutement BMO")) failures.push("market:detail_dimensions_missing");
  if (detail.includes(identity.packageFingerprintSha256 || "__missing__")) failures.push("market:fingerprint_exposed_in_default_ui");
  if (!identity.packageFingerprintSha256) failures.push("market:identity_missing");
  if (synthesis.dimensions.offerVolume.level === synthesis.dimensions.tension.level && synthesis.dimensions.tension.level !== "unknown") failures.push("market:volume_tension_alias");
  return {
    status: failures.length ? "failed" : "ok",
    marketLayerIdentity: identity,
    compatibility,
    synthesis: {
      interpretation: synthesis.interpretation,
      unknownDimensions: synthesis.unknownDimensions,
      mappingQuality: synthesis.mappingQuality,
      sourceCoverage: synthesis.sourceCoverage
    },
    failures
  };
}

function validatePerformanceSemantics(app) {
  const previousView = app.App.state.mainView;
  const previousMetrics = app.App.state.performanceMetrics;
  app.App.state.mainView = "data";
  app.App.state.performanceMetrics = { datasetLoadMs: 10, normalizationMs: 5, profileScoringMs: 20, totalGeneratedLoadMs: 40, resultCardsRendered: 0 };
  const report = app.createBrowserPerformanceReport();
  app.App.state.mainView = previousView;
  app.App.state.performanceMetrics = previousMetrics;
  const failures = [];
  if (report.runtimePerformanceVerdict !== "measured") failures.push("performance:runtime_not_measured");
  if (report.scoringPerformanceVerdict !== "measured") failures.push("performance:scoring_not_measured");
  if (report.renderValidationVerdict !== "not_measured") failures.push("performance:render_should_be_not_measured");
  if (report.completionVerdict !== "partial_valid_without_render_measurement") failures.push("performance:global_verdict_too_alarmist");
  return { status: failures.length ? "failed" : "ok", verdicts: { runtime: report.runtimePerformanceVerdict, scoring: report.scoringPerformanceVerdict, render: report.renderValidationVerdict, global: report.completionVerdict }, failures };
}

function validateRuntimeBundleIdentity(app, generated = {}) {
  const failures = [];
  const identity = app.getRuntimeBundleIdentity(app.App.state.dataset);
  const compatibility = app.assessRuntimeBundleCompatibility(app.App.state.dataset);
  if (!compatibility.compatible) failures.push(...compatibility.issues.map(issue => `runtime:${issue}`));
  if (identity.inputMode !== "packaged_corpus") failures.push("runtime:input_mode_not_packaged");
  const expectedSkillsEngine = generated.runtimeBundleManifest?.counts?.skillsEngine;
  if (Number.isFinite(expectedSkillsEngine) && identity.counts?.skillsEngine !== expectedSkillsEngine) failures.push(`runtime:skills_engine_${identity.counts?.skillsEngine || 0}_expected_${expectedSkillsEngine}`);
  if (identity.counts?.jobs !== EXPECTED_JOBS_COUNT) failures.push(`runtime:jobs_${identity.counts?.jobs || 0}`);
  if (identity.status !== "coherent") failures.push(`runtime:status_${identity.status}`);
  if (generated.runtimeBundleManifest?.fingerprintSha256 !== identity.fingerprintSha256) failures.push("runtime:manifest_fingerprint_mismatch");
  return { status: failures.length ? "failed" : "ok", identity, compatibility, failures };
}

function validateCacheCompatibility(app) {
  const failures = [];
  const exact = app.assessRuntimeBundleCompatibility(app.App.state.dataset);
  const expected = exact.expected;
  const cases = {
    exact,
    previousBuild: app.assessRuntimeBundleCompatibility({ datasetVersion: expected.sourceDatasetVersion, runtimeBundleIdentity: { ...expected, runtimeBundleRevision: "rome500-runtime-v0.7.5-r0" } }),
    wrongFingerprint: app.assessRuntimeBundleCompatibility({ datasetVersion: expected.sourceDatasetVersion, runtimeBundleIdentity: { ...expected, fingerprintSha256: "0".repeat(64) } }),
    missingSkillsEngine: app.assessRuntimeBundleCompatibility({ datasetVersion: expected.sourceDatasetVersion, runtimeBundleIdentity: { ...expected, counts: { ...expected.counts, skillsEngine: 0 } } }),
    staleAccessReport: app.assessRuntimeBundleCompatibility({ datasetVersion: expected.sourceDatasetVersion, runtimeBundleIdentity: { ...expected, ruleVersions: { ...expected.ruleVersions, access: "v0.7.4-alpha" } } }),
    realImport: app.assessRuntimeBundleCompatibility({ datasetVersion: expected.sourceDatasetVersion, runtimeBundleIdentity: { inputMode: "real_import", counts: { jobs: EXPECTED_JOBS_COUNT, skillsEngine: expected.counts.skillsEngine } } })
  };
  if (!cases.exact.compatible) failures.push("cache:exact_rejected");
  for (const name of ["previousBuild", "wrongFingerprint", "missingSkillsEngine", "staleAccessReport"]) {
    if (cases[name].compatible || cases[name].action !== "reload_packaged_corpus") failures.push(`cache:${name}_not_rejected`);
  }
  if (!cases.realImport.compatible || cases.realImport.comparisonStatus !== "not_comparable") failures.push("cache:real_import_not_preserved_separately");
  return { status: failures.length ? "failed" : "ok", cases, failures };
}

function validateAccessLabels(generated = {}) {
  const failures = [];
  const forbidden = /\b(?:obligatoire\s+requis(?:e|es|s)?|requise\s+requis|requis\s+requis|cité(?:es?)?\s+recommandé(?:es?)?)\b/i;
  const malformed = [];
  for (const row of toArray(generated.accessSummary)) {
    const labels = [row.displayLabel, ...toArray(row.requiredCredentialLabels), ...toArray(row.optionalCredentialLabels)];
    if (!String(row.displayLabel || "").trim()) malformed.push({ romeCode: row.romeCode, reason: "empty_display_label" });
    for (const label of labels) if (forbidden.test(String(label || ""))) malformed.push({ romeCode: row.romeCode, label, reason: "automatic_redundancy" });
  }
  const byCode = new Map(toArray(generated.accessSummary).map(row => [row.romeCode, row]));
  for (const code of ["I1309", "N4109"]) {
    if (!byCode.has(code)) failures.push(`access-label:${code}:missing`);
    if (forbidden.test(byCode.get(code)?.displayLabel || "")) failures.push(`access-label:${code}:redundant`);
  }
  if (malformed.length) failures.push(`access-label:malformed_${malformed.length}`);
  return { status: failures.length ? "failed" : "ok", scannedCount: toArray(generated.accessSummary).length, rows: Object.fromEntries(["I1309", "N4109"].map(code => [code, byCode.get(code) || null])), malformed, failures };
}

function validateTestBenchDeterminism(app) {
  const failures = [];
  const normalize = report => ({
    datasetVersion: report.datasetVersion,
    runtimeFingerprint: report.runtimeBundleIdentity?.fingerprintSha256,
    rows: toArray(report.rows).map(row => ({ id: row.id, top5: row.top5, expectedJobsEvaluation: row.expectedJobsEvaluation, anomalies: row.anomalies, marketUniform: row.marketUniform })),
    anomalies: report.anomalies,
    summary: report.summary
  });
  app.App.state.profile = app.normalizeProfile({ profileName: "Etat parasite A", preferredSectors: ["numerique"], excludedSectors: ["sante_soin"], hasRequestedResults: true });
  const first = normalize(app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052));
  app.App.state.profile = app.normalizeProfile({ profileName: "Etat parasite B", preferredSectors: ["nature_agriculture"], excludedSectors: ["numerique"], criterionWeights: { skills: 5, training: 5, constraints: 50, values: 20, context: 10, market: 10 }, hasRequestedResults: true });
  const second = normalize(app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052));
  const firstSha256 = canonicalSha256(first);
  const secondSha256 = canonicalSha256(second);
  if (toArray(first.rows).length !== 12) failures.push(`bench:profiles_${toArray(first.rows).length}`);
  if (firstSha256 !== secondSha256) failures.push("bench:user_state_leak");
  for (const row of first.rows) {
    const themeIds = toArray(row.top5).map(item => item.top5ThemeId || item.themeId).filter(Boolean);
    if (themeIds.length && new Set(themeIds).size !== themeIds.length) failures.push(`bench:${row.id}:duplicate_top5_theme`);
  }
  return { status: failures.length ? "failed" : "ok", profilesCount: first.rows.length, profilesRevision: "integrated-12-v0.8.0", firstSha256, secondSha256, failures };
}

function validateTop5ThemeContract(app) {
  const failures = [];
  const make = ({ id, code, title, score, status = "possible_now", confidence = 80, feasibility = 80 }) => ({
    jobId: id,
    romeCode: code,
    title,
    globalScore: score,
    selectionScore: score,
    confidenceScore: confidence,
    feasibilityScore: feasibility,
    status,
    scores: { constraints: 20, values: 10, training: 15, market: 0 },
    coreProfileMatch: { level: "compatible" },
    job: { id, romeCode: code, title, family: title, domain: title, primarySectorId: "unknown", secondarySectorIds: [], appellations: [], skillGroups: [], requiredSkills: [], optionalSkills: [], interestTags: [], transitionTags: [], relatedJobs: [] }
  });
  const input = [
    make({ id: "animation-best", code: "G1203", title: "Animateur jeunesse", score: 94 }),
    make({ id: "animation-variant", code: "G1235", title: "Animateur de séjour de vacances", score: 90 }),
    make({ id: "coordination", code: "K1206", title: "Coordinateur socioculturel", score: 88 }),
    make({ id: "social", code: "K1217", title: "Éducateur socioéducatif", score: 84 }),
    make({ id: "digital", code: "M1805", title: "Développeur web", score: 80 }),
    make({ id: "nature", code: "A1203", title: "Agent des espaces naturels", score: 76 }),
    make({ id: "excluded", code: "Z0001", title: "Comptable", score: 99, status: "excluded_for_now" })
  ];
  const orderBefore = input.map(item => `${item.jobId}:${item.globalScore}:${item.selectionScore}`);
  const first = app.diversifyTopResults(input);
  const second = app.diversifyTopResults(input);
  const themes = first.top5.map(item => item.top5ThemeId);
  if (first.top5.length !== 5 || new Set(themes).size !== 5) failures.push("top5:five_distinct_themes_expected");
  if (first.top5[0]?.jobId !== "animation-best") failures.push("top5:best_global_representative_not_first");
  if (first.top5.some(item => item.jobId === "animation-variant")) failures.push("top5:variant_used_as_representative");
  if (!toArray(first.variantsByJob["animation-best"]).some(item => item.jobId === "animation-variant")) failures.push("top5:variant_not_discoverable");
  if (first.top5.some(item => ["excluded_for_now", "discouraged"].includes(item.status))) failures.push("top5:inadmissible_filler");
  if (canonicalSha256(first) !== canonicalSha256(second)) failures.push("top5:nondeterministic_selection");
  if (canonicalSha256(orderBefore) !== canonicalSha256(input.map(item => `${item.jobId}:${item.globalScore}:${item.selectionScore}`))) failures.push("top5:source_order_or_scores_mutated");
  const narrow = app.diversifyTopResults(input.slice(0, 4));
  if (narrow.top5.length >= 5 || !narrow.top5ShortfallReason) failures.push("top5:honest_shortfall_missing");
  return {
    status: failures.length ? "failed" : "ok",
    revision: first.top5ThemeContractRevision,
    threshold: first.top5RelevanceThreshold,
    themes,
    representatives: first.top5.map(item => ({ jobId: item.jobId, themeId: item.top5ThemeId, score: item.selectionScore })),
    failures
  };
}

function validateMarketInterpretationMatrix(app) {
  const failures = [];
  const dimension = (level, status = "available", value = 1) => ({ level, status, value });
  const cases = [
    { id: "low_strong", input: { offerVolume: dimension("low"), territorialPresence: dimension("strong_local", "available", 87), nationalOfferVolume: dimension("high"), territoryLabel: "Aude" }, expected: "low_absolute_volume_strong_local_presence", forbidden: /peu représenté/i },
    { id: "low_weak", input: { offerVolume: dimension("low"), territorialPresence: dimension("weak_local"), nationalOfferVolume: dimension("high"), territoryLabel: "Aude" }, expected: "active_national_low_local" },
    { id: "high_strong", input: { offerVolume: dimension("high"), territorialPresence: dimension("top_local", "available", 96), nationalOfferVolume: dimension("high"), territoryLabel: "Aude" }, expected: "high_absolute_and_local_presence" },
    { id: "tension_low", input: { tension: dimension("very_high"), offerVolume: dimension("low"), territorialPresence: dimension("strong_local"), territoryLabel: "Aude" }, expected: "high_tension_low_volume" },
    { id: "bmo_masked", input: { recruitmentProjects: dimension("unclassified"), recruitmentDifficulty: dimension("unknown", "suppressed_partial", null), seasonality: dimension("unknown", "suppressed_partial", null) }, expected: "partial_data" },
    { id: "territory_fallback", input: { offerVolume: { ...dimension("medium"), territoryLabel: "Occitanie" }, territorialPresence: dimension("medium_local"), territoryLabel: "Occitanie" }, expected: "partial_data" },
    { id: "no_history", input: { trend: dimension("unknown", "insufficient_history", null) }, expected: "no_robust_data" }
  ];
  const rows = cases.map(test => {
    const actual = app.interpretMarketSynthesis(test.input);
    if (actual.caseId !== test.expected) failures.push(`market-matrix:${test.id}:${actual.caseId}`);
    if (test.forbidden?.test(actual.text)) failures.push(`market-matrix:${test.id}:contradictory_text`);
    return { id: test.id, expected: test.expected, actual };
  });
  return { status: failures.length ? "failed" : "ok", rows, failures };
}

function validateSectors(app) {
  const jobs = app.App.state.dataset.jobs;
  const rows = {};
  const failures = [];
  for (const [code, expected] of Object.entries(SECTOR_EXPECTATIONS)) {
    const job = findJobByCode(jobs, code);
    const runtime = job ? app.getJobSectorProfile(job) : null;
    const rowFailures = [];
    if (!job) rowFailures.push("missing_job");
    if (expected.boussoleDomainLabel && job?.boussoleDomainLabel !== expected.boussoleDomainLabel) rowFailures.push(`expected_boussole_domain_${expected.boussoleDomainLabel}`);
    if (expected.primary && runtime?.primarySectorId !== expected.primary) rowFailures.push(`expected_primary_${expected.primary}`);
    if ((expected.secondary || []).some(id => !runtime?.secondarySectorIds?.includes(id))) rowFailures.push("missing_secondary_sector");
    if ((expected.forbidden || []).includes(runtime?.primarySectorId)) rowFailures.push(`forbidden_primary_${runtime?.primarySectorId}`);
    if ((expected.forbidden || []).some(id => runtime?.secondarySectorIds?.includes(id))) rowFailures.push("forbidden_secondary_sector");
    rows[code] = { title: job?.title || null, sourceDomain: job?.sourceDomain || job?.domain || null, boussoleDomainLabel: job?.boussoleDomainLabel || null, generatedPrimary: job?.primarySectorId || null, runtime, status: rowFailures.length ? "failed" : "ok", failures: rowFailures };
    failures.push(...rowFailures.map(failure => `sector:${code}:${failure}`));
  }

  const importedButAmbiguous = jobs
    .map(job => ({ job, runtime: app.getJobSectorProfile(job) }))
    .filter(({ job, runtime }) => job.primarySectorId && job.primarySectorId !== "unknown" && runtime.sectorMappingStatus === "ambiguous_unusable");
  if (importedButAmbiguous.length) failures.push(`sector:ambiguous_imported:${importedButAmbiguous.length}`);

  return {
    status: failures.length ? "failed" : "ok",
    rows,
    importedButAmbiguousCount: importedButAmbiguous.length,
    sampleImportedButAmbiguous: importedButAmbiguous.slice(0, 20).map(({ job, runtime }) => ({ romeCode: job.romeCode, title: job.title, primarySectorId: job.primarySectorId, runtimeStatus: runtime.sectorMappingStatus })),
    failures
  };
}

function validateJobDisplay(app) {
  const job = findJobByCode(app.App.state.dataset.jobs, "G1202");
  const failures = [];
  const modes = {};
  if (!job) return { status: "failed", modes, failures: ["display:G1202:missing_job"] };
  const previousMode = app.App.state.displayMode;
  const result = app.createExplorationResultShell(job);
  for (const mode of ["essential", "detailed", "diagnostic"]) {
    app.App.state.displayMode = mode;
    const html = app.renderJobDetailsPanelContent(result);
    const hasSectorLabel = html.includes("Secteur Boussole");
    const hasExpectedDomain = html.includes("Culture, création, loisirs et animation");
    const hasSourceLabel = mode === "essential" || html.includes("Domaine / famille ROME");
    modes[mode] = { hasSectorLabel, hasSourceLabel, hasExpectedDomain };
    if (!hasSectorLabel) failures.push(`display:${mode}:missing_sector_label`);
    if (!hasSourceLabel) failures.push(`display:${mode}:missing_source_domain_label`);
    if (!hasExpectedDomain) failures.push(`display:${mode}:unexpected_G1202_sector`);
  }
  app.App.state.displayMode = previousMode;
  return { status: failures.length ? "failed" : "ok", modes, failures };
}

function validateAccess(app) {
  const jobs = app.App.state.dataset.jobs;
  const failures = [];
  const rows = {};
  const assert = (condition, code, message) => {
    if (!condition) failures.push(`access:${code}:${message}`);
  };

  for (const code of unique([...NEGATION_CASES, ...NO_DIPLOMA_CASES, ...CAPACITY_CASES, ...Object.keys(RANGE_CASES), "G1235", "K1201", "K1207", "K1307", "K2106", "J1104", "J1202", "J1405", "J1407", "J1506"])) {
    const job = findJobByCode(jobs, code);
    rows[code] = job?.accessSummary || null;
  }

  const g1201 = rows.G1201;
  assert(g1201?.requirementKind === "recommended", "G1201", "requirement_not_recommended");
  assert(g1201?.mandatoryQualification === false, "G1201", "mandatory_should_be_false");
  assert(g1201?.minimumDiplomaLevel === 4 && g1201?.maximumDiplomaLevel === 5, "G1201", "bad_bac_to_bac2_range");
  assert(!g1201?.specificCredentialRequired, "G1201", "specific_credential_should_be_false");

  const k1201 = rows.K1201;
  assert(k1201?.mandatoryQualification === true, "K1201", "deass_not_mandatory");
  assert(k1201?.specificCredentialRequired === true, "K1201", "deass_not_specific");
  assert(toArray(k1201?.requiredCredentialLabels).some(label => /DEASS|assistant de service social/i.test(label)), "K1201", "deass_label_missing");

  const exactCredentials = {
    K1207: /DEES|éducateur spécialisé/i,
    K1307: /CAP.*AEPE|accompagnant éducatif petite enfance/i,
    J1104: /sage-femme|maïeutique/i,
    J1202: /pharmacie/i,
    J1405: /opticien/i,
    J1407: /orthoptiste/i,
    J1506: /infirmier/i
  };
  for (const [code, pattern] of Object.entries(exactCredentials)) {
    assert(["mandatory", "regulated"].includes(rows[code]?.requirementKind), code, "mandatory_or_regulated_expected");
    assert(rows[code]?.specificCredentialRequired === true, code, "specific_credential_expected");
    assert(toArray(rows[code]?.requiredCredentialLabels).some(label => pattern.test(label)), code, "precise_credential_label_missing");
  }
  assert(rows.G1235?.requirementKind === "conditional" && !rows.G1235?.contradictoryEvidence, "G1235", "contextual_bafa_misclassified");
  assert(toArray(rows.K2106?.accessPaths).length >= 3, "K2106", "parallel_crpe_paths_missing");
  assert(!/cap.*aepe/i.test(toArray(rows.K2106?.requiredCredentialLabels).join(" ")), "K2106", "cap_aepe_must_not_be_required");
  assert(!toArray(rows.K2106?.requiredCredentialLabels).some(label => /concours|crpe/i.test(label)), "K2106", "exam_must_not_be_credential");
  assert(toArray(rows.K2106?.requiredExams).some(label => /CRPE/i.test(label)), "K2106", "required_exam_missing");

  for (const code of NEGATION_CASES) {
    const summary = rows[code];
    if (code !== "N1210") {
      assert(summary?.mandatoryQualification === false, code, "negation_created_mandatory");
      assert(summary?.regulated === false || code === "K2111", code, "negation_created_regulated");
    } else {
      assert(summary?.contradictoryEvidence === true, code, "conflict_not_detected");
    }
  }

  for (const code of NO_DIPLOMA_CASES) {
    assert(rows[code]?.noDiplomaPossible === true, code, "no_diploma_not_detected");
  }

  for (const code of CAPACITY_CASES) {
    const labels = [...toArray(rows[code]?.citedDiplomas), ...toArray(rows[code]?.requiredCredentialLabels)].join(" ");
    assert(!/\bcap\b/i.test(labels.replace(/capacit[ée]/gi, "")), code, "capacity_parsed_as_cap");
  }

  for (const [code, range] of Object.entries(RANGE_CASES)) {
    assert(rows[code]?.minimumDiplomaLevel === range.min && rows[code]?.maximumDiplomaLevel === range.max, code, "bad_diploma_range");
    if (range.mandatory === false) assert(rows[code]?.mandatoryQualification === false, code, "range_case_should_not_be_mandatory");
  }

  return { status: failures.length ? "failed" : "ok", rows, failures };
}

function validateAccessQuality(generated = {}) {
  const report = generated.accessSummaryQualityReport || {};
  const summaries = toArray(generated.accessSummary);
  const failures = [];
  const reportDate = Date.parse(report.generatedAt || "");
  const newestSummaryDate = Math.max(...summaries.map(row => Date.parse(row.generatedAt || "")).filter(Number.isFinite), 0);
  if (!Number.isFinite(reportDate)) failures.push("access-quality:missing_generated_at");
  if (newestSummaryDate && reportDate < newestSummaryDate) failures.push("access-quality:report_older_than_summaries");
  if (report.summary?.jobsCount !== summaries.length) failures.push("access-quality:jobs_count_mismatch");
  if (report.summary?.truthFailuresCount !== 0 || toArray(report.truthFailures).length) failures.push("access-quality:truth_failures");
  if (report.summary?.genericRequiredLabelsRejectedCount !== 0) failures.push("access-quality:generic_required_labels");
  if (!report.buildId || (!report.sourceArtifactSha256 && report.identityScope !== "runtime_bundle_component")) failures.push("access-quality:missing_build_identity");
  if ((report.summary?.accessDurationKnownCount || 0) < 8) failures.push("access-quality:known_duration_coverage_too_low");
  if ((report.summary?.accessDurationUnknownCount || 0) <= 0) failures.push("access-quality:unknown_durations_not_preserved");
  if (generated.qualityReport?.provenanceDistribution?.mappings?.unknown !== 0) failures.push("quality:mapping_provenance_unknown");
  if (generated.qualityReport?.provenanceDistribution?.mappings?.generated_rome !== toArray(generated.mappings).length) failures.push("quality:mapping_provenance_mismatch");
  if (generated.qualityReport?.summary?.jobsWithAccessSummary !== summaries.length) failures.push("quality:access_summary_counter_mismatch");
  if (!generated.qualityReport?.accessCatalogExplanation?.note) failures.push("quality:missing_access_catalog_explanation");
  const actualKinds = summaries.reduce((counts, row) => ({ ...counts, [row.requirementKind || "unknown"]: (counts[row.requirementKind || "unknown"] || 0) + 1 }), {});
  if (JSON.stringify(actualKinds) !== JSON.stringify(report.summary?.requirementKindCounts || {})) failures.push("access-quality:requirement_distribution_mismatch");
  return { status: failures.length ? "failed" : "ok", generatedAt: report.generatedAt || null, newestSummaryDate: newestSummaryDate ? new Date(newestSummaryDate).toISOString() : null, summary: report.summary || null, failures };
}

function validateTraining(app) {
  const jobs = app.App.state.dataset.jobs;
  const failures = [];
  const profile = app.normalizeProfile({
    diplomaLevel: "5",
    trainingOpenness: "short",
    canDoShortTraining: true,
    canDoLongTraining: false,
    skills: ["skill-active-listening", "skill-communication", "skill-mediation"],
    experienceDomains: ["social"],
    jobExperiences: [
      { romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes" },
      { romeCode: "M1805", title: "Études et développement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no" }
    ],
    interests: ["aider", "accompagner"]
  });
  const criteria = app.mapUserProfileToCriteria(profile);
  const rows = {};
  for (const code of ["K1201", "K1207", "K1307", "K2106", "J1104", "J1202", "J1405", "J1407", "J1506", "G1204", "I1309", "N4109", "C1504"]) {
    const job = findJobByCode(jobs, code);
    const training = job ? app.calculateTrainingScore(criteria, job) : null;
    rows[code] = training;
    if (!job) failures.push(`training:${code}:missing_job`);
    if (training?.missingCertifications?.length && training.statusHint === "short" && training.trainingDuration?.category !== "short") failures.push(`training:${code}:undocumented_specific_credential_shortcut`);
  }
  if (rows.K1201?.statusHint === "now" || rows.K1201?.statusHint === "short") failures.push("training:K1201:deass_should_not_be_now_or_short");
  if (!rows.K1201?.missingCertifications?.length) failures.push("training:K1201:deass_missing_certification_not_reported");
  for (const code of ["K1207", "K1307", "J1104", "J1202", "J1405", "J1407", "J1506"]) {
    if (["now", "short"].includes(rows[code]?.statusHint)) failures.push(`training:${code}:regulated_access_too_easy`);
    if (!rows[code]?.missingCertifications?.length) failures.push(`training:${code}:missing_credential_not_reported`);
  }
  for (const code of ["K1201", "K1207", "J1104", "J1202", "J1407", "J1506"]) {
    if (rows[code]?.statusHint !== "long" || rows[code]?.trainingDuration?.category !== "long") failures.push(`training:${code}:documented_long_access_not_preserved`);
  }
  for (const code of ["K1307", "G1204"]) {
    if (rows[code]?.statusHint !== "access_to_verify" || rows[code]?.trainingDuration?.category !== "unknown") failures.push(`training:${code}:unknown_duration_not_prudent`);
  }
  for (const code of ["I1309", "N4109"]) {
    if (rows[code]?.statusHint !== "short" || rows[code]?.trainingDuration?.category !== "short") failures.push(`training:${code}:documented_short_access_not_preserved`);
  }
  if (rows.K2106?.statusHint !== "access_to_verify") failures.push(`training:K2106:expected_access_to_verify_got_${rows.K2106?.statusHint}`);
  if (toArray(rows.K2106?.accessFeasibility?.accessPaths).length < 3) failures.push("training:K2106:runtime_paths_missing");
  if (toArray(rows.K2106?.missingCertifications).some(label => /concours|crpe/i.test(label))) failures.push("training:K2106:exam_in_missing_certifications");
  if (!toArray(rows.K2106?.missingExams).some(label => /CRPE/i.test(label))) failures.push("training:K2106:missing_exam_not_reported");
  if (rows.K2106?.accessFeasibility?.bestAccessPath) failures.push("training:K2106:unconfirmed_path_called_best");
  if (rows.K2106?.accessFeasibility?.leadPathCandidate?.pathId !== "k2106-crpe-troisieme-concours") failures.push(`training:K2106:unexpected_lead_path_${rows.K2106?.accessFeasibility?.leadPathCandidate?.pathId || "missing"}`);
  return { status: failures.length ? "failed" : "ok", rows, failures };
}

function validateContext(app) {
  const jobs = app.App.state.dataset.jobs;
  const failures = [];
  const job = findJobByCode(jobs, "A1101");
  const profile = app.normalizeProfile({ preferredWorkStyles: ["field"], preferredEnvironments: ["outdoor"], contextPreferences: { outdoor: "important" } });
  const criteria = app.mapUserProfileToCriteria(profile);
  const context = job ? app.calculateContextScore(criteria, job) : null;
  if (!job) failures.push("context:A1101:missing_job");
  if (context?.evidenceAvailable !== false) failures.push("context:A1101:evidence_should_be_false");
  if (context?.score !== 5) failures.push(`context:A1101:expected_neutral_5_got_${context?.score}`);
  if (toArray(context?.matched).length) failures.push("context:A1101:inferred_context_bonus_detected");
  return { status: failures.length ? "failed" : "ok", rows: { A1101: context }, failures };
}

function validateConstraintEvidence(app) {
  const failures = [];
  const profile = app.normalizeProfile({
    constraints: [
      { value: "nightWork", severity: "excluding" },
      { value: "weekendWork", severity: "excluding" },
      { value: "heavyLoad", severity: "excluding" },
      { value: "standing", severity: "avoid" },
      { value: "travel", severity: "avoid" },
      { value: "driverLicenseRequired", severity: "excluding" }
    ],
    driverLicenses: [],
    hasRequestedResults: true
  });
  const criteria = app.mapUserProfileToCriteria(profile);
  const rows = {};
  for (const code of ["G1202", "K1207", "K2106", "J1506"]) {
    const job = findJobByCode(app.App.state.dataset.jobs, code);
    const detail = job ? app.calculateConstraintScore(criteria, job) : null;
    rows[code] = detail;
    if (!job) failures.push(`constraints:${code}:missing_job`);
    if (toArray(detail?.matchedConstraints).some(label => /^(Permis obligatoire|Port de charges|Bruit important)$/i.test(label))) failures.push(`constraints:${code}:ambiguous_positive_label`);
    if (toArray(detail?.constraintEvaluations).some(item => !item.status || !item.source || !Number.isFinite(Number(item.confidence)))) failures.push(`constraints:${code}:evidence_metadata_missing`);
  }
  const unknownJob = {
    id: "truth-unknown-constraints",
    romeCode: "Z0000",
    title: "Métier test inconnu",
    physicalConstraints: { level: "unknown", tags: [], source: "unknown", confidence: 0 },
    scheduleConstraints: { nightWork: "unknown", weekendWork: "unknown", source: "unknown", confidence: 0 },
    mobilityConstraints: { travelFrequency: "unknown", source: "unknown", confidence: 0 },
    workContexts: [],
    officialConstraintSummary: { confirmedSignals: [], unknownDimensions: ["schedule", "physical", "mobility", "environment", "publicContact"], source: "unknown", confidence: 0 },
    accessSummary: {}
  };
  const unknown = app.calculateConstraintScore(criteria, unknownJob);
  rows.unknown = unknown;
  if (unknown.score === 25 || unknown.score > 13) failures.push(`constraints:unknown:expected_neutral_got_${unknown.score}`);
  if (unknown.confirmedCompatibleCount || unknown.confirmedIncompatibleCount) failures.push("constraints:unknown:invented_certainty");
  if (rows.J1506 && !rows.J1506.constraintEvaluations.some(item => item.preferenceId === "heavyLoad" && item.status === "confirmed_incompatible")) failures.push("constraints:J1506:official_heavy_load_not_applied");
  if (rows.G1202 && !rows.G1202.constraintEvaluations.some(item => item.preferenceId === "weekendWork" && item.status === "possible_risk")) failures.push("constraints:G1202:contextual_weekend_not_prudent");
  return { status: failures.length ? "failed" : "ok", rows, failures };
}

function validateSectorExclusions(app) {
  const failures = [];
  const expectations = {
    L1509: ["culture_communication", "industrie_production"],
    L1308: ["culture_communication", "administratif_support"],
    D1203: ["sante_soin", "commerce_vente"],
    H1211: ["sante_soin", "industrie_production"],
    M1716: ["culture_communication", "numerique"],
    M1305: ["numerique", "industrie_production"],
    F1105: ["nature_agriculture", "batiment_construction"],
    H2206: ["industrie_production", "batiment_construction"]
  };
  const rows = {};
  for (const [code, expected] of Object.entries(expectations)) {
    const job = findJobByCode(app.App.state.dataset.jobs, code);
    const mapping = job ? app.getJobSectorProfile(job) : null;
    const decision = job ? app.evaluateSectorExclusionDecision(expected[1], job, { excludedSectors: [expected[1]], profileSectors: [expected[0]] }) : null;
    rows[code] = { mapping, decision };
    if (!job) failures.push(`sector-truth:${code}:missing_job`);
    if (!expected.every(id => mapping?.allSectorIds?.includes(id))) failures.push(`sector-truth:${code}:expected_multisector_mapping`);
    if (decision?.hardExclusion) failures.push(`sector-truth:${code}:secondary_sector_hard_excluded`);
  }
  const prefixJob = { id: "truth-prefix-sector", romeCode: "K1299", title: "Métier test préfixe", primarySectorId: null, secondarySectorIds: [], sectorMappingConfidence: 0.65, provenance: "generated_rome", sourceRefs: ["france_travail_rome_generated"] };
  const prefixDecision = app.evaluateSectorExclusionDecision("social_insertion", prefixJob, { excludedSectors: ["social_insertion"], profileSectors: [] });
  rows.prefixMediumConfidence = prefixDecision;
  if (prefixDecision.hardExclusion) failures.push("sector-truth:prefix_medium_confidence_hard_excluded");
  return { status: failures.length ? "failed" : "ok", rows, failures };
}

function validateCorpusMaturity(app, generated = {}) {
  const failures = [];
  const sourceVersion = EXPECTED_JOBS_COUNT === 500 ? "rome500-experimental-v0.7" : generated.manifest?.datasetVersion;
  const expectedVersion = process.env.BOUSSOLE_EXPECTED_DATASET_VERSION || (EXPECTED_JOBS_COUNT === 500 ? "rome500-candidate-v0.7" : `rome${EXPECTED_JOBS_COUNT}-candidate-v0.1`);
  const migrated = app.mergeGeneratedDatasetIntoApp({ ...generated, manifest: { ...(generated.manifest || {}), datasetVersion: sourceVersion } }, { replace: true });
  if (migrated.datasetVersion !== expectedVersion) failures.push("corpus:dataset_version_mismatch");
  if (EXPECTED_JOBS_COUNT === 500 && !toArray(migrated.manifest?.datasetVersionAliases).includes("rome500-experimental-v0.7")) failures.push("corpus:legacy_alias_not_documented");
  return { status: failures.length ? "failed" : "ok", datasetVersion: migrated.datasetVersion, aliases: migrated.manifest?.datasetVersionAliases || [], failures };
}

function validateCorpusConsistency(app, generatedTarget = {}, generatedBaseline = {}) {
  const failures = [];
  const targetCodes = ["G1201", "G1202", "G1203", "K1201", "K1207", "K1307", "G1204", "K2106", "J1104", "J1202", "J1405", "J1407", "J1506", "N1210", "M1501", "D1424", "I1309", "N4109"];
  const baselineCodes = new Set(toArray(generatedBaseline.jobs).map(job => job.romeCode));
  const targetSummary = new Map(toArray(generatedTarget.accessSummary).map(row => [row.romeCode, row]));
  const baselineSummary = new Map(toArray(generatedBaseline.accessSummary).map(row => [row.romeCode, row]));
  const commonCodes = targetCodes.filter(code => baselineCodes.has(code));
  const rows = {};
  for (const code of commonCodes) {
    const left = baselineSummary.get(code);
    const right = targetSummary.get(code);
    const fields = ["requirementKind", "specificCredentialRequired", "mandatoryQualification", "regulated", "contradictoryEvidence"];
    const mismatches = fields.filter(field => left?.[field] !== right?.[field]);
    if (left?.trainingDuration?.category !== right?.trainingDuration?.category) mismatches.push("trainingDuration.category");
    if (toArray(left?.accessPaths).length !== toArray(right?.accessPaths).length) mismatches.push("accessPaths.length");
    rows[code] = { baseline: left || null, target: right || null, mismatches };
    failures.push(...mismatches.map(field => `corpus-consistency:${code}:${field}`));
  }
  const previousDataset = app.App.state.dataset;
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generatedBaseline, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generatedBaseline.manifest);
  for (const code of commonCodes) {
    const runtime = findJobByCode(app.App.state.dataset.jobs, code)?.accessSummary;
    if (!runtime) failures.push(`corpus-consistency:${code}:missing_runtime_baseline`);
  }
  app.App.state.dataset = previousDataset;
  return { status: failures.length ? "failed" : "ok", commonCodes, rows, failures };
}

export function validateCedricScenario(app, envelope = null) {
  const failures = [];
  const integratedFallback = app.DIAGNOSTIC_TEST_PROFILES_V052.find(item => item.id === "enfance-relation")?.profile || {};
  const raw = envelope ? envelope.profile || envelope.data || envelope : integratedFallback;
  const profile = app.normalizeProfile({
    ...raw,
    hasRequestedResults: true,
    jobExperiences: [
      { romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes", recency: "recent", masteryLevel: "advanced", source: "user_direct" },
      { romeCode: "M1805", title: "Études et développement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no", recency: "recent", masteryLevel: "autonomous", source: "user_direct" }
    ]
  });
  app.App.state.profile = profile;
  const results = app.calculateAllMatches(profile, app.App.state.dataset);
  app.App.state.results = results;
  const byCode = new Map(results.completeList.map(result => [result.job?.romeCode || result.romeCode, result]));
  const targetCodes = ["G1201", "G1202", "G1203", "G1204", "G1235", "G1238", "K1201", "K1207", "K1224", "K1307", "K2106", "M1805", "J1104", "J1202", "J1405", "J1407", "J1506", "N1210", "M1501", "D1424", "I1309", "N4109"];
  const rows = Object.fromEntries(targetCodes.map(code => {
    const result = byCode.get(code);
    const job = result?.job;
    return [code, result ? {
      title: result.title,
      rank: results.completeList.indexOf(result) + 1,
      score: result.globalScore,
      status: result.status,
      trainingStatus: result.scoreDetails?.training?.statusHint,
      trainingDuration: result.scoreDetails?.training?.trainingDuration || null,
      missingCertifications: result.scoreDetails?.training?.missingCertifications || [],
      confirmedConstraints: result.scoreDetails?.constraints?.confirmedConstraints || [],
      constraintUncertainties: result.scoreDetails?.constraints?.uncertainties || [],
      negativeReasons: result.negativeReasons || [],
      primarySectorId: job ? app.getJobSectorProfile(job).primarySectorId : null,
      secondarySectorIds: job ? app.getJobSectorProfile(job).secondarySectorIds : [],
      boussoleDomainLabel: job?.boussoleDomainLabel || null,
      accessPaths: result.scoreDetails?.training?.accessFeasibility?.accessPaths || []
    } : null];
  }));
  const top5 = results.top5.map(result => ({ romeCode: result.job?.romeCode || result.romeCode, title: result.title, score: result.globalScore, status: result.status, top5ThemeId: result.top5ThemeId, top5ThemeLabel: result.top5ThemeLabel, mainReason: result.resultInterpretation?.mainReason || result.positiveReasons?.[0] || null }));
  const constraintUnknownAsStrong = results.completeList.filter(result => {
    const detail = result.scoreDetails?.constraints || {};
    return detail.activeCount > 0 && detail.unknownCount === detail.activeCount && result.scores?.constraints >= 14;
  });
  const ambiguousConstraintPositives = results.completeList.filter(result =>
    toArray(result.scoreDetails?.constraints?.matchedConstraints).some(label => /^(Permis obligatoire|Port de charges|Bruit important)$/i.test(label))
  );
  const falseCompatibleReasons = results.completeList.filter(result => {
    const detail = result.scoreDetails?.constraints || {};
    return detail.activeCount > 0 && detail.unknownCount > detail.activeCount / 2 && /contraintes.*compatibles/i.test(JSON.stringify(result.positiveReasons || []));
  });
  const mediumPrefixHardExclusions = results.completeList.filter(result => toArray(result.exclusionReasons).some(reason =>
    reason.sectorDecision?.hardExclusion && /prefix/.test(reason.sectorDecision?.mapping?.source || "") && Number(reason.sectorDecision?.mapping?.confidence || 0) < 0.8
  ));
  const possibleNowWithMissingAccess = results.completeList.filter(result => result.status === "possible_now" && (
    toArray(result.scoreDetails?.training?.missingCertifications).length || toArray(result.scoreDetails?.training?.missingExams).length
  ));
  if (constraintUnknownAsStrong.length) failures.push(`cedric:unknown_constraints_rewarded_${constraintUnknownAsStrong.length}`);
  if (ambiguousConstraintPositives.length) failures.push(`cedric:ambiguous_constraint_positives_${ambiguousConstraintPositives.length}`);
  if (falseCompatibleReasons.length) failures.push(`cedric:false_constraint_compatibility_reason_${falseCompatibleReasons.length}`);
  if (mediumPrefixHardExclusions.length) failures.push(`cedric:medium_prefix_hard_exclusions_${mediumPrefixHardExclusions.length}`);
  if (possibleNowWithMissingAccess.length) failures.push(`cedric:possible_now_with_missing_access_${possibleNowWithMissingAccess.length}`);
  if (top5[0]?.romeCode !== "G1203") failures.push(`cedric:G1203_not_first_${top5[0]?.romeCode || "missing"}`);
  if (new Set(top5.map(item => item.top5ThemeId)).size !== top5.length) failures.push("cedric:duplicate_top5_theme");
  if (top5.filter(item => ["G1203", "G1235"].includes(item.romeCode)).length > 1) failures.push("cedric:animation_variants_repeat_top5");
  if (top5.some(item => item.romeCode === "M1805")) failures.push("cedric:M1805_unwanted_in_top5");
  if (results.completeList.slice(0, 15).some(item => item.romeCode === "M1805")) failures.push("cedric:M1805_unwanted_in_top15");
  if (rows.G1202?.primarySectorId !== "culture_communication" || !rows.G1202?.secondarySectorIds.includes("education_enfance")) failures.push("cedric:G1202_bad_sector");
  for (const code of ["K1207", "K1307", "J1104", "J1202", "J1405", "J1407", "J1506"]) {
    if (["possible_now", "possible_with_small_adjustment", "possible_after_short_training"].includes(rows[code]?.status)) failures.push(`cedric:${code}:access_too_easy_${rows[code]?.status}`);
  }
  if (rows.K2106?.trainingStatus !== "access_to_verify" || rows.K2106?.accessPaths.length < 3) failures.push("cedric:K2106_parallel_routes_not_prudent");
  if (!/faisabilité demande des vérifications/i.test(byCode.get("K2106")?.resultInterpretation?.mainReason || "")) failures.push("cedric:K2106_main_reason_not_prudent");
  if (rows.K2106?.accessPaths.some(path => !path.eligibilityStatus || !path.examStatus || !path.practiceStatus || !path.nextAction)) failures.push("cedric:K2106_path_evaluation_incomplete");
  if (rows.K2106?.accessPaths.some(path => path.practiceStatus === "accessible_now")) failures.push("cedric:K2106_practice_must_not_be_immediate");
  const thirdCrpe = rows.K2106?.accessPaths.find(path => path.pathId === "k2106-crpe-troisieme-concours");
  if (thirdCrpe?.eligibilityStatus !== "to_verify" || !thirdCrpe?.missingRequirements?.some(item => /contrat|activit/i.test(item))) failures.push("cedric:K2106_third_exam_scope_must_be_verified");
  if (rows.G1203?.confirmedConstraints.some(item => /formation longue/i.test(item))) failures.push("cedric:G1203_unknown_training_presented_as_confirmed");
  if (rows.G1203?.negativeReasons.some(item => /formation longue/i.test(item))) failures.push("cedric:G1203_unknown_training_presented_as_vigilance");
  for (const code of ["K1201", "K1207", "J1104", "J1202", "J1407", "J1506"]) {
    if (rows[code]?.trainingStatus !== "long" || rows[code]?.trainingDuration?.category !== "long") failures.push(`cedric:${code}_long_access_not_preserved`);
  }
  for (const code of ["K1307", "G1204", "J1405"]) {
    if (rows[code]?.trainingStatus !== "access_to_verify") failures.push(`cedric:${code}_unknown_or_intermediate_access_not_prudent`);
  }
  for (const code of ["I1309", "N4109"]) {
    if (rows[code]?.trainingStatus !== "short" || rows[code]?.trainingDuration?.category !== "short") failures.push(`cedric:${code}_short_access_not_preserved`);
  }

  const contradictoryTextFailures = results.completeList.filter(result => {
    const text = JSON.stringify({ status: result.status, negativeReasons: result.negativeReasons, interpretation: result.resultInterpretation, diagnostic: result.diagnostic || null });
    return ["possible_after_long_training", "explore_with_caution"].includes(result.status) && /petite marche/i.test(text);
  });
  if (contradictoryTextFailures.length) failures.push(`cedric:contradictory_small_step_text_${contradictoryTextFailures.length}`);

  const modeChecks = {};
  const criteria = app.mapUserProfileToCriteria(profile);
  for (const mode of ["essential", "detailed", "diagnostic"]) {
    app.App.state.displayMode = mode;
    const g1202 = byCode.get("G1202");
    const k2106 = byCode.get("K2106");
    const gHtml = app.renderJobDetailsPanelContent(g1202);
    const kHtml = app.renderJobDetailsPanelContent(k2106);
    modeChecks[mode] = {
      g1202SectorVisible: gHtml.includes("Culture, création, loisirs et animation"),
      sourceDomainVisibleWhenExpected: mode === "essential" || gHtml.includes("Domaine / famille ROME"),
      k2106CrpeVisible: kHtml.includes("CRPE"),
      k2106PathsVisibleWhenExpected: mode === "essential" || kHtml.includes("Voies d’accès distinctes"),
      k2106NoCapAepe: !/CAP AEPE/i.test(kHtml),
      k2106ExamNotCertification: !/certification à vérifier[^<]*(CRPE|concours)|qualification[^<]*(CRPE|concours)/i.test(kHtml),
      k2106ContestTruthVisible: mode === "essential" || /concours requis ; réussite non renseignée/i.test(kHtml)
    };
    if (!Object.values(modeChecks[mode]).every(Boolean)) failures.push(`cedric:display_${mode}_failed`);
  }
  app.App.state.displayMode = "essential";
  const profileRoundTrip = app.normalizeProfile(JSON.parse(JSON.stringify({ profile })).profile);
  const compactDataset = app.prepareCompactDatasetExport(app.App.state.dataset);
  const compactRoundTrip = app.validateDataset(compactDataset);
  const compactG1203 = findJobByCode(compactRoundTrip.normalized?.jobs, "G1203");
  const exports = {
    profile: profileRoundTrip.jobExperiences.length === 2,
    results: app.prepareCompactResultsForExport(results).top5.length === 5,
    diagnostic: app.buildResultDiagnosticExport(results)?.top5?.length === 5,
    bench: Boolean(app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052)?.summary),
    compactCorpus: compactDataset.jobs.length === EXPECTED_JOBS_COUNT,
    compactFapRoundTrip: compactRoundTrip.valid && compactG1203?.marketStats?.fapEnrichment?.fapMappings?.some(item => item.fapCode === "V5X81") && compactG1203.marketStats.fapEnrichment.territories?.["DEP-11"]?.[0]?.bmo?.recruitmentProjects?.value === 157,
    diagnosticCorpus: app.App.state.dataset.jobs.length === EXPECTED_JOBS_COUNT,
    quality: app.App.state.dataset.accessSummaryQualityReport?.summary?.truthFailuresCount === 0,
    buildIdentity: [app.prepareCompactResultsForExport(results), app.buildResultDiagnosticExport(results), app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052), app.prepareCompactDatasetExport(app.App.state.dataset)].every(item => item.build?.buildId === app.getBuildMetadata().buildId),
    markdownBuild: app.resultsToMarkdown(results).includes(`Build : ${app.getBuildMetadata().buildId}`)
  };
  for (const [name, ok] of Object.entries(exports)) if (!ok) failures.push(`cedric:export_${name}_failed`);
  return {
    status: failures.length ? "failed" : "ok",
    scenarioId: "technical_profile_with_declared_experience",
    top5,
    rows,
    constraintAudit: {
      unknownAsStrongCount: constraintUnknownAsStrong.length,
      ambiguousPositiveLabelsCount: ambiguousConstraintPositives.length,
      falseCompatibleReasonsCount: falseCompatibleReasons.length
    },
    sectorAudit: { mediumPrefixHardExclusionsCount: mediumPrefixHardExclusions.length },
    accessAudit: { possibleNowWithMissingAccessCount: possibleNowWithMissingAccess.length },
    modeChecks,
    exports,
    criteriaDiplomaLevel: criteria.education.highestLevel,
    failures
  };
}

export async function loadGeneratedBundle(directory = ROME500_DIR, options = {}) {
  return {
    manifest: await readJson(path.join(directory, "import-manifest.rome.json"), {}),
    runtimeBundleManifest: await readJson(path.join(directory, "runtime-bundle-manifest.json"), null),
    jobs: await readJson(path.join(directory, "jobs.rome.json"), []),
    skills: await readJson(path.join(directory, "skills.rome.json"), []),
    skillsEngine: await readJson(path.join(directory, "skills-engine.rome.json"), []),
    skillIntegrityReport: await readJson(path.join(directory, "skill-reference-integrity-report.json"), null),
    knowledge: await readJson(path.join(directory, "knowledge.rome.json"), []),
    certificationLike: await readJson(path.join(directory, "certification-like.rome.json"), []),
    matchableSkills: await readJson(path.join(directory, "skills-matchable.rome.json"), []),
    workContexts: await readJson(path.join(directory, "work-contexts.rome.json"), []),
    jobAppellations: await readJson(path.join(directory, "job-appellations.rome.json"), []),
    mappings: await readJson(path.join(directory, "mappings.rome.json"), []),
    qualityReport: await readJson(path.join(directory, "data-quality-report.rome.json"), {}),
    accessSummary: await readJson(path.join(directory, options.accessSummaryFile || ACCESS_SUMMARY_FILE), []),
    accessSummaryQualityReport: await readJson(path.join(directory, "access-summary-quality-report.json"), null),
    officialConstraintSummary: await readJson(path.join(directory, options.constraintSummaryFile || CONSTRAINT_SUMMARY_FILE), []),
    marketManifest: await readJson(path.join(MARKET_DIR, "market-import-manifest.json"), null),
    marketQualityReport: await readJson(path.join(MARKET_DIR, "market-quality-report.json"), null),
    marketPackageIdentity: await readJson(path.join(MARKET_DIR, "market-package-identity.json"), null),
    marketTemporalContract: await readJson(path.join(MARKET_DIR, "market-temporal-contract.json"), null),
    marketTrends: await readJson(path.join(MARKET_DIR, options.marketTrendsFile || `market-trends.rome${EXPECTED_JOBS_COUNT}.json`), null),
    marketNational: await readJson(path.join(MARKET_DIR, "market-national.rome.json"), []),
    marketOccitanie: await readJson(path.join(MARKET_DIR, "market-occitanie.rome.json"), []),
    marketAude: await readJson(path.join(MARKET_DIR, "market-aude.rome.json"), []),
    marketFapEnrichment: await readJson(path.join(MARKET_DIR, options.marketEnrichmentFile || MARKET_ENRICHMENT_FILE), [])
  };
}

export function loadBoussoleEngine(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    ?.replace('document.addEventListener("DOMContentLoaded", initApp);', "");
  if (!script) throw new Error("Impossible d’extraire le script de Boussole Pro.");
  const noop = () => {};
  const fakeElement = () => ({
    addEventListener: noop,
    removeEventListener: noop,
    classList: { add: noop, remove: noop, toggle: noop },
    style: {},
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    removeAttribute: noop,
    appendChild: noop,
    remove: noop,
    click: noop,
    focus: noop,
    innerHTML: ""
  });
  const context = {
    console,
    structuredClone: globalThis.structuredClone,
    setTimeout,
    clearTimeout,
    Blob: function Blob() {},
    URL: { createObjectURL: () => "", revokeObjectURL: noop },
    FileReader: function FileReader() {},
    crypto: { randomUUID: () => Math.random().toString(36).slice(2) },
    performance: { now: () => Date.now() },
    window: { setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), CSS: { escape: value => String(value) } },
    document: { addEventListener: noop, getElementById: () => fakeElement(), body: fakeElement(), createElement: () => fakeElement() },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    location: { protocol: "http:" },
    navigator: {}
  };
  context.window = Object.assign(context.window, context);
  vm.createContext(context);
  vm.runInContext(`${script}
this.__boussole = {
  App,
  mergeGeneratedDatasetIntoApp,
  markDatasetAsOfficialRome,
  normalizeProfile,
  createEmptyProfile,
  createBrowserPerformanceReport,
  setConstraintSeverity,
  mapUserProfileToCriteria,
  calculateTrainingScore,
  calculateConstraintScore,
  calculateContextScore,
  calculateAllMatches,
  diversifyTopResults,
  inferTop5Theme,
  interpretMarketSynthesis,
  getJobSectorProfile,
  evaluateSectorExclusionDecision,
  createExplorationResultShell,
  renderJobDetailsPanelContent,
  prepareCompactResultsForExport,
  buildResultDiagnosticExport,
  runDiagnosticProfiles,
  DIAGNOSTIC_TEST_PROFILES_V052,
  prepareCompactDatasetExport,
  validateDataset,
  markDatasetAsRealImport,
  shouldReloadPackagedCorpus,
  resultsToMarkdown,
  getBuildMetadata,
  getRuntimeBundleIdentity,
  assessRuntimeBundleCompatibility,
  getJobMarketSynthesis: typeof getJobMarketSynthesis === "function" ? getJobMarketSynthesis : null,
  renderMarketOneLineSummary: typeof renderMarketOneLineSummary === "function" ? renderMarketOneLineSummary : null,
  renderMarketDetailModal: typeof renderMarketDetailModal === "function" ? renderMarketDetailModal : null,
  getMarketLayerIdentity: typeof getMarketLayerIdentity === "function" ? getMarketLayerIdentity : null,
  assessMarketLayerCompatibility: typeof assessMarketLayerCompatibility === "function" ? assessMarketLayerCompatibility : null,
  runtimeComponentCounts
};`, context, { timeout: 15000 });
  return context.__boussole;
}

function findJobByCode(jobs = [], code = "") {
  return jobs.find(job => job.romeCode === code);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function unique(items = []) {
  return [...new Set(toArray(items).filter(Boolean))];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
