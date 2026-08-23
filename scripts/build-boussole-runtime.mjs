import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { adaptCompactRuntime, buildCompactRuntime, sha256 } from "./boussole-runtime-compact.mjs";
import { loadBoussoleEngine, loadGeneratedBundle } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations/boussolepro");
const APP_PATH = path.join(APP_DIR, "boussole-pro.html");
const OFFLINE_PATH = path.join(APP_DIR, "boussole-pro-offline.html");
const SOURCE_DIR = path.join(APP_DIR, "data/generated/rome1000-candidate");
const MARKET_DIR = path.join(APP_DIR, "data/generated/market");
const OUTPUT_DIR = path.join(APP_DIR, "data/generated/boussole-runtime");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/boussole-runtime-v1");
const REPORT_PATH = path.join(REPORT_DIR, "boussole-runtime-build-report.json");
const BROWSER_PROVIDER_PATH = path.join(ROOT, "scripts/boussole-runtime-browser-provider.js");
const APP_VERSION = "1.2.0";
const BUILD_ID = "20260823-runtime-compacts-v1-01";

const [appHtml, browserProvider] = await Promise.all([readFile(APP_PATH, "utf8"), readFile(BROWSER_PROVIDER_PATH, "utf8")]);
const previousPayload = parsePayload(appHtml);
if (!previousPayload?.defaultProfile) throw new Error("Le profil de démonstration embarqué est absent de la coquille applicative.");

const generatedAt = process.env.BOUSSOLE_RUNTIME_GENERATED_AT || new Date().toISOString();
const sourceFiles = [
  path.join(SOURCE_DIR, "jobs.rome.json"),
  path.join(SOURCE_DIR, "skills-engine.rome.json"),
  path.join(SOURCE_DIR, "knowledge.rome.json"),
  path.join(SOURCE_DIR, "work-contexts.rome.json"),
  path.join(SOURCE_DIR, "access-summary.rome1000.json"),
  path.join(SOURCE_DIR, "official-constraint-summary.rome1000.json"),
  path.join(MARKET_DIR, "market-national.rome.json"),
  path.join(MARKET_DIR, "market-occitanie.rome.json"),
  path.join(MARKET_DIR, "market-aude.rome.json"),
  path.join(MARKET_DIR, "market-fap-enrichment.rome1000.json")
];
const sourceBuffers = await Promise.all(sourceFiles.map(file => readFile(file)));
const sourceFingerprintSha256 = sha256(sourceBuffers.map((buffer, index) => `${path.basename(sourceFiles[index])}:${sha256(buffer)}`).join("|"));
const datasetVersion = `boussole-runtime-v1-${sourceFingerprintSha256.slice(0, 12)}`;

const bundle = await loadGeneratedBundle(SOURCE_DIR, {
  accessSummaryFile: "access-summary.rome1000.json",
  constraintSummaryFile: "official-constraint-summary.rome1000.json",
  marketEnrichmentFile: "market-fap-enrichment.rome1000.json",
  marketTrendsFile: "market-trends.rome1000.json"
});
const sourceDate = String(bundle.manifest?.importedAt || bundle.marketManifest?.generatedAt || generatedAt).slice(0, 10);
const engine = loadBoussoleEngine(appHtml);
engine.App.state.dataset = engine.mergeGeneratedDatasetIntoApp(bundle, { replace: true });
engine.markDatasetAsOfficialRome(engine.App.state.dataset, bundle.manifest);
const masterDataset = engine.App.state.dataset;
const sourceJobs = JSON.parse(sourceBuffers[0].toString("utf8"));
const sourceJobsById = new Map(sourceJobs.map(job => [job.id, job]));
masterDataset.jobs = masterDataset.jobs.map(job => ({
  ...job,
  romeKnowledgeRefs: sourceJobsById.get(job.id)?.romeKnowledgeRefs || job.romeKnowledgeRefs || []
}));
const referenceProfile = engine.normalizeProfile(clone(previousPayload.defaultProfile));
engine.App.state.profile = referenceProfile;
const referenceResults = engine.calculateAllMatches(referenceProfile, masterDataset, { skipAudit: true });
const directionByJobId = new Map(referenceResults.completeList.map(result => [result.jobId, {
  primaryDirection: result.primaryDirection,
  primaryDirectionLabel: result.primaryDirectionLabel,
  secondaryDirections: result.secondaryDirections || []
}]));
masterDataset.jobs = masterDataset.jobs.map(job => ({ ...job, ...(directionByJobId.get(job.id) || {}) }));

const built = buildCompactRuntime(masterDataset, { generatedAt, datasetVersion, sourceDate });
const filePayloads = {
  core: JSON.stringify(built.core),
  competences: JSON.stringify(built.competences),
  marche: JSON.stringify(built.marche)
};
const fileNames = { core: "boussole-core.json", competences: "boussole-competences.json", marche: "boussole-marche.json" };
const files = Object.fromEntries(Object.entries(filePayloads).map(([key, content]) => [key, {
  path: fileNames[key],
  sha256: sha256(content),
  bytes: Buffer.byteLength(content)
}]));
const runtimeFingerprintSha256 = sha256(Object.values(files).map(file => file.sha256).join("|"));
const manifest = {
  schemaVersion: "1.0.0",
  datasetVersion,
  generatedAt,
  sourceDate,
  sourceFingerprintSha256,
  runtimeFingerprintSha256,
  files,
  counts: built.validation.counts,
  territories: Object.keys(built.marche.territories)
};

const parity = runParityChecks({ appHtml, engine, masterDataset, runtime: built, manifest });
if (parity.failures.length) {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, "boussole-runtime-parity-debug.json"), `${JSON.stringify(parity, null, 2)}\n`, "utf8");
  throw new Error(`Parité fonctionnelle échouée : ${parity.failures.join(", ")}`);
}

const rawBytes = Object.values(files).reduce((sum, file) => sum + file.bytes, 0);
const gzipBytes = Object.values(filePayloads).reduce((sum, content) => sum + gzipSync(content, { level: 9 }).byteLength, 0);
if (rawBytes > 12_000_000) throw new Error(`Plafond runtime brut dépassé : ${rawBytes} octets.`);
if (gzipBytes > 2_000_000) throw new Error(`Plafond runtime gzip dépassé : ${gzipBytes} octets.`);

const shellPayload = {
  schemaVersion: "1.0.0",
  appVersion: APP_VERSION,
  buildId: BUILD_ID,
  classicReference: previousPayload.classicReference,
  defaultProfile: previousPayload.defaultProfile,
  runtimeBasePath: "data/generated/boussole-runtime/",
  embeddedRuntime: null
};
const onlineHtml = normalizeRuntimeShell(injectRuntimeProvider(
  replaceMarkedBlock(appHtml, "REFONTE_DATA", safeInlineJson(shellPayload)),
  browserProvider
));
const offlinePayload = { ...shellPayload, embeddedRuntime: { manifest, core: built.core, competences: built.competences, marche: built.marche } };
const offlineHtml = replaceMarkedBlock(onlineHtml, "REFONTE_DATA", safeInlineJson(offlinePayload));
if (/"dataset"\s*:\s*\{/.test(parsePayloadText(onlineHtml))) throw new Error("Le HTML connecté contient encore un corpus dataset embarqué.");
if (!offlineHtml.includes(`"datasetVersion":"${datasetVersion}"`)) throw new Error("Le HTML autonome n’embarque pas la projection validée.");

await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(REPORT_DIR, { recursive: true });
await Promise.all([
  ...Object.entries(filePayloads).map(([key, content]) => writeFile(path.join(OUTPUT_DIR, fileNames[key]), content, "utf8")),
  writeFile(path.join(OUTPUT_DIR, "boussole-runtime-manifest.json"), JSON.stringify(manifest), "utf8"),
  writeFile(APP_PATH, onlineHtml, "utf8"),
  writeFile(OFFLINE_PATH, offlineHtml, "utf8")
]);

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_runtime_compact_v1_build",
  generatedAt,
  status: "passed",
  app: { version: APP_VERSION, buildId: BUILD_ID, onlineBytes: Buffer.byteLength(onlineHtml), offlineBytes: Buffer.byteLength(offlineHtml) },
  dataset: { datasetVersion, sourceDate, sourceFingerprintSha256, runtimeFingerprintSha256 },
  counts: built.validation.counts,
  sizes: {
    files: Object.fromEntries(Object.entries(filePayloads).map(([key, content]) => [fileNames[key], { rawBytes: Buffer.byteLength(content), gzipBytes: gzipSync(content, { level: 9 }).byteLength }])),
    totalRawBytes: rawBytes,
    totalGzipBytes: gzipBytes,
    previousEmbeddedDatasetBytes: previousPayload.dataset ? Buffer.byteLength(JSON.stringify(previousPayload.dataset)) : null,
    safetyLimits: { rawBytes: 12_000_000, gzipBytes: 2_000_000 },
    optimizationTargets: { rawBytes: 10_000_000, gzipBytes: 1_500_000 }
  },
  largestSections: largestSections(built),
  compacting: {
    droppedNonScoringMobilizedIds: built.diagnostics.droppedNonScoringMobilizedIds,
    groupOccurrencesDeduplicated: built.diagnostics.groupOccurrences,
    unresolvedKnowledgeIds: built.diagnostics.unresolvedKnowledgeIds.length,
    rawAccessTextsIncluded: 0,
    publishedTerritories: Object.keys(built.marche.territories)
  },
  validation: built.validation,
  parity,
  privacy: "Aucun profil utilisateur réel, secret, jeton ou réponse API brute n’est inclus dans les ressources runtime."
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  status: report.status,
  datasetVersion,
  counts: report.counts,
  sizes: { rawBytes, gzipBytes, onlineHtmlBytes: report.app.onlineBytes, offlineHtmlBytes: report.app.offlineBytes },
  parityProfiles: parity.profiles.length,
  output: path.relative(ROOT, OUTPUT_DIR),
  report: path.relative(ROOT, REPORT_PATH)
}, null, 2));

function runParityChecks({ appHtml: html, engine: baselineEngine, masterDataset: baselineDataset, runtime, manifest: runtimeManifest }) {
  const compactDataset = adaptCompactRuntime(runtime, runtimeManifest);
  const compactEngine = loadBoussoleEngine(html);
  const profiles = baselineEngine.DIAGNOSTIC_TEST_PROFILES_V052;
  const rows = [];
  const failures = [];
  for (const fixture of profiles) {
    const raw = fixture.profile || fixture;
    const baselineProfile = baselineEngine.normalizeProfile(clone(raw));
    const compactProfile = compactEngine.normalizeProfile(clone(raw));
    baselineEngine.App.state.profile = baselineProfile;
    baselineEngine.App.state.dataset = baselineDataset;
    compactEngine.App.state.profile = compactProfile;
    compactEngine.App.state.dataset = compactDataset;
    const baseline = baselineEngine.calculateAllMatches(baselineProfile, baselineDataset, { skipAudit: true });
    const compact = compactEngine.calculateAllMatches(compactProfile, compactDataset, { skipAudit: true });
    const baselineSignature = resultSignature(baseline);
    const compactSignature = resultSignature(compact);
    const same = JSON.stringify(baselineSignature) === JSON.stringify(compactSignature);
    const id = fixture.id || fixture.name || `profile-${rows.length + 1}`;
    if (!same) failures.push(`profile:${id}`);
    rows.push({ id, same, baseline: baselineSignature, compact: compactSignature });
  }
  const searches = {
    jobs: ["animateur", "K2111", "M1805", "documentaliste"].map(query => compareSearch(query, baselineDataset.jobs, compactDataset.jobs, jobSearchText)),
    skills: ["animer", "écouter"].map(query => compareSearch(query, baselineDataset.skillsEngine, compactDataset.skillsEngine, item => `${item.id} ${item.label}`))
  };
  if ([...searches.jobs, ...searches.skills].some(row => !row.same)) failures.push("searches");
  const accessCases = ["J1104", "A1101", "G1202"].map(code => {
    const baseline = baselineDataset.jobs.find(job => job.romeCode === code);
    const compact = compactDataset.jobs.find(job => job.romeCode === code);
    const same = JSON.stringify(accessSignature(baseline)) === JSON.stringify(accessSignature(compact));
    if (!same) failures.push(`access:${code}`);
    return { code, same, baseline: accessSignature(baseline), compact: accessSignature(compact) };
  });
  const marketCases = ["A1101", "G1203"].map(code => ({ code, territories: runtime.marche.jobs.find(row => row.jobId === `rome-${code}`)?.territories || null }));
  return { status: failures.length ? "failed" : "passed", failures, profiles: rows, searches, accessCases, marketCases };
}

function resultSignature(result) {
  const rows = result.completeList.slice(0, 50).map(item => ({
    code: item.romeCode,
    score: item.personalFitScore,
    components: item.personalFitComponents,
    status: item.status,
    access: item.accessStatus
  }));
  return { top5: result.top5.map(item => item.romeCode), first50: rows };
}

function accessSignature(job) {
  const access = job?.accessSummary || {};
  return { category: access.accessLevelCategory, kind: access.requirementKind, minimum: access.minimumDiplomaLevel ?? null, maximum: access.maximumDiplomaLevel ?? null, regulated: Boolean(access.regulated), mandatory: Boolean(access.mandatoryQualification), credentials: access.requiredCredentialLabels || [], exams: access.requiredExams || [], paths: (job?.accessPaths || []).map(path => path.id || path.pathId) };
}

function compareSearch(query, baseline, compact, textBuilder) {
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = normalize(query);
  const search = items => items.filter(item => normalize(textBuilder(item)).includes(q)).slice(0, 20).map(item => item.romeCode || item.id);
  const before = search(baseline);
  const after = search(compact);
  return { query, same: before.length > 0 && after.length > 0 && before[0] === after[0], before, after };
}

function jobSearchText(job) {
  return `${job.romeCode} ${job.title} ${(job.appellations || []).map(item => typeof item === "string" ? item : item?.label).join(" ")}`;
}

function largestSections(built) {
  const sections = {
    "core.jobs": built.core.jobs,
    "core.workContexts": built.core.workContexts,
    "core.dictionaries": built.core.dictionaries,
    "competences.items": built.competences.items,
    "competences.groups": built.competences.groups,
    "competences.jobs": built.competences.jobs,
    "marche.jobs": built.marche.jobs,
    "marche.metadata": { vintages: built.marche.vintages, territories: built.marche.territories }
  };
  return Object.entries(sections).map(([section, value]) => ({ section, rawBytes: Buffer.byteLength(JSON.stringify(value)) })).sort((a, b) => b.rawBytes - a.rawBytes).slice(0, 10);
}

function parsePayload(html) {
  return JSON.parse(parsePayloadText(html));
}

function parsePayloadText(html) {
  const match = html.match(/\/\* REFONTE_DATA_START \*\/([\s\S]*?)\/\* REFONTE_DATA_END \*\//);
  if (!match) throw new Error("Le bloc REFONTE_DATA est absent.");
  return match[1];
}

function replaceMarkedBlock(source, name, content) {
  const start = `/* ${name}_START */`;
  const end = `/* ${name}_END */`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) throw new Error(`Marqueurs ${name} absents ou invalides.`);
  return `${source.slice(0, startIndex + start.length)}${content}${source.slice(endIndex)}`;
}

function injectRuntimeProvider(source, content) {
  const start = "/* RUNTIME_PROVIDER_START */";
  const end = "/* RUNTIME_PROVIDER_END */";
  if (source.includes(start) && source.includes(end)) return replaceMarkedBlock(source, "RUNTIME_PROVIDER", `\n${content.trim()}\n`);
  const anchor = "/* REFONTE_DATA_END */;\n  </script>\n  <script>\n    \"use strict\";";
  if (!source.includes(anchor)) throw new Error("Point d’injection du fournisseur runtime introuvable.");
  return source.replace(anchor, `/* REFONTE_DATA_END */;\n  </script>\n  <script>\n${start}\n${content.trim()}\n${end}\n  </script>\n  <script>\n    \"use strict\";`);
}

function normalizeRuntimeShell(source) {
  return source
    .replaceAll("REFONTE_DATA.dataset", "this.state.dataset")
    .replaceAll("Boussole Pro v1.1 -", "Boussole Pro v1.2 -")
    .replaceAll("métiers réels embarqués", "métiers réels disponibles")
    .replaceAll("ROME100 stratifié", "ROME1000 actif")
    .replaceAll(
      "Les 17 directions sont couvertes. Le prototype fonctionne sans connexion et n’effectue aucun appel réseau au démarrage.",
      "Les 17 directions sont couvertes. Les ressources compactes sont contrôlées avant leur activation."
    )
    .replaceAll(
      "Les 17 directions sont couvertes. L’application fonctionne sans connexion et n’effectue aucun appel réseau au démarrage.",
      "Les 17 directions sont couvertes. Les ressources compactes sont contrôlées avant leur activation."
    )
    .replaceAll(
      "Le corpus actif est embarqué et fonctionne hors ligne.",
      "Le corpus actif provient d’un paquet compact contrôlé."
    )
    .replaceAll(
      'this.state.datasetMode === "emergency_rome100" ? "secours ROME100" : "ROME1000 actif"',
      'this.state.datasetMode === "offline_embedded" ? "ROME1000 autonome" : this.state.datasetMode === "validated_cache" ? "ROME1000 en cache" : "ROME1000 actif"'
    )
    .replaceAll(
      'this.state.datasetMode === "emergency_rome100" ? "ROME100 de secours" : "ROME1000 actif"',
      'this.state.datasetMode === "offline_embedded" ? "ROME1000 autonome" : this.state.datasetMode === "validated_cache" ? "ROME1000 en cache" : "ROME1000 actif"'
    );
}

function safeInlineJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
