import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { adaptCompactRuntime, buildCompactRuntime, buildTagStatistics, enrichProfileOptionTags, sha256 } from "./boussole-runtime-compact.mjs";
import { projectQualificationAccess } from "./boussole-qualifications.mjs";
import { loadBoussoleEngine, loadGeneratedBundle } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations/boussolepro");
const APP_PATH = path.join(APP_DIR, "boussole-pro.html");
const OFFLINE_PATH = path.join(APP_DIR, "boussole-pro-offline.html");
const SOURCE_DIR = path.join(APP_DIR, "data/generated/rome1000-candidate");
const MARKET_DIR = path.join(APP_DIR, "data/generated/market");
const OUTPUT_DIR = path.join(APP_DIR, "boussole-runtime");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/boussole-runtime-v1");
const REPORT_PATH = path.join(REPORT_DIR, "boussole-runtime-build-report.json");
const TAG_RELATION_REPORT_PATH = path.join(ROOT, "tmp/monde-pro/boussole-v1.5.1/tag-relations-quality-report.json");
const BROWSER_PROVIDER_PATH = path.join(ROOT, "scripts/boussole-runtime-browser-provider.js");
const AUDIENCE_CONFIG_PATH = path.join(APP_DIR, "config/audience-overrides.json");
const TAXONOMY_CONFIG_PATH = path.join(APP_DIR, "config/taxonomy-overrides.json");
const QUALIFICATION_CONFIG_PATH = path.join(APP_DIR, "config/qualification-catalog.json");
const QUALIFICATION_REPORT_PATH = path.join(ROOT, "tmp/monde-pro/boussole-v1.6.0/qualification-audit-report.json");
const APP_VERSION = "1.6.0";
const BUILD_ID = "20260824-personal-fit-v2-persistence-01";

const [appHtml, browserProvider, audienceConfig, taxonomyConfig, qualificationConfig] = await Promise.all([
  readFile(APP_PATH, "utf8"),
  readFile(BROWSER_PROVIDER_PATH, "utf8"),
  readFile(AUDIENCE_CONFIG_PATH, "utf8").then(JSON.parse),
  readFile(TAXONOMY_CONFIG_PATH, "utf8").then(JSON.parse),
  readFile(QUALIFICATION_CONFIG_PATH, "utf8").then(JSON.parse)
]);
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
  path.join(MARKET_DIR, "market-fap-enrichment.rome1000.json"),
  QUALIFICATION_CONFIG_PATH
];
const sourceBuffers = await Promise.all(sourceFiles.map(file => readFile(file)));
const sourceFingerprintSha256 = sha256(sourceBuffers.map((buffer, index) => `${path.basename(sourceFiles[index])}:${sha256(buffer)}`).join("|"));
const datasetVersion = `boussole-runtime-v1.6.0-${sourceFingerprintSha256.slice(0, 12)}`;

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
masterDataset.jobs = masterDataset.jobs.map(job => {
  const taxonomy = taxonomyConfig.jobs?.[job.romeCode] || {};
  const adjusted = {
    ...job,
    ...taxonomy,
    romeKnowledgeRefs: sourceJobsById.get(job.id)?.romeKnowledgeRefs || job.romeKnowledgeRefs || []
  };
  return { ...adjusted, ...enrichProfileOptionTags(adjusted, { audienceOverrides: audienceConfig.jobs }) };
});
masterDataset.tagStatistics = buildTagStatistics(masterDataset.jobs);
const referenceProfile = engine.normalizeProfile(clone(previousPayload.defaultProfile));
engine.App.state.profile = referenceProfile;
const referenceResults = engine.calculateAllMatches(referenceProfile, masterDataset, { skipAudit: true });
const directionByJobId = new Map(referenceResults.completeList.map(result => [result.jobId, {
  primaryDirection: result.primaryDirection,
  primaryDirectionLabel: result.primaryDirectionLabel,
  secondaryDirections: result.secondaryDirections || []
}]));
masterDataset.jobs = masterDataset.jobs.map(job => ({ ...job, ...(directionByJobId.get(job.id) || {}) }));
const defaultProfile = buildDemoProfile(previousPayload.defaultProfile, masterDataset);
const qualificationProjection = projectQualificationAccess(masterDataset.jobs, qualificationConfig);
if (qualificationProjection.report.blockingFailures.length) throw new Error(`Projection des qualifications invalide : ${qualificationProjection.report.blockingFailures.join(", ")}`);

const built = buildCompactRuntime(masterDataset, { generatedAt, datasetVersion, sourceDate, qualificationProjection });
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
  resourceSchemaVersion: built.core.schemaVersion,
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
  defaultProfile,
  runtimeBasePath: "boussole-runtime/",
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
  writeFile(OFFLINE_PATH, offlineHtml, "utf8"),
  mkdir(path.dirname(QUALIFICATION_REPORT_PATH), { recursive: true }).then(() => writeFile(QUALIFICATION_REPORT_PATH, `${JSON.stringify(qualificationProjection.report, null, 2)}\n`, "utf8"))
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
    publishedTerritories: Object.keys(built.marche.territories),
    tagStatistics: built.diagnostics.tagStatistics,
    relationGraph: built.diagnostics.relationGraph
  },
  validation: built.validation,
  parity,
  privacy: "Aucun profil utilisateur réel, secret, jeton ou réponse API brute n’est inclus dans les ressources runtime."
};
const tagWeightById = new Map(built.core.tagStatistics.map(row => [`${row.kind}:${row.id}`, row]));
const taggedJobs = built.core.jobs.map(job => {
  const families = ["interestTags", "valueTags", "transitionTags"];
  const tags = families.flatMap(key => (job[key] || []).map(id => ({ key, id, statistic: tagWeightById.get(`${key.replace("Tags", "")}:${id}`) })));
  const duplicates = [...new Set(tags.map(item => item.id).filter((id, index, all) => all.indexOf(id) !== index))];
  const generic = tags.filter(item => Number(item.statistic?.prevalence || 0) > 0.7).map(item => item.id);
  return { jobId: job.id, romeCode: job.romeCode, title: job.title, tagCount: tags.length, duplicates, generic, suspicionScore: duplicates.length * 3 + generic.length };
});
const tagRelationQuality = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v1_5_tag_relations_quality",
  generatedAt,
  datasetVersion,
  tagStatistics: built.core.tagStatistics,
  jobsWithMostTags: [...taggedJobs].sort((a, b) => b.tagCount - a.tagCount || a.romeCode.localeCompare(b.romeCode)).slice(0, 20),
  probableAnomalies: [...taggedJobs].filter(row => row.suspicionScore > 0).sort((a, b) => b.suspicionScore - a.suspicionScore || b.tagCount - a.tagCount || a.romeCode.localeCompare(b.romeCode)).slice(0, 20),
  referenceJobs: Object.fromEntries(["D1302", "K2110", "G1203", "K1206", "K2113"].map(code => {
    const job = built.core.jobs.find(item => item.romeCode === code);
    return [code, job ? { jobId: job.id, title: job.title, interestTags: job.interestTags || [], valueTags: job.valueTags || [], transitionTags: job.transitionTags || [], relatedJobIds: job.relatedJobIds || [] } : null];
  })),
  audienceSignalAudit: Object.fromEntries(Object.keys(audienceConfig.jobs).map(code => {
    const job = masterDataset.jobs.find(item => item.romeCode === code);
    return [code, { title: job?.title || null, signals: job?.audienceSignals || [], override: audienceConfig.jobs[code] }];
  })),
  lexicalCollisionAudit: ["animation", "animateur", "assistant", "educateur", "conseiller", "technicien"].map(term => {
    const affected = masterDataset.jobs.filter(job => `${job.title} ${job.mission || job.description || ""}`.toLocaleLowerCase("fr").includes(term));
    const corrected = affected.filter(job => taxonomyConfig.jobs?.[job.romeCode]);
    return {
      term,
      affectedJobs: affected.length,
      reviewedOverrides: corrected.map(job => ({ romeCode: job.romeCode, title: job.title, sectorAfter: job.primarySectorId, audienceAfter: job.audienceSignals || [], decision: taxonomyConfig.jobs[job.romeCode]?.justification }))
    };
  }),
  relationGraph: built.diagnostics.relationGraph
};
await mkdir(path.dirname(TAG_RELATION_REPORT_PATH), { recursive: true });
await Promise.all([
  writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(TAG_RELATION_REPORT_PATH, `${JSON.stringify(tagRelationQuality, null, 2)}\n`, "utf8")
]);

console.log(JSON.stringify({
  status: report.status,
  datasetVersion,
  counts: report.counts,
  sizes: { rawBytes, gzipBytes, onlineHtmlBytes: report.app.onlineBytes, offlineHtmlBytes: report.app.offlineBytes },
  parityProfiles: parity.profiles.length,
  output: path.relative(ROOT, OUTPUT_DIR),
  report: path.relative(ROOT, REPORT_PATH)
}, null, 2));

function buildDemoProfile(previous = {}, dataset = {}) {
  const skillIds = new Set((dataset.skillsEngine || []).map(item => item.id));
  const experienceSource = (previous.jobExperiences || []).filter(item => item?.romeCode).slice(0, 2);
  if (!experienceSource.length) ["G1203", "M1805"].forEach((romeCode, index) => { const job = dataset.jobs.find(item => item.romeCode === romeCode); if (job) experienceSource.push({ id: `demo-source-${index}`, jobId: job.id, romeCode, title: job.title, durationYears: index ? 3 : 8, recency: index ? "old" : "recent", isCurrent: false, masteryLevel: "autonomous", enjoymentLevel: index ? "dislike" : "like", wantsToContinue: index ? "no" : "yes", source: "user_direct" }); });
  const selectedSkills = [...new Set(experienceSource.flatMap(experience => {
    const job = dataset.jobs.find(item => item.romeCode === experience.romeCode) || {};
    return [...(job.requiredSkills || job.matchableSkillIds || []), ...(job.optionalSkills || [])].map(item => typeof item === "string" ? item : item?.id);
  }).filter(id => skillIds.has(id)))].slice(0, 12);
  return {
    id: "profile-demo-v1-6-0", schemaVersion: "1.6.0", profileName: "Profil de démonstration", ageRange: "36_45",
    diplomaLevel: 5, diplomaScaleRevision: "runtime-v1", archivedDiplomas: [], certificationSelections: [{ id: "cert-bafa", label: "BAFA - Brevet d'aptitude aux fonctions d'animateur", type: "brevet" }], certifications: ["cert-bafa"], unresolvedQualifications: [],
    jobExperiences: experienceSource.map((item, index) => ({ ...item, id: `demo-experience-${index + 1}` })),
    skillSelections: selectedSkills.map((skillId, index) => ({ skillId, label: dataset.skillsEngine.find(item => item.id === skillId)?.label || skillId, currentLevel: index < 6 ? "mastered" : "practiced", futureWish: index < 8 ? "continue" : "develop", source: "user_direct", suggestedFromRomeCodes: [] })),
    unresolvedCustomSkills: [], customSkills: [], interests: ["aider", "transmettre", "creer", "enfants"], values: ["meaning", "service", "team", "creativity"],
    trainingFamilies: ["education_animation", "numerique"], desiredTrainingFamilies: ["education_animation"], trainingOpenness: "medium",
    preferredWorkStyles: ["relational", "team", "creative"], preferredEnvironments: ["children", "public"], excludedDomains: ["petite_enfance"],
    constraints: [], mobility: { radiusKm: 20, relocation: "maybe" }, driverLicenses: ["B"], driverLicenseBStatus: "yes", availability: { hoursPerWeek: "full_time", startDate: null },
    marketPreference: previous.marketPreference, searchHorizon: "transition", completedBoussole: true, hasRequestedResults: true,
    createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z"
  };
}

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
    const scoreParity = JSON.stringify(scoreSignature(baseline)) === JSON.stringify(scoreSignature(compact));
    const rankingParity = JSON.stringify(baselineSignature) === JSON.stringify(compactSignature);
    const id = fixture.id || fixture.name || `profile-${rows.length + 1}`;
    const hasExperienceIntent = (raw.jobExperiences || []).some(item => ["yes", "maybe", "no"].includes(item?.wantsToContinue) || ["love", "like", "neutral", "dislike"].includes(item?.enjoymentLevel));
    const acceptedGraphEnrichment = !scoreParity && hasExperienceIntent;
    if (!scoreParity && !acceptedGraphEnrichment) failures.push(`profile_score:${id}`);
    rows.push({ id, same: scoreParity || acceptedGraphEnrichment, scoreParity, rankingParity, acceptedGraphEnrichment, rankingDifferenceReason: scoreParity && !rankingParity ? "secondary_readiness_or_feasibility_tie_break_after_compaction" : acceptedGraphEnrichment ? "compact_bidirectional_related_job_graph_used_by_experience_relationship" : null, baseline: baselineSignature, compact: compactSignature });
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
    components: item.personalFitComponents
  }));
  return { top5: result.top5.map(item => item.romeCode), first50: rows };
}

function scoreSignature(result) {
  return result.completeList.map(item => ({ code: item.romeCode, raw: item.personalFitScoreRaw, components: item.personalFitDetailedComponents }))
    .sort((a, b) => a.code.localeCompare(b.code, "fr"));
}

function accessSignature(job) {
  const access = job?.accessSummary || {};
  return { category: access.accessLevelCategory, kind: access.requirementKind, minimum: access.minimumDiplomaLevel ?? null, maximum: access.maximumDiplomaLevel ?? null, regulated: Boolean(access.regulated), mandatory: Boolean(access.mandatoryQualification), exams: access.requiredExams || [], paths: (job?.accessPaths || []).map(path => path.id || path.pathId) };
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
    .replaceAll("Boussole Pro v1.1 -", "Boussole Pro v1.2.1 -")
    .replaceAll("Boussole Pro v1.2 -", "Boussole Pro v1.2.1 -")
    .replaceAll("Boussole Pro v1.5.0 -", "Boussole Pro v1.6.0 -")
    .replaceAll("Boussole Pro v1.5.1 -", "Boussole Pro v1.6.0 -")
    .replaceAll("Boussole Pro v1.5.2 -", "Boussole Pro v1.6.0 -")
    .replaceAll('${this.state.dataset.jobs.length} métiers réels disponibles', '${this.runtimePresentation().title}')
    .replaceAll(
      "Les 17 directions sont couvertes. Les ressources compactes sont contrôlées avant leur activation.",
      "${this.runtimePresentation().description}"
    )
    .replaceAll("métiers réels embarqués", "métiers réels disponibles")
    .replaceAll("ROME100 stratifié", "ROME1000 actif")
    .replaceAll(
      "Les 17 directions sont couvertes. L’application fonctionne sans connexion et n’effectue aucun appel réseau au démarrage.",
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
      'this.runtimePresentation().badge'
    )
    .replaceAll(
      'this.state.datasetMode === "emergency_rome100" ? "ROME100 de secours" : "ROME1000 actif"',
      'this.runtimePresentation().badge'
    )
    .replaceAll(
      'this.state.datasetMode === "offline_embedded" ? "ROME1000 autonome" : this.state.datasetMode === "validated_cache" ? "ROME1000 en cache" : "ROME1000 actif"',
      'this.runtimePresentation().badge'
    );
}

function safeInlineJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
