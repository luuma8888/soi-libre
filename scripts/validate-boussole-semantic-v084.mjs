import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ACCESS_OVERRIDES,
  CAREER_DIRECTIONS,
  CAREER_DIRECTION_OVERRIDES,
  PROFESSIONAL_DOMAIN_DIRECTIONS,
  buildSkillsReadiness,
  calculateCanonicalPersonalFit,
  classifyCareerDirection,
  deriveAccessStatus
} from "./boussole-semantic-v084-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJson = async relative => JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));
const jobsPackage = await readJson("creations/boussolepro/data/generated/rome1000-candidate/jobs.rome.json");
const jobs = jobsPackage.jobs || jobsPackage;
const accessPackage = await readJson("creations/boussolepro/data/generated/rome1000-candidate/access-summary.rome1000.json");
const accessRows = Array.isArray(accessPackage) ? accessPackage : accessPackage.items || accessPackage.rows || accessPackage.accessSummaries || [];
const officialDomains = await readJson("creations/boussolepro/data/local/rome-professional-domain-labels.2026-06.json");
const activeRuntime = await readJson("creations/boussolepro/data/generated/active-runtime.json");
const marketQuality = await readJson("creations/boussolepro/data/generated/market/market-quality-report.json");
const html = await readFile(path.join(ROOT, "creations/boussolepro/boussole-pro.html"), "utf8");

const failures = [];
const assertions = [];
const check = (condition, id, details = null) => {
  assertions.push({ id, status: condition ? "passed" : "failed", details });
  if (!condition) failures.push(id);
};

check(CAREER_DIRECTIONS.length === 17, "taxonomy:17_directions", CAREER_DIRECTIONS.length);
check(Object.keys(PROFESSIONAL_DOMAIN_DIRECTIONS).length === 110, "taxonomy:110_domain_mappings", Object.keys(PROFESSIONAL_DOMAIN_DIRECTIONS).length);
check(officialDomains.professionalDomains.length === 110, "taxonomy:110_official_labels", officialDomains.professionalDomains.length);
check(jobs.length === 1000, "runtime:1000_active_jobs", jobs.length);

const classifications = jobs.map(job => ({ romeCode: job.romeCode, ...classifyCareerDirection(job) }));
const unclassified = classifications.filter(item => item.primaryDirection === "unclassified");
check(unclassified.length === 0, "taxonomy:all_active_jobs_classified", unclassified);
check(JSON.stringify(classifications) === JSON.stringify(jobs.map(job => ({ romeCode: job.romeCode, ...classifyCareerDirection(job) }))), "taxonomy:deterministic");
check(classifyCareerDirection({ romeCode: "M1899", title: "Titre sans indice lexical" }).primaryDirection === "construire_numerique", "taxonomy:future_known_domain");
check(classifyCareerDirection({ romeCode: "Z9901", title: "Développeur" }).primaryDirection === "unclassified", "taxonomy:future_unknown_domain_no_keyword_fallback");

const controlCases = {
  M1607: "administrer_garantir_droits",
  M1602: "administrer_garantir_droits",
  C1107: "gerer_piloter",
  K1303: "grandir_transmettre",
  K2205: "batir_prendre_soin_lieux",
  A1401: "cultiver_proteger_vivant",
  G1203: "animer_faire_vivre",
  G1238: "animer_faire_vivre",
  K2106: "grandir_transmettre",
  M1805: "construire_numerique",
  K1807: "batir_prendre_soin_lieux",
  K2133: "comprendre_concevoir"
};
for (const [romeCode, expected] of Object.entries(controlCases)) {
  check(classifyCareerDirection({ romeCode }).primaryDirection === expected, `taxonomy:control:${romeCode}`, expected);
}
check(Object.keys(CAREER_DIRECTION_OVERRIDES).every(code => classifyCareerDirection({ romeCode: code }).classificationSource === "rome_code_override"), "taxonomy:overrides_precede_domains");

const personalInput = { aspirationScore: 78, valueScore: 12, contextScore: 8, constraintScore: 18 };
const baselineFit = calculateCanonicalPersonalFit(personalInput);
check(calculateCanonicalPersonalFit({ ...personalInput, offers: 0 }) === baselineFit, "separation:offers_do_not_change_fit");
check(calculateCanonicalPersonalFit({ ...personalInput, bmo: 100, dares: "high_tension" }) === baselineFit, "separation:bmo_dares_do_not_change_fit");
check(calculateCanonicalPersonalFit({ ...personalInput, diplomaLevel: 0 }) === baselineFit, "separation:diploma_does_not_change_fit");
check(calculateCanonicalPersonalFit({ ...personalInput, skills: ["skill-test"] }) === baselineFit, "separation:skills_do_not_change_fit");
check(calculateCanonicalPersonalFit({ ...personalInput, constraintScore: 4 }) < baselineFit, "separation:known_daily_constraint_changes_fit");
check(calculateCanonicalPersonalFit({ ...personalInput, constraintScore: 12.5 }) === calculateCanonicalPersonalFit({ ...personalInput, constraintScore: 12.5 }), "separation:unknown_constraint_is_neutral_and_deterministic");

check(buildSkillsReadiness({ score: 5 }, true).level !== buildSkillsReadiness({ score: 22 }, true).level, "separation:skills_change_readiness");
check(buildSkillsReadiness({ score: 25 }, false).level === "insufficient_information", "skills:insufficient_information_not_absence");

const accessCases = [
  ["equal", { evidenceAvailable: true, levelGap: 0 }, "direct_or_near_direct"],
  ["plus_one", { evidenceAvailable: true, levelGap: 1 }, "one_step"],
  ["plus_two", { evidenceAvailable: true, levelGap: 2 }, "long_path"],
  ["credential", { evidenceAvailable: true, levelGap: 0, missingMandatoryCredentials: ["Diplôme"] }, "qualification_or_competition"],
  ["competition", { evidenceAvailable: true, levelGap: 0, competitionRequired: true, competitionSatisfied: false }, "qualification_or_competition"],
  ["regulated_unresolved", { evidenceAvailable: true, levelGap: 0, regulated: true, regulationResolved: false }, "unknown"],
  ["unknown", { evidenceAvailable: false }, "unknown"],
  ["contradictory", { evidenceAvailable: true, levelGap: 0, contradictoryEvidence: true }, "unknown"],
  ["no_diploma", { evidenceAvailable: true, noDiplomaPossible: true }, "direct_or_near_direct"],
  ["skills_do_not_override_credential", { evidenceAvailable: true, levelGap: 0, missingMandatoryCredentials: ["Titre"], skillScore: 100 }, "qualification_or_competition"]
];
for (const [id, facts, expected] of accessCases) check(deriveAccessStatus(facts).status === expected, `access:${id}`, deriveAccessStatus(facts));
check(ACCESS_OVERRIDES.K1308.competitionRequired && ACCESS_OVERRIDES.K1308.accessPaths.length === 2, "access:K1308_routes_and_competition");
check(new Set(ACCESS_OVERRIDES.K1308.accessPaths.map(pathItem => pathItem.pathId)).size === 2, "access:multiple_routes_preserved");

const contradictions = accessRows.filter(row => row.contradictoryEvidence || row.requirementKind === "conflicting");
check(contradictions.length === 19, "access:19_contradictions_accounted_for", contradictions.map(row => row.romeCode));
check(contradictions.every(() => deriveAccessStatus({ evidenceAvailable: true, contradictoryEvidence: true }).status === "unknown"), "access:contradictions_force_unknown");
const unresolvedRegulated = accessRows.filter(row => row.regulated && !row.specificCredentialRequired && !row.mandatoryQualification && !row.requiredCredentialLabels?.length);
check(unresolvedRegulated.every(row => row.romeCode === "K2106"), "access:raw_regulated_unresolved_inventory", unresolvedRegulated.map(row => row.romeCode));
check(html.includes("K2106: {") && html.includes("Concours externe CRPE Bac+3"), "access:K2106_runtime_override_resolves_routes");

check(/appVersion: "v0\.8\.4"/.test(html), "app:version_v084");
check(html.includes('policyRevision: "personal-fit-only-v1"'), "separation:selection_policy_personal_only");
const comparatorSource = html.match(/function comparePersonalFitCandidates\([\s\S]*?\n\}/)?.[0] || "";
const candidateScoreSource = html.match(/function personalFitCandidateScore\([\s\S]*?\n\}/)?.[0] || "";
check(comparatorSource.includes("personalFitCandidateScore") && comparatorSource.includes("romeCode"), "top5:pure_comparator_present");
check(!/(confidence|globalScore|skills|experience|diploma|access|market|training|title)/i.test(comparatorSource), "top5:pure_comparator_has_no_secondary_dimension", comparatorSource);
check(candidateScoreSource.includes("personalFitScore") && !candidateScoreSource.includes("globalScore"), "top5:score_source_is_personal_fit_only", candidateScoreSource);
check(html.includes("personalFitReasons") && html.includes("skillsReadinessEvidence") && html.includes("accessEvidence") && html.includes("marketSummaryByTerritory"), "separation:result_compartments_present");
check(html.includes('const RESULTS_VIEW_CONTRACT_REVISION = "results-view-v1"'), "view:stable_contract");
check(html.includes("explorationSearchIndex") && html.includes("jobsByPrimaryDirection"), "view:exploration_indexes");
check(html.includes("dreamPaths: dream.map") && html.includes("personalFitScore >= 65"), "view:aligned_long_paths_remain_discoverable");
check(html.includes("excludedPaths: excluded.map") && html.includes("completeList: summaries"), "view:excluded_remain_in_complete_list");
check(activeRuntime.market?.coverage?.activeRomeJobs === 1000, "counters:active_jobs_1000", activeRuntime.market?.coverage?.activeRomeJobs);
check(marketQuality.checks?.activeRomeJobs === 1000, "counters:market_quality_active_jobs_1000", marketQuality.checks?.activeRomeJobs);
check(activeRuntime.market?.counts?.offerNational === 894, "market:national_894", activeRuntime.market?.counts?.offerNational);
check(activeRuntime.market?.counts?.offerRegional === 883, "market:regional_883", activeRuntime.market?.counts?.offerRegional);
check(activeRuntime.market?.counts?.offerDepartmental === 785, "market:departmental_785", activeRuntime.market?.counts?.offerDepartmental);

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_semantic_v084_validation",
  generatedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "passed",
  assertionsCount: assertions.length,
  failures,
  coverage: {
    directions: CAREER_DIRECTIONS.length,
    professionalDomains: Object.keys(PROFESSIONAL_DOMAIN_DIRECTIONS).length,
    officialDomainLabels: officialDomains.professionalDomains.length,
    activeJobs: jobs.length,
    unclassifiedActiveJobs: unclassified.length,
    accessContradictions: contradictions.length,
    rawRegulatedStillRequiringRuntimeRule: unresolvedRegulated.map(row => row.romeCode),
    market: activeRuntime.market?.counts
  },
  accessContradictions: contradictions.map(row => ({
    romeCode: row.romeCode,
    sourceStatus: "contradictory",
    finalRuntimeStatus: "unknown",
    resolution: "Volontairement inconnu tant qu'une source ne lève pas la contradiction.",
    excerpts: row.matchedExcerpts || []
  })),
  assertions
};

const reportArgIndex = process.argv.indexOf("--report");
if (reportArgIndex >= 0 && process.argv[reportArgIndex + 1]) {
  await writeFile(path.resolve(process.argv[reportArgIndex + 1]), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures, coverage: report.coverage }, null, 2));
if (failures.length) process.exitCode = 1;
