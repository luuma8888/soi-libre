import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const MARKET_DIR = path.join(GENERATED_DIR, "market");

const SECTOR_EXPECTATIONS = {
  G1201: { primary: "hotellerie_hebergement", forbidden: ["education_enfance"] },
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
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);

  const report = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_v073_consolidation_validation",
    generatedAt: new Date().toISOString(),
    sourceArtifactSha256: htmlSha256,
    datasetVersion: app.App.state.dataset.datasetVersion,
    jobsCount: app.App.state.dataset.jobs.length,
    checks: {},
    failures: [],
    status: "ok"
  };

  report.checks.sectors = validateSectors(app);
  report.checks.access = validateAccess(app);
  report.checks.training = validateTraining(app);
  report.checks.context = validateContext(app);

  for (const group of Object.values(report.checks)) {
    for (const failure of group.failures || []) report.failures.push(failure);
  }
  report.status = report.failures.length ? "failed" : "ok";

  await writeFile(path.join(GENERATED_DIR, "boussole-v073-consolidation-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.status !== "ok") {
    throw new Error(`[Boussole Pro] Validation v0.7.3 échouée: ${report.failures.join(", ")}`);
  }
  console.log(`[Boussole Pro] Validation v0.7.3 OK (${report.jobsCount} métiers, SHA ${htmlSha256.slice(0, 12)}...).`);
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
    if (expected.primary && runtime?.primarySectorId !== expected.primary) rowFailures.push(`expected_primary_${expected.primary}`);
    if ((expected.forbidden || []).includes(runtime?.primarySectorId)) rowFailures.push(`forbidden_primary_${runtime?.primarySectorId}`);
    if ((expected.forbidden || []).some(id => runtime?.secondarySectorIds?.includes(id))) rowFailures.push("forbidden_secondary_sector");
    rows[code] = { title: job?.title || null, generatedPrimary: job?.primarySectorId || null, runtime, status: rowFailures.length ? "failed" : "ok", failures: rowFailures };
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

function validateAccess(app) {
  const jobs = app.App.state.dataset.jobs;
  const failures = [];
  const rows = {};
  const assert = (condition, code, message) => {
    if (!condition) failures.push(`access:${code}:${message}`);
  };

  for (const code of unique([...NEGATION_CASES, ...NO_DIPLOMA_CASES, ...CAPACITY_CASES, ...Object.keys(RANGE_CASES), "K1201"])) {
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
    interests: ["aider", "accompagner"]
  });
  const criteria = app.mapUserProfileToCriteria(profile);
  const rows = {};
  for (const code of ["K1201", "J1407", "J1506", "G1204", "I1309", "N4109", "C1504"]) {
    const job = findJobByCode(jobs, code);
    const training = job ? app.calculateTrainingScore(criteria, job) : null;
    rows[code] = training;
    if (!job) failures.push(`training:${code}:missing_job`);
    if (training?.missingCertifications?.length && training.statusHint === "short") failures.push(`training:${code}:specific_credential_shortcut`);
  }
  if (rows.K1201?.statusHint === "now" || rows.K1201?.statusHint === "short") failures.push("training:K1201:deass_should_not_be_now_or_short");
  if (!rows.K1201?.missingCertifications?.length) failures.push("training:K1201:deass_missing_certification_not_reported");
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
  getJobSectorProfile
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
