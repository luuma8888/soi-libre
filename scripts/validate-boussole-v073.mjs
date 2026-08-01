import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const MARKET_DIR = path.join(GENERATED_DIR, "market");
const CEDRIC_PROFILE_PATH = path.join(ROOT, "tmp", "monde-pro", "profils tests", "boussole-pro-profil-cedric-2026-07-10.json");

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
  const app = loadBoussoleEngine(html);
  const generated = await loadGeneratedBundle();
  const cedricEnvelope = await readJson(CEDRIC_PROFILE_PATH, null);
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);

  const report = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_v074_targeted_corrections_validation",
    generatedAt: new Date().toISOString(),
    sourceArtifactSha256: htmlSha256,
    datasetVersion: app.App.state.dataset.datasetVersion,
    jobsCount: app.App.state.dataset.jobs.length,
    checks: {},
    failures: [],
    status: "ok"
  };

  report.checks.sectors = validateSectors(app);
  report.checks.jobDisplay = validateJobDisplay(app);
  report.checks.access = validateAccess(app);
  report.checks.accessQuality = validateAccessQuality(generated);
  report.checks.training = validateTraining(app);
  report.checks.context = validateContext(app);
  report.checks.cedricScenario = validateCedricScenario(app, cedricEnvelope);

  for (const group of Object.values(report.checks)) {
    for (const failure of group.failures || []) report.failures.push(failure);
  }
  report.status = report.failures.length ? "failed" : "ok";

  await writeFile(path.join(GENERATED_DIR, "boussole-v074-targeted-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.status !== "ok") {
    throw new Error(`[Boussole Pro] Validation v0.7.4 échouée: ${report.failures.join(", ")}`);
  }
  console.log(`[Boussole Pro] Validation v0.7.4 OK (${report.jobsCount} métiers, SHA ${htmlSha256.slice(0, 12)}...).`);
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
    if (training?.missingCertifications?.length && training.statusHint === "short") failures.push(`training:${code}:specific_credential_shortcut`);
  }
  if (rows.K1201?.statusHint === "now" || rows.K1201?.statusHint === "short") failures.push("training:K1201:deass_should_not_be_now_or_short");
  if (!rows.K1201?.missingCertifications?.length) failures.push("training:K1201:deass_missing_certification_not_reported");
  for (const code of ["K1207", "K1307", "J1104", "J1202", "J1405", "J1407", "J1506"]) {
    if (["now", "short"].includes(rows[code]?.statusHint)) failures.push(`training:${code}:regulated_access_too_easy`);
    if (!rows[code]?.missingCertifications?.length) failures.push(`training:${code}:missing_credential_not_reported`);
  }
  if (rows.K2106?.statusHint !== "access_to_verify") failures.push(`training:K2106:expected_access_to_verify_got_${rows.K2106?.statusHint}`);
  if (toArray(rows.K2106?.accessFeasibility?.accessPaths).length < 3) failures.push("training:K2106:runtime_paths_missing");
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

function validateCedricScenario(app, envelope = null) {
  const failures = [];
  if (!envelope) return { status: "failed", failures: ["cedric:profile_missing"] };
  const raw = envelope.profile || envelope.data || envelope;
  const profile = app.normalizeProfile({
    ...raw,
    hasRequestedResults: true,
    jobExperiences: [
      { romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes", recency: "recent", masteryLevel: "advanced", source: "user_direct" },
      { romeCode: "M1805", title: "Études et développement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no", recency: "old", masteryLevel: "advanced", source: "user_direct" }
    ]
  });
  app.App.state.profile = profile;
  const results = app.calculateAllMatches(profile, app.App.state.dataset);
  app.App.state.results = results;
  const byCode = new Map(results.completeList.map(result => [result.job?.romeCode || result.romeCode, result]));
  const targetCodes = ["G1201", "G1202", "G1203", "K1201", "K1207", "K1307", "K2106", "M1805", "J1104", "J1202", "J1405", "J1407", "J1506"];
  const rows = Object.fromEntries(targetCodes.map(code => {
    const result = byCode.get(code);
    const job = result?.job;
    return [code, result ? {
      title: result.title,
      score: result.globalScore,
      status: result.status,
      trainingStatus: result.scoreDetails?.training?.statusHint,
      missingCertifications: result.scoreDetails?.training?.missingCertifications || [],
      primarySectorId: job ? app.getJobSectorProfile(job).primarySectorId : null,
      secondarySectorIds: job ? app.getJobSectorProfile(job).secondarySectorIds : [],
      boussoleDomainLabel: job?.boussoleDomainLabel || null,
      accessPaths: result.scoreDetails?.training?.accessFeasibility?.accessPaths || []
    } : null];
  }));
  const top5 = results.top5.map(result => ({ romeCode: result.job?.romeCode || result.romeCode, title: result.title, score: result.globalScore, status: result.status, mainReason: result.resultInterpretation?.mainReason || result.positiveReasons?.[0] || null }));
  if (top5[0]?.romeCode !== "G1203") failures.push(`cedric:G1203_not_first_${top5[0]?.romeCode || "missing"}`);
  if (top5.some(item => item.romeCode === "M1805")) failures.push("cedric:M1805_unwanted_in_top5");
  if (rows.G1202?.primarySectorId !== "culture_communication" || !rows.G1202?.secondarySectorIds.includes("education_enfance")) failures.push("cedric:G1202_bad_sector");
  for (const code of ["K1207", "K1307", "J1104", "J1202", "J1405", "J1407", "J1506"]) {
    if (["possible_now", "possible_with_small_adjustment", "possible_after_short_training"].includes(rows[code]?.status)) failures.push(`cedric:${code}:access_too_easy_${rows[code]?.status}`);
  }
  if (rows.K2106?.trainingStatus !== "access_to_verify" || rows.K2106?.accessPaths.length < 3) failures.push("cedric:K2106_parallel_routes_not_prudent");

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
      k2106NoCapAepe: !/CAP AEPE/i.test(kHtml)
    };
    if (!Object.values(modeChecks[mode]).every(Boolean)) failures.push(`cedric:display_${mode}_failed`);
  }
  app.App.state.displayMode = "essential";
  const profileRoundTrip = app.normalizeProfile(JSON.parse(JSON.stringify({ profile })).profile);
  const exports = {
    profile: profileRoundTrip.jobExperiences.length === 2,
    results: app.prepareCompactResultsForExport(results).top5.length === 5,
    diagnostic: app.buildResultDiagnosticExport(results)?.top5?.length === 5,
    bench: Boolean(app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052)?.summary),
    compactCorpus: app.prepareCompactDatasetExport(app.App.state.dataset).jobs.length === 500,
    diagnosticCorpus: app.App.state.dataset.jobs.length === 500,
    quality: app.App.state.dataset.accessSummaryQualityReport?.summary?.truthFailuresCount === 0
  };
  for (const [name, ok] of Object.entries(exports)) if (!ok) failures.push(`cedric:export_${name}_failed`);
  return { status: failures.length ? "failed" : "ok", profileId: profile.id, experiences: profile.jobExperiences, top5, rows, modeChecks, exports, criteriaDiplomaLevel: criteria.education.highestLevel, failures };
}

async function loadGeneratedBundle() {
  return {
    manifest: await readJson(path.join(ROME500_DIR, "import-manifest.rome.json"), {}),
    jobs: await readJson(path.join(ROME500_DIR, "jobs.rome.json"), []),
    skills: await readJson(path.join(ROME500_DIR, "skills.rome.json"), []),
    knowledge: await readJson(path.join(ROME500_DIR, "knowledge.rome.json"), []),
    certificationLike: await readJson(path.join(ROME500_DIR, "certification-like.rome.json"), []),
    matchableSkills: await readJson(path.join(ROME500_DIR, "skills-matchable.rome.json"), []),
    workContexts: await readJson(path.join(ROME500_DIR, "work-contexts.rome.json"), []),
    jobAppellations: await readJson(path.join(ROME500_DIR, "job-appellations.rome.json"), []),
    mappings: await readJson(path.join(ROME500_DIR, "mappings.rome.json"), []),
    qualityReport: await readJson(path.join(ROME500_DIR, "data-quality-report.rome.json"), {}),
    accessSummary: await readJson(path.join(ROME500_DIR, "access-summary.rome500.json"), []),
    accessSummaryQualityReport: await readJson(path.join(ROME500_DIR, "access-summary-quality-report.json"), null),
    officialConstraintSummary: await readJson(path.join(ROME500_DIR, "official-constraint-summary.rome500.json"), []),
    marketManifest: await readJson(path.join(MARKET_DIR, "market-import-manifest.json"), null),
    marketQualityReport: await readJson(path.join(MARKET_DIR, "market-quality-report.json"), null),
    marketNational: await readJson(path.join(MARKET_DIR, "market-national.rome.json"), []),
    marketOccitanie: await readJson(path.join(MARKET_DIR, "market-occitanie.rome.json"), []),
    marketAude: await readJson(path.join(MARKET_DIR, "market-aude.rome.json"), [])
  };
}

function loadBoussoleEngine(html) {
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
  mapUserProfileToCriteria,
  calculateTrainingScore,
  calculateContextScore,
  calculateAllMatches,
  getJobSectorProfile,
  createExplorationResultShell,
  renderJobDetailsPanelContent,
  prepareCompactResultsForExport,
  buildResultDiagnosticExport,
  runDiagnosticProfiles,
  DIAGNOSTIC_TEST_PROFILES_V052,
  prepareCompactDatasetExport
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

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
