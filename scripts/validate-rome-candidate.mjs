import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const EXPECTED_COUNT = Number(process.env.ROME_VALIDATION_EXPECTED_COUNT || 1000);
const BASE_COUNT = Number(process.env.ROME_VALIDATION_BASE_COUNT || EXPECTED_COUNT - 200);
const TARGET_SUBDIR = process.env.ROME_VALIDATION_SUBDIR || `rome${EXPECTED_COUNT}-candidate`;
const ROME_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", TARGET_SUBDIR);
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");
const REQUIRED_CODES = ["K1202", "K1206", "K1208", "K1210", "K1215", "K2113", "A1503"];

export async function main() {
  const prefix = `rome-codes-${EXPECTED_COUNT}`;
  const [baseSelection, selection, additions, audit, jobs, skillsEngine, access, constraints, marketNational, marketRegional, marketDepartmental, enrichment, runtime, marketIdentity] = await Promise.all([
    readLocal(`rome-codes-${BASE_COUNT}.json`), readLocal(`${prefix}.json`), readLocal(`${prefix}-additions.json`), readLocal(`${prefix}-audit.json`),
    readRome("jobs.rome.json"), readRome("skills-engine.rome.json"), readRome(`access-summary.rome${EXPECTED_COUNT}.json`), readRome(`official-constraint-summary.rome${EXPECTED_COUNT}.json`),
    readMarket("market-national.rome.json"), readMarket("market-occitanie.rome.json"), readMarket("market-aude.rome.json"), readMarket(`market-fap-enrichment.rome${EXPECTED_COUNT}.json`),
    readRome("runtime-bundle-manifest.json"), readMarket("market-package-identity.json")
  ]);
  const baseCodes = new Set(baseSelection.codes.map(codeOf).filter(Boolean));
  const selectedCodes = new Set(selection.codes.map(codeOf).filter(Boolean));
  const additionCodes = new Set(additions.codes.map(codeOf).filter(Boolean));
  const jobCodes = new Set(jobs.map(codeOf).filter(Boolean));
  const skillIds = new Set(skillsEngine.map(row => row.id).filter(Boolean));
  const g1203 = enrichment.find(row => row.romeCode === "G1203");
  const g1203Aude = g1203?.territories?.["DEP-11"]?.[0];
  const unresolvedJobSkills = jobs.flatMap(job => [...new Set([...(job.mobilizedSkillIds || []), ...(job.matchableSkillIds || []), ...(job.softSkillIds || [])])]
    .filter(id => !skillIds.has(id)).map(id => ({ romeCode: job.romeCode, skillId: id })));
  const observedMarketCodes = new Set([...marketNational, ...marketRegional, ...marketDepartmental].map(codeOf).filter(Boolean));
  const assertions = [
    check("selection_exact_count", selection.codes.length === EXPECTED_COUNT && selectedCodes.size === EXPECTED_COUNT, selection.codes.length),
    check("base_preserved", baseCodes.size === BASE_COUNT && [...baseCodes].every(code => selectedCodes.has(code)), baseCodes.size),
    check("additions_exact_count", additionCodes.size === EXPECTED_COUNT - BASE_COUNT, additionCodes.size),
    check("jobs_exact_count", jobs.length === EXPECTED_COUNT && jobCodes.size === EXPECTED_COUNT, jobs.length),
    check("selection_matches_jobs", [...selectedCodes].every(code => jobCodes.has(code)), jobCodes.size),
    check("priority_codes_preserved", REQUIRED_CODES.every(code => jobCodes.has(code)), REQUIRED_CODES.filter(code => !jobCodes.has(code))),
    check("skills_references_resolved", unresolvedJobSkills.length === 0, unresolvedJobSkills.slice(0, 20)),
    check("access_summary_complete", access.length === EXPECTED_COUNT, access.length),
    check("constraints_summary_complete", constraints.length === EXPECTED_COUNT, constraints.length),
    check("market_rome800_coverage_preserved", marketNational.length >= 714 && marketRegional.length >= 705 && marketDepartmental.length >= 626 && [...baseCodes].filter(code => observedMarketCodes.has(code)).length >= 714, { national: marketNational.length, regional: marketRegional.length, departmental: marketDepartmental.length }),
    check("fap_enrichment_exact_count", enrichment.length === EXPECTED_COUNT && new Set(enrichment.map(codeOf)).size === EXPECTED_COUNT, enrichment.length),
    check("fap_bmo_semantics_distinct", Number.isFinite(marketIdentity.coverage?.bmoFapFamilies) && Number.isFinite(marketIdentity.coverage?.jobsWithBmo), marketIdentity.coverage),
    check("g1203_market_truth", g1203?.fapMappings?.some(row => row.fapCode === "V5X81") && g1203Aude?.bmo?.recruitmentProjects?.value === 157 && g1203Aude?.bmo?.recruitmentDifficulty?.value === null && g1203Aude?.bmo?.seasonality?.value === null && g1203Aude?.dares?.tension?.level === "very_low", g1203Aude),
    check("selection_audit_coherent", audit.finalCodesCount === EXPECTED_COUNT && audit.additionsCount === EXPECTED_COUNT - BASE_COUNT, { finalCodesCount: audit.finalCodesCount, additionsCount: audit.additionsCount }),
    check("runtime_identity_coherent", runtime.status === "coherent" && runtime.counts?.jobs === EXPECTED_COUNT && runtime.datasetIdentity?.validationScope === "validated_for_boussole_pro_v0_8", runtime.coherence),
    check("market_identity_recomputed", Boolean(marketIdentity.packageFingerprintSha256) && marketIdentity.counts?.derivedRomeRows === EXPECTED_COUNT, marketIdentity.counts)
  ];
  const failed = assertions.filter(item => !item.pass);
  const report = {
    schemaVersion: "1.0.0",
    reportKind: `rome${EXPECTED_COUNT}_candidate_validation`,
    generatedAt: new Date().toISOString(),
    status: failed.length ? "failed" : "passed",
    assertions,
    failuresCount: failed.length,
    privacy: "Aucun profil utilisateur, texte libre, secret ou jeton n'est inclus."
  };
  await writeFile(path.join(ROME_DIR, `rome${EXPECTED_COUNT}-validation-report.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures: failed.map(item => item.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

function codeOf(row) { return typeof row === "string" ? row : row?.romeCode || row?.code || ""; }
function check(id, pass, observed) { return { id, pass: Boolean(pass), observed }; }
async function readLocal(name) { return readJson(path.join(LOCAL_DIR, name)); }
async function readRome(name) { return readJson(path.join(ROME_DIR, name)); }
async function readMarket(name) { return readJson(path.join(MARKET_DIR, name)); }
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
