import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adaptCompactRuntime } from "./boussole-runtime-compact.mjs";
import { loadBoussoleEngine } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const RUNTIME_DIR = path.join(ROOT, "creations/boussolepro/boussole-runtime");
const REPORT_PATH = path.join(ROOT, "tmp/monde-pro/boussole-v1.4/functional-validation-report.json");
const PROFILE_PATH = path.join(ROOT, "tmp/monde-pro/profils tests/boussole-pro-profil-cedric-2026-07-10.json");

const [html, manifest, core, competences, marche, legacyEnvelope] = await Promise.all([
  readFile(APP_PATH, "utf8"),
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

const saturationCases = [0, 0.5, 2.35, 3, 3.35, 4, 100].map(value => ({ value, score: engine.saturatingTagScore(value, 10, 3) }));
assert("saturation_finite_and_bounded", saturationCases.every(row => Number.isFinite(row.score) && row.score >= 0 && row.score <= 10), saturationCases);
assert("saturation_monotonic", saturationCases.every((row, index) => index === 0 || row.score >= saturationCases[index - 1].score), saturationCases);
assert("saturation_reaches_max_at_target", saturationCases.find(row => row.value === 3)?.score === 10, saturationCases);

const profile = engine.normalizeProfile({
  ...(legacyEnvelope.profile || {}),
  profileName: "Cédric - fixture v1.4",
  skills: [],
  skillSignals: [],
  skillSelections: [],
  customSkills: [],
  unresolvedCustomSkills: [],
  experienceDomains: [],
  experienceDomainDetails: {},
  domainOrientation: {},
  jobExperiences: [
    { id: "cedric-g1203", jobId: "rome-G1203", romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, recency: "current", isCurrent: true, masteryLevel: "expert", enjoymentLevel: "love", wantsToContinue: "yes", source: "user_direct" },
    { id: "cedric-m1805", jobId: "rome-M1805", romeCode: "M1805", title: "Développeur / Développeuse informatique", durationYears: 3, recency: "old", isCurrent: false, masteryLevel: "autonomous", enjoymentLevel: "not_specified", wantsToContinue: "no", source: "user_direct" }
  ],
  interests: ["aider", "accompagner", "transmettre", "enfants", "creer", "proteger"],
  values: ["meaning", "service", "team"],
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
engine.App.state.profile = profile;
const criteria = engine.mapUserProfileToCriteria(profile);
const results = engine.calculateAllMatches(profile, dataset, { skipAudit: true });
const g1203 = resultByCode(results, "G1203");
const m1805 = resultByCode(results, "M1805");
const k1309 = resultByCode(results, "K1309");
const k1303 = resultByCode(results, "K1303");
const d1302 = resultByCode(results, "D1302");
const k2110 = resultByCode(results, "K2110");
const k2113 = resultByCode(results, "K2113");

const scoreFields = ["personalFitScore", "personalFitTieBreakScore", "globalScore", "selectionScore", "feasibilityScore"];
const invalidScores = results.completeList.flatMap(result => scoreFields.filter(field => !Number.isFinite(result[field]) || result[field] < 0 || result[field] > 100).map(field => `${result.romeCode}:${field}:${result[field]}`));
const invalidComponents = results.completeList.flatMap(result => Object.entries(result.personalFitComponents || {}).filter(([, value]) => value !== "not_evaluated" && (!Number.isFinite(value) || value < 0 || value > 100)).map(([field, value]) => `${result.romeCode}:${field}:${value}`));
assert("all_scores_finite_and_bounded", invalidScores.length === 0 && invalidComponents.length === 0, { invalidScores: invalidScores.slice(0, 20), invalidComponents: invalidComponents.slice(0, 20) });
assert("exact_intention_adjustment_positive", g1203?.personalFitIntentAdjustment === 14, summarize(g1203));
assert("exact_intention_adjustment_negative", m1805?.personalFitIntentAdjustment === -18, summarize(m1805));
assert("g1203_twenty_points_above_m1805", g1203?.personalFitScore >= m1805?.personalFitScore + 20, { g1203: summarize(g1203), m1805: summarize(m1805) });
assert("g1203_is_top_representative", results.top5.some(result => result.romeCode === "G1203"), results.top5.map(summarize));
assert("g1203_exact_experience_support", g1203?.skillsReadinessEvidence?.some(label => /expérience|exercé|G1203|Animateur/i.test(label)), g1203?.skillsReadinessEvidence);
assert("m1805_negative_intent_explained", m1805?.personalFitReasons?.some(label => /ne pas souhait|ne souhaitez pas|écart/i.test(label)), m1805?.personalFitReasons);
assert("k2113_above_k2110", k2113?.personalFitTieBreakScore > k2110?.personalFitTieBreakScore, { k2113: summarize(k2113), k2110: summarize(k2110) });
assert("k1309_not_childcare_excluded", !k1309?.exclusionReasons?.some(item => item.code === "voluntary_domain_petite_enfance"), k1309?.exclusionReasons);
assert("k1303_childcare_warning_v151", k1303?.exclusionDecision?.status === "warning" && !k1303?.exclusionReasons?.some(item => ["voluntary_domain_petite_enfance", "voluntary_audience_petite_enfance"].includes(item.code)), k1303?.exclusionDecision);
assert("d1302_commerce_excluded", d1302?.status === "excluded_for_now", d1302?.exclusionReasons);
assert("skills_absence_does_not_penalize_fit", results.completeList.every(result => Number.isFinite(result.personalFitScore)), { skills: profile.skills?.length, skillSelections: profile.skillSelections?.length });

const tagArrays = core.jobs.flatMap(job => [[job.id, "interest", job.interestTags], [job.id, "value", job.valueTags], [job.id, "transition", job.transitionTags]]);
assert("tags_limited_to_six", tagArrays.every(([, , tags]) => (tags || []).length <= 6), tagArrays.filter(([, , tags]) => (tags || []).length > 6).slice(0, 20));
assert("generated_tag_statistics", Array.isArray(core.tagStatistics) && core.tagStatistics.length > 0 && core.tagStatistics.every(row => Number.isFinite(row.df) && Number.isFinite(row.prevalence) && Number.isFinite(row.weight)), core.tagStatistics?.slice(0, 5));
assert("d1302_noise_removed", !byCode("D1302")?.interestTags?.includes("animaux") && !byCode("D1302")?.transitionTags?.includes("social") && !byCode("D1302")?.transitionTags?.includes("animation"), byCode("D1302"));
assert("k2110_child_noise_removed", !byCode("K2110")?.interestTags?.includes("enfants") && !byCode("K2110")?.transitionTags?.includes("enfance"), byCode("K2110"));
assert("g1203_specific_tags_preserved", ["enfants", "accompagner", "transmettre", "creer", "proteger"].every(tag => byCode("G1203")?.interestTags?.includes(tag)), byCode("G1203")?.interestTags);

const relationErrors = [];
for (const job of dataset.jobs) {
  const related = job.relatedJobIds || [];
  if (related.length > 12) relationErrors.push(`${job.romeCode}:degree:${related.length}`);
  for (const relatedId of related) {
    const other = dataset.jobs.find(candidate => candidate.id === relatedId);
    if (!other) relationErrors.push(`${job.romeCode}:orphan:${relatedId}`);
    else if (!(other.relatedJobIds || []).includes(job.id)) relationErrors.push(`${job.romeCode}:asymmetric:${other.romeCode}`);
  }
}
assert("related_graph_valid_symmetric", relationErrors.length === 0, relationErrors.slice(0, 30));
const relatedPair = (a, b) => byCode(a)?.relatedJobIds?.includes(byCode(b)?.id) && byCode(b)?.relatedJobIds?.includes(byCode(a)?.id);
assert("expected_close_relations", relatedPair("G1203", "G1235") && relatedPair("G1203", "G1202") && relatedPair("K1208", "K1207"), {
  g1203: byCode("G1203")?.relatedJobIds,
  k1208: byCode("K1208")?.relatedJobIds
});
assert("expected_domain_relations", (relatedPair("K1206", "K1209") || relatedPair("K1206", "K1217")) && (relatedPair("K2110", "K2138") || relatedPair("K2110", "K2116")), {
  k1206: byCode("K1206")?.relatedJobIds,
  k2110: byCode("K2110")?.relatedJobIds
});
assert("forbidden_strong_relations_absent", !relatedPair("G1203", "G1206") && !relatedPair("K2110", "K2113"), {
  g1203: byCode("G1203")?.relatedJobIds,
  k2110: byCode("K2110")?.relatedJobIds
});

const activityMissing = core.jobs.filter(job => job.missingFields?.includes("activities"));
assert("missing_activities_recomputed", activityMissing.length === core.jobs.filter(job => !job.activities?.length).length && activityMissing.length === 12, { declared: activityMissing.length, empty: core.jobs.filter(job => !job.activities?.length).length });
const marketByCode = code => marche.jobs.find(row => row.jobId === byCode(code)?.id)?.territories;
assert("partial_market_offers_preserved", marketByCode("A1206")?.FR?.availability === "partial" && marketByCode("A1206")?.FR?.offersCount === 1260, marketByCode("A1206"));
assert("k1204_market_reference", marketByCode("K1204")?.FR?.offersCount === 2940 && marketByCode("K1204")?.FR?.tensionLevel === "high" && marketByCode("K1204")?.["REG-76"]?.offersCount === 160 && marketByCode("K1204")?.["DEP-11"]?.offersCount === 10 && marketByCode("K1204")?.["DEP-11"]?.tensionLevel === "very_high", marketByCode("K1204"));

const completeIds = results.resultsViewModel?.completeList.map(row => row.jobId) || [];
const topIds = new Set(results.resultsViewModel?.topDirections.map(row => row.representative.jobId) || []);
const recommendedExcludesTop = results.resultsViewModel?.recommendedPaths.every(row => !topIds.has(row.jobId));
assert("result_families_keep_complete_catalog", completeIds.length === 1000 && new Set(completeIds).size === 1000 && recommendedExcludesTop, { total: completeIds.length, unique: new Set(completeIds).size, recommendedExcludesTop });

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v1_4_functional_validation",
  generatedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "passed",
  assertionCount: assertions.length,
  failures,
  counts: { jobs: dataset.jobs.length, skills: dataset.skillsEngine.length, knowledge: dataset.knowledge.length },
  top5: results.top5.map(summarize),
  calibration: {
    auditBaselineBeforeV14: {
      source: "audit fonctionnel fourni avant correction",
      scores: { G1203: 67, M1805: 61, K1206: 57, K1208: 53, K1309: 52 }
    },
    afterV14: Object.fromEntries(["G1203", "M1805", "K1206", "K1208", "K1309"].map(code => [code, summarize(resultByCode(results, code))])),
    scoreDistribution: scoreDistribution(results.completeList.map(item => item.personalFitScore))
  },
  references: Object.fromEntries(["G1203", "M1805", "K1206", "K1208", "K1309", "K2110", "K2113"].map(code => [code, summarize(resultByCode(results, code))])),
  saturationCases,
  activityMissingCount: activityMissing.length,
  relationErrorCount: relationErrors.length
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) throw new Error(`Validation v1.4 échouée : ${failures.map(item => item.id).join(", ")}`);

function summarize(result) {
  if (!result) return null;
  return {
    romeCode: result.romeCode,
    title: result.title,
    personalFitScore: result.personalFitScore,
    personalFitTieBreakScore: result.personalFitTieBreakScore,
    personalFitIntentAdjustment: result.personalFitIntentAdjustment,
    personalFitComponents: result.personalFitComponents,
    status: result.status,
    top5ThemeId: result.top5ThemeId
  };
}

function scoreDistribution(values) {
  const finite = values.filter(Number.isFinite);
  const buckets = { "0-19": 0, "20-39": 0, "40-59": 0, "60-79": 0, "80-100": 0 };
  for (const value of finite) {
    if (value < 20) buckets["0-19"] += 1;
    else if (value < 40) buckets["20-39"] += 1;
    else if (value < 60) buckets["40-59"] += 1;
    else if (value < 80) buckets["60-79"] += 1;
    else buckets["80-100"] += 1;
  }
  return {
    count: finite.length,
    minimum: Math.min(...finite),
    maximum: Math.max(...finite),
    average: Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(3)),
    buckets
  };
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(RUNTIME_DIR, name), "utf8"));
}
