import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const SOURCE_PATH = path.join(ROOT, "creations", "boussolepro", "data", "sources", "market", "fap-rome", "Dares_FAP2021_Table_passage_ROME.xlsx");
const REPORT_PATH = process.env.MARKET_PHASE2_REPORT || path.join(ROOT, "tmp", "monde-pro", "boussole-market-phase2-validation-report.json");
const TARGETS = ["G1203", "G1235", "G1238", "G1202", "G1237", "G1240", "K2106", "K1207", "K1303"];
const EXPECTED_FAP = { G1203: "V5X81", G1202: "V5X81", K2106: "W0X80", K1207: "V4X83", K1303: "T2B60" };
const EXPECTED_MISSING = ["G1235", "G1238", "G1237", "G1240"];

const [html, source, mappings, enrichment, identity, mappingStatus, parsing, cardinality, national, regional, departmental] = await Promise.all([
  readFile(HTML_PATH, "utf8"), readFile(SOURCE_PATH),
  readJson("fap-rome-mappings.json"), readJson("market-fap-enrichment.rome500.json"),
  readJson("market-package-identity.json"), readJson("fap-rome-mapping-status.json"),
  readJson("fap-rome-parsing-report.json"), readJson("fap-rome-cardinality-report.json"),
  readJson("market-national.rome.json"), readJson("market-occitanie.rome.json"), readJson("market-aude.rome.json")
]);
const sourceInfo = await stat(SOURCE_PATH);
const byRome = new Map(enrichment.map(row => [row.romeCode, row]));
const failures = [];
const check = (id, passed, details = null) => {
  if (!passed) failures.push(id);
  return { id, passed, details };
};

const targetChecks = TARGETS.map(romeCode => {
  const row = byRome.get(romeCode);
  const fapCodes = [...new Set((row?.fapMappings || []).map(item => item.fapCode))];
  const expected = EXPECTED_FAP[romeCode];
  const shouldBeMissing = EXPECTED_MISSING.includes(romeCode);
  return check(`target_${romeCode}`, Boolean(row) && (shouldBeMissing ? fapCodes.length === 0 : fapCodes.includes(expected)), { fapCodes, cardinalityStatus: row?.cardinalityStatus });
});

const checks = [
  check("app_version", html.includes('appVersion: "v0.8.0-alpha"') && html.includes('buildId: "20260802-market-phase2-fap-rome-01"')),
  check("app_loads_compact_enrichment", html.includes('marketFapEnrichment: "market-fap-enrichment.rome500.json"')),
  check("source_sha256", sha256(source) === "2f3808fa1aa05981f79988befa528580e697fca45f19dff1a72d6afbb5866241", { size: sourceInfo.size }),
  check("source_rows", parsing.rowsRead === 1096 && parsing.validRows === 1096 && parsing.rejectedRows === 0),
  check("source_row_references", mappings.every(row => Number.isInteger(row.sourceRow) && row.sourceRow > 1)),
  check("qualification_preserved", mappings.some(row => row.qualificationCode && row.qualificationValues?.length)),
  check("active_corpus_500", enrichment.length === 500 && identity.coverage?.activeRomeJobs === 500),
  check("offer_cardinalities", national.length === 437 && regional.length === 429 && departmental.length === 382),
  check("official_mapping_coverage", identity.coverage?.jobsWithOfficialFapMapping === 213 && mappingStatus.counts?.mappedActiveRome === 213),
  check("bmo_dares_coverage", identity.coverage?.jobsWithBmo === 209 && identity.coverage?.jobsWithDaresTension === 206),
  check("qualification_dependency", identity.coverage?.jobsQualificationDependent === 115),
  check("no_bmo_dares_ranking", identity.coverage?.rankingEligibleJobsBmoDares === 0 && enrichment.every(row => row.rankingEligible === false)),
  check("multiple_fap_not_aggregated", enrichment.filter(row => new Set(row.fapMappings.map(item => item.fapCode)).size > 1).every(row => Object.values(row.territories).every(families => families.length > 1))),
  check("shared_family_computed", enrichment.some(row => row.sharedFamily === true)),
  check("cardinality_views", cardinality.byRome?.length === 500 && cardinality.byFap?.length > 300 && cardinality.byStatisticalFap?.length > 200),
  check("compact_runtime_size", (await stat(path.join(MARKET_DIR, "market-fap-enrichment.rome500.json"))).size < 1_600_000),
  ...targetChecks
];

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_market_phase2_validation",
  generatedAt: new Date().toISOString(),
  appVersion: "v0.8.0-alpha",
  buildId: "20260802-market-phase2-fap-rome-01",
  marketFingerprint: identity.packageFingerprintSha256,
  counts: identity.counts,
  coverage: identity.coverage,
  checks,
  failures,
  verdict: failures.length ? "failed" : "passed"
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ verdict: report.verdict, checks: checks.length, failures, coverage: report.coverage }, null, 2));
if (failures.length) process.exitCode = 1;

async function readJson(name) {
  return JSON.parse(await readFile(path.join(MARKET_DIR, name), "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
