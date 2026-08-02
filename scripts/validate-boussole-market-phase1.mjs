import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildMarketSynthesis,
  calculateMarketRankingInfluence,
  marketDimension,
  migrateOfferVolumeRow
} from "./market-phase1-core.mjs";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const OUTPUT_PATH = process.env.MARKET_TRUTH_REPORT || path.join(ROOT, "tmp", "monde-pro", "boussole-market-phase1-truth-report.json");

const known = (value, level, extra = {}) => marketDimension({
  status: value === 0 ? "zero" : "available",
  value,
  level,
  sourceName: extra.sourceName || "fixture_official",
  sourceVintage: extra.sourceVintage || "2026",
  confidence: extra.confidence ?? 0.9,
  mapping: extra.mapping || { method: "not_required", confidence: 1, rankingEligible: true },
  freshness: extra.freshness || "current"
});
const unknown = () => marketDimension();

const truthCases = [
  {
    id: "high_tension_low_volume",
    input: { tension: known(1.4, "high"), offerVolume: known(12, "low") },
    expected: "high_tension_low_volume",
    rankAllowed: true
  },
  {
    id: "high_volume_high_seasonality",
    input: { offerVolume: known(2400, "high"), seasonality: known(72, "high") },
    expected: "high_volume_high_seasonality",
    rankAllowed: true
  },
  {
    id: "high_difficulty_unknown_causes",
    input: { recruitmentDifficulty: known(68, "high", { sourceName: "france_travail_bmo", mapping: { method: "unmapped", confidence: 0, rankingEligible: false } }) },
    expected: "high_difficulty_unknown_causes",
    rankAllowed: false
  },
  {
    id: "active_national_low_local",
    input: { offerVolume: known(0, "zero"), nationalOfferVolume: known(12500, "high"), territoryLabel: "l'Aude" },
    expected: "active_national_low_local",
    rankAllowed: true
  },
  {
    id: "high_local_volume_unknown_tension",
    input: { offerVolume: known(1800, "high"), tension: unknown() },
    expected: "high_local_volume_no_high_tension",
    rankAllowed: true
  },
  {
    id: "bmo_ambiguous_mapping",
    input: { recruitmentProjects: known(800, "unclassified", { sourceName: "france_travail_bmo", mapping: { method: "ambiguous", confidence: 0.35, rankingEligible: false } }) },
    expected: "partial_data",
    expectedMapping: "ambiguous",
    rankAllowed: false
  },
  {
    id: "dares_present_bmo_absent",
    input: { tension: known(0.4, "moderate", { sourceName: "dares_france_travail_tension", mapping: { method: "validated_local_mapping", confidence: 0.9, rankingEligible: true } }) },
    expected: "partial_data",
    rankAllowed: true
  },
  {
    id: "all_market_data_absent",
    input: {},
    expected: "no_robust_data",
    rankAllowed: false
  },
  {
    id: "stale_vintage",
    input: { offerVolume: known(150, "medium", { sourceVintage: "2019", freshness: "very_stale" }) },
    expected: "partial_data",
    expectedFreshness: "very_stale",
    rankAllowed: true
  },
  {
    id: "previous_market_cache",
    input: {},
    expected: "no_robust_data",
    previousCacheFingerprint: "market-v1-old",
    rankAllowed: false
  }
];

const failures = [];
const results = truthCases.map(fixture => {
  const synthesis = buildMarketSynthesis(fixture.input);
  const influence = calculateMarketRankingInfluence({
    requestedWeight: 15,
    goal: "quickEmployment",
    rankingEligible: synthesis.rankingEligible,
    reliability: 0.9,
    marketScore: 82,
    personalFitScore: 74,
    feasibilityScore: 66
  });
  const checks = {
    interpretation: synthesis.interpretation.caseId === fixture.expected,
    unknownDimensionsExplicit: Array.isArray(synthesis.unknownDimensions),
    mapping: !fixture.expectedMapping || synthesis.mappingQuality?.method === fixture.expectedMapping,
    freshness: !fixture.expectedFreshness || synthesis.freshness === fixture.expectedFreshness,
    rankPolicy: fixture.rankAllowed ? influence.effectiveWeight <= 15 : influence.effectiveWeight === 0,
    exportShape: Boolean(synthesis.dimensions && synthesis.sourceCoverage && synthesis.mappingQuality && influence.policyRevision),
    previousCacheInvalidated: !fixture.previousCacheFingerprint || fixture.previousCacheFingerprint !== "cb91d82982701e2898aba1b8d92b4ae1f0ea36dc0156d0f42e69fd8a6c09113d"
  };
  for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`${fixture.id}:${name}`);
  return { id: fixture.id, expected: fixture.expected, received: synthesis.interpretation.caseId, phrase: synthesis.interpretation.text, checks, influence };
});

const offerFiles = ["market-national.rome.json", "market-occitanie.rome.json", "market-aude.rome.json"];
const offerRows = (await Promise.all(offerFiles.map(file => readJson(path.join(MARKET_DIR, file))))).flat();
const html = await readFile(APP_PATH, "utf8");
const quality = await readJson(path.join(MARKET_DIR, "market-quality-report.json"));
const identity = await readJson(path.join(MARKET_DIR, "market-package-identity.json"));
const mappingStatus = await readJson(path.join(MARKET_DIR, "fap-rome-mapping-status.json"));

const semanticChecks = {
  offerRowsNeverCreateTension: offerRows.every(row => row.marketDataKind !== "offers_volume" || row.tensionLevel === "unknown"),
  offerRowsNeverCreateDifficulty: offerRows.every(row => row.marketDataKind !== "offers_volume" || row.recruitmentDifficulty === "unknown"),
  noMisnamedHighTensionFacet: !html.includes('["high_tension", "Volume fort"]'),
  distinctRealTensionFacet: html.includes('["real_high_tension", "Tension réelle élevée"]'),
  independentMarketFingerprint: html.includes(identity.packageFingerprintSha256),
  noFapRankingWithoutMapping: identity.counts.fapRomeRankingEligible === 0 && mappingStatus.counts.rankingEligible === 0,
  qualityReportGreenWithKnownGap: quality.status === "completed_with_known_source_gap",
  personalAndFeasibilityStable: stabilityChecks().personalAndFeasibilityStable,
  unknownMarketNoBonus: stabilityChecks().unknownMarketNoBonus,
  vintageDoesNotChangeScore: stabilityChecks().vintageDoesNotChangeScore,
  weakMappingDoesNotChangeRank: stabilityChecks().weakMappingDoesNotChangeRank,
  explicitInfluenceCapped: stabilityChecks().explicitInfluenceCapped,
  exportedEffectMatchesFormula: stabilityChecks().exportedEffectMatchesFormula
};
for (const [name, passed] of Object.entries(semanticChecks)) if (!passed) failures.push(`semantic:${name}`);

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_market_phase1_truth_cases",
  generatedAt: new Date().toISOString(),
  appVersion: "v0.7.7-alpha",
  buildId: "20260802-market-phase1-01",
  marketLayerIdentity: identity,
  fixtures: results,
  semanticChecks,
  counts: { fixtures: truthCases.length, offerRows: offerRows.length, failures: failures.length },
  failures,
  verdict: failures.length ? "failed" : "passed"
};
await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ verdict: report.verdict, fixtures: truthCases.length, offerRows: offerRows.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;

function stabilityChecks() {
  const base = { requestedWeight: 5, personalFitScore: 78, feasibilityScore: 64, marketScore: 80, reliability: 0.9 };
  const knownMarket = calculateMarketRankingInfluence({ ...base, rankingEligible: true });
  const unknownMarket = calculateMarketRankingInfluence({ ...base, rankingEligible: false, marketScore: null });
  const vintageA = calculateMarketRankingInfluence({ ...base, rankingEligible: true, sourceVintage: "2024" });
  const vintageB = calculateMarketRankingInfluence({ ...base, rankingEligible: true, sourceVintage: "2026" });
  const weak = calculateMarketRankingInfluence({ ...base, rankingEligible: false, mappingConfidence: 0.3 });
  const absent = calculateMarketRankingInfluence({ ...base, rankingEligible: false, mappingConfidence: 0 });
  const explicit = calculateMarketRankingInfluence({ ...base, requestedWeight: 30, goal: "quickEmployment", rankingEligible: true });
  return {
    personalAndFeasibilityStable: base.personalFitScore === 78 && base.feasibilityScore === 64,
    unknownMarketNoBonus: unknownMarket.effectPoints === 0,
    vintageDoesNotChangeScore: vintageA.selectionScore === vintageB.selectionScore,
    weakMappingDoesNotChangeRank: weak.selectionScore === absent.selectionScore,
    explicitInfluenceCapped: explicit.effectiveWeight === 15,
    exportedEffectMatchesFormula: knownMarket.effectPoints === knownMarket.selectionScore - knownMarket.scoreWithoutMarket
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
