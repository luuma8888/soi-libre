import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adaptCompactRuntime, sha256 } from "./boussole-runtime-compact.mjs";
import { calculateRiasecAlignment, normalizeRiasecRanking, validateRiasecReference } from "./boussole-riasec.mjs";
import { loadBoussoleEngine } from "./validate-boussole-v073.mjs";

const root = process.cwd();
const appDir = path.join(root, "creations/boussolepro");
const runtimeDir = path.join(appDir, "boussole-runtime");
const reportPath = path.join(root, "tmp/monde-pro/boussole-v1.6.1/riasec-validation-report.json");
const readJson = async file => JSON.parse(await readFile(file, "utf8"));
const [html, manifest, core, competences, marche, riasec] = await Promise.all([
  readFile(path.join(appDir, "boussole-pro.html"), "utf8"),
  readJson(path.join(runtimeDir, "boussole-runtime-manifest.json")),
  readJson(path.join(runtimeDir, "boussole-core.json")),
  readJson(path.join(runtimeDir, "boussole-competences.json")),
  readJson(path.join(runtimeDir, "boussole-marche.json")),
  readJson(path.join(runtimeDir, "rome-riasec-boussole-pro-v1.1.json"))
]);
const failures = [];
let assertions = 0;
const assert = (id, condition) => { assertions += 1; if (!condition) failures.push(id); };
const coverage = validateRiasecReference(riasec, core.jobs.map(job => job.romeCode));
assert("reference_valid", coverage.failures.length === 0);
assert("coverage_exact", coverage.commonCodes === 1000 && !coverage.orphanCodes.length && !coverage.unclassifiedCodes.length);
const isCurrentEditorialRevision = riasec.editorialRevision === "1.1.0";
for (const [code, expected] of [["G1203", "SAE"], ["G1209", "SRE"], ["M1805", "ICR"]]) {
  assert(`editorial_${code}`, Boolean(riasec.occupations[code]) && (!isCurrentEditorialRevision || riasec.occupations[code].top3.join("") === expected));
}
assert("core_unchanged_by_secondary_package", sha256(await readFile(path.join(runtimeDir, "boussole-core.json"))) === manifest.files.core.sha256);
assert("user_valid", JSON.stringify(normalizeRiasecRanking(["s", "a", "i"])) === JSON.stringify(["S", "A", "I"]));
assert("user_invalid", ["S-S-I", "S-A", "S-A-X"].every(value => !normalizeRiasecRanking(value.split("-"))));
const ranking = ["S", "A", "E", "I", "R", "C"];
assert("exact_match_100", calculateRiasecAlignment(["S", "A", "E"], ranking) === 100);
assert("order_matters", calculateRiasecAlignment(["A", "S", "E"], ranking) < 100 && calculateRiasecAlignment(["A", "S", "E"], ranking) > 0);
assert("partial_match", calculateRiasecAlignment(["S", "A", "I"], ranking) < 100 && calculateRiasecAlignment(["S", "A", "I"], ranking) > 80);
assert("fourth_fifth_sixth", Math.abs(calculateRiasecAlignment(["I", "R", "C"], ranking) - Number((100 * (0.5 * 0.35 + 0.3 * 0.15) / 0.86).toFixed(6))) < 0.000001);
assert("missing_not_evaluated", calculateRiasecAlignment(["S", "A", "I"], []) === "not_evaluated");

const engine = loadBoussoleEngine(html);
const dataset = adaptCompactRuntime({ core, competences, marche }, manifest);
dataset.riasecOccupations = riasec.occupations;
engine.App.state.dataset = dataset;
const shell = JSON.parse(html.match(/\/\* REFONTE_DATA_START \*\/([\s\S]*?)\/\* REFONTE_DATA_END \*\//)[1]);
const profile = engine.normalizeProfile(shell.defaultProfile);
const withScores = engine.normalizeProfile({ ...profile, assessments: { futureTest: { answer: 42 }, riasec: { schemaVersion: "1.0.0", ranking: ["S", "A", "I"], rawScores: { scale: "external", S: 88 } } } });
const withoutScores = engine.normalizeProfile({ ...withScores, assessments: { ...withScores.assessments, riasec: { ...withScores.assessments.riasec, rawScores: { scale: "other", S: 2 } } } });
assert("future_assessment_preserved", withScores.assessments?.futureTest?.answer === 42);
const base = engine.calculateAllMatches(profile, dataset, { skipAudit: true });
const scored = engine.calculateAllMatches(withScores, dataset, { skipAudit: true });
const changedRaw = engine.calculateAllMatches(withoutScores, dataset, { skipAudit: true });
const rows = result => new Map(result.completeList.map(item => [item.romeCode, item]));
const baseRows = rows(base), scoredRows = rows(scored), rawRows = rows(changedRaw);
assert("all_1000_results", baseRows.size === 1000 && scoredRows.size === 1000);
assert("raw_scores_ignored", [...scoredRows].every(([code, row]) => row.personalFitScoreRaw === rawRows.get(code)?.personalFitScoreRaw));
assert("constraints_unchanged", [...scoredRows].every(([code, row]) => row.feasibilityScore === baseRows.get(code)?.feasibilityScore && JSON.stringify(row.exclusionReasons || []) === JSON.stringify(baseRows.get(code)?.exclusionReasons || [])));
assert("weight_split", [...scoredRows.values()].every(row => row.riasec?.status !== "evaluated" || (row.personalFitConfiguredWeights?.directionsAndActivities ?? row.configuredWeights?.directionsAndActivities) === 0.15));
assert("riasec_effective_weight_capped", [...scoredRows.values()].every(row => row.riasec?.status !== "evaluated" || row.appliedWeights?.riasecAlignment === 0.05));
assert("alignment_present", scoredRows.get("G1203")?.riasec?.status === "evaluated" && Number.isFinite(scoredRows.get("G1203")?.riasec?.scoreRaw));
const sparse = engine.calculatePersonalFitMetrics({ assessments: { riasec: { ranking: ["S", "A", "I"] } } }, dataset.jobs.find(job => job.romeCode === "G1203"), {});
assert("sparse_profile_riasec_capped", sparse.appliedWeights.riasecAlignment === 0.05 && sparse.rawScore >= 47.5 && sparse.rawScore <= 52.5);
const noReference = { ...dataset, riasecOccupations: {} };
engine.App.state.dataset = noReference;
const undocumented = engine.calculateAllMatches(withScores, noReference, { skipAudit: true });
assert("missing_occupation_neutral", [...rows(undocumented)].every(([code, row]) => row.personalFitScoreRaw === baseRows.get(code)?.personalFitScoreRaw));

const report = { schemaVersion: "1.0.0", status: failures.length ? "failed" : "passed", generatedAt: new Date().toISOString(), assertions, failures, coverage, editorialRevision: riasec.editorialRevision || null, riasecSha256: manifest.files.riasec.sha256, examples: ["G1203", "G1209", "M1805"].map(code => ({ code, before: baseRows.get(code)?.personalFitScoreRaw, after: scoredRows.get(code)?.personalFitScoreRaw, alignment: scoredRows.get(code)?.riasec?.scoreRaw })) };
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) throw new Error(`Validation RIASEC échouée : ${failures.join(", ")}`);
