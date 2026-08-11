import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const REPORT_PATH = path.resolve(ROOT, process.env.MARKET_PHASE3_VALIDATION_REPORT || path.join(MARKET_DIR, "market-phase3-validation-report.json"));
const REQUIRED_POINT_FIELDS = ["indicatorId", "sourceName", "sourceVintage", "period", "territoryId", "territoryLabel", "classificationVersion", "statisticalFamilyId", "romeCode", "value", "unit", "status", "isSuppressed", "isImputed", "mappingMethod", "mappingConfidence", "comparisonStatus", "breakReason"];

export async function main() {
  const [contract, temporalContract, series, snapshots, runtime, identity, quality, trendsQuality, sourceMetadata] = await Promise.all([
    readMarket("market-contract.json"), readMarket("market-temporal-contract.json"), readMarket("market-temporal-series.json"),
    readMarket("market-offer-snapshot-registry.json"), readMarket("market-trends.rome1000.json"), readMarket("market-package-identity.json"),
    readMarket("market-quality-report.json"), readMarket("market-trends-quality-report.json"), readMarket("market-trends-source-metadata.json")
  ]);
  const failures = [];
  const bmoPoints = series.points.filter(point => point.indicatorId.startsWith("bmo_"));
  const daresPoints = series.points.filter(point => point.indicatorId === "dares_tension_index");
  const bmoVintages = unique(bmoPoints.map(point => point.period));
  const daresVintages = unique(daresPoints.map(point => point.period));
  const malformedPoints = series.points.filter(point => REQUIRED_POINT_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(point, field)));
  const secretPattern = /client[_-]?secret|bearer\s+[a-z0-9._-]+|ft_client_secret/i;
  const publicPayload = JSON.stringify({ temporalContract, series, snapshots, runtime, identity, quality, trendsQuality, sourceMetadata });

  if (contract.marketContractRevision !== "market-contract-v4.0.0-phase3") failures.push("contract:market_revision");
  if (temporalContract.temporalContractRevision !== "market-temporal-contract-v1.0.0") failures.push("contract:temporal_revision");
  if (JSON.stringify(bmoVintages) !== JSON.stringify(["2024", "2025", "2026"])) failures.push(`bmo:vintages_${bmoVintages.join("_")}`);
  if (JSON.stringify(daresVintages) !== JSON.stringify(["2023", "2024"])) failures.push(`dares:vintages_${daresVintages.join("_")}`);
  if (malformedPoints.length) failures.push(`temporal:malformed_points_${malformedPoints.length}`);
  if (bmoPoints.some(point => point.isSuppressed && point.value !== null)) failures.push("bmo:suppressed_not_null");
  if (daresPoints.some(point => point.isImputed && point.value !== null)) failures.push("dares:imputed_used_as_direct_value");
  if (runtime.jobs.length !== 1000 || runtime.counts?.jobs !== 1000) failures.push(`runtime:jobs_${runtime.jobs.length}`);
  if (runtime.jobs.some(row => row.rankingWeight !== 0)) failures.push("runtime:nonzero_ranking_weight");
  if (!runtime.jobs.find(row => row.romeCode === "G1203")?.familyMappings?.length) failures.push("runtime:G1203_history_missing");
  if (snapshots.comparisonStatus !== "insufficient_history" || snapshots.snapshots.length !== 1) failures.push("offers:history_must_remain_insufficient");
  if (snapshots.snapshots.some(snapshot => snapshot.synthetic !== false)) failures.push("offers:synthetic_snapshot");
  if (quality.coverage?.jobsWithBmo !== 491 || quality.coverage?.jobsWithDaresTension !== 482) failures.push("quality:final_coverage_counts");
  if (identity.temporalContractRevision !== temporalContract.temporalContractRevision) failures.push("identity:temporal_revision");
  if (identity.counts?.marketTrendRuntimeRows !== 1000) failures.push("identity:runtime_trend_count");
  if (!identity.components?.some(item => item.fileName === "market-trends.rome1000.json" && item.count === 1000)) failures.push("identity:runtime_component");
  if (await fingerprint(identity.components) !== identity.packageFingerprintSha256) failures.push("identity:fingerprint");
  if (secretPattern.test(publicPayload)) failures.push("security:secret_like_material");
  if (trendsQuality.assertions?.suppressedValuesRemainNull !== true || trendsQuality.assertions?.imputedDaresExcludedFromTrend !== true) failures.push("quality:missing_value_assertions");

  const report = {
    schemaVersion: "1.0.0", generatedAt: new Date().toISOString(), status: failures.length ? "failed" : "passed",
    counts: { temporalPoints: series.points.length, bmoPoints: bmoPoints.length, daresPoints: daresPoints.length, runtimeJobs: runtime.jobs.length, offerSnapshots: snapshots.snapshots.length },
    vintages: { bmo: bmoVintages, dares: daresVintages },
    coverage: trendsQuality.coverage, packageFingerprintSha256: identity.packageFingerprintSha256,
    failures
  };
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (failures.length) throw new Error(`[Boussole Pro] Validation marché phase 3 échouée : ${failures.join(", ")}`);
  console.log(JSON.stringify(report, null, 2));
}

async function fingerprint(components = []) {
  const rows = [];
  for (const component of components) {
    const buffer = await readFile(path.join(MARKET_DIR, component.fileName));
    const parsed = JSON.parse(buffer);
    const count = Array.isArray(parsed) ? parsed.length : Array.isArray(parsed.points) ? parsed.points.length : Array.isArray(parsed.jobs) ? parsed.jobs.length : 1;
    if (sha256(buffer) !== component.sha256 || count !== component.count) return "component_mismatch";
    rows.push(`${component.fileName}:${component.sha256}:${component.count}`);
  }
  return sha256(rows.sort().join("\n"));
}

function unique(values) { return [...new Set(values)].sort(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function readMarket(fileName) { return JSON.parse(await readFile(path.join(MARKET_DIR, fileName), "utf8")); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
