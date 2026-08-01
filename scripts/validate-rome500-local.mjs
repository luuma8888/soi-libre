import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const MARKET_DIR = path.join(GENERATED_DIR, "market");

async function main() {
  const app = await loadBoussoleEngine();
  const rome72 = await buildDataset(app, GENERATED_DIR, MARKET_DIR, "ROME 72");
  const rome500 = await buildDataset(app, ROME500_DIR, MARKET_DIR, "ROME 500 expérimental");

  const report72 = runRegression(app, rome72, "rome72");
  const report500 = runRegression(app, rome500, "rome500");
  const comparison = buildComparisonReport(report72, report500);

  app.App.state.dataset = rome500.dataset;
  app.App.state.profile = app.normalizeProfile({});
  const essentialCoverage = buildEssentialCoverageReport(app, rome500);
  const explorationCoverage = buildExplorationCoverageReport(app, rome500);

  await mkdir(GENERATED_DIR, { recursive: true });
  await writeJson(path.join(GENERATED_DIR, "matching-regression-report.rome72.json"), report72);
  await writeJson(path.join(GENERATED_DIR, "matching-regression-report.rome500.json"), report500);
  await writeJson(path.join(GENERATED_DIR, "rome72-vs-rome500-regression-report.json"), comparison);
  await writeJson(path.join(GENERATED_DIR, "essential-jobs-coverage-report.json"), essentialCoverage);
  await writeJson(path.join(GENERATED_DIR, "exploration-filter-coverage-report.json"), explorationCoverage);
  if (essentialCoverage.sectorMappingRegression?.status !== "ok") {
    throw new Error("[Boussole Pro] Régression mapping secteur G1203 détectée : le métier reste classé côté restauration/hôtellerie.");
  }

  console.log(`[Boussole Pro] Validation ROME500: ${rome500.dataset.jobs.length} métiers, marché FR ${essentialCoverage.marketCoverage.jobsWithNationalMarket}, Occitanie ${essentialCoverage.marketCoverage.jobsWithRegionalMarket}, Aude ${essentialCoverage.marketCoverage.jobsWithDepartmentalMarket}.`);
  console.log(`[Boussole Pro] Propreté/hôtellerie Top 5: ${findProfileTop(report500, "proprete-hotellerie-accessible").join(", ") || "non trouvé"}.`);
}

async function loadBoussoleEngine() {
  const html = await readFile(HTML_PATH, "utf8");
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
  CONFIG,
  DIAGNOSTIC_TEST_PROFILES_V052,
  mergeGeneratedDatasetIntoApp,
  markDatasetAsOfficialRome,
  runDiagnosticProfiles,
  calculateMarketCoverage,
  mapUserProfileToCriteria,
  normalizeProfile,
  collectJobContextTags,
  explorationContextMatches,
  getJobSectorProfile
};`, context, { timeout: 15000 });
  return context.__boussole;
}

async function buildDataset(app, generatedDir, marketDir, label) {
  const generated = {
    manifest: await readJson(path.join(generatedDir, "import-manifest.rome.json"), {}),
    jobs: await readJson(path.join(generatedDir, "jobs.rome.json"), []),
    skills: await readJson(path.join(generatedDir, "skills.rome.json"), []),
    knowledge: await readJson(path.join(generatedDir, "knowledge.rome.json"), []),
    certificationLike: await readJson(path.join(generatedDir, "certification-like.rome.json"), []),
    matchableSkills: await readJson(path.join(generatedDir, "skills-matchable.rome.json"), []),
    workContexts: await readJson(path.join(generatedDir, "work-contexts.rome.json"), []),
    jobAppellations: await readJson(path.join(generatedDir, "job-appellations.rome.json"), []),
    mappings: await readJson(path.join(generatedDir, "mappings.rome.json"), []),
    qualityReport: await readJson(path.join(generatedDir, "data-quality-report.rome.json"), {}),
    marketManifest: await readJson(path.join(marketDir, "market-import-manifest.json"), null),
    marketQualityReport: await readJson(path.join(marketDir, "market-quality-report.json"), null),
    marketNational: await readJson(path.join(marketDir, "market-national.rome.json"), []),
    marketOccitanie: await readJson(path.join(marketDir, "market-occitanie.rome.json"), []),
    marketAude: await readJson(path.join(marketDir, "market-aude.rome.json"), [])
  };
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);
  return { label, generatedDir, marketDir, generated, dataset: app.App.state.dataset };
}

function runRegression(app, datasetBundle, corpusKey) {
  app.App.state.dataset = datasetBundle.dataset;
  app.App.state.profile = app.normalizeProfile({});
  const report = app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052);
  const marketCoverage = app.calculateMarketCoverage(datasetBundle.dataset, {});
  return {
    ...report,
    reportKind: `matching_regression_${corpusKey}`,
    corpusKey,
    datasetLabel: datasetBundle.label,
    datasetVersion: datasetBundle.dataset.datasetVersion || report.datasetVersion,
    jobsCount: datasetBundle.dataset.jobs.length,
    marketCoverage,
    rows: report.rows.map(row => ({
      ...row,
      scoreDistribution: scoreDistribution(row.top5.map(item => item.score)),
      expectedJobsEvaluation: row.expectedJobsEvaluation
    }))
  };
}

function buildComparisonReport(report72, report500) {
  const rows72 = new Map(report72.rows.map(row => [row.id, row]));
  const rows500 = new Map(report500.rows.map(row => [row.id, row]));
  const profiles = [...new Set([...rows72.keys(), ...rows500.keys()])].map(profileId => {
    const left = rows72.get(profileId) || {};
    const right = rows500.get(profileId) || {};
    const top72 = (left.top5 || []).map(item => item.romeCode).filter(Boolean);
    const top500 = (right.top5 || []).map(item => item.romeCode).filter(Boolean);
    const expected72 = left.expectedJobsEvaluation || [];
    const expected500 = right.expectedJobsEvaluation || [];
    return {
      profileId,
      title: right.title || left.title || profileId,
      top5Rome72: top72,
      top5Rome500: top500,
      expectedJobsRome72: expected72,
      expectedJobsRome500: expected500,
      scoreDistributionRome72: left.scoreDistribution || scoreDistribution((left.top5 || []).map(item => item.score)),
      scoreDistributionRome500: right.scoreDistribution || scoreDistribution((right.top5 || []).map(item => item.score)),
      improvements: compareProfileImprovements(left, right),
      regressions: compareProfileRegressions(left, right)
    };
  });
  return {
    schemaVersion: "1.0.0",
    reportKind: "rome72_vs_rome500_regression",
    generatedAt: new Date().toISOString(),
    rome72: { datasetVersion: report72.datasetVersion, jobsCount: report72.jobsCount, marketCoverage: report72.marketCoverage },
    rome500: { datasetVersion: report500.datasetVersion, jobsCount: report500.jobsCount, marketCoverage: report500.marketCoverage },
    profiles,
    summary: {
      profilesCompared: profiles.length,
      profilesWithMoreDiverseTop5: profiles.filter(row => unique(row.top5Rome500).length > unique(row.top5Rome72).length).length,
      blockingRegressions: profiles.flatMap(row => row.regressions).filter(item => item.severity === "blocking").length,
      warnings: [
        "Le marché pèse peu dans les profils tests : il départage, mais ne remplace pas la cohérence profil/métier.",
        "Les métiers attendus absents du corpus sont signalés comme not_in_active_corpus, pas comme échec moteur."
      ]
    }
  };
}

function compareProfileImprovements(left = {}, right = {}) {
  const improvements = [];
  const leftExpected = countExpectedInTop(left);
  const rightExpected = countExpectedInTop(right);
  if (rightExpected > leftExpected) improvements.push({ type: "expected_jobs_better_ranked", from: leftExpected, to: rightExpected });
  if (unique((right.top5 || []).map(item => item.family)).length > unique((left.top5 || []).map(item => item.family)).length) improvements.push({ type: "top5_family_diversity_improved" });
  if ((right.profileEvidence?.resolvedSkillsCount || 0) > (left.profileEvidence?.resolvedSkillsCount || 0)) improvements.push({ type: "profile_skill_evidence_improved" });
  return improvements;
}

function compareProfileRegressions(left = {}, right = {}) {
  const regressions = [];
  const leftExpected = countExpectedInTop(left);
  const rightExpected = countExpectedInTop(right);
  if (rightExpected < leftExpected) regressions.push({ type: "expected_jobs_less_visible", severity: "warning", from: leftExpected, to: rightExpected });
  if ((right.anomalies || []).some(item => item.severity === "blocking")) regressions.push({ type: "blocking_anomaly", severity: "blocking" });
  return regressions;
}

function countExpectedInTop(row = {}) {
  const topCodes = new Set((row.top5 || []).map(item => item.romeCode).filter(Boolean));
  return (row.expectedJobsEvaluation || []).filter(item => item.presentInCorpus !== false && topCodes.has(item.romeCode)).length;
}

function buildEssentialCoverageReport(app, bundle) {
  const jobs = bundle.dataset.jobs || [];
  const expectedCodes = unique(app.DIAGNOSTIC_TEST_PROFILES_V052.flatMap(test => test.expectedRomeCodes || test.expectedJobs || []));
  const presentCodes = new Set(jobs.map(job => job.romeCode).filter(Boolean));
  const sectorCounts = countBy(jobs.flatMap(job => job.boussoleSectorIds?.length ? job.boussoleSectorIds : [job.primarySectorId || "unknown"]));
  const familyCounts = countBy(jobs.map(job => job.family || "Famille non renseignée"));
  const marketCoverage = app.calculateMarketCoverage(bundle.dataset, {});
  const sectorMappingRegression = buildSectorMappingRegression(app, bundle);
  return {
    schemaVersion: "1.0.0",
    reportKind: "essential_jobs_coverage_rome500",
    generatedAt: new Date().toISOString(),
    datasetVersion: bundle.dataset.datasetVersion,
    jobsCount: jobs.length,
    officialRomeDomains: countBy(jobs.map(job => job.officialRomeDomain?.label || job.family || "Non renseigné")),
    boussoleSectors: sectorCounts,
    romePrefixes: countBy(jobs.map(job => String(job.romeCode || "?").charAt(0))),
    expectedCodes: {
      total: expectedCodes.length,
      present: expectedCodes.filter(code => presentCodes.has(code)),
      absent: expectedCodes.filter(code => !presentCodes.has(code))
    },
    underRepresentedFamilies: Object.entries(familyCounts)
      .filter(([, count]) => count <= 2)
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => a.count - b.count || a.family.localeCompare(b.family, "fr")),
    marketCoverage,
    sectorMappingRegression,
    status: jobs.length >= 500 && marketCoverage.jobsWithNationalMarket > 0 && sectorMappingRegression.status === "ok" ? "ok" : "completed_with_warnings"
  };
}

function buildSectorMappingRegression(app, bundle) {
  const job = (bundle.dataset.jobs || []).find(row => row.romeCode === "G1203");
  const runtimeSector = job ? app.getJobSectorProfile(job) : {};
  const generatedSectorText = normalizeAuditText([
    job?.boussoleDomainLabel,
    job?.primarySectorId,
    ...toArray(job?.boussoleSectorIds)
  ].join(" "));
  const checks = {
    g1203Present: Boolean(job),
    g1203GeneratedPrimaryEducation: job?.primarySectorId === "education_enfance",
    g1203RuntimePrimaryEducation: runtimeSector?.primarySectorId === "education_enfance",
    g1203GeneratedNotRestauration: !/(restauration|hotellerie|tourisme)/.test(generatedSectorText)
  };
  return {
    status: Object.values(checks).every(Boolean) ? "ok" : "failed",
    checks,
    g1203: job ? {
      title: job.title,
      domain: job.domain,
      family: job.family,
      boussoleSectorIds: job.boussoleSectorIds || [],
      primarySectorId: job.primarySectorId,
      secondarySectorIds: job.secondarySectorIds || [],
      runtimePrimarySectorId: runtimeSector?.primarySectorId || "unknown",
      runtimeSecondarySectorIds: runtimeSector?.secondarySectorIds || []
    } : null
  };
}

function buildExplorationCoverageReport(app, bundle) {
  const jobs = bundle.dataset.jobs || [];
  const filters = ["office", "quiet", "outdoor", "home", "children", "animals", "hospitality", "team", "remote"];
  const filterRows = Object.fromEntries(filters.map(filter => {
    const matches = jobs.filter(job => app.explorationContextMatches(job, filter));
    return [filter, {
      count: matches.length,
      sampleRomeCodes: matches.slice(0, 20).map(job => job.romeCode).filter(Boolean),
      sampleTitles: matches.slice(0, 8).map(job => job.title)
    }];
  }));
  const usedCanonicalTags = countBy(jobs.flatMap(job => app.collectJobContextTags(job)));
  const checks = {
    childrenIncludesK1303: filterRows.children.sampleRomeCodes.includes("K1303") || jobs.some(job => job.romeCode === "K1303" && app.explorationContextMatches(job, "children")),
    childrenIncludesJ1304: filterRows.children.sampleRomeCodes.includes("J1304") || jobs.some(job => job.romeCode === "J1304" && app.explorationContextMatches(job, "children")),
    childrenIncludesK2106: filterRows.children.sampleRomeCodes.includes("K2106") || jobs.some(job => job.romeCode === "K2106" && app.explorationContextMatches(job, "children")),
    outdoorHasNatureJobs: jobs.some(job => /^A/.test(job.romeCode || "") && app.explorationContextMatches(job, "outdoor")),
    homeHasHomeJobs: filterRows.home.count > 0,
    hospitalityHasJobs: filterRows.hospitality.count > 0
  };
  return {
    schemaVersion: "1.0.0",
    reportKind: "exploration_filter_coverage_rome500",
    generatedAt: new Date().toISOString(),
    datasetVersion: bundle.dataset.datasetVersion,
    jobsCount: jobs.length,
    filters: filterRows,
    usedCanonicalTags,
    checks,
    status: Object.values(checks).every(Boolean) ? "ok" : "completed_with_warnings",
    recommendations: [
      "Conserver les identifiants ROME officiels et maintenir la couche canonicalTags pour les filtres communs.",
      "Ajouter un filtre uniquement s’il renvoie assez de métiers pour éviter les options vides."
    ]
  };
}

function findProfileTop(report, profileId) {
  const row = report.rows.find(item => item.id === profileId);
  return row ? row.top5.map(item => `${item.romeCode} ${item.title}`) : [];
}

function scoreDistribution(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  return {
    low: clean.filter(value => value < 45).length,
    medium: clean.filter(value => value >= 45 && value < 70).length,
    high: clean.filter(value => value >= 70).length,
    min: clean.length ? Math.min(...clean) : null,
    max: clean.length ? Math.max(...clean) : null,
    average: clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function countBy(values = []) {
  return values.filter(Boolean).reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeAuditText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
