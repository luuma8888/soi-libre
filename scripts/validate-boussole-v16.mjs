import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adaptCompactRuntime } from "./boussole-runtime-compact.mjs";
import { loadBoussoleEngine } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const APP = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const OFFLINE = path.join(ROOT, "creations/boussolepro/boussole-pro-offline.html");
const RUNTIME = path.join(ROOT, "creations/boussolepro/boussole-runtime");
const REPORT = path.join(ROOT, "tmp/monde-pro/boussole-v1.6.0/functional-validation-report.json");
const [html, offlineHtml, manifest, core, competences, marche] = await Promise.all([
  readFile(APP, "utf8"), readFile(OFFLINE, "utf8"), ...["boussole-runtime-manifest.json", "boussole-core.json", "boussole-competences.json", "boussole-marche.json"].map(file => readFile(path.join(RUNTIME, file), "utf8").then(JSON.parse))
]);
const dataset = adaptCompactRuntime({ core, competences, marche }, manifest);
const engine = loadBoussoleEngine(html); engine.App.state.dataset = dataset;
const offlineEngine = loadBoussoleEngine(offlineHtml); offlineEngine.App.state.dataset = dataset;
const assertions = [], failures = [];
const assert = (id, condition, details = null) => { assertions.push({ id, status: condition ? "passed" : "failed", details }); if (!condition) failures.push({ id, details }); };
const clone = value => structuredClone(value);
const baseProfile = values => engine.normalizeProfile({ profileName: "Fixture générique", interests: ["aider", "organiser"], values: ["meaning", "service"], preferredWorkStyles: ["relational"], preferredEnvironments: ["public"], constraints: [], skillSelections: [], jobExperiences: [], trainingFamilies: [], desiredTrainingFamilies: [], excludedDomains: [], exclusions: { jobIds: [], domains: [], tags: [] }, completedBoussole: true, hasRequestedResults: true, ...values });
const run = (profile, targetEngine = engine) => { targetEngine.App.state.dataset = dataset; const normalized = targetEngine.normalizeProfile(clone(profile)); targetEngine.App.state.profile = normalized; return targetEngine.calculateAllMatches(normalized, dataset, { skipAudit: true }); };
const byCode = (results, code) => results.completeList.find(item => item.romeCode === code);
const firstJobWithSkill = dataset.jobs.find(job => (job.scorableSkillIds || []).length) || dataset.jobs.find(job => (job.requiredSkills || []).length);
const targetSkillId = (firstJobWithSkill.scorableSkillIds || firstJobWithSkill.requiredSkills)[0];
const code = firstJobWithSkill.romeCode;

const noSkill = baseProfile({});
const acquired = baseProfile({ skillSelections: [{ skillId: targetSkillId, currentLevel: "mastered", futureWish: "none" }] });
const noSkillRun = run(noSkill), acquiredRun = run(acquired);
assert("acquired_skills_do_not_change_personal_fit", byCode(noSkillRun, code).personalFitScoreRaw === byCode(acquiredRun, code).personalFitScoreRaw, { code, before: byCode(noSkillRun, code).personalFitScoreRaw, after: byCode(acquiredRun, code).personalFitScoreRaw });
assert("acquired_skills_change_readiness_only", Number(byCode(acquiredRun, code).skillsReadiness || 0) > Number(byCode(noSkillRun, code).skillsReadiness || 0), { before: byCode(noSkillRun, code).skillsReadiness, after: byCode(acquiredRun, code).skillsReadiness });

const develop = baseProfile({ skillSelections: [{ skillId: targetSkillId, currentLevel: "practiced", futureWish: "develop" }] });
const continueProfile = baseProfile({ skillSelections: [{ skillId: targetSkillId, currentLevel: "mastered", futureWish: "continue" }] });
const avoid = baseProfile({ skillSelections: [{ skillId: targetSkillId, currentLevel: "not_assessed", futureWish: "avoid" }] });
const developResult = byCode(run(develop), code), continueResult = byCode(run(continueProfile), code), avoidResult = byCode(run(avoid), code);
assert("practiced_develop_two_independent_axes", developResult.personalFitDetailedComponents.desiredSkills > 50 && developResult.skillsReadiness > 0, developResult.personalFitDetailedComponents);
assert("mastered_continue_two_independent_axes", continueResult.personalFitDetailedComponents.desiredSkills > developResult.personalFitDetailedComponents.desiredSkills && continueResult.skillsReadiness >= developResult.skillsReadiness, null);
const avoidCriteria = engine.mapUserProfileToCriteria(avoid);
assert("avoid_is_desire_not_acquired_weakness", avoidResult.personalFitDetailedComponents.desiredSkills < 50 && !avoidCriteria.skillEvidence.weak.includes(targetSkillId) && !avoidCriteria.skillEvidence.absent.includes(targetSkillId), avoidCriteria.skillEvidence);
assert("unselected_skills_are_not_penalties", noSkillRun.completeList.every(item => item.skillsReadiness === null || item.skillsReadiness >= 0), null);

const exactPositive = baseProfile({ jobExperiences: [{ id: "experience", jobId: firstJobWithSkill.id, romeCode: code, title: firstJobWithSkill.title, enjoymentLevel: "love", wantsToContinue: "yes", durationYears: 10, recency: "current", masteryLevel: "expert" }] });
const exactNeutral = baseProfile({ jobExperiences: [{ id: "experience", jobId: firstJobWithSkill.id, romeCode: code, title: firstJobWithSkill.title, enjoymentLevel: "not_specified", wantsToContinue: "not_specified", durationYears: 10, recency: "current", masteryLevel: "expert" }] });
const positiveResult = byCode(run(exactPositive), code), neutralResult = byCode(run(exactNeutral), code);
assert("exact_experience_has_no_raw_bonus", positiveResult.personalFitIntentAdjustment === 0 && neutralResult.personalFitIntentAdjustment === 0, null);
assert("experience_intention_is_bounded_component", positiveResult.personalFitDetailedComponents.experiencedJobsRelationship === 100 && neutralResult.personalFitDetailedComponents.experiencedJobsRelationship === "not_evaluated", positiveResult.experiencedJobsRelationshipDiagnostic);
const relatedId = (firstJobWithSkill.relatedJobs || firstJobWithSkill.relatedJobIds || [])[0];
if (relatedId) { const related = dataset.jobs.find(job => job.id === relatedId); assert("experience_propagates_to_explicit_related_job", byCode(run(exactPositive), related.romeCode).personalFitDetailedComponents.experiencedJobsRelationship !== "not_evaluated", related.romeCode); }

const g1203 = dataset.jobs.find(job => job.romeCode === "G1203");
const nightProfile = baseProfile({ constraints: [{ value: "nightWork", severity: "avoid" }] });
const nightCriteria = engine.mapUserProfileToCriteria(nightProfile);
const night = engine.calculateConstraintScore(nightCriteria, g1203);
assert("rome_sparse_absence_not_penalized_g1203", night.score100 === 100 && night.riskScore === 0, night);
const remoteProfile = baseProfile({ constraints: [{ value: "remoteNeeded", severity: "excluding" }] });
const remote = engine.calculateConstraintScore(engine.mapUserProfileToCriteria(remoteProfile), g1203);
assert("unknown_remote_is_neutral_with_lower_confidence", remote.score100 === 100 && remote.dailyRealityEvidenceConfidence < 70 && remote.unknownCount >= 1, remote);
assert("notable_context_cannot_hard_exclude", engine.applyHardExclusions(nightCriteria, g1203).confirmed.length === 0, engine.applyHardExclusions(nightCriteria, g1203));

const profiles = [
  ["animation", { interests: ["transmettre", "enfants"] }], ["numerique", { interests: ["analyser", "technique"], preferredWorkStyles: ["analytical"] }],
  ["administratif", { interests: ["organiser"], preferredEnvironments: ["office"] }], ["sante", { interests: ["aider"], values: ["service"] }],
  ["manuel", { interests: ["fabriquer", "reparer"], preferredWorkStyles: ["manual"] }], ["nature", { interests: ["nature"], preferredEnvironments: ["outdoor"] }],
  ["commerce", { interests: ["communiquer"], preferredEnvironments: ["public"] }], ["minimal", { interests: [], values: [], preferredWorkStyles: [], preferredEnvironments: [] }]
];
const distributions = {};
for (const [id, values] of profiles) {
  const profile = baseProfile(values), first = run(profile), second = run(profile);
  const valid = first.completeList.every(item => Number.isFinite(item.personalFitScoreRaw) && item.personalFitScoreRaw >= 0 && item.personalFitScoreRaw <= 100 && item.personalFitScore >= 0 && item.personalFitScore <= 100);
  const stable = first.completeList.map(item => `${item.romeCode}:${item.personalFitScoreRaw}`).join("|") === second.completeList.map(item => `${item.romeCode}:${item.personalFitScoreRaw}`).join("|");
  const top100 = first.completeList.slice(0, 100); const groups = Object.values(Object.groupBy(top100, item => item.personalFitScoreRaw)).map(rows => rows.length);
  distributions[id] = { valid, stable, largestExactTie: Math.max(...groups), tieSignal: Math.max(...groups) >= 80 ? (id === "minimal" ? "expected_empty_profile" : "abnormally_large") : "normal", top5: first.top5.map(item => item.romeCode) };
  assert(`profile_${id}_finite_bounded_stable`, valid && stable, distributions[id]);
  assert(`profile_${id}_ties_reviewed`, Math.max(...groups) < 80 || id === "minimal", distributions[id]);
}

const parityProfile = baseProfile({ skillSelections: [{ skillId: targetSkillId, currentLevel: "practiced", futureWish: "develop" }] });
const online = run(parityProfile, engine), offline = run(parityProfile, offlineEngine);
assert("online_offline_same_raw_scores_ranks_exclusions", JSON.stringify(online.completeList.map(item => [item.romeCode, item.personalFitScoreRaw, item.status])) === JSON.stringify(offline.completeList.map(item => [item.romeCode, item.personalFitScoreRaw, item.status])), null);
assert("result_contract_v2", online.completeList.every(item => item.scoringVersion === "personal-fit-v2" && Number.isFinite(item.personalFitScoreRaw) && item.configuredWeights && item.appliedWeights && Array.isArray(item.notEvaluatedComponents) && Number.isFinite(item.feasibilityScore) && Number.isFinite(item.dailyRealityEvidenceConfidence)), null);
assert("source_contracts_present", html.includes("storageSchemaVersion = \"2.0.0\"") && html.includes("updateProfile(mutator") && html.includes("Ajouter à Ma boussole") && html.includes("pagehide") && html.includes("visibilitychange"), null);
assert("version_v1_6_0", html.includes("Boussole Pro v1.6.0") && manifest.datasetVersion.includes("v1.6.0"), manifest.datasetVersion);

const report = { schemaVersion: "1.0.0", reportKind: "boussole_v1_6_scoring_persistence_validation", generatedAt: new Date().toISOString(), status: failures.length ? "failed" : "passed", assertions: assertions.length, failures, referenceSkill: { job: code, skillId: targetSkillId }, distributions };
await mkdir(path.dirname(REPORT), { recursive: true }); await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, assertions: report.assertions, failures: failures.map(item => item.id), report: path.relative(ROOT, REPORT) }, null, 2));
if (failures.length) throw new Error(`Validation v1.6.0 échouée : ${failures.map(item => item.id).join(", ")}`);
