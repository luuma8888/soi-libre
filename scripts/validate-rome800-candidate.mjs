import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ROME_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome800-candidate");
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");
const REQUIRED_CODES = ["K1202", "K1206", "K1208", "K1210", "K1215", "K2113", "A1503"];

async function main() {
  const [baseSelection, selection, additions, audit, jobs, skillsEngine, access, constraints, marketNational, marketRegional, marketDepartmental, enrichment, runtime, marketIdentity] = await Promise.all([
    readLocal("rome-codes-500.json"), readLocal("rome-codes-800.json"), readLocal("rome-codes-800-additions.json"), readLocal("rome-codes-800-audit.json"),
    readRome("jobs.rome.json"), readRome("skills-engine.rome.json"), readRome("access-summary.rome800.json"), readRome("official-constraint-summary.rome800.json"),
    readMarket("market-national.rome.json"), readMarket("market-occitanie.rome.json"), readMarket("market-aude.rome.json"), readMarket("market-fap-enrichment.rome800.json"),
    readRome("runtime-bundle-manifest.json"), readMarket("market-package-identity.json")
  ]);
  const baseCodes = new Set(baseSelection.codes.map(row => row.romeCode));
  const selectedCodes = new Set(selection.codes.map(row => row.romeCode));
  const jobCodes = new Set(jobs.map(row => row.romeCode));
  const skillIds = new Set(skillsEngine.map(row => row.id));
  const g1203 = enrichment.find(row => row.romeCode === "G1203");
  const g1203Aude = g1203?.territories?.["DEP-11"]?.[0];
  const unresolvedJobSkills = jobs.flatMap(job => [...new Set([...(job.mobilizedSkillIds || []), ...(job.matchableSkillIds || []), ...(job.softSkillIds || [])])]
    .filter(id => !skillIds.has(id)).map(id => ({ romeCode: job.romeCode, skillId: id })));
  const assertions = [
    check("selection_exactly_800", selection.codes.length === 800 && selectedCodes.size === 800, selection.codes.length),
    check("base_500_preserved", baseCodes.size === 500 && [...baseCodes].every(code => selectedCodes.has(code)), baseCodes.size),
    check("additions_exactly_300", additions.codes.length === 300 && new Set(additions.codes.map(row => row.romeCode)).size === 300, additions.codes.length),
    check("jobs_exactly_800", jobs.length === 800 && jobCodes.size === 800, jobs.length),
    check("selection_matches_jobs", [...selectedCodes].every(code => jobCodes.has(code)), jobCodes.size),
    check("priority_codes_present", REQUIRED_CODES.every(code => jobCodes.has(code)), REQUIRED_CODES.filter(code => !jobCodes.has(code))),
    check("skills_references_resolved", unresolvedJobSkills.length === 0, unresolvedJobSkills.slice(0, 20)),
    check("access_summary_complete", access.length === 800, access.length),
    check("constraints_summary_complete", constraints.length === 800, constraints.length),
    check("market_existing_coverage_preserved", marketNational.length >= 437 && marketRegional.length >= 429 && marketDepartmental.length >= 382, { national: marketNational.length, regional: marketRegional.length, departmental: marketDepartmental.length }),
    check("fap_enrichment_exactly_800", enrichment.length === 800 && new Set(enrichment.map(row => row.romeCode)).size === 800, enrichment.length),
    check("g1203_market_truth", g1203?.fapMappings?.some(row => row.fapCode === "V5X81") && g1203Aude?.bmo?.recruitmentProjects?.value === 157 && g1203Aude?.bmo?.recruitmentDifficulty?.value === null && g1203Aude?.bmo?.seasonality?.value === null && g1203Aude?.dares?.tension?.level === "very_low", g1203Aude),
    check("selection_audit_coherent", audit.finalCodesCount === 800 && audit.additionsCount === 300, { finalCodesCount: audit.finalCodesCount, additionsCount: audit.additionsCount }),
    check("runtime_identity_coherent", runtime.status === "coherent" && runtime.counts?.jobs === 800, runtime.coherence),
    check("market_identity_recomputed", Boolean(marketIdentity.packageFingerprintSha256) && marketIdentity.counts?.derivedRomeRows === 800, marketIdentity.counts)
  ];
  const failed = assertions.filter(item => !item.pass);
  const report = {
    schemaVersion: "1.0.0", reportKind: "rome800_candidate_validation", generatedAt: new Date().toISOString(),
    status: failed.length ? "failed" : "passed", assertions, failuresCount: failed.length,
    privacy: "Aucun profil utilisateur, texte libre, secret ou jeton n'est inclus."
  };
  await writeFile(path.join(ROME_DIR, "rome800-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures: failed.map(item => item.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

function check(id, pass, observed) { return { id, pass: Boolean(pass), observed }; }
async function readLocal(name) { return readJson(path.join(LOCAL_DIR, name)); }
async function readRome(name) { return readJson(path.join(ROME_DIR, name)); }
async function readMarket(name) { return readJson(path.join(MARKET_DIR, name)); }
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
main().catch(error => { console.error(error); process.exit(1); });
