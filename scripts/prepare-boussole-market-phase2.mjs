import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readXlsxRows, XLSX_READER_INFO } from "./market-xlsx.mjs";

const ROOT = process.cwd();
const MARKET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const JOBS_PATH = path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome500-experimental", "jobs.rome.json");
const SOURCE_PATH = path.resolve(ROOT, process.env.FAP_ROME_SOURCE_PATH || "creations/boussolepro/data/sources/market/fap-rome/Dares_FAP2021_Table_passage_ROME.xlsx");
const NORMALIZED_AT = process.env.MARKET_NORMALIZED_AT || new Date().toISOString();
const CONTRACT_REVISION = "market-contract-v3.0.0-phase2";
const SOURCE_PAGE = "https://dares.travail-emploi.gouv.fr/donnees/la-nomenclature-des-familles-professionnelles-2021";
const SOURCE_URL = "https://dares.travail-emploi.gouv.fr/sites/default/files/f83237de4f41868cb73b0e1aafe4800c/Dares_FAP2021_Table_passage_ROME.xlsx";
const QUALIFICATION_LABELS = Object.freeze({
  0: "Non précisé", 1: "Manœuvres", 2: "Ouvriers non qualifiés", 3: "Ouvriers qualifiés", 4: "Indépendants",
  5: "Employés non qualifiés", 6: "Employés qualifiés", 7: "Techniciens", 8: "Agents de maîtrise", 9: "Ingénieurs et cadres"
});

async function main() {
  const [jobs, bmoRows, daresRows, offerNational, offerRegional, offerDepartmental, identity, contract, manifest, quality] = await Promise.all([
    readJson(JOBS_PATH, []), readMarket("bmo-fap2021.json", []), readMarket("dares-tension-fap2021.json", []),
    readMarket("market-national.rome.json", []), readMarket("market-occitanie.rome.json", []), readMarket("market-aude.rome.json", []),
    readMarket("market-package-identity.json", {}), readMarket("market-contract.json", {}), readMarket("market-import-manifest.json", {}),
    readMarket("market-quality-report.json", {})
  ]);
  const activeCodes = new Set(jobs.map(job => job.romeCode).filter(Boolean));
  const source = await readOfficialCrosswalk(SOURCE_PATH);
  const normalizedRows = source.rows.map(normalizeCrosswalkRow).filter(Boolean);
  const strictKeys = new Set();
  const mappings = normalizedRows.filter(row => {
    const key = `${row.romeCode}|${row.qualificationCode}|${row.fapCodeDetailed}`;
    if (strictKeys.has(key)) return false;
    strictKeys.add(key);
    return true;
  });
  const indexes = buildIndexes(mappings, activeCodes);
  const enrichment = buildEnrichment(indexes, bmoRows, daresRows);
  const parsingReport = buildParsingReport(source, normalizedRows, mappings, activeCodes);
  const cardinalityReport = buildCardinalityReport(indexes, activeCodes);
  const sourceMetadata = await buildSourceMetadata(source);
  const mappingStatus = buildMappingStatus(mappings, indexes, enrichment, activeCodes);

  await writeMarket("fap-rome-source-metadata.json", sourceMetadata);
  await writeMarket("fap-rome-mappings.json", mappings);
  await writeMarket("fap-rome-parsing-report.json", parsingReport);
  await writeMarket("fap-rome-cardinality-report.json", cardinalityReport);
  await writeMarketCompact("market-fap-enrichment.rome500.json", enrichment);
  await writeMarket("fap-rome-mapping-status.json", mappingStatus);
  await writeMarket("market-contract.json", {
    ...contract,
    schemaVersion: "3.0.0",
    marketContractRevision: CONTRACT_REVISION,
    semanticRules: { ...(contract.semanticRules || {}), qualificationMustBePreserved: true, fapFamilyDataIsContextOnly: true, bmoDaresRankingEligible: false }
  });

  const newFiles = [
    "fap-rome-source-metadata.json", "fap-rome-mappings.json", "fap-rome-parsing-report.json",
    "fap-rome-cardinality-report.json", "market-fap-enrichment.rome500.json", "fap-rome-mapping-status.json", "market-contract.json"
  ];
  const runtimeComponentFiles = [
    "market-contract.json",
    "market-national.rome.json",
    "market-occitanie.rome.json",
    "market-aude.rome.json",
    "bmo-fap2021.json",
    "dares-tension-fap2021.json",
    "fap2021-nomenclature.json",
    "fap-rome-mappings.json",
    "fap-rome-mapping-status.json",
    "territories.json",
    "market-fap-enrichment.rome500.json"
  ];
  const components = await hashMarketFiles(runtimeComponentFiles);
  const fingerprint = sha256(components.map(item => `${item.fileName}:${item.sha256}:${item.count}`).sort().join("\n"));
  const counts = deriveCounts(enrichment, mappings, bmoRows, daresRows, offerNational, offerRegional, offerDepartmental);
  const nextIdentity = {
    ...identity,
    schemaVersion: "3.0.0",
    marketContractRevision: CONTRACT_REVISION,
    packageFingerprintSha256: fingerprint,
    parserVersions: { ...(identity.parserVersions || {}), xlsx: XLSX_READER_INFO.revision, phase2: "prepare-boussole-market-phase2-v1" },
    normalizedAt: NORMALIZED_AT,
    derivedAt: NORMALIZED_AT,
    packagedAt: NORMALIZED_AT,
    sources: uniqueSources([...(identity.sources || []), sourceMetadata.source]),
    counts: {
      ...(identity.counts || {}),
      offerNational: offerNational.length,
      offerRegional: offerRegional.length,
      offerDepartmental: offerDepartmental.length,
      ...counts.packagedSourceRows,
      fapRomeMappings: mappings.length,
      derivedRomeRows: enrichment.length
    },
    packagedSourceRows: counts.packagedSourceRows,
    derivedRomeRows: counts.derivedRomeRows,
    runtimeLoadedRows: counts.runtimeLoadedRows,
    coverage: { ...(identity.coverage || {}), ...counts.coverage },
    mappingCoverage: mappingStatus.counts,
    components,
    status: "market_phase2_fap_bmo_dares_active_context_only"
  };
  await writeMarket("market-package-identity.json", nextIdentity);
  await writeMarket("market-quality-report.json", {
    ...quality,
    schemaVersion: "3.0.0",
    marketContractRevision: CONTRACT_REVISION,
    generatedAt: NORMALIZED_AT,
    status: "completed_with_partial_official_fap_coverage",
    marketLayerIdentity: nextIdentity,
    coverageByDimension: {
      ...(quality.coverageByDimension || {}),
      observedOfferVolume: counts.coverage.jobsWithObservedOffers,
      recruitmentProjects: counts.coverage.jobsWithBmoProjects,
      recruitmentDifficulty: counts.coverage.jobsWithBmoDifficulty,
      seasonality: counts.coverage.jobsWithBmoSeasonality,
      tension: counts.coverage.jobsWithDaresPublishedClass,
      territorialPresence: counts.coverage.jobsWithObservedOffers
    },
    coverageByTerritory: { national: offerNational.length, regional: offerRegional.length, departmental: offerDepartmental.length },
    mappingCoverage: mappingStatus.counts,
    rankingPolicy: {
      ...(quality.rankingPolicy || {}),
      recruitmentProjects: "context_only_phase2",
      recruitmentDifficulty: "context_only_phase2",
      seasonality: "context_only_phase2",
      daresTension: "context_only_phase2",
      weakOrAmbiguousMapping: "never"
    },
    sourceStatus: {
      offers: "connected_existing_static_package",
      bmo: "official_source_normalized_and_linked_by_fap_family",
      daresTension: "official_source_normalized_and_linked_by_fap_family",
      fapRomeMapping: "official_dares_crosswalk_active_with_qualification_preserved"
    },
    blockers: [],
    knownLimits: [
      `${counts.coverage.jobsWithoutOfficialFapMapping} codes ROME actifs restent absents de la table officielle disponible.`,
      "Les statistiques FAP décrivent une famille professionnelle et non exclusivement une appellation ROME.",
      "Les familles dépendantes de la qualification restent séparées ; aucune moyenne ni addition n'est calculée.",
      "La cause d'une difficulté BMO n'est jamais déduite automatiquement.",
      "Les cellules BMO masquées restent non disponibles et ne sont jamais converties en zéro."
    ]
  });
  await writeMarket("market-import-manifest.json", {
    ...manifest,
    schemaVersion: "3.0.0",
    datasetName: "Boussole Pro - couche marché phase 2",
    datasetVersion: "market-v3-phase2-2026-08-02",
    marketContractRevision: CONTRACT_REVISION,
    marketLayerIdentity: nextIdentity,
    files: unique([...(manifest.files || []), ...newFiles, "market-package-identity.json"]),
    status: "completed_with_official_fap_rome_context_activation"
  });

  console.log(JSON.stringify({ status: "market_phase2_ready", fingerprint, ...counts.coverage, mappings: mappings.length }, null, 2));
}

async function readOfficialCrosswalk(filePath) {
  const rows = [];
  let headers = [];
  await readXlsxRows(filePath, "xl/worksheets/sheet2.xml", (cells, rowIndex) => {
    if (rowIndex === 0) { headers = cells.map(normalizeHeader); return; }
    rows.push({
      ...Object.fromEntries(headers.map((header, index) => [header, String(cells[index] || "").trim()])),
      __sourceRow: rowIndex + 1
    });
  });
  return { filePath, headers, rows };
}

function normalizeCrosswalkRow(raw) {
  const romeCode = String(raw.rome || "").trim().toUpperCase();
  const fapCodeDetailed = String(raw.fap_2021 || "").trim();
  if (!/^[A-Z][0-9]{4}$/.test(romeCode) || !fapCodeDetailed) return null;
  const qualificationCode = String(raw.qualification || "").trim() || null;
  const qualificationValues = qualificationCode ? [...qualificationCode.replace(/^Q_/, "")].filter(value => /[0-9]/.test(value)) : [];
  return {
    schemaVersion: "3.0.0", marketContractRevision: CONTRACT_REVISION,
    sourceRow: Number(raw.__sourceRow) || null, romeCode, romeLabel: raw.intitule_rome || null,
    qualificationCode, qualificationValues,
    qualificationLabels: qualificationValues.map(value => QUALIFICATION_LABELS[value]).filter(Boolean),
    fapCodeDetailed, fapCode: fapCodeDetailed.slice(0, 5), fapLabel: raw.intitule_fap || null,
    method: "official_crosswalk", mappingSpecificity: "rome_by_qualification_to_fap2021",
    displayEligible: true, rankingEligible: false,
    rankingEligibilityReason: "official_family_context_not_calibrated_for_rome_ranking",
    source: "dares_fap2021_rome_crosswalk", sourceReference: SOURCE_PAGE
  };
}

function buildIndexes(mappings, activeCodes) {
  const byRome = groupBy(mappings, row => row.romeCode);
  const byFap = groupBy(mappings, row => row.fapCodeDetailed);
  const byStatisticalFap = groupBy(mappings, row => row.fapCode);
  const byActiveRome = new Map();
  for (const code of activeCodes) {
    const rows = byRome.get(code) || [];
    const detailed = unique(rows.map(row => row.fapCodeDetailed));
    const statistical = unique(rows.map(row => row.fapCode));
    byActiveRome.set(code, {
      romeCode: code, mappings: rows, distinctDetailedFap: detailed, distinctStatisticalFap: statistical,
      qualificationDependent: detailed.length > 1,
      cardinalityStatus: !rows.length ? "official_mapping_missing_for_active_rome" : detailed.length === 1 ? "official_unique_across_qualifications" : "official_qualification_dependent"
    });
  }
  return { byRome, byFap, byStatisticalFap, byActiveRome, activeCodes };
}

function buildEnrichment(indexes, bmoRows, daresRows) {
  const { byActiveRome, byStatisticalFap, activeCodes } = indexes;
  const bmo = new Map(bmoRows.map(row => [`${row.territoryId}|${row.fapCode}`, row]));
  const dares = new Map(daresRows.map(row => [`${row.territoryId}|${row.fapCode}`, row]));
  const territories = ["FR", "REG-76", "DEP-11"];
  return [...byActiveRome.values()].map(entry => {
    const territoryData = Object.fromEntries(territories.map(territoryId => {
      const families = entry.distinctStatisticalFap.map(fapCode => {
        const mappingRows = entry.mappings.filter(row => row.fapCode === fapCode);
        const bmoRow = bmo.get(`${territoryId}|${fapCode}`) || null;
        const daresRow = dares.get(`${territoryId}|${fapCode}`) || null;
        return {
          fapCode, fapDetailedCodes: unique(mappingRows.map(row => row.fapCodeDetailed)),
          fapLabels: unique(mappingRows.map(row => row.fapLabel).filter(Boolean)),
          qualificationCodes: unique(mappingRows.map(row => row.qualificationCode).filter(Boolean)),
          bmo: compactBmo(bmoRow), dares: compactDares(daresRow)
        };
      });
      return [territoryId, families];
    }));
    const sharedFamily = entry.distinctStatisticalFap.some(fapCode =>
      unique((byStatisticalFap.get(fapCode) || []).map(row => row.romeCode).filter(code => activeCodes.has(code))).length > 1
    );
    return {
      romeCode: entry.romeCode,
      cardinalityStatus: entry.cardinalityStatus, qualificationDependency: entry.qualificationDependent,
      mappingSpecificity: entry.mappings.length ? "official_rome_by_qualification" : "unmapped",
      fapMappings: entry.mappings.map(row => ({
        fapCode: row.fapCode,
        fapCodeDetailed: row.fapCodeDetailed,
        fapLabel: row.fapLabel,
        qualificationCode: row.qualificationCode,
        sourceRow: row.sourceRow
      })),
      sharedFamily, territories: territoryData,
      displayEligible: Object.values(territoryData).some(families => families.some(item => item.bmo || item.dares)), rankingEligible: false,
      rankingEligibilityReason: "bmo_dares_context_only_phase2",
      warning: entry.qualificationDependent ? "Plusieurs repères selon la qualification ; aucune moyenne n’est calculée." : entry.mappings.length ? "Statistique de famille FAP officielle partagée ; elle ne décrit pas exclusivement ce métier." : "Correspondance FAP non disponible pour ce code ROME."
    };
  }).sort((a, b) => a.romeCode.localeCompare(b.romeCode, "fr"));
}

function compactBmo(row) {
  if (!row) return null;
  return {
    year: row.sourceVintage || row.year || "2026", territoryLabel: row.territoryLabel,
    recruitmentProjects: compactDimension(row.recruitmentProjectsDimension),
    recruitmentDifficulty: compactDimension(row.recruitmentDifficulty),
    seasonality: compactDimension(row.seasonality),
    suppressed: { difficultRows: row.difficultSuppressedRows || 0, seasonalRows: row.seasonalSuppressedRows || 0 }
  };
}

function compactDares(row) {
  if (!row) return null;
  const imputed = Boolean(row.tension?.details?.imputed);
  return {
    year: row.sourceVintage || "2024",
    territoryLabel: row.territoryLabel,
    tension: compactDimension(row.tension),
    publishedDiscreteClass: numberOrNull(row.tension?.details?.publishedDiscreteClass),
    sufficientVolume: row.tension?.details?.sufficientVolume !== false,
    imputed,
    displayAsOfficialClass: !imputed && row.tension?.status === "available"
  };
}

function compactDimension(raw) {
  if (!raw) return null;
  return {
    status: raw.status || "unknown",
    value: numberOrNull(raw.value),
    unit: raw.unit || null,
    level: raw.level || "unknown",
    confidence: numberOrNull(raw.confidence),
    details: raw.details && Object.keys(raw.details).length ? raw.details : undefined
  };
}

function buildParsingReport(source, normalizedRows, mappings, activeCodes) {
  return {
    schemaVersion: "3.0.0", reportKind: "fap_rome_official_parsing", generatedAt: NORMALIZED_AT,
    sourceHeaders: source.headers, rowsRead: source.rows.length, validRows: normalizedRows.length,
    rejectedRows: source.rows.length - normalizedRows.length, strictDuplicates: normalizedRows.length - mappings.length,
    distinctRomeCodes: unique(mappings.map(row => row.romeCode)).length,
    distinctDetailedFapCodes: unique(mappings.map(row => row.fapCodeDetailed)).length,
    distinctQualificationCodes: unique(mappings.map(row => row.qualificationCode).filter(Boolean)).length,
    activeRomeCodes: activeCodes.size, status: normalizedRows.length ? "passed" : "failed"
  };
}

function buildCardinalityReport(indexes, activeCodes) {
  const byRome = [...indexes.byActiveRome.values()].map(entry => ({
    romeCode: entry.romeCode, status: entry.cardinalityStatus, qualificationDependent: entry.qualificationDependent,
    qualifications: unique(entry.mappings.map(row => row.qualificationCode).filter(Boolean)),
    detailedFapCodes: entry.distinctDetailedFap, statisticalFapCodes: entry.distinctStatisticalFap
  }));
  const byFap = [...indexes.byFap.entries()].map(([fapCodeDetailed, rows]) => ({
    fapCodeDetailed, romeCodes: unique(rows.map(row => row.romeCode)),
    qualifications: unique(rows.map(row => row.qualificationCode).filter(Boolean)),
    status: unique(rows.map(row => row.romeCode)).length > 1 ? "official_shared_family" : "official_single_rome_family"
  }));
  const byStatisticalFap = [...indexes.byStatisticalFap.entries()].map(([fapCode, rows]) => {
    const activeRomeCodes = unique(rows.map(row => row.romeCode).filter(code => activeCodes.has(code)));
    return {
      fapCode,
      activeRomeCodes,
      activeRomeCount: activeRomeCodes.length,
      status: activeRomeCodes.length > 1 ? "official_shared_family" : "official_single_active_rome_family"
    };
  });
  return { schemaVersion: "3.0.0", reportKind: "fap_rome_cardinalities", generatedAt: NORMALIZED_AT, activeRomeCodes: activeCodes.size, byRome, byFap, byStatisticalFap };
}

async function buildSourceMetadata(source) {
  const bytes = await readFile(source.filePath);
  const info = await stat(source.filePath);
  return {
    schemaVersion: "1.0.0", retrievedAt: "2026-08-02T11:54:00.000Z", normalizedAt: NORMALIZED_AT,
    source: { id: "dares_fap2021_rome_crosswalk", producer: "Dares", resourceLabel: "Table de passage FAP 2021 / Rome", pageUrl: SOURCE_PAGE, directUrl: SOURCE_URL, archivedRetrievalUrl: "https://web.archive.org/web/20240425053231id_/" + SOURCE_URL, fileName: path.basename(source.filePath), format: "xlsx", sourceVintage: "FAP2021", retrievalStatus: "official_copy_archived_from_public_page", sizeBytes: info.size, sha256: sha256(bytes), headers: source.headers, rows: source.rows.length }
  };
}

function buildMappingStatus(mappings, indexes, enrichment, activeCodes) {
  const mapped = enrichment.filter(row => row.fapMappings.length);
  const dependent = mapped.filter(row => row.qualificationDependency);
  const display = enrichment.filter(row => row.displayEligible);
  return {
    schemaVersion: "3.0.0", marketContractRevision: CONTRACT_REVISION,
    status: "official_crosswalk_active_context_only",
    reason: "Table officielle Dares ROME × qualification → FAP-2021 intégrée. BMO et Dares sont descriptives et sans effet de rang.",
    policy: "Les familles restent séparées ; aucune première FAP, moyenne ou addition arbitraire.",
    counts: {
      activeRomeCodes: activeCodes.size,
      sourceRows: mappings.length,
      mappedActiveRome: mapped.length,
      missingActiveRome: activeCodes.size - mapped.length,
      qualificationDependent: dependent.length,
      multipleStatisticalFap: enrichment.filter(row => unique(row.fapMappings.map(item => item.fapCode)).length > 1).length,
      sharedFamily: enrichment.filter(row => row.sharedFamily).length,
      displayEligible: display.length,
      rankingEligible: 0
    },
    requiredNextInput: null
  };
}

function deriveCounts(enrichment, mappings, bmoRows, daresRows, offerNational, offerRegional, offerDepartmental) {
  const withMapping = enrichment.filter(row => row.fapMappings.length);
  const withBmo = enrichment.filter(row => Object.values(row.territories).some(families => families.some(family => family.bmo)));
  const withDares = enrichment.filter(row => Object.values(row.territories).some(families => families.some(family => family.dares)));
  const hasDimension = (row, getter) => Object.values(row.territories).some(families => families.some(family => {
    const dimension = getter(family);
    return dimension && ["available", "zero"].includes(dimension.status) && dimension.value !== null;
  }));
  const withBmoProjects = enrichment.filter(row => hasDimension(row, family => family.bmo?.recruitmentProjects));
  const withBmoDifficulty = enrichment.filter(row => hasDimension(row, family => family.bmo?.recruitmentDifficulty));
  const withBmoSeasonality = enrichment.filter(row => hasDimension(row, family => family.bmo?.seasonality));
  const withDaresPublished = enrichment.filter(row => Object.values(row.territories).some(families => families.some(family => family.dares?.displayAsOfficialClass)));
  const withDaresImputed = enrichment.filter(row => Object.values(row.territories).some(families => families.some(family => family.dares?.imputed)));
  return {
    packagedSourceRows: { bmoFapRows: bmoRows.length, daresTensionFapRows: daresRows.length, fapRomeSourceRows: mappings.length },
    derivedRomeRows: { total: enrichment.length, withOfficialMapping: withMapping.length, withBmo: withBmo.length, withDares: withDares.length },
    runtimeLoadedRows: { compactFapEnrichmentRows: enrichment.length },
    coverage: {
      activeRomeJobs: enrichment.length,
      jobsWithObservedOffers: unique([...offerNational, ...offerRegional, ...offerDepartmental].filter(row => Number.isFinite(Number(row.offers12m))).map(row => row.romeCode)).length,
      jobsWithOfficialFapMapping: withMapping.length,
      jobsWithBmo: withBmo.length,
      jobsWithBmoProjects: withBmoProjects.length,
      jobsWithBmoDifficulty: withBmoDifficulty.length,
      jobsWithBmoSeasonality: withBmoSeasonality.length,
      jobsWithDaresTension: withDares.length,
      jobsWithDaresPublishedClass: withDaresPublished.length,
      jobsWithDaresImputed: withDaresImputed.length,
      jobsQualificationDependent: withMapping.filter(row => row.qualificationDependency).length,
      jobsWithMultipleStatisticalFap: enrichment.filter(row => unique(row.fapMappings.map(item => item.fapCode)).length > 1).length,
      jobsWithSharedFapFamily: enrichment.filter(row => row.sharedFamily).length,
      jobsWithoutOfficialFapMapping: enrichment.length - withMapping.length,
      displayEligibleJobs: enrichment.filter(row => row.displayEligible).length,
      rankingEligibleJobsBmoDares: 0
    }
  };
}

async function hashMarketFiles(files) {
  const output = [];
  for (const fileName of files) {
    const filePath = path.join(MARKET_DIR, fileName);
    try { const bytes = await readFile(filePath); const value = JSON.parse(bytes); output.push({ fileName, sha256: sha256(bytes), count: Array.isArray(value) ? value.length : 1 }); } catch { /* composant historique absent */ }
  }
  return output;
}

async function readMarket(name, fallback) { return readJson(path.join(MARKET_DIR, name), fallback); }
async function readJson(filePath, fallback) { try { return JSON.parse(await readFile(filePath, "utf8")); } catch { return fallback; } }
async function writeMarket(name, value) { await writeFile(path.join(MARKET_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
async function writeMarketCompact(name, value) { await writeFile(path.join(MARKET_DIR, name), `${JSON.stringify(value)}\n`, "utf8"); }
function normalizeHeader(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function groupBy(rows, keyFn) { const map = new Map(); rows.forEach(row => { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); }); return map; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function uniqueSources(values) { const map = new Map(); values.filter(Boolean).forEach(item => map.set(item.id || item.sourceName || JSON.stringify(item), item)); return [...map.values()]; }
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

main().catch(error => { console.error(error); process.exitCode = 1; });
