import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations/boussolepro");
const CLASSIC_PATH = path.join(APP_DIR, "boussole-pro-classic-v0.8.4.html");
const APP_PATH = path.join(APP_DIR, "boussole-pro.html");
const RUNTIME_DIR = path.join(APP_DIR, "data/generated/rome1000-candidate");
const MARKET_DIR = path.join(APP_DIR, "data/generated/market");
const OUTPUT_DIR = path.join(APP_DIR, "data/generated/refonte-v1");
const TMP_DIR = path.join(ROOT, "tmp/monde-pro/refonte-interface-v1");
const PROFILE_PATH = path.join(ROOT, "tmp/monde-pro/profils tests/boussole-pro-profil-cedric-2026-07-10.json");

const sha256 = value => createHash("sha256").update(value).digest("hex");
const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
};

const classicHtml = await readFile(CLASSIC_PATH, "utf8");
const refonteTemplate = await readFile(APP_PATH, "utf8");
const engineScript = classicHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  ?.replace('document.addEventListener("DOMContentLoaded", initApp);', "")
  .trim();
if (!engineScript) throw new Error("Le moteur classique n'a pas pu etre extrait.");
if (engineScript.includes("</script>")) throw new Error("Le moteur contient une fermeture script non integrable telle quelle.");

const app = loadClassicEngine(engineScript);
const bundle = await loadGeneratedBundle();
app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(bundle, { replace: true });
app.markDatasetAsOfficialRome(app.App.state.dataset, bundle.manifest);

const profileEnvelope = await readJson(PROFILE_PATH);
const profile = app.normalizeProfile({
  ...(profileEnvelope.profile || profileEnvelope),
  hasRequestedResults: true,
  completedBoussole: true
});
app.App.state.profile = profile;
app.App.state.displayMode = "essential";
const fullResults = app.calculateAllMatches(profile, app.App.state.dataset, { skipAudit: true });
const selectedResults = selectStratifiedResults(fullResults);
const selectedIds = new Set(selectedResults.map(result => result.jobId));
const prototypeDataset = compactPrototypeDataset(app.App.state.dataset, selectedIds);

app.App.state.dataset = prototypeDataset;
const prototypeResults = app.calculateAllMatches(profile, prototypeDataset, { skipAudit: true });
const manifest = buildManifest({
  selectedResults,
  fullResults,
  prototypeResults,
  profile,
  classicHtml
});

const payload = {
  schemaVersion: "1.0.0",
  appVersion: "1.0.0-prototype.1",
  buildId: "20260816-interface-refonte-v1-02",
  generatedAt: manifest.generatedAt,
  classicReference: manifest.classicReference,
  dataset: prototypeDataset,
  defaultProfile: profile,
  sampleManifest: manifest
};

const builtHtml = replaceMarkedBlock(
  replaceMarkedBlock(refonteTemplate, "CLASSIC_ENGINE", `\n${engineScript}\n`),
  "REFONTE_DATA",
  JSON.stringify(payload)
);

await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(TMP_DIR, { recursive: true });
await writeFile(APP_PATH, builtHtml);
await writeFile(path.join(OUTPUT_DIR, "rome100-stratified-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(TMP_DIR, "prototype-data-summary.json"), `${JSON.stringify({
  ...manifest,
  output: {
    htmlPath: path.relative(ROOT, APP_PATH),
    htmlBytes: Buffer.byteLength(builtHtml),
    htmlSha256: sha256(builtHtml),
    embeddedDatasetBytes: Buffer.byteLength(JSON.stringify(prototypeDataset))
  }
}, null, 2)}\n`);

console.log(JSON.stringify({
  status: "built",
  html: path.relative(ROOT, APP_PATH),
  jobs: prototypeDataset.jobs.length,
  directions: manifest.coverage.directions,
  top5Preserved: manifest.validation.top5Preserved,
  htmlBytes: Buffer.byteLength(builtHtml),
  htmlSha256: sha256(builtHtml)
}, null, 2));

function selectStratifiedResults(results) {
  const complete = results.completeList || [];
  const byId = new Map(complete.map(result => [result.jobId, result]));
  const selected = new Map();
  const reasons = new Map();
  const add = (result, reason) => {
    if (!result || selected.has(result.jobId)) {
      if (result && reason) reasons.get(result.jobId)?.add(reason);
      return;
    }
    selected.set(result.jobId, result);
    reasons.set(result.jobId, new Set([reason]));
  };

  (results.top5 || []).forEach(result => add(result, "top5_representative"));
  (results.top5 || []).forEach(result => {
    (results.variantsByJob?.[result.jobId] || []).slice(0, 1).forEach(variant => add(byId.get(variant.jobId), "top5_variant"));
  });

  const view = results.resultsViewModel || app.buildResultsViewModel(profile, results, app.App.state.dataset);
  (view.excludedPaths || []).slice(0, 6).forEach(item => add(byId.get(item.jobId), "excluded_path"));
  (view.dreamPaths || []).slice(0, 6).forEach(item => add(byId.get(item.jobId), "dream_path"));

  const marketKinds = { complete: 0, partial: 0, absent: 0 };
  for (const result of complete) {
    const territories = Object.values(result.marketSummaryByTerritory || {});
    const available = territories.filter(row => row?.availability === "available").length;
    const kind = available === 3 ? "complete" : available > 0 ? "partial" : "absent";
    if (marketKinds[kind] < 2) {
      add(result, `market_${kind}`);
      marketKinds[kind] += 1;
    }
    if (Object.values(marketKinds).every(count => count >= 2)) break;
  }

  complete.filter(isRegulatedResult).slice(0, 4)
    .forEach(result => add(result, "regulated_access"));

  const directions = [...new Set(complete.map(result => result.primaryDirection).filter(Boolean))];
  directions.forEach(direction => {
    complete.filter(result => result.primaryDirection === direction).slice(0, 3)
      .forEach(result => add(result, "direction_minimum"));
  });

  let round = 3;
  while (selected.size < 100) {
    let progressed = false;
    for (const direction of directions) {
      const candidate = complete.filter(result => result.primaryDirection === direction)[round];
      if (candidate) {
        add(candidate, "direction_balanced_fill");
        progressed = true;
      }
      if (selected.size >= 100) break;
    }
    if (!progressed) break;
    round += 1;
  }
  complete.forEach(result => {
    if (selected.size < 100) add(result, "ranked_fill");
  });

  const output = [...selected.values()].slice(0, 100);
  output.forEach(result => {
    result.__prototypeSelectionReasons = [...(reasons.get(result.jobId) || [])];
  });
  if (output.length !== 100) throw new Error(`Echantillon incomplet : ${output.length}/100.`);
  return output;
}

function compactPrototypeDataset(dataset, selectedIds) {
  const jobs = (dataset.jobs || []).filter(job => selectedIds.has(job.id));
  const jobIds = new Set(jobs.map(job => job.id));
  const romeCodes = new Set(jobs.map(job => job.romeCode));
  const skillIds = new Set(jobs.flatMap(job => [
    ...(job.requiredSkills || []), ...(job.optionalSkills || []), ...(job.mobilizedSkillIds || []),
    ...(job.matchableSkillIds || []), ...(job.softSkillIds || [])
  ]).map(item => typeof item === "string" ? item : item?.id).filter(Boolean));
  const contextIds = new Set(jobs.flatMap(job => job.workContexts || []).map(item => typeof item === "string" ? item : item?.id).filter(Boolean));
  const knowledgeIds = new Set(jobs.flatMap(job => job.knowledgeIds || []).filter(Boolean));
  const certificationIds = new Set(jobs.flatMap(job => [
    ...(job.requiredCertifications || []), ...(job.recommendedCertifications || [])
  ]).map(item => typeof item === "string" ? item : item?.id).filter(Boolean));
  const referencesJob = row => jobIds.has(row.jobId) || romeCodes.has(row.romeCode);

  return {
    ...dataset,
    datasetName: "Boussole Pro - prototype refonte ROME100 stratifie",
    datasetVersion: "rome100-refonte-v1.0",
    provenance: "prototype_from_active_rome1000",
    jobs,
    skills: (dataset.skills || []).filter(row => skillIds.has(row.id)),
    skillsEngine: (dataset.skillsEngine || []).filter(row => referencesJob(row) || skillIds.has(row.skillId)),
    matchableSkills: (dataset.matchableSkills || []).filter(row => skillIds.has(row.id || row.skillId)),
    workContexts: (dataset.workContexts || []).filter(row => contextIds.has(row.id)),
    knowledge: (dataset.knowledge || []).filter(row => knowledgeIds.has(row.id)),
    certifications: (dataset.certifications || []).filter(row => certificationIds.has(row.id) || referencesJob(row)),
    certificationLike: (dataset.certificationLike || []).filter(row => certificationIds.has(row.id) || referencesJob(row)),
    mappings: (dataset.mappings || []).filter(referencesJob),
    jobAppellations: (dataset.jobAppellations || []).filter(referencesJob),
    accessSummary: (dataset.accessSummary || []).filter(referencesJob),
    officialConstraintSummary: (dataset.officialConstraintSummary || []).filter(referencesJob),
    marketTrends: null,
    marketNational: [],
    marketOccitanie: [],
    marketAude: [],
    marketFapEnrichment: [],
    runtimeBundleIdentity: {
      inputMode: "embedded_prototype",
      runtimeBundleRevision: "rome100-refonte-v1.0",
      fingerprintSha256: sha256(jobs.map(job => job.romeCode).sort().join("|")),
      sourceDatasetVersion: dataset.datasetVersion,
      status: "prototype_validated_scope",
      counts: { jobs: jobs.length, skills: skillIds.size }
    }
  };
}

function buildManifest({ selectedResults, fullResults, prototypeResults, profile: selectedProfile, classicHtml: sourceHtml }) {
  const generatedAt = new Date().toISOString();
  const selectedCodes = selectedResults.map(result => result.romeCode || result.job?.romeCode);
  const directionCounts = Object.fromEntries([...new Set(selectedResults.map(result => result.primaryDirection))]
    .sort().map(direction => [direction, selectedResults.filter(result => result.primaryDirection === direction).length]));
  const accessCounts = {};
  const marketCounts = { complete: 0, partial: 0, absent: 0 };
  selectedResults.forEach(result => {
    const access = result.accessStatus || "unknown";
    accessCounts[access] = (accessCounts[access] || 0) + 1;
    const available = Object.values(result.marketSummaryByTerritory || {}).filter(row => row?.availability === "available").length;
    marketCounts[available === 3 ? "complete" : available > 0 ? "partial" : "absent"] += 1;
  });
  const fullTop = (fullResults.top5 || []).map(result => result.romeCode || result.job?.romeCode);
  const prototypeTop = (prototypeResults.top5 || []).map(result => result.romeCode || result.job?.romeCode);
  return {
    schemaVersion: "1.0.0",
    reportKind: "boussole_refonte_v1_rome100_stratified_manifest",
    generatedAt,
    selectionPolicy: "real_active_rome1000_stratified_by_17_directions_then_required_scenarios",
    classicReference: {
      commit: "bd9b54767ed143668826074e757a8e2dc46502ad",
      tag: "v0.8.4-classic-frozen-r1",
      htmlSha256: sha256(sourceHtml),
      enginePolicy: "exact_classic_engine_snapshot_with_new_view_adapter"
    },
    profile: { id: selectedProfile.id, name: selectedProfile.profileName || null, source: path.relative(ROOT, PROFILE_PATH) },
    count: selectedResults.length,
    codes: selectedCodes,
    rows: selectedResults.map(result => ({
      jobId: result.jobId,
      romeCode: result.romeCode || result.job?.romeCode,
      title: result.title,
      primaryDirection: result.primaryDirection,
      secondaryDirections: result.secondaryDirections || [],
      personalFitScore: result.personalFitScore,
      status: result.status,
      accessStatus: result.accessStatus,
      regulated: isRegulatedResult(result),
      selectionReasons: result.__prototypeSelectionReasons || []
    })),
    coverage: {
      directions: Object.keys(directionCounts).length,
      directionCounts,
      accessCounts,
      marketCounts,
      excluded: selectedResults.filter(result => result.status === "excluded_for_now").length,
      dreamCandidates: selectedResults.filter(result => ["long_path", "current_blocker", "qualification_or_competition"].includes(result.accessStatus) && result.personalFitScore >= 65).length,
      regulated: selectedResults.filter(isRegulatedResult).length,
      hybrid: selectedResults.filter(result => (result.secondaryDirections || []).length).length
    },
    validation: {
      allRealRomeCodes: selectedCodes.every(code => /^[A-Z][0-9]{4}$/.test(code || "")),
      all17DirectionsCovered: Object.keys(directionCounts).length === 17,
      minimumPerDirection: Math.min(...Object.values(directionCounts)),
      fullTop5: fullTop,
      prototypeTop5: prototypeTop,
      top5Preserved: JSON.stringify(fullTop) === JSON.stringify(prototypeTop),
      deterministicIdentity: sha256(selectedCodes.join("|"))
    }
  };
}

function isRegulatedResult(result = {}) {
  const status = result.accessSummaryV1?.regulatedStatus;
  return result.job?.accessSummary?.regulated === true || result.accessSummaryV1?.regulated === true || status === "regulated";
}

async function loadGeneratedBundle() {
  return {
    manifest: await readJson(path.join(RUNTIME_DIR, "import-manifest.rome.json"), {}),
    runtimeBundleManifest: await readJson(path.join(RUNTIME_DIR, "runtime-bundle-manifest.json"), null),
    jobs: await readJson(path.join(RUNTIME_DIR, "jobs.rome.json"), []),
    skills: await readJson(path.join(RUNTIME_DIR, "skills.rome.json"), []),
    skillsEngine: await readJson(path.join(RUNTIME_DIR, "skills-engine.rome.json"), []),
    matchableSkills: await readJson(path.join(RUNTIME_DIR, "skills-matchable.rome.json"), []),
    knowledge: await readJson(path.join(RUNTIME_DIR, "knowledge.rome.json"), []),
    certificationLike: await readJson(path.join(RUNTIME_DIR, "certification-like.rome.json"), []),
    workContexts: await readJson(path.join(RUNTIME_DIR, "work-contexts.rome.json"), []),
    jobAppellations: await readJson(path.join(RUNTIME_DIR, "job-appellations.rome.json"), []),
    mappings: await readJson(path.join(RUNTIME_DIR, "mappings.rome.json"), []),
    qualityReport: await readJson(path.join(RUNTIME_DIR, "data-quality-report.rome.json"), {}),
    accessSummary: await readJson(path.join(RUNTIME_DIR, "access-summary.rome1000.json"), []),
    accessSummaryQualityReport: await readJson(path.join(RUNTIME_DIR, "access-summary-quality-report.json"), null),
    officialConstraintSummary: await readJson(path.join(RUNTIME_DIR, "official-constraint-summary.rome1000.json"), []),
    marketManifest: await readJson(path.join(MARKET_DIR, "market-import-manifest.json"), null),
    marketQualityReport: await readJson(path.join(MARKET_DIR, "market-quality-report.json"), null),
    marketPackageIdentity: await readJson(path.join(MARKET_DIR, "market-package-identity.json"), null),
    marketTemporalContract: await readJson(path.join(MARKET_DIR, "market-temporal-contract.json"), null),
    marketTrends: await readJson(path.join(MARKET_DIR, "market-trends.rome1000.json"), null),
    marketNational: await readJson(path.join(MARKET_DIR, "market-national.rome.json"), []),
    marketOccitanie: await readJson(path.join(MARKET_DIR, "market-occitanie.rome.json"), []),
    marketAude: await readJson(path.join(MARKET_DIR, "market-aude.rome.json"), []),
    marketFapEnrichment: await readJson(path.join(MARKET_DIR, "market-fap-enrichment.rome1000.json"), [])
  };
}

function loadClassicEngine(script) {
  const noop = () => {};
  const fakeElement = () => ({
    addEventListener: noop, removeEventListener: noop,
    classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {},
    querySelector: () => null, querySelectorAll: () => [], setAttribute: noop,
    removeAttribute: noop, appendChild: noop, remove: noop, click: noop, focus: noop, innerHTML: ""
  });
  const context = {
    console, structuredClone: globalThis.structuredClone, setTimeout, clearTimeout,
    Blob: function Blob() {}, URL: { createObjectURL: () => "", revokeObjectURL: noop },
    FileReader: function FileReader() {}, crypto: { randomUUID: () => Math.random().toString(36).slice(2) },
    performance: { now: () => Date.now() },
    window: { setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), CSS: { escape: value => String(value) } },
    document: { addEventListener: noop, getElementById: () => fakeElement(), body: fakeElement(), createElement: () => fakeElement() },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    location: { protocol: "http:" }, navigator: {}
  };
  context.window = Object.assign(context.window, context);
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.__refonteEngine={App,mergeGeneratedDatasetIntoApp,markDatasetAsOfficialRome,normalizeProfile,calculateAllMatches,buildResultsViewModel};`, context, { timeout: 30000 });
  return context.__refonteEngine;
}

function replaceMarkedBlock(source, name, content) {
  const start = `/* ${name}_START */`;
  const end = `/* ${name}_END */`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) throw new Error(`Marqueurs ${name} absents ou invalides.`);
  return `${source.slice(0, startIndex + start.length)}${content}${source.slice(endIndex)}`;
}
