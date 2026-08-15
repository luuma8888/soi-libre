import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateBmoRows, normalizeDaresTensionRow } from "./market-phase1-core.mjs";
import { readXlsxRows, XLSX_READER_INFO } from "./market-xlsx.mjs";

const ROOT = process.cwd();
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const JOBS_PATH = path.resolve(ROOT, process.env.MARKET_JOBS_PATH || "creations/boussolepro/data/generated/rome1000-candidate/jobs.rome.json");
const NORMALIZED_AT = process.env.MARKET_NORMALIZED_AT || new Date().toISOString();
const CONTRACT_REVISION = "market-contract-v4.0.0-phase3";
const TEMPORAL_CONTRACT_REVISION = "market-temporal-contract-v1.0.0";
const RUNTIME_FILENAME = process.env.MARKET_TRENDS_RUNTIME_FILE || "market-trends.rome1000.json";

const BMO_SOURCES = Object.freeze([
  { year: "2024", path: process.env.BMO_2024_XLSX_PATH, publishedAt: "2024-04-25", url: "https://www.data.gouv.fr/api/1/datasets/r/4319f5e8-a8e6-476c-8da0-c0d3439ebb55" },
  { year: "2025", path: process.env.BMO_2025_XLSX_PATH, publishedAt: "2025-04-17", url: "https://www.data.gouv.fr/api/1/datasets/r/54478315-aafd-4070-b8df-a5647297e0c0" },
  { year: "2026", path: process.env.BMO_2026_XLSX_PATH, publishedAt: "2026-04-21", url: "https://www.data.gouv.fr/api/1/datasets/r/228917c7-c22e-4766-835e-fcb923f29b3d" }
]);
const DARES_SOURCES = Object.freeze([
  { year: "2023", path: process.env.DARES_TENSION_2023_XLSX_PATH, publishedAt: "2025-04-30", url: "https://statistiques.pole-emploi.org/offres/Handlers/HTFile.ashx?MEDIAID=183486&SITEKEY=7550205d-2042-4165-bb99-fd14a4b3f938" },
  { year: "2024", path: process.env.DARES_TENSION_2024_XLSX_PATH, publishedAt: "2026-02-04", url: "https://statistiques.francetravail.org/offres/Handlers/HTFile.ashx?MEDIAID=187108" }
]);

export async function main() {
  assertSourcePaths([...BMO_SOURCES, ...DARES_SOURCES]);
  const [jobs, mappings, identity, contract, manifest, quality, offerNational, offerRegional, offerDepartmental] = await Promise.all([
    readJson(JOBS_PATH), readMarket("fap-rome-mappings.json"), readMarket("market-package-identity.json"),
    readMarket("market-contract.json"), readMarket("market-import-manifest.json"), readMarket("market-quality-report.json"),
    readMarket("market-national.rome.json"), readMarket("market-occitanie.rome.json"), readMarket("market-aude.rome.json")
  ]);
  const bmoRows = (await Promise.all(BMO_SOURCES.map(readBmoSource))).flat().sort(comparePeriodTerritoryFap);
  const daresRows = (await Promise.all(DARES_SOURCES.map(readDaresSource))).flat().sort(comparePeriodTerritoryFap);
  const temporalSeries = buildAuditableTemporalSeries(bmoRows, daresRows);
  const snapshotRegistry = buildOfferSnapshotRegistry(identity, { national: offerNational, regional: offerRegional, departmental: offerDepartmental });
  const runtime = buildRuntimeTrends(jobs, mappings, bmoRows, daresRows, snapshotRegistry);
  const temporalContract = buildTemporalContract();
  const nextMarketContract = {
    ...contract,
    schemaVersion: "4.0.0",
    marketContractRevision: CONTRACT_REVISION,
    interpretationRevision: "market-interpretation-v2",
    temporalContractRevision: TEMPORAL_CONTRACT_REVISION,
    semanticRules: {
      ...(contract.semanticRules || {}),
      temporalTrendsAreDescriptiveOnly: true,
      temporalTrendsRankingWeight: 0,
      historicalOffersRequireThreeComparableSnapshots: true,
      noSyntheticHistory: true
    }
  };
  const sourceMetadata = await buildSourceMetadata();
  const trendsQuality = buildTrendsQuality(runtime, temporalSeries, snapshotRegistry);

  await writeMarket("market-temporal-contract.json", temporalContract);
  await writeMarket("market-contract.json", nextMarketContract);
  await writeMarket("market-temporal-series.json", temporalSeries);
  await writeMarket("market-offer-snapshot-registry.json", snapshotRegistry);
  await writeMarket(RUNTIME_FILENAME, runtime);
  await writeMarket("market-trends-source-metadata.json", sourceMetadata);
  await writeMarket("market-trends-quality-report.json", trendsQuality);

  const componentFiles = unique([
    ...toArray(identity.components).map(item => item.fileName),
    "market-temporal-contract.json", "market-temporal-series.json", "market-offer-snapshot-registry.json",
    RUNTIME_FILENAME, "market-trends-source-metadata.json", "market-trends-quality-report.json"
  ]).filter(fileName => !["market-package-identity.json", "market-import-manifest.json", "market-quality-report.json"].includes(fileName));
  const components = await hashFiles(componentFiles);
  const fingerprint = sha256(components.map(item => `${item.fileName}:${item.sha256}:${item.count}`).sort().join("\n"));
  const nextIdentity = {
    ...identity,
    schemaVersion: "4.0.0",
    marketContractRevision: CONTRACT_REVISION,
    temporalContractRevision: TEMPORAL_CONTRACT_REVISION,
    packageFingerprintSha256: fingerprint,
    parserVersions: { ...(identity.parserVersions || {}), xlsx: XLSX_READER_INFO.revision, phase3: "prepare-boussole-market-phase3-v1" },
    normalizedAt: NORMALIZED_AT,
    derivedAt: NORMALIZED_AT,
    packagedAt: NORMALIZED_AT,
    sourceVintage: { ...(identity.sourceVintage || {}), bmoHistory: ["2024", "2025", "2026"], daresTensionHistory: ["2023", "2024"], offerHistory: ["2026T1"] },
    sourcePublishedAt: { ...(identity.sourcePublishedAt || {}), bmoHistoryLatest: "2026-04-21", daresTensionHistoryLatest: "2026-02-04" },
    sources: uniqueSources([...(identity.sources || []), ...sourceMetadata.sources]),
    counts: {
      ...(identity.counts || {}),
      temporalSeriesPoints: temporalSeries.points.length,
      marketTrendRuntimeRows: runtime.jobs.length,
      offerSnapshots: snapshotRegistry.snapshots.length
    },
    temporalCoverage: trendsQuality.coverage,
    runtimeLoadedRows: { ...(identity.runtimeLoadedRows || {}), marketTrendRuntimeRows: runtime.jobs.length },
    components,
    status: "market_phase3_official_recent_evolution_context_only"
  };
  await writeMarket("market-package-identity.json", nextIdentity);
  await writeMarket("market-quality-report.json", {
    ...quality,
    schemaVersion: "4.0.0",
    marketContractRevision: CONTRACT_REVISION,
    temporalContractRevision: TEMPORAL_CONTRACT_REVISION,
    generatedAt: NORMALIZED_AT,
    status: "completed_with_official_recent_evolution_and_insufficient_offer_history",
    marketLayerIdentity: nextIdentity,
    checks: { ...(quality.checks || {}), activeRomeJobs: runtime.jobs.length },
    coverage: { ...(quality.coverage || identity.coverage || {}), jobsWithBmo: 491, jobsWithDaresTension: 482 },
    temporalCoverage: trendsQuality.coverage,
    sourceStatus: {
      ...(quality.sourceStatus || {}),
      bmoHistory: "official_2024_2026_fap2021_comparable_when_values_known",
      daresHistory: "official_2023_2024_fap2021_recent_evolution",
      offerHistory: "single_real_snapshot_insufficient_history"
    }
  });
  await writeMarket("market-import-manifest.json", {
    ...manifest,
    schemaVersion: "4.0.0",
    datasetName: "Boussole Pro - couche marché phase 3",
    datasetVersion: process.env.MARKET_DATASET_VERSION || "market-v4-phase3-rome1000-2026-08-11",
    generatedAt: NORMALIZED_AT,
    marketContractRevision: CONTRACT_REVISION,
    temporalContractRevision: TEMPORAL_CONTRACT_REVISION,
    marketLayerIdentity: nextIdentity,
    files: unique([...(manifest.files || []), ...componentFiles, "market-package-identity.json"]),
    status: "completed_with_official_recent_evolution_context_only"
  });
  console.log(JSON.stringify({ status: "market_phase3_ready", fingerprint, ...trendsQuality.coverage }, null, 2));
}

async function readBmoSource(source) {
  const raw = [];
  let headers = [];
  await readXlsxRows(source.path, "xl/worksheets/sheet2.xml", (cells, rowIndex) => {
    if (rowIndex === 0) { headers = cells.map(normalizeHeader); return; }
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    if (String(row.annee) !== source.year || !row.code_metier_bmo) return;
    const projects = numberOrNull(row.met);
    if (projects === null) return;
    const base = {
      year: source.year, fapCode: row.code_metier_bmo, fapLabel: row.nom_metier_bmo,
      recruitmentProjects: projects, difficultProjects: sourceMeasure(row.xmet), seasonalProjects: sourceMeasure(row.smet)
    };
    raw.push({ ...base, territoryId: "FR", territoryLabel: "France entière", territoryLevel: "national" });
    if (String(row.reg).padStart(2, "0") === "76") raw.push({ ...base, territoryId: "REG-76", territoryLabel: "Occitanie", territoryLevel: "regional" });
    if (String(row.dept).padStart(2, "0") === "11") raw.push({ ...base, territoryId: "DEP-11", territoryLabel: "Aude", territoryLevel: "departmental" });
  });
  return aggregateBmoRows(raw, { sourceVintage: source.year, sourcePublishedAt: source.publishedAt, normalizedAt: NORMALIZED_AT });
}

async function readDaresSource(source) {
  const outputs = [];
  const sheets = [
    { path: "xl/worksheets/sheet3.xml", territoryId: "FR", territoryLabel: "France entière", territoryLevel: "national" },
    { path: "xl/worksheets/sheet5.xml", territoryId: "REG-76", territoryLabel: "Occitanie", territoryLevel: "regional", codeHeader: "code_region", code: "76" },
    { path: "xl/worksheets/sheet7.xml", territoryId: "DEP-11", territoryLabel: "Aude", territoryLevel: "departmental", codeHeader: "code_departement", code: "11" }
  ];
  for (const sheet of sheets) {
    let headers = [];
    await readXlsxRows(source.path, sheet.path, (cells, rowIndex) => {
      if (rowIndex === 0) { headers = cells.map(normalizeHeader); return; }
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
      if (String(row.annee) !== source.year || !row.code_fap_228) return;
      if (sheet.codeHeader && String(row[sheet.codeHeader]).padStart(2, "0") !== sheet.code) return;
      outputs.push(normalizeDaresTensionRow({
        year: source.year, fapCode: row.code_fap_228, fapLabel: row.libelle_fap_228,
        territoryId: sheet.territoryId, territoryLabel: sheet.territoryLabel, territoryLevel: sheet.territoryLevel,
        tensionIndex: row.tension, imputedTensionIndex: row.tension_valeurs_imputees_volumetrie_insuffisante,
        tensionClass: row.tension_discret, hiringIntensity: row.intensite_d_embauches,
        trainingEmploymentLink: row.lien_formation_emploi, availableWorkforceShortage: row.manque_de_main_d_oeuvre_disponible,
        employmentNonDurability: row.non_durabilite_de_l_emploi, demandingWorkingConditions: row.conditions_de_travail_contraignantes,
        geographicMismatch: row.inadequation_geographique, salaryUnattractiveness: row.non_attractivite_salariale,
        sufficientVolume: String(row.croisement_ou_volumetrie_suffisante || "").includes("FAP228")
      }, { sourceVintage: source.year, sourcePublishedAt: source.publishedAt, normalizedAt: NORMALIZED_AT }));
    });
  }
  return outputs;
}

function buildAuditableTemporalSeries(bmoRows, daresRows) {
  const points = [];
  for (const row of bmoRows) {
    for (const [indicatorId, dimension] of [
      ["bmo_recruitment_projects", row.recruitmentProjectsDimension],
      ["bmo_recruitment_difficulty_rate", row.recruitmentDifficulty],
      ["bmo_seasonality_rate", row.seasonality]
    ]) points.push(temporalPoint({ indicatorId, row, dimension, sourceName: "france_travail_bmo" }));
  }
  for (const row of daresRows) points.push(temporalPoint({ indicatorId: "dares_tension_index", row, dimension: row.tension, sourceName: "dares_france_travail_tension" }));
  return {
    schemaVersion: "1.0.0", temporalContractRevision: TEMPORAL_CONTRACT_REVISION, generatedAt: NORMALIZED_AT,
    scope: "complete_normalized_official_fap_series_for_fr_reg76_dep11",
    classificationBreak: { before: "2023", reason: "Dares tension directly compared only from FAP-2021 publication vintages 2023-2024." },
    points
  };
}

function temporalPoint({ indicatorId, row, dimension, sourceName }) {
  const isSuppressed = String(dimension?.status || "").includes("suppressed");
  const isImputed = Boolean(dimension?.details?.imputed || String(dimension?.status || "").includes("imputed"));
  return {
    indicatorId, sourceName, sourceVintage: row.sourceVintage, period: row.sourceVintage,
    territoryId: row.territoryId, territoryLabel: row.territoryLabel, classificationVersion: "FAP2021",
    statisticalFamilyId: row.fapCode, romeCode: null, value: isSuppressed || isImputed ? null : dimension?.value ?? null,
    unit: dimension?.unit || null, status: dimension?.status || "unknown", isSuppressed, isImputed,
    mappingMethod: "not_applied_at_source_level", mappingConfidence: 1,
    comparisonStatus: isSuppressed ? "suppressed_value" : isImputed ? "missing_value" : dimension?.value === null || dimension?.value === undefined ? "missing_value" : "comparable",
    breakReason: null, publishedDiscreteClass: dimension?.details?.publishedDiscreteClass ?? null,
    sufficientVolume: dimension?.details?.sufficientVolume ?? null, sourcePublishedAt: row.sourcePublishedAt || null
  };
}

function buildRuntimeTrends(jobs, mappings, bmoRows, daresRows, snapshotRegistry) {
  const activeCodes = new Set(jobs.map(job => job.romeCode));
  const mappingsByRome = groupBy(mappings.filter(item => activeCodes.has(item.romeCode)), item => item.romeCode);
  const activeFapCodes = new Set(mappings.filter(item => activeCodes.has(item.romeCode)).map(item => item.fapCode));
  const bmo = new Map(bmoRows.map(row => [`${row.territoryId}|${row.fapCode}|${row.sourceVintage}`, row]));
  const dares = new Map(daresRows.map(row => [`${row.territoryId}|${row.fapCode}|${row.sourceVintage}`, row]));
  const territories = ["FR", "REG-76", "DEP-11"];
  const fapLabels = new Map([...bmoRows, ...daresRows].map(row => [row.fapCode, row.fapLabel]));
  const families = [...activeFapCodes].sort((a, b) => a.localeCompare(b, "fr")).map(fapCode => {
    const territorySeries = Object.fromEntries(territories.map(territoryId => {
      const bmoSeries = BMO_SOURCES.map(source => compactBmoHistory(bmo.get(`${territoryId}|${fapCode}|${source.year}`), source.year));
      const daresSeries = DARES_SOURCES.map(source => compactDaresHistory(dares.get(`${territoryId}|${fapCode}|${source.year}`), source.year));
      return [territoryId, {
        bmo: { comparisonStatus: comparisonStatus(bmoSeries, 3), periods: bmoSeries, evolution: summarizeBmoEvolution(bmoSeries) },
        dares: { comparisonStatus: comparisonStatus(daresSeries, 2), periods: daresSeries, evolution: summarizeDaresEvolution(daresSeries), classificationBreakBefore: "2023" },
        offers: { comparisonStatus: "insufficient_history", snapshotCount: snapshotRegistry.snapshots.length, requiredComparableSnapshots: 3 }
      }];
    }));
    return {
      fapCode, fapLabel: fapLabels.get(fapCode) || null, territories: territorySeries,
      displayEligible: Object.values(territorySeries).some(item => item.bmo.periods.some(period => period.projects.value !== null) || item.dares.periods.some(period => period.index.value !== null))
    };
  });
  const familyByCode = new Map(families.map(family => [family.fapCode, family]));
  const rows = jobs.map(job => {
    const mapRows = mappingsByRome.get(job.romeCode) || [];
    const fapCodes = unique(mapRows.map(item => item.fapCode));
    const familyMappings = fapCodes.map(fapCode => ({
      fapCode,
      qualificationCodes: unique(mapRows.filter(item => item.fapCode === fapCode).map(item => item.qualificationCode).filter(Boolean))
    }));
    return {
      romeCode: job.romeCode, mappingMethod: mapRows.length ? "official_rome_by_qualification_to_fap2021" : "unmapped",
      mappingConfidence: mapRows.length ? 0.95 : 0, sharedFamilyContextOnly: true, rankingWeight: 0,
      familyMappings, displayEligible: fapCodes.some(fapCode => familyByCode.get(fapCode)?.displayEligible)
    };
  }).sort((a, b) => a.romeCode.localeCompare(b.romeCode, "fr"));
  return {
    schemaVersion: "1.0.0", temporalContractRevision: TEMPORAL_CONTRACT_REVISION, generatedAt: NORMALIZED_AT,
    scope: "runtime_compact_rome1000", rankingPolicy: "descriptive_context_only_weight_zero",
    counts: { jobs: rows.length, activeFapFamilies: families.length, displayEligibleJobs: rows.filter(row => row.displayEligible).length },
    families, jobs: rows
  };
}

function compactBmoHistory(row, year) {
  const compact = dimension => ({ value: dimension && ["available", "zero"].includes(dimension.status) ? dimension.value : null, status: dimension?.status || "missing", isSuppressed: String(dimension?.status || "").includes("suppressed") });
  return { period: year, projects: compact(row?.recruitmentProjectsDimension), difficultyRate: compact(row?.recruitmentDifficulty), seasonalityRate: compact(row?.seasonality) };
}

function compactDaresHistory(row, year) {
  const direct = row?.tension?.status === "available";
  return {
    period: year,
    index: { value: direct ? row.tension.value : null, status: row?.tension?.status || "missing" },
    publishedClass: direct ? row.tension.details?.publishedDiscreteClass ?? null : null,
    isImputed: Boolean(row?.tension?.details?.imputed), sufficientVolume: row?.tension?.details?.sufficientVolume ?? null
  };
}

function comparisonStatus(periods, expected) {
  if (periods.length < expected) return "insufficient_history";
  const values = periods.map(period => period.projects?.value ?? period.index?.value ?? null);
  if (periods.some(period => period.projects?.isSuppressed)) return "suppressed_value";
  if (values.some(value => value === null)) return "missing_value";
  return "comparable";
}

function summarizeBmoEvolution(periods) {
  const first = periods[0]?.projects?.value;
  const last = periods.at(-1)?.projects?.value;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { status: "not_calculated", comparisonStatus: "missing_value", periodsCount: periods.length };
  const absolute = last - first;
  const relativePercent = first >= 50 ? Number(((absolute / first) * 100).toFixed(1)) : null;
  const stableThreshold = Math.max(10, first * 0.05);
  return {
    status: first < 50 ? "exact_values_low_base" : Math.abs(absolute) < stableThreshold ? "stable" : absolute > 0 ? "increase" : "decrease",
    comparisonStatus: "comparable", periodsCount: periods.length, from: periods[0].period, to: periods.at(-1).period,
    absolute, relativePercent, thresholdMethod: "projects_stable_if_abs_delta_below_max_10_or_5_percent; no_relative_label_if_base_below_50"
  };
}

function summarizeDaresEvolution(periods) {
  const first = periods[0]?.index?.value;
  const last = periods.at(-1)?.index?.value;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { status: "not_calculated", comparisonStatus: "missing_value", periodsCount: periods.length };
  const absolute = Number((last - first).toFixed(3));
  const classDelta = Number(periods.at(-1)?.publishedClass) - Number(periods[0]?.publishedClass);
  return {
    status: Math.abs(absolute) < 0.1 || classDelta === 0 ? "stable" : absolute > 0 ? "increase" : "decrease",
    comparisonStatus: "comparable", periodsCount: periods.length, from: periods[0].period, to: periods.at(-1).period,
    absolute, classDelta: Number.isFinite(classDelta) ? classDelta : null,
    thresholdMethod: "stable_if_published_class_unchanged_or_absolute_standardized_index_delta_below_0.1"
  };
}

function buildOfferSnapshotRegistry(identity, rows) {
  return {
    schemaVersion: "1.0.0", temporalContractRevision: TEMPORAL_CONTRACT_REVISION, generatedAt: NORMALIZED_AT,
    indicatorId: "observed_offer_volume_12m", sourceName: "france_travail_market_api",
    minimumComparableSnapshots: 3, comparisonStatus: "insufficient_history",
    methodAudit: {
      result: "current_package_exposes_one_period_only",
      apiSupportsPeriodType: true,
      historicalPeriodParameterVerifiedLocally: false,
      decision: "append_only_real_snapshot_registry_no_backfill"
    },
    snapshots: [{
      period: identity.sourceVintage?.offers || "2026T1", packageFingerprintSha256: identity.packageFingerprintSha256,
      sourceMethod: "POST", territories: { FR: rows.national.length, "REG-76": rows.regional.length, "DEP-11": rows.departmental.length },
      comparisonStatus: "insufficient_history", synthetic: false
    }]
  };
}

function buildTemporalContract() {
  return {
    schemaVersion: "1.0.0", temporalContractRevision: TEMPORAL_CONTRACT_REVISION, marketContractRevision: CONTRACT_REVISION,
    requiredFields: ["indicatorId", "sourceName", "sourceVintage", "period", "territoryId", "territoryLabel", "classificationVersion", "statisticalFamilyId", "romeCode", "value", "unit", "status", "isSuppressed", "isImputed", "mappingMethod", "mappingConfidence", "comparisonStatus", "breakReason"],
    comparisonStatuses: ["comparable", "insufficient_history", "missing_value", "suppressed_value", "classification_break", "territory_break", "method_break", "shared_family_context_only"],
    comparableWindows: { bmo: ["2024", "2025", "2026"], daresTension: ["2023", "2024"], observedOffersMinimumSnapshots: 3 },
    classificationRules: { bmo: "FAP2021 same source schema and territory", daresTension: "FAP2021 direct recent evolution; explicit break before 2023", offers: "same API method, activity nomenclature, territory and period definition" },
    rankingPolicy: { bmo: 0, daresTension: 0, observedOfferTrend: 0 },
    missingValuePolicy: "masked_missing_or_imputed_values_are_never_zero_and_do_not_receive_a_trend_label"
  };
}

async function buildSourceMetadata() {
  const sources = [];
  for (const source of [...BMO_SOURCES, ...DARES_SOURCES]) {
    const buffer = await readFile(source.path);
    const info = await stat(source.path);
    sources.push({
      id: `${BMO_SOURCES.includes(source) ? "france_travail_bmo" : "dares_tension"}_${source.year}`,
      producer: BMO_SOURCES.includes(source) ? "France Travail" : "Dares et France Travail",
      sourceVintage: source.year, sourcePublishedAt: source.publishedAt, url: source.url,
      retrievedForNormalizationAt: NORMALIZED_AT, localInputSizeBytes: info.size, localInputSha256: sha256(buffer), format: "xlsx"
    });
  }
  return { schemaVersion: "1.0.0", temporalContractRevision: TEMPORAL_CONTRACT_REVISION, generatedAt: NORMALIZED_AT, sources };
}

function buildTrendsQuality(runtime, temporalSeries, snapshotRegistry) {
  const bmoPoints = temporalSeries.points.filter(point => point.indicatorId.startsWith("bmo_"));
  const daresPoints = temporalSeries.points.filter(point => point.indicatorId === "dares_tension_index");
  const familyByCode = new Map(runtime.families.map(family => [family.fapCode, family]));
  const jobsWithBmoHistory = runtime.jobs.filter(row => row.familyMappings.some(mapping => Object.values(familyByCode.get(mapping.fapCode)?.territories || {}).some(item => item.bmo.comparisonStatus === "comparable"))).length;
  const jobsWithDaresHistory = runtime.jobs.filter(row => row.familyMappings.some(mapping => Object.values(familyByCode.get(mapping.fapCode)?.territories || {}).some(item => item.dares.comparisonStatus === "comparable"))).length;
  return {
    schemaVersion: "1.0.0", temporalContractRevision: TEMPORAL_CONTRACT_REVISION, generatedAt: NORMALIZED_AT,
    status: "completed_with_official_recent_evolution_and_insufficient_offer_history",
    coverage: {
      activeRomeJobs: runtime.jobs.length, jobsWithBmoHistory, jobsWithDaresHistory,
      bmoTemporalPoints: bmoPoints.length, daresTemporalPoints: daresPoints.length,
      suppressedBmoPoints: bmoPoints.filter(point => point.isSuppressed).length,
      imputedDaresPointsExcludedFromTrend: daresPoints.filter(point => point.isImputed).length,
      offerSnapshots: snapshotRegistry.snapshots.length, offerHistoryComparisonStatus: snapshotRegistry.comparisonStatus,
      jobsWithBmo: 491, jobsWithDaresTension: 482
    },
    assertions: {
      bmoVintages: unique(bmoPoints.map(point => point.period)), daresVintages: unique(daresPoints.map(point => point.period)),
      suppressedValuesRemainNull: bmoPoints.filter(point => point.isSuppressed).every(point => point.value === null),
      imputedDaresExcludedFromTrend: daresPoints.filter(point => point.isImputed).every(point => point.value === null),
      offerHistoryIsNotSynthesized: snapshotRegistry.snapshots.every(item => item.synthetic === false),
      rankingWeightZero: runtime.jobs.every(row => row.rankingWeight === 0)
    }
  };
}

function sourceMeasure(value) {
  if (String(value).trim() === "*") return "suppressed";
  return numberOrNull(value);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "*" || value === "n.d.") return null;
  const numeric = Number(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeHeader(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function assertSourcePaths(sources) {
  const missing = sources.filter(source => !source.path).map(source => source.year);
  if (missing.length) throw new Error(`Sources temporelles absentes : ${missing.join(", ")}. Fournir les cinq chemins XLSX officiels.`);
}

function comparePeriodTerritoryFap(a, b) {
  return String(a.sourceVintage).localeCompare(String(b.sourceVintage), "fr") || String(a.territoryId).localeCompare(String(b.territoryId), "fr") || String(a.fapCode).localeCompare(String(b.fapCode), "fr");
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) { const key = keyOf(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
  return map;
}

function unique(values) { return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ""))]; }
function toArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function uniqueSources(rows) { return [...new Map(rows.map(row => [row.id || row.url, row])).values()]; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }
async function readMarket(fileName) { return readJson(path.join(MARKET_DIR, fileName)); }
async function writeMarket(fileName, value) { await writeFile(path.join(MARKET_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
async function hashFiles(files) {
  const rows = [];
  for (const fileName of files) {
    const buffer = await readFile(path.join(MARKET_DIR, fileName));
    const parsed = JSON.parse(buffer);
    rows.push({ fileName, sha256: sha256(buffer), count: Array.isArray(parsed) ? parsed.length : Array.isArray(parsed.points) ? parsed.points.length : Array.isArray(parsed.jobs) ? parsed.jobs.length : 1 });
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
