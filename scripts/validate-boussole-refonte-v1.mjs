import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const CLASSIC_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro-classic-v0.8.4.html");
const APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const MANIFEST_PATH = path.join(ROOT, "creations/boussolepro/data/generated/refonte-v1/rome1000-embedded-manifest.json");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/refonte-interface-v1");
const REPORT_PATH = path.join(REPORT_DIR, "engine-invariance-and-migration-report.json");
const EXPECTED_CLASSIC_COMMIT = "bd9b54767ed143668826074e757a8e2dc46502ad";
const EXPECTED_CLASSIC_SHA = "ed3c0fbfe558f19652c6c4d754375adcde74f3eea1260e7713b078302b7bf5da";

const [classicHtml, refonteHtml, manifest] = await Promise.all([
  readFile(CLASSIC_PATH, "utf8"),
  readFile(APP_PATH, "utf8"),
  readFile(MANIFEST_PATH, "utf8").then(JSON.parse)
]);
const payloadText = refonteHtml.match(/\/\* REFONTE_DATA_START \*\/([\s\S]*?)\/\* REFONTE_DATA_END \*\//)?.[1];
if (!payloadText) throw new Error("Le paquet embarque de la refonte est introuvable.");
const payload = JSON.parse(payloadText);
const engineScript = classicHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  ?.replace('document.addEventListener("DOMContentLoaded", initApp);', "");
if (!engineScript) throw new Error("Le moteur classique est introuvable.");

const app = loadClassicEngine(engineScript);
app.App.state.dataset = clone(payload.dataset);
app.App.state.displayMode = "essential";
const profile = app.normalizeProfile(clone(payload.defaultProfile));
app.App.state.profile = profile;

const baseline = calculate(app, profile, app.App.state.dataset);
const repeat = calculate(app, profile, app.App.state.dataset);
const skillsOnly = calculate(app, app.normalizeProfile({
  ...clone(profile), skills: [], skillSignals: [], customSkills: [], softSkills: [],
  skillConceptEvidence: {}, jobExperiences: clone(profile.jobExperiences)
}), app.App.state.dataset);
const diplomaOnly = calculate(app, app.normalizeProfile({ ...clone(profile), diplomaLevel: profile.diplomaLevel === 7 ? 2 : 7 }), app.App.state.dataset);
const marketDataset = clone(app.App.state.dataset);
marketDataset.jobs.forEach(job => mutateMarket(job));
const marketOnly = calculate(app, profile, marketDataset);

const unknownProfile = { ...clone(profile), futureProfileField: { preserved: true }, futureArray: ["sentinel"] };
const migratedUnknown = app.normalizeProfile(unknownProfile);
const topIdentity = result => result.top5.map(item => `${item.romeCode}:${item.primaryDirection}:${item.personalFitScore}`);
const scoreIdentity = result => result.completeList.map(item => `${item.romeCode}:${item.personalFitScore}:${item.status}`);
const failures = [];
const assertions = [];
const assert = (name, condition, details = null) => {
  assertions.push({ name, status: condition ? "passed" : "failed", details });
  if (!condition) failures.push(name);
};

assert("classic_html_immutable", sha256(classicHtml) === EXPECTED_CLASSIC_SHA, { expected: EXPECTED_CLASSIC_SHA, received: sha256(classicHtml) });
assert("classic_commit_reference", payload.classicReference.commit === EXPECTED_CLASSIC_COMMIT);
assert("new_html_distinct", sha256(refonteHtml) !== sha256(classicHtml));
assert("single_page_offline", !/(?:src|href)=["']https?:\/\//i.test(refonteHtml) && !/<script[^>]+src=/i.test(refonteHtml));
assert("rome1000_exact", payload.dataset.jobs.length === 1000 && manifest.count === 1000 && manifest.validation.exact1000Jobs === true);
assert("rome100_emergency_fallback", payload.fallbackDataset.jobs.length === 100 && manifest.counts.fallbackJobs === 100);
assert("real_unique_rome_codes", manifest.validation.uniqueValidRomeCodes === true);
assert("all_17_directions", manifest.validation.all17DirectionsCovered === true && manifest.coverage.directions === 17);
assert("no_unclassified_job", manifest.validation.noUnclassifiedJob === true);
assert("top5_preserved_from_full_runtime", manifest.validation.top5Preserved === true, { full: manifest.validation.fullTop5, active: manifest.validation.activeTop5 });
assert("deterministic_repeat", baseline.sha256 === repeat.sha256, { first: baseline.sha256, second: repeat.sha256 });
assert("skills_do_not_change_top", JSON.stringify(topIdentity(baseline.results)) === JSON.stringify(topIdentity(skillsOnly.results)));
assert("skills_do_not_change_personal_fit", JSON.stringify(scoreIdentity(baseline.results)) === JSON.stringify(scoreIdentity(skillsOnly.results)));
assert("diploma_does_not_change_top", JSON.stringify(topIdentity(baseline.results)) === JSON.stringify(topIdentity(diplomaOnly.results)));
assert("diploma_does_not_change_personal_fit", baseline.results.completeList.every((item, index) => item.personalFitScore === diplomaOnly.results.completeList[index]?.personalFitScore));
assert("market_does_not_change_top", JSON.stringify(topIdentity(baseline.results)) === JSON.stringify(topIdentity(marketOnly.results)));
assert("market_does_not_change_personal_fit", JSON.stringify(scoreIdentity(baseline.results)) === JSON.stringify(scoreIdentity(marketOnly.results)));
assert("excluded_still_consultable", baseline.results.excludedPaths.length > 0 && baseline.results.excludedPaths.every(item => baseline.results.completeList.some(row => row.jobId === item.jobId)));
assert("unknown_profile_fields_preserved", migratedUnknown.futureProfileField?.preserved === true && migratedUnknown.futureArray?.[0] === "sentinel");
assert("search_index_complete", baseline.results.explorationSearchIndex.length === 1000 && baseline.results.explorationSearchIndex.every(row => row.romeCode && row.text));
assert("view_contract_complete", ["profilePortrait", "topDirections", "recommendedPaths", "dreamPaths", "skillsSupportedPaths", "exploratoryPaths", "excludedPaths", "completeList", "jobDetailsById", "explorationCatalog", "explorationSearchIndex", "jobsByPrimaryDirection", "resultMetadata"].every(key => key in baseline.results));
assert("nine_locked_steps", ["Départ", "Formation", "Contraintes", "Parcours professionnel", "Compétences", "Envies", "Environnements", "Validation", "Première lecture"].every((title, index) => refonteHtml.includes(`${index + 1}. ${title}`) || refonteHtml.includes(`\"${title}\"`)));
assert("no_job_datalist_in_v11_interface", !/<datalist\b/i.test(refonteHtml.slice(refonteHtml.lastIndexOf("// Adaptation v1.1"))));
assert("v11_build_identity", payload.appVersion === "1.1.0" && payload.buildId === "20260816-ma-boussole-rome1000-v1-1-01");

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_refonte_v1_1_engine_invariance_and_profile_migration",
  generatedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "passed",
  build: { appVersion: payload.appVersion, buildId: payload.buildId, htmlSha256: sha256(refonteHtml), htmlBytes: Buffer.byteLength(refonteHtml) },
  classicReference: { commit: EXPECTED_CLASSIC_COMMIT, htmlSha256: sha256(classicHtml) },
  corpus: { jobs: payload.dataset.jobs.length, directions: manifest.coverage.directions, manifestIdentity: manifest.validation.deterministicIdentity },
  calculations: {
    baseline: summarize(baseline), repeat: summarize(repeat), skillsOnly: summarize(skillsOnly),
    diplomaOnly: summarize(diplomaOnly), marketOnly: summarize(marketOnly)
  },
  profileMigration: { unknownTopLevelFieldsPreserved: migratedUnknown.futureProfileField?.preserved === true, sourceVersion: payload.defaultProfile.schemaVersion || null },
  assertions,
  failures
};

await mkdir(REPORT_DIR, { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures, report: path.relative(ROOT, REPORT_PATH) }, null, 2));
if (failures.length) process.exitCode = 1;

function calculate(engine, rawProfile, dataset) {
  engine.App.state.profile = rawProfile;
  engine.App.state.dataset = dataset;
  const started = performance.now();
  const rawResults = engine.calculateAllMatches(rawProfile, dataset, { skipAudit: true });
  const view = rawResults.resultsViewModel || engine.buildResultsViewModel(rawProfile, rawResults, dataset);
  const normalized = {
    top5: rawResults.top5.map(item => ({ romeCode: item.romeCode, direction: item.primaryDirection, score: item.personalFitScore })),
    complete: rawResults.completeList.map(item => ({ romeCode: item.romeCode, score: item.personalFitScore, status: item.status }))
  };
  return { results: { ...rawResults, ...view }, elapsedMs: Math.round((performance.now() - started) * 100) / 100, sha256: sha256(JSON.stringify(normalized)) };
}

function summarize(run) {
  return { elapsedMs: run.elapsedMs, sha256: run.sha256, top5: run.results.top5.map(item => item.romeCode), results: run.results.completeList.length };
}

function mutateMarket(job) {
  if (!job.marketStats) job.marketStats = {};
  for (const key of ["national", "regional", "departmental"]) {
    job.marketStats[key] ||= {};
    Object.assign(job.marketStats[key], { offersFranceTravail12m: 999999, offers12m: 999999, absoluteOfferSignal: "very_high", confidence: 1, sourceLevel: key });
  }
}

function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function loadClassicEngine(script) {
  const noop = () => {};
  const fakeElement = () => ({ addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {}, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop, click: noop, focus: noop, innerHTML: "" });
  const context = {
    console, structuredClone: globalThis.structuredClone, setTimeout, clearTimeout,
    Blob: function Blob() {}, URL: { createObjectURL: () => "", revokeObjectURL: noop }, FileReader: function FileReader() {},
    crypto: { randomUUID: () => Math.random().toString(36).slice(2) }, performance: { now: () => Date.now() },
    window: { setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), CSS: { escape: value => String(value) } },
    document: { addEventListener: noop, getElementById: () => fakeElement(), body: fakeElement(), createElement: () => fakeElement() },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, location: { protocol: "http:" }, navigator: {}
  };
  context.window = Object.assign(context.window, context);
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.__engine={App,normalizeProfile,calculateAllMatches,buildResultsViewModel};`, context, { timeout: 30000 });
  return context.__engine;
}
