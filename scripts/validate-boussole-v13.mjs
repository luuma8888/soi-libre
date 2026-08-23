import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adaptCompactRuntime } from "./boussole-runtime-compact.mjs";
import { loadBoussoleEngine } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const APP = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const RUNTIME = path.join(ROOT, "creations/boussolepro/boussole-runtime");
const REPORT = path.join(ROOT, "tmp/monde-pro/boussole-v1.3/functional-validation-report.json");
const [html, manifest, core, competences, marche] = await Promise.all([
  readFile(APP, "utf8"), readJson("boussole-runtime-manifest.json"), readJson("boussole-core.json"), readJson("boussole-competences.json"), readJson("boussole-marche.json")
]);
const engine = loadBoussoleEngine(html);
const dataset = adaptCompactRuntime({ core, competences, marche }, manifest);
engine.App.state.dataset = dataset;
const failures = [];
let assertions = 0;
const assert = (id, condition, details = null) => { assertions += 1; if (!condition) failures.push({ id, details }); };

assert("custom_empty_does_not_match", engine.hasRelatedCustomSkill(["", null], dataset.skillsEngine[0]?.id, dataset) === false);
assert("custom_unconfirmed_does_not_make_enough_evidence", engine.mapUserProfileToCriteria(engine.normalizeProfile({ customSkills: ["écoute", "animation", "bureautique"] })).hasEnoughSkillEvidence === false);
const insufficient = engine.buildSkillsReadiness({ hasEnoughSkillEvidence: false }, { score: 20 });
assert("empty_evidence_is_insufficient", insufficient.level === "insufficient_information" && insufficient.evidence.length === 0, insufficient);
const exact = engine.buildSkillsReadiness({ hasEnoughSkillEvidence: false }, { score: 8, exactExperience: { hasExactExperience: true, experience: { title: "Animateur / Animatrice jeunesse", durationYears: 10 } } });
assert("exact_experience_is_visible_evidence", exact.evidence.some(label => label.includes("10 an(s)") && label.includes("Animateur")), exact);

const k1303 = dataset.jobs.find(job => job.romeCode === "K1303");
const g1203 = dataset.jobs.find(job => job.romeCode === "G1203");
const exclusionProfile = engine.normalizeProfile({ excludedDomains: ["petite_enfance"], exclusions: { jobIds: [], domains: ["petite_enfance"], tags: [] } });
const exclusionCriteria = engine.mapUserProfileToCriteria(exclusionProfile);
assert("childcare_explicitly_excluded", engine.applyHardExclusions(exclusionCriteria, k1303).confirmed.some(item => item.code === "voluntary_domain_petite_enfance"));
assert("youth_animation_not_childcare", !engine.applyHardExclusions(exclusionCriteria, g1203).confirmed.some(item => item.code === "voluntary_domain_petite_enfance"));

const profile = engine.normalizeProfile({
  profileName: "Audit v1.3", diplomaLevel: 5, certifications: ["cert-bafa"], customSkills: ["cinq lignes", "sans bonus", "à relier", "non confirmées", "conservées"],
  jobExperiences: [{ id: "exp-g1203", jobId: g1203.id, romeCode: "G1203", title: g1203.title, durationYears: 10, recency: "recent", masteryLevel: "autonomous", enjoymentLevel: "love", wantsToContinue: "yes", source: "user_direct" }],
  interests: ["aider", "transmettre", "enfants"], values: ["meaning", "service", "team"], preferredWorkStyles: ["relational", "team"], preferredEnvironments: ["children", "public"], excludedDomains: ["petite_enfance"], exclusions: { jobIds: [], domains: ["petite_enfance"], tags: [] }, trainingOpenness: "medium"
});
engine.App.state.profile = profile;
const results = engine.calculateAllMatches(profile, dataset, { skipAudit: true });
const vm = engine.buildResultsViewModel(profile, results, dataset);
const familyIds = [
  ...vm.topDirections.map(item => item.representative.jobId), ...vm.recommendedPaths.map(item => item.jobId), ...vm.dreamPaths.map(item => item.jobId),
  ...vm.skillsSupportedPaths.map(item => item.jobId), ...vm.exploratoryPaths.map(item => item.jobId), ...vm.excludedPaths.map(item => item.jobId)
];
assert("canonical_bac_plus_2", profile.diplomaLevel === 5);
assert("bafa_recognized", engine.mapUserProfileToCriteria(profile).certifications.held.some(item => engine.normalizeCertificationKey(item) === "cert-bafa"));
assert("thematic_families_exclusive", new Set(familyIds).size === familyIds.length, { total: familyIds.length, unique: new Set(familyIds).size });
assert("all_jobs_preserved", vm.completeList.length === 1000);
assert("g1203_exact_support", vm.jobDetailsById[g1203.id]?.skillsReadinessEvidence.some(label => String(label).includes("10 an(s)")), vm.jobDetailsById[g1203.id]?.skillsReadinessEvidence);
assert("k1303_not_top_representative", !vm.topDirections.some(item => item.representative.romeCode === "K1303"));
const market = vm.completeList.find(item => Object.values(item.marketSummaryByTerritory || {}).some(row => row.offersCount !== null))?.marketSummaryByTerritory;
assert("market_view_model_preserves_fields", Object.values(market || {}).some(row => "tensionLevel" in row && "recruitmentDifficultyRate" in row && "statisticalScope" in row && "periods" in row));

const report = { schemaVersion: "1.0.0", reportKind: "boussole_v1_3_functional_validation", generatedAt: new Date().toISOString(), status: failures.length ? "failed" : "passed", assertions, failures, counts: { jobs: dataset.jobs.length, skills: dataset.skillsEngine.length, knowledge: dataset.knowledge.length }, cases: { g1203: g1203?.title, k1303: k1303?.title } };
await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) throw new Error(`Validation fonctionnelle v1.3 échouée : ${failures.map(item => item.id).join(", ")}`);

async function readJson(name) { return JSON.parse(await readFile(path.join(RUNTIME, name), "utf8")); }
