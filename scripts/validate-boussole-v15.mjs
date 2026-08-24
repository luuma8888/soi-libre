import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { adaptCompactRuntime } from "./boussole-runtime-compact.mjs";
import { loadBoussoleEngine } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const OFFLINE_APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro-offline.html");
const RUNTIME_DIR = path.join(ROOT, "creations/boussolepro/boussole-runtime");
const REPORT_PATH = path.join(ROOT, "tmp/monde-pro/boussole-v1.5.1/functional-validation-report.json");
const PROFILE_PATH = path.join(ROOT, "tmp/monde-pro/profils tests/boussole-pro-profil-cedric-2026-07-10.json");

const [html, offlineHtml, manifest, core, competences, marche, legacyEnvelope] = await Promise.all([
  readFile(APP_PATH, "utf8"),
  readFile(OFFLINE_APP_PATH, "utf8"),
  readJson("boussole-runtime-manifest.json"),
  readJson("boussole-core.json"),
  readJson("boussole-competences.json"),
  readJson("boussole-marche.json"),
  readFile(PROFILE_PATH, "utf8").then(JSON.parse).catch(() => ({ profile: {} }))
]);
const engine = loadBoussoleEngine(html);
const dataset = adaptCompactRuntime({ core, competences, marche }, manifest);
engine.App.state.dataset = dataset;
const failures = [];
const assertions = [];
const assert = (id, condition, details = null) => {
  assertions.push({ id, status: condition ? "passed" : "failed", details });
  if (!condition) failures.push({ id, details });
};
const byCode = code => dataset.jobs.find(job => job.romeCode === code);
const resultByCode = (results, code) => results.completeList.find(result => result.romeCode === code);
const audience = (code, id) => byCode(code)?.audienceSignals?.find(signal => signal.id === id);
const hasHardExclusion = (results, code) => resultByCode(results, code)?.exclusionDecision?.status === "hard" || resultByCode(results, code)?.status === "excluded_for_now";
const exclusionStatus = (results, code) => resultByCode(results, code)?.exclusionDecision?.status || "none";

const realProfile = createProfile({
  ...(legacyEnvelope.profile || {}),
  profileName: "Fixture universelle",
  skills: [],
  skillSignals: [],
  skillSelections: [],
  customSkills: [],
  unresolvedCustomSkills: [],
  experienceDomains: [],
  experienceDomainDetails: {},
  domainOrientation: {},
  jobExperiences: [
    { id: "fixture-g1203", jobId: "rome-G1203", romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, recency: "current", isCurrent: true, masteryLevel: "expert", enjoymentLevel: "love", wantsToContinue: "yes", source: "user_direct" },
    { id: "fixture-m1805", jobId: "rome-M1805", romeCode: "M1805", title: "Développeur / Développeuse informatique", durationYears: 7, recency: "old", isCurrent: false, masteryLevel: "autonomous", enjoymentLevel: "neutral", wantsToContinue: "no", source: "user_direct" }
  ],
  interests: ["aider", "accompagner", "transmettre", "enfants", "creer", "proteger"],
  values: ["meaning", "service", "creativity", "solidarity"],
  trainingFamilies: ["numerique", "education_animation"],
  desiredTrainingFamilies: ["social", "education_animation"],
  preferredWorkStyles: ["relational", "creative"],
  preferredEnvironments: ["children"],
  excludedDomains: ["petite_enfance", "industrie", "batiment", "commerce"],
  exclusions: { jobIds: [], domains: ["petite_enfance", "industrie", "batiment", "commerce"], tags: [] },
  driverLicenses: ["B"],
  driverLicenseBStatus: "yes",
  completedBoussole: true,
  hasRequestedResults: true
});

const profileFixtures = [
  ["administratif_calme", { interests: ["organiser", "analyser"], values: ["clarity", "stability"], preferredWorkStyles: ["structured"], preferredEnvironments: ["office", "quiet"] }],
  ["enfance_relation", { interests: ["accompagner", "transmettre", "enfants"], values: ["meaning", "service"], preferredWorkStyles: ["relational"], preferredEnvironments: ["children"], desiredTrainingFamilies: ["education_animation"] }],
  ["numerique_coeur", { interests: ["analyser", "creer"], values: ["autonomy", "precision"], preferredWorkStyles: ["autonomous", "structured"], preferredEnvironments: ["remote", "office"], desiredTrainingFamilies: ["numerique"] }],
  ["terrain_nature", { interests: ["nature", "proteger"], values: ["ecology", "autonomy"], preferredWorkStyles: ["movement", "manual"], preferredEnvironments: ["outdoor", "field"] }],
  ["proprete_hotellerie", { interests: ["organiser", "aider"], values: ["service", "stability"], preferredWorkStyles: ["structured", "movement"], preferredEnvironments: ["public", "field"] }],
  ["minimal", {}],
  ["social_commerce_exclu", { interests: ["aider", "accompagner"], desiredTrainingFamilies: ["social"], excludedDomains: ["commerce"], exclusions: { domains: ["commerce"], jobIds: [], tags: [] } }],
  ["education_numerique_outil", { interests: ["transmettre", "enfants"], trainingFamilies: ["numerique"], desiredTrainingFamilies: ["education_animation"], preferredEnvironments: ["children"] }],
  ["animateur_souhaite", { jobExperiences: [realProfile.jobExperiences[0]], interests: ["accompagner", "transmettre", "enfants"], preferredEnvironments: ["children"] }],
  ["metier_non_souhaite", { jobExperiences: [realProfile.jobExperiences[1]], interests: ["analyser"] }],
  ["experience_ancienne", { jobExperiences: [{ ...realProfile.jobExperiences[0], recency: "old", isCurrent: false, wantsToContinue: "maybe" }] }],
  ["sans_experience", { interests: ["creer", "organiser"], jobExperiences: [] }],
  ["profil_reel", realProfile],
  ["profil_reel_sans_cadre", { ...realProfile, preferredEnvironments: [] }],
  ["profil_reel_sans_exclusion_public", { ...realProfile, excludedDomains: ["industrie", "batiment", "commerce"], exclusions: { domains: ["industrie", "batiment", "commerce"], jobIds: [], tags: [] } }],
  ["screen_open", { ...realProfile, constraints: setConstraint(realProfile.constraints, "screenWork", "open") }]
].map(([id, values]) => [id, createProfile(values)]);

const runs = new Map();
for (const [id, profile] of profileFixtures) {
  engine.App.state.profile = profile;
  const results = engine.calculateAllMatches(profile, dataset, { skipAudit: true });
  runs.set(id, { profile, results });
  const ids = results.completeList.map(item => item.jobId);
  const invalid = results.completeList.filter(item => !Number.isFinite(item.personalFitScore) || !Number.isFinite(item.personalFitTieBreakScore) || item.personalFitScore < 0 || item.personalFitScore > 100);
  assert(`profile_${id}_1000_unique_finite`, ids.length === 1000 && new Set(ids).size === 1000 && invalid.length === 0, { count: ids.length, unique: new Set(ids).size, invalid: invalid.slice(0, 5).map(item => item.romeCode) });
}

assert("audience_k1202_essential", audience("K1202", "petite_enfance")?.centrality === "essential", audience("K1202"));
assert("audience_k1307_essential", audience("K1307", "petite_enfance")?.centrality === "essential", audience("K1307"));
assert("audience_j1304_central", ["essential", "dominant"].includes(audience("J1304", "petite_enfance")?.centrality), audience("J1304"));
assert("audience_k1303_multi_age", audience("K1303", "children_multi_age")?.centrality === "dominant" && audience("K1303", "petite_enfance")?.centrality === "possible", byCode("K1303")?.audienceSignals);
assert("audience_k1308_preschool", audience("K1308", "children_preschool_3_6")?.centrality === "essential" && !audience("K1308", "petite_enfance"), byCode("K1308")?.audienceSignals);
assert("audience_g1235_multi_age", ["dominant", "possible"].includes(audience("G1235", "children_multi_age")?.centrality) && audience("G1235", "petite_enfance")?.centrality !== "essential", byCode("G1235")?.audienceSignals);
assert("audience_g1203_youth", ["essential", "dominant"].includes(audience("G1203", "youth")?.centrality), byCode("G1203")?.audienceSignals);
assert("audience_k1309_multi_age", audience("K1309", "children_multi_age")?.centrality === "dominant", byCode("K1309")?.audienceSignals);
assert("audience_l1510_none", !(byCode("L1510")?.audienceSignals || []).some(signal => /child|enfance|youth/.test(signal.id)), byCode("L1510")?.audienceSignals);

assert("l1510_taxonomy_clean", byCode("L1510")?.primarySectorId === "culture_communication" && !(byCode("L1510")?.secondarySectorIds || []).some(id => ["education_enfance", "social_insertion"].includes(id)), byCode("L1510"));
assert("l1510_tags_clean", !["enfants", "transmettre", "nature", "accompagner"].some(tag => byCode("L1510")?.interestTags?.includes(tag)) && !byCode("L1510")?.transitionTags?.includes("enfance"), byCode("L1510"));
assert("audience_dictionary_preschool_label", core.dictionaries?.audiences?.some(item => item.id === "children_preschool_3_6" && item.label === "Enfants de maternelle (3–6 ans)"), core.dictionaries?.audiences);

const realResults = runs.get("profil_reel").results;
const offlineEngine = loadBoussoleEngine(offlineHtml);
offlineEngine.App.state.dataset = dataset;
const offlineProfile = offlineEngine.normalizeProfile(structuredClone(realProfile));
offlineEngine.App.state.profile = offlineProfile;
const offlineResults = offlineEngine.calculateAllMatches(offlineProfile, dataset, { skipAudit: true });
const paritySignature = results => ({
  top5: results.top5.map(item => item.romeCode),
  excluded: results.excluded.map(item => item.romeCode),
  scores: results.completeList.map(item => [item.romeCode, item.personalFitScore, item.personalFitTieBreakScore])
});
assert("online_offline_functional_parity", JSON.stringify(paritySignature(realResults)) === JSON.stringify(paritySignature(offlineResults)), { onlineTop: paritySignature(realResults).top5, offlineTop: paritySignature(offlineResults).top5 });
assert("real_exclusion_matrix", !hasHardExclusion(realResults, "G1235") && !hasHardExclusion(realResults, "K1303") && hasHardExclusion(realResults, "K1202") && hasHardExclusion(realResults, "K1307") && hasHardExclusion(realResults, "J1304") && !hasHardExclusion(realResults, "K1308") && !hasHardExclusion(realResults, "K1309") && !hasHardExclusion(realResults, "L1510"), Object.fromEntries(["G1235", "K1303", "K1202", "K1307", "J1304", "K1308", "K1309", "L1510"].map(code => [code, resultByCode(realResults, code)?.exclusionDecision || resultByCode(realResults, code)?.exclusionReasons])));
assert("real_warning_matrix", exclusionStatus(realResults, "K1303") === "warning" && exclusionStatus(realResults, "G1235") === "warning" && exclusionStatus(realResults, "K1309") === "warning" && exclusionStatus(realResults, "K1308") === "none" && exclusionStatus(realResults, "L1510") === "none", Object.fromEntries(["K1303", "G1235", "K1309", "K1308", "L1510"].map(code => [code, exclusionStatus(realResults, code)])));
assert("petite_enfance_messages_exact", resultByCode(realResults, "K1202")?.exclusionDecision?.reasons?.[0]?.message === "Vous avez exclu « Petite enfance (0–3 ans) » et ce public est incontournable dans ce métier." && resultByCode(realResults, "K1303")?.exclusionDecision?.warnings?.[0]?.message === "Des enfants de 0 à 3 ans peuvent être concernés selon le poste, sans être un public systématique.", { hard: resultByCode(realResults, "K1202")?.exclusionDecision, warning: resultByCode(realResults, "K1303")?.exclusionDecision });
assert("real_top_and_intent", realResults.top5.some(item => item.romeCode === "G1203") && resultByCode(realResults, "G1203")?.personalFitScore >= resultByCode(realResults, "M1805")?.personalFitScore + 20, realResults.top5.map(item => item.romeCode));
assert("l1510_not_in_child_top", !runs.get("enfance_relation").results.top5.some(item => item.romeCode === "L1510"), runs.get("enfance_relation").results.top5.map(item => item.romeCode));

const withoutAudienceExclusion = runs.get("profil_reel_sans_exclusion_public").results;
assert("no_audience_exclusion_without_choice", ["K1303", "K1308", "K1202", "K1307", "J1304", "G1235", "K1309", "L1510"].every(code => exclusionStatus(withoutAudienceExclusion, code) === "none"), Object.fromEntries(["K1303", "K1308", "K1202", "K1307", "J1304", "G1235", "K1309", "L1510"].map(code => [code, exclusionStatus(withoutAudienceExclusion, code)])));
assert("exclusion_does_not_change_personal_score", resultByCode(realResults, "K1202")?.personalFitScore === resultByCode(withoutAudienceExclusion, "K1202")?.personalFitScore && resultByCode(realResults, "K1202")?.personalFitTieBreakScore === resultByCode(withoutAudienceExclusion, "K1202")?.personalFitTieBreakScore, { excluded: summarize(resultByCode(realResults, "K1202")), open: summarize(resultByCode(withoutAudienceExclusion, "K1202")) });
assert("relevance_without_exclusion_is_fit", realResults.completeList.every(item => item.relevanceWithoutExclusion === item.personalFitScore), realResults.completeList.filter(item => item.relevanceWithoutExclusion !== item.personalFitScore).slice(0, 10).map(summarize));
assert("no_hard_exclusion_from_possible", realResults.completeList.every(item => item.exclusionDecision?.status !== "hard" || item.exclusionDecision.reasons.every(reason => !["possible", "unknown"].includes(reason.evidenceLevel))), realResults.completeList.filter(item => item.exclusionDecision?.status === "hard" && item.exclusionDecision.reasons.some(reason => ["possible", "unknown"].includes(reason.evidenceLevel))).map(summarize));

const g1203 = resultByCode(realResults, "G1203");
assert("g1203_in_skills_supported_tab", realResults.resultsViewModel?.skillsSupportedPaths?.some(item => item.romeCode === "G1203"), realResults.resultsViewModel?.skillsSupportedPaths?.slice(0, 10));
assert("personal_assessment_contract", realResults.resultsViewModel?.jobDetailsById?.[g1203.jobId]?.personalAssessment?.dimensions?.length === 4, realResults.resultsViewModel?.jobDetailsById?.[g1203.jobId]?.personalAssessment);
assert("exclusion_decision_in_detail_contract", realResults.resultsViewModel?.jobDetailsById?.[resultByCode(realResults, "K1202")?.jobId]?.exclusionDecision?.status === "hard", realResults.resultsViewModel?.jobDetailsById?.[resultByCode(realResults, "K1202")?.jobId]);
assert("market_ranking_weight_zero", [...runs.values()].every(run => run.results.resultsViewModel?.resultMetadata?.marketRankingWeight === 0), [...runs.values()].map(run => run.results.resultsViewModel?.resultMetadata?.marketRankingWeight));

const realNoContext = runs.get("profil_reel_sans_cadre").results;
assert("environment_changes_only_context", resultByCode(realResults, "G1203")?.personalFitComponents?.aspiration === resultByCode(realNoContext, "G1203")?.personalFitComponents?.aspiration && resultByCode(realResults, "G1203")?.personalFitComponents?.values === resultByCode(realNoContext, "G1203")?.personalFitComponents?.values && resultByCode(realResults, "G1203")?.personalFitComponents?.dailyReality === resultByCode(realNoContext, "G1203")?.personalFitComponents?.dailyReality && resultByCode(realResults, "G1203")?.contextAlignment?.environmentScore100 !== resultByCode(realNoContext, "G1203")?.contextAlignment?.environmentScore100, { withContext: summarize(g1203), withoutContext: summarize(resultByCode(realNoContext, "G1203")) });
assert("context_alignment_contract", Boolean(g1203?.contextAlignment) && ["score100", "environmentScore100", "workStyleScore100", "rhythmScore100", "matchedEnvironments", "unmatchedEnvironments", "unknownEnvironments", "confidence"].every(key => key in g1203.contextAlignment), g1203?.contextAlignment);

const screenAbsentProfile = createProfile({ ...realProfile, constraints: (realProfile.constraints || []).filter(item => item.value !== "screenWork") });
engine.App.state.profile = screenAbsentProfile;
const screenAbsent = engine.calculateAllMatches(screenAbsentProfile, dataset, { skipAudit: true });
const screenOpen = runs.get("screen_open").results;
assert("screen_open_is_neutral", ["G1203", "M1805", "L1510"].every(code => resultByCode(screenAbsent, code)?.personalFitScore === resultByCode(screenOpen, code)?.personalFitScore && resultByCode(screenAbsent, code)?.personalFitComponents?.aspiration === resultByCode(screenOpen, code)?.personalFitComponents?.aspiration), { absent: ["G1203", "M1805", "L1510"].map(code => summarize(resultByCode(screenAbsent, code))), open: ["G1203", "M1805", "L1510"].map(code => summarize(resultByCode(screenOpen, code))) });

const topSets = ["administratif_calme", "enfance_relation", "numerique_coeur", "terrain_nature"].map(id => runs.get(id).results.top5.map(item => item.romeCode).join("|"));
assert("universal_profiles_have_distinct_tops", new Set(topSets).size === topSets.length, topSets);
assert("numeric_profile_promotes_numeric_jobs", runs.get("numerique_coeur").results.top5.some(item => item.romeCode === "M1805" || item.job?.primarySectorId === "numerique"), runs.get("numerique_coeur").results.top5.map(summarize));

const relatedPair = (a, b) => byCode(a)?.relatedJobIds?.includes(byCode(b)?.id) && byCode(b)?.relatedJobIds?.includes(byCode(a)?.id);
assert("relations_expected_and_clean", relatedPair("G1203", "G1235") && relatedPair("G1203", "G1202") && relatedPair("K1207", "K1208") && !relatedPair("G1203", "L1510") && !relatedPair("G1203", "G1206"), { g1203: byCode("G1203")?.relatedJobIds, l1510: byCode("L1510")?.relatedJobIds });
const adjacency = dataset.jobs.map(job => [job.id, [...(job.relatedJobIds || [])].sort()]).sort((a, b) => a[0].localeCompare(b[0]));
const edgeCount = adjacency.reduce((sum, [, ids]) => sum + ids.length, 0) / 2;
const graphHash = digest(adjacency);
assert("relation_graph_frozen", edgeCount === 4973 && adjacency.every(([, ids]) => ids.length > 0) && graphHash === "53f68f2ee907ef1e084f69a39769a490647796099cd59b67cd66581d764b29a0", { edgeCount, isolated: adjacency.filter(([, ids]) => !ids.length).length, graphHash });
const genericTopSignature = Object.fromEntries([...runs].map(([id, run]) => [id, run.results.top5.map(item => [item.romeCode, item.personalFitScore, item.personalFitTieBreakScore])]));
assert("generic_results_frozen_with_audience_exception", digest(genericTopSignature) === "a7fa6ca001521617a816f9e7f373aea440d2c96241da9fa51c51b37347aef2ce", { hash: digest(genericTopSignature), baselineHash: "7dd49264610248d7c7e1bf13d0a88344d3c14c60e62ff40f0ee55ea20ab68fb9", allowedDifference: "K1303 is no longer removed by the 0-3 audience exclusion and can enter the visible Top; its personal score is unchanged." });

const marketRows = dataset.jobs.flatMap(job => ["national", "regional", "departmental"].map(key => job.marketStats?.[key]).filter(Boolean));
assert("market_presence_percentiles", marketRows.some(row => Number.isFinite(row.presencePercentile) && row.presencePercentile > 0) && marketRows.filter(row => Number.isFinite(row.offers12m) && row.offers12m === 0).every(row => row.presencePercentile === 0) && marketRows.filter(row => !Number.isFinite(row.offers12m)).every(row => row.presencePercentile === null), { computed: marketRows.filter(row => Number.isFinite(row.presencePercentile)).length, zeros: marketRows.filter(row => row.presencePercentile === 0).length, absent: marketRows.filter(row => row.presencePercentile === null).length });
const contradictoryMarketRows = marketRows.filter(row => Number(row.offers12m) === 0 && (row.offersLevel === "medium" || ["medium_local", "strong_local", "top_local"].includes(row.territorialOfferSignal)));
assert("market_zero_signal_consistency", contradictoryMarketRows.length === 0, contradictoryMarketRows.slice(0, 20).map(row => ({ territory: row.territoryId, offers: row.offers12m, offersLevel: row.offersLevel, territorialSignal: row.territorialOfferSignal })));

assert("exploration_sort_contract_in_source", html.includes("explorationSort") && html.includes("Accord personnel — du plus élevé") && html.includes("Intitulé — Z à A"), null);
assert("dynamic_rosette_contract_in_source", html.includes("maxBranchLength") && html.includes("branchRadius") && html.includes("DIRECTION_STYLE"), null);
assert("market_climate_popover_contract_in_source", html.includes("market-climate-capsule") && html.includes("market-popover") && html.includes("aria-expanded"), null);
assert("market_climate_verdict_contract_in_source", ["Porteur", "Niche en tension", "Actif", "Limité", "Données partielles", "Indisponible"].every(label => html.includes(label)) && html.includes("Voir les données utilisées") && html.includes("marketRankingWeight: 0"), null);
assert("final_editorial_contract_in_source", html.includes("<title>Boussole Pro - explorer ses pistes professionnelles</title>") && html.includes('high: "Élevée"') && html.includes('medium: "Moyenne"') && html.includes('low: "Faible"') && !html.includes("La liste complète du prototype") && !html.includes("le prototype ne force pas"), null);
assert("market_wind_visual_removed_from_source", !/Carte des vents du marché|market-wind-map|market-main-plane|market-marker|market-quadrant|market-axis-[xy]/.test(html), null);
assert("job_detail_balance_contract_in_source", html.includes("balanceJobDetailColumns") && html.includes("agreement-matrix") && html.includes("Quatre repères de l’accord personnel"), null);
assert("related_panel_contract_in_source", html.includes("Métiers proches de «") && html.includes("openRelatedJobs") && html.includes("back-dialog-state"), null);
assert("favorite_icon_contract_in_source", html.includes("favoriteIcon") && html.includes('fill="currentColor"'), null);
assert("version_v1_5_1", html.includes("Boussole Pro v1.5.1"), null);
const rankingSource = ["calculatePersonalFitMetrics", "comparePersonalFitCandidates", "diversifyTopResults"].map(name => html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))?.[0] || "").join("\n");
assert("no_fixture_overfit_in_ranking", !/Lu['’]?uma|Cedric|2026-07-10|profile-demo|G1203|M1805/.test(rankingSource), rankingSource.match(/Lu['’]?uma|Cedric|2026-07-10|profile-demo|G1203|M1805/g));

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v1_5_1_functional_validation",
  generatedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "passed",
  assertionCount: assertions.length,
  failures,
  assertions,
  profileTop5: Object.fromEntries([...runs].map(([id, run]) => [id, run.results.top5.map(summarize)])),
  scoreDistributions: Object.fromEntries([...runs].map(([id, run]) => [id, distribution(run.results.completeList.map(item => item.personalFitScore))])),
  exclusionMatrix: Object.fromEntries(["G1235", "K1303", "K1202", "K1307", "J1304", "K1308", "K1309", "L1510"].map(code => [code, resultByCode(realResults, code)?.exclusionDecision || null])),
  contextComponents: Object.fromEntries(["G1203", "M1805", "L1510"].map(code => [code, resultByCode(realResults, code)?.contextAlignment || null])),
  parity: { onlineOffline: "passed", datasetVersion: manifest.datasetVersion, jobs: dataset.jobs.length },
  frozenReference: { appVersion: "1.5.0", coreSha256: "f02e3553aae2585c16a6be2390d20f6959b7c9823436fde56853dd9a8c6e4de9", competencesSha256: "20495a601eaa38001129c77a0feb74f185d64b9f1d383aa920c13ff804e6c22a", marketSha256: "9cc42115d4c5bf8b9c33e3c8ad3a6655aa0a02359204e972ffbf1eb8e6c3df5c", graphHash: "53f68f2ee907ef1e084f69a39769a490647796099cd59b67cd66581d764b29a0", genericResultsHash: "7dd49264610248d7c7e1bf13d0a88344d3c14c60e62ff40f0ee55ea20ab68fb9" },
  current: { appVersion: "1.5.1", datasetVersion: manifest.datasetVersion },
  referenceMatrix: Object.fromEntries(["G1203", "M1805", "G1235", "K1202", "K1307", "J1304", "K1308", "K1309", "L1510"].map(code => [code, summarize(resultByCode(realResults, code))]))
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, assertions: report.assertionCount, failures: failures.map(item => item.id), report: path.relative(ROOT, REPORT_PATH) }, null, 2));
if (failures.length) throw new Error(`Validation de consolidation v1.5.1 échouée : ${failures.map(item => item.id).join(", ")}`);

function createProfile(values = {}) {
  return engine.normalizeProfile({
    profileName: "Fixture universelle",
    jobExperiences: [],
    skills: [],
    skillSignals: [],
    skillSelections: [],
    customSkills: [],
    unresolvedCustomSkills: [],
    interests: [],
    values: [],
    trainingFamilies: [],
    desiredTrainingFamilies: [],
    preferredWorkStyles: [],
    preferredEnvironments: [],
    excludedDomains: [],
    exclusions: { jobIds: [], domains: [], tags: [] },
    constraints: [],
    completedBoussole: true,
    hasRequestedResults: true,
    ...values
  });
}

function setConstraint(constraints = [], value, severity) {
  const rows = constraints.map(item => ({ ...item }));
  const current = rows.find(item => item.value === value);
  if (current) current.severity = severity;
  else rows.push({ id: `constraint-${value}`, value, label: value, type: "environment", severity });
  return rows;
}

function summarize(result) {
  if (!result) return null;
  return {
    romeCode: result.romeCode,
    title: result.title,
    personalFitScore: result.personalFitScore,
    personalFitTieBreakScore: result.personalFitTieBreakScore,
    personalFitComponents: result.personalFitComponents,
    environmentScore100: result.contextAlignment?.environmentScore100,
    status: result.status,
    exclusionDecision: result.exclusionDecision
  };
}

function distribution(scores = []) {
  const buckets = { "0_39": 0, "40_59": 0, "60_79": 0, "80_100": 0 };
  for (const score of scores) {
    if (score < 40) buckets["0_39"] += 1;
    else if (score < 60) buckets["40_59"] += 1;
    else if (score < 80) buckets["60_79"] += 1;
    else buckets["80_100"] += 1;
  }
  return buckets;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(RUNTIME_DIR, name), "utf8"));
}
