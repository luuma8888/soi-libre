import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_DIMENSIONS,
  MARKET_INTERPRETATION_REVISION,
  MARKET_SCHEMA_REVISION,
  MARKET_SCORE_POLICY_REVISION,
  aggregateBmoRows,
  migrateOfferVolumeRow,
  normalizeDaresTensionRow
} from "./market-phase1-core.mjs";
import { XLSX_READER_INFO, readXlsxRows } from "./market-xlsx.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market");
const JOBS_PATH = path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome500-experimental", "jobs.rome.json");
const NORMALIZED_AT = process.env.MARKET_NORMALIZED_AT || new Date().toISOString();
const BMO_XLSX_PATH = process.env.BMO_XLSX_PATH || "";
const DARES_TENSION_XLSX_PATH = process.env.DARES_TENSION_XLSX_PATH || "";
const FAP_CSV_PATH = process.env.FAP_CSV_PATH || "";

const SOURCES = Object.freeze({
  offers: {
    id: "france_travail_market_api",
    producer: "France Travail",
    sourceVintage: "2026T1",
    url: "https://www.data.gouv.fr/dataservices/api-marche-du-travail"
  },
  bmo: {
    id: "france_travail_bmo_2026",
    producer: "France Travail",
    sourceVintage: "2026",
    sourcePublishedAt: "2026-04-21",
    url: "https://www.data.gouv.fr/api/1/datasets/r/228917c7-c22e-4766-835e-fcb923f29b3d"
  },
  daresTension: {
    id: "dares_france_travail_tension_2024",
    producer: "Dares et France Travail",
    sourceVintage: "2024",
    sourcePublishedAt: "2026-02-04",
    url: "https://statistiques.francetravail.org/offres/Handlers/HTFile.ashx?MEDIAID=187108"
  },
  fap: {
    id: "dares_fap2021_nomenclature",
    producer: "Dares",
    sourceVintage: "FAP2021",
    sourcePublishedAt: "2024-04-30",
    url: "https://data.dares.travail-emploi.gouv.fr/api/explore/v2.1/catalog/datasets/dares_nomenclature_fap2021/exports/csv?use_labels=true"
  }
});

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const activeJobs = await readJson(JOBS_PATH, []);
  const activeRomeCodes = new Set(activeJobs.map(job => job.romeCode).filter(Boolean));
  const offerFiles = [
    ["market-national.rome.json", "national"],
    ["market-occitanie.rome.json", "regional"],
    ["market-aude.rome.json", "departmental"]
  ];
  const offersByLevel = {};
  for (const [fileName, level] of offerFiles) {
    const rows = await readJson(path.join(OUTPUT_DIR, fileName), []);
    offersByLevel[level] = rows.map(migrateOfferVolumeRow);
    await writeJson(fileName, offersByLevel[level]);
  }

  const fapNomenclature = FAP_CSV_PATH
    ? await readFapNomenclature(FAP_CSV_PATH)
    : await readJson(path.join(OUTPUT_DIR, "fap2021-nomenclature.json"), []);
  const bmoRows = BMO_XLSX_PATH
    ? await readBmo2026(BMO_XLSX_PATH)
    : await readJson(path.join(OUTPUT_DIR, "bmo-fap2021.json"), []);
  const daresRows = DARES_TENSION_XLSX_PATH
    ? await readDaresTension2024(DARES_TENSION_XLSX_PATH)
    : await readJson(path.join(OUTPUT_DIR, "dares-tension-fap2021.json"), []);
  const mappings = await readJson(path.join(OUTPUT_DIR, "fap-rome-mappings.json"), []);
  const controlledMappings = normalizeMappings(mappings, activeRomeCodes);

  await writeJson("market-contract.json", buildContract());
  await writeJson("fap2021-nomenclature.json", fapNomenclature);
  await writeJson("bmo-fap2021.json", bmoRows);
  await writeJson("dares-tension-fap2021.json", daresRows);
  await writeJson("fap-rome-mappings.json", controlledMappings);
  await writeJson("fap-rome-mapping-status.json", buildMappingStatus(controlledMappings, fapNomenclature, bmoRows, daresRows));

  const dataFiles = [
    "market-contract.json",
    "market-national.rome.json",
    "market-occitanie.rome.json",
    "market-aude.rome.json",
    "bmo-fap2021.json",
    "dares-tension-fap2021.json",
    "fap2021-nomenclature.json",
    "fap-rome-mappings.json",
    "fap-rome-mapping-status.json",
    "territories.json"
  ];
  const componentIdentity = await hashFiles(dataFiles);
  const packageFingerprintSha256 = sha256(componentIdentity.map(item => `${item.fileName}:${item.sha256}:${item.count}`).sort().join("\n"));
  const identity = buildMarketIdentity({
    packageFingerprintSha256,
    componentIdentity,
    offersByLevel,
    bmoRows,
    daresRows,
    controlledMappings,
    activeRomeCodes
  });
  const quality = buildQualityReport({
    identity,
    offersByLevel,
    bmoRows,
    daresRows,
    controlledMappings,
    activeRomeCodes
  });
  const manifest = buildManifest({ identity, quality, dataFiles });
  await writeJson("market-package-identity.json", identity);
  await writeJson("market-quality-report.json", quality);
  await writeJson("market-import-manifest.json", manifest);

  console.log(`[Boussole Pro] Couche marche ${MARKET_SCHEMA_REVISION}: ${packageFingerprintSha256}.`);
  console.log(`- offres: FR=${offersByLevel.national.length}, Occitanie=${offersByLevel.regional.length}, Aude=${offersByLevel.departmental.length}`);
  console.log(`- BMO 2026 FAP: ${bmoRows.length}; Dares 2024 FAP: ${daresRows.length}; mappings ROME autorises: ${controlledMappings.filter(item => item.rankingEligible).length}`);
}

async function readBmo2026(filePath) {
  let headers = [];
  const rows = [];
  await readXlsxRows(filePath, "xl/worksheets/sheet2.xml", (cells, rowIndex) => {
    if (rowIndex === 0) {
      headers = cells.map(normalizeHeader);
      return;
    }
    const row = rowObject(headers, cells);
    const fapCode = row.code_metier_bmo;
    const projects = numberOrNull(row.met);
    if (!fapCode || projects === null) return;
    const base = {
      year: row.annee,
      fapCode,
      fapLabel: row.nom_metier_bmo,
      recruitmentProjects: projects,
      difficultProjects: sourceMeasure(row.xmet),
      seasonalProjects: sourceMeasure(row.smet)
    };
    rows.push({ ...base, territoryId: "FR", territoryLabel: "France entiere", territoryLevel: "national" });
    if (String(row.reg).padStart(2, "0") === "76") {
      rows.push({ ...base, territoryId: "REG-76", territoryLabel: "Occitanie", territoryLevel: "regional" });
    }
    if (String(row.dept).padStart(2, "0") === "11") {
      rows.push({ ...base, territoryId: "DEP-11", territoryLabel: "Aude", territoryLevel: "departmental" });
    }
  });
  return aggregateBmoRows(rows, {
    sourceVintage: SOURCES.bmo.sourceVintage,
    sourcePublishedAt: SOURCES.bmo.sourcePublishedAt,
    normalizedAt: NORMALIZED_AT
  });
}

async function readDaresTension2024(filePath) {
  const outputs = [];
  const sheets = [
    { path: "xl/worksheets/sheet3.xml", territoryId: "FR", territoryLabel: "France entiere", territoryLevel: "national" },
    { path: "xl/worksheets/sheet5.xml", territoryId: "REG-76", territoryLabel: "Occitanie", territoryLevel: "regional", territoryCodeHeader: "code_region", territoryCode: "76" },
    { path: "xl/worksheets/sheet7.xml", territoryId: "DEP-11", territoryLabel: "Aude", territoryLevel: "departmental", territoryCodeHeader: "code_departement", territoryCode: "11" }
  ];
  for (const sheet of sheets) {
    let headers = [];
    await readXlsxRows(filePath, sheet.path, (cells, rowIndex) => {
      if (rowIndex === 0) {
        headers = cells.map(normalizeHeader);
        return;
      }
      const row = rowObject(headers, cells);
      if (String(row.annee) !== "2024") return;
      if (sheet.territoryCodeHeader && String(row[sheet.territoryCodeHeader]).padStart(2, "0") !== sheet.territoryCode) return;
      if (!row.code_fap_228) return;
      outputs.push(normalizeDaresTensionRow({
        year: row.annee,
        fapCode: row.code_fap_228,
        fapLabel: row.libelle_fap_228,
        territoryId: sheet.territoryId,
        territoryLabel: sheet.territoryLabel,
        territoryLevel: sheet.territoryLevel,
        tensionIndex: row.tension,
        imputedTensionIndex: row.tension_valeurs_imputees_volumetrie_insuffisante,
        tensionClass: row.tension_discret,
        hiringIntensity: row.intensite_d_embauches,
        trainingEmploymentLink: row.lien_formation_emploi,
        availableWorkforceShortage: row.manque_de_main_d_oeuvre_disponible,
        employmentNonDurability: row.non_durabilite_de_l_emploi,
        demandingWorkingConditions: row.conditions_de_travail_contraignantes,
        geographicMismatch: row.inadequation_geographique,
        salaryUnattractiveness: row.non_attractivite_salariale,
        sufficientVolume: String(row.croisement_ou_volumetrie_suffisante || "").includes("FAP228")
      }, {
        sourceVintage: SOURCES.daresTension.sourceVintage,
        sourcePublishedAt: SOURCES.daresTension.sourcePublishedAt,
        normalizedAt: NORMALIZED_AT
      }));
    });
  }
  return outputs.sort(compareTerritoryAndCode);
}

async function readFapNomenclature(filePath) {
  const text = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  const rows = parseDelimitedRows(text, ";");
  const byCode = new Map();
  rows.forEach(row => {
    const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
    const code = normalized.code_fap_228;
    if (!code || byCode.has(code)) return;
    byCode.set(code, {
      fapCode: code,
      fapLabel: normalized.intitule_fap_228 || null,
      parentFap86Code: normalized.code_fap_86 || null,
      parentFap86Label: normalized.intitule_fap_86 || null,
      sourceName: "dares_fap2021_nomenclature",
      sourceVintage: "FAP2021"
    });
  });
  return [...byCode.values()].sort((a, b) => a.fapCode.localeCompare(b.fapCode, "fr"));
}

function normalizeMappings(rows, activeRomeCodes) {
  return rows.map(raw => {
    const method = ["official_crosswalk", "validated_local_mapping", "ambiguous", "unmapped"].includes(raw.method) ? raw.method : "unmapped";
    const confidence = clamp(Number(raw.confidence || raw.mappingConfidence || 0), 0, 1);
    const romeCodes = [...new Set([...(Array.isArray(raw.romeCodes) ? raw.romeCodes : []), raw.romeCode].filter(code => activeRomeCodes.has(code)))];
    const rankingEligible = ["official_crosswalk", "validated_local_mapping"].includes(method) && confidence >= 0.75 && romeCodes.length > 0;
    return {
      schemaVersion: "2.0.0",
      marketContractRevision: MARKET_SCHEMA_REVISION,
      fapCode: raw.fapCode || null,
      fapLabel: raw.fapLabel || null,
      romeCodes,
      direction: raw.direction || "fap_to_rome",
      source: raw.source || null,
      nomenclatureVersions: raw.nomenclatureVersions || { fap: "FAP2021", rome: "ROME 4.0" },
      method,
      confidence,
      rankingEligible,
      multipleFapForRome: Boolean(raw.multipleFapForRome),
      multipleRomeForFap: romeCodes.length > 1,
      justification: raw.justification || "Correspondance non fournie dans les sources officielles disponibles localement.",
      reference: raw.reference || null
    };
  }).filter(item => item.fapCode);
}

function buildContract() {
  return {
    schemaVersion: "2.0.0",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    interpretationRevision: MARKET_INTERPRETATION_REVISION,
    rankingPolicyRevision: MARKET_SCORE_POLICY_REVISION,
    dimensions: MARKET_DIMENSIONS,
    semanticRules: {
      offerVolumeIsNotTension: true,
      recruitmentProjectsAreNotObservedOffers: true,
      difficultyDoesNotEstablishCause: true,
      missingIsNotZero: true,
      suppressedIsNotZero: true,
      widerTerritoryFallbackMustBeExplicit: true,
      weakOrAmbiguousMappingCannotInfluenceRanking: true
    },
    thresholds: {
      observedOfferVolume: { method: "product_absolute_threshold_v1", note: "Utilise seulement comme lecture de volume brut ; la presence relative compare les metiers dans un meme territoire et une meme periode." },
      territorialPresence: { method: "percentile_within_same_territory_and_period_v1", topLocal: 90, strongLocal: 75, mediumLocal: 35 },
      bmoRates: { method: "product_rate_threshold_v1", highFromPercent: 60, moderateFromPercent: 30 },
      daresTension: { method: "official_published_discrete_class", classes: { 1: "very_low", 2: "low", 3: "moderate", 4: "high", 5: "very_high" } }
    }
  };
}

function buildMappingStatus(mappings, fapNomenclature, bmoRows, daresRows) {
  const mappedFapCodes = new Set(mappings.filter(item => item.method !== "unmapped").map(item => item.fapCode).filter(Boolean));
  const absentMappings = Math.max(0, fapNomenclature.length - mappedFapCodes.size);
  return {
    schemaVersion: "2.0.0",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    status: mappings.some(item => item.rankingEligible) ? "partially_connected" : "not_run_needs_source_or_workflow",
    reason: mappings.some(item => item.rankingEligible)
      ? "Certaines correspondances controlees sont disponibles."
      : "Les sources officielles BMO et Dares utilisent FAP2021, mais aucune table officielle FAP2021-ROME exploitable n'a ete trouvee dans les sources consultees.",
    policy: "Aucune premiere correspondance arbitraire. Les lignes FAP restent auditables et ne modifient pas le classement.",
    counts: {
      fapNomenclature: fapNomenclature.length,
      bmoRows: bmoRows.length,
      daresRows: daresRows.length,
      mappings: mappings.length,
      rankingEligible: mappings.filter(item => item.rankingEligible).length,
      ambiguous: mappings.filter(item => item.method === "ambiguous").length,
      unmapped: absentMappings,
      absent: absentMappings
    },
    requiredNextInput: "Table officielle ou validee FAP2021 vers ROME 4.0, avec cardinalites et references."
  };
}

function buildMarketIdentity({ packageFingerprintSha256, componentIdentity, offersByLevel, bmoRows, daresRows, controlledMappings, activeRomeCodes }) {
  const offerCodes = new Set(Object.values(offersByLevel).flat().map(row => row.romeCode).filter(Boolean));
  const sourceFapCodes = new Set([...bmoRows, ...daresRows].map(row => row.fapCode).filter(Boolean));
  const mappedFapCodes = new Set(controlledMappings.filter(item => item.method !== "unmapped").map(item => item.fapCode).filter(Boolean));
  const absentMappings = Math.max(0, sourceFapCodes.size - mappedFapCodes.size);
  return {
    schemaVersion: "2.0.0",
    identityKind: "boussole_market_layer_identity",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    packageFingerprintAlgorithm: "sha256_of_sorted_market_component_hashes_and_counts",
    packageFingerprintSha256,
    parserVersions: { xlsx: XLSX_READER_INFO.revision, phase1: "prepare-boussole-market-phase1-v1" },
    sourcePublishedAt: { bmo: SOURCES.bmo.sourcePublishedAt, daresTension: SOURCES.daresTension.sourcePublishedAt, fapNomenclature: SOURCES.fap.sourcePublishedAt },
    sourceVintage: { offers: SOURCES.offers.sourceVintage, bmo: SOURCES.bmo.sourceVintage, daresTension: SOURCES.daresTension.sourceVintage, fapNomenclature: SOURCES.fap.sourceVintage },
    normalizedAt: NORMALIZED_AT,
    derivedAt: NORMALIZED_AT,
    packagedAt: NORMALIZED_AT,
    sources: Object.values(SOURCES),
    territories: ["FR", "REG-76", "DEP-11"],
    counts: {
      offerNational: offersByLevel.national.length,
      offerRegional: offersByLevel.regional.length,
      offerDepartmental: offersByLevel.departmental.length,
      bmoFapRows: bmoRows.length,
      daresTensionFapRows: daresRows.length,
      fapRomeMappings: controlledMappings.length,
      fapRomeRankingEligible: controlledMappings.filter(item => item.rankingEligible).length
    },
    coverage: {
      activeRomeJobs: activeRomeCodes.size,
      jobsWithObservedOffers: [...offerCodes].filter(code => activeRomeCodes.has(code)).length,
      jobsWithBmo: 0,
      jobsWithDaresTension: 0,
      bmoFapFamilies: new Set(bmoRows.map(row => row.fapCode)).size,
      daresFapFamilies: new Set(daresRows.map(row => row.fapCode)).size
    },
    mappingCoverage: {
      officialCrosswalk: controlledMappings.filter(item => item.method === "official_crosswalk").length,
      validatedLocal: controlledMappings.filter(item => item.method === "validated_local_mapping").length,
      ambiguous: controlledMappings.filter(item => item.method === "ambiguous").length,
      unmapped: absentMappings,
      absent: absentMappings
    },
    components: componentIdentity,
    status: controlledMappings.some(item => item.rankingEligible) ? "partial_market_layer" : "offer_layer_ready_fap_sources_unmapped"
  };
}

function buildQualityReport({ identity, offersByLevel, bmoRows, daresRows, controlledMappings, activeRomeCodes }) {
  const allOffers = Object.values(offersByLevel).flat();
  const semanticFailures = allOffers.filter(row => row.marketDataKind === "offers_volume" && row.tensionLevel !== "unknown");
  const outOfBounds = [
    ...bmoRows.filter(row => [row.recruitmentDifficulty?.value, row.seasonality?.value].some(value => value !== null && (value < 0 || value > 100))),
    ...daresRows.filter(row => row.tension?.details?.publishedDiscreteClass !== null && ![1, 2, 3, 4, 5].includes(row.tension.details.publishedDiscreteClass))
  ];
  const duplicates = duplicateKeys([
    ...allOffers.map(row => `offer|${row.sourceLevel}|${row.romeCode}`),
    ...bmoRows.map(row => `bmo|${row.territoryId}|${row.fapCode}`),
    ...daresRows.map(row => `dares|${row.territoryId}|${row.fapCode}`)
  ]);
  const mappingEligible = controlledMappings.filter(item => item.rankingEligible);
  return {
    schemaVersion: "2.0.0",
    reportKind: "boussole_market_quality_runtime",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    generatedAt: NORMALIZED_AT,
    status: semanticFailures.length || outOfBounds.length || duplicates.length ? "failed" : "completed_with_known_source_gap",
    marketLayerIdentity: identity,
    coverageByDimension: {
      observedOfferVolume: new Set(allOffers.map(row => row.romeCode).filter(Boolean)).size,
      recruitmentProjects: 0,
      recruitmentDifficulty: 0,
      seasonality: 0,
      tension: 0,
      territorialPresence: new Set(allOffers.filter(row => row.territorialOfferSignal !== "unknown").map(row => row.romeCode)).size,
      trend: 0,
      bmoFapRows: bmoRows.length,
      daresTensionFapRows: daresRows.length
    },
    coverageByTerritory: {
      national: offersByLevel.national.length,
      regional: offersByLevel.regional.length,
      departmental: offersByLevel.departmental.length
    },
    coverageByVintage: {
      "2026T1_offers": allOffers.filter(row => String(row.latestPeriodCode || "").startsWith("2026")).length,
      "2026_bmo": bmoRows.length,
      "2024_dares_tension": daresRows.length
    },
    mappingCoverage: identity.mappingCoverage,
    zeroVsMissing: {
      zeroOfferRows: allOffers.filter(row => row.offers12m === 0).length,
      missingOfferRows: allOffers.filter(row => row.offers12m === null || row.offers12m === undefined).length,
      bmoSuppressedDifficultyRows: bmoRows.filter(row => row.recruitmentDifficulty?.status === "suppressed_partial").length,
      bmoSuppressedSeasonalityRows: bmoRows.filter(row => row.seasonality?.status === "suppressed_partial").length
    },
    checks: {
      activeRomeJobs: activeRomeCodes.size,
      falseOfficialTensionFromOffers: semanticFailures.length,
      outOfBounds: outOfBounds.length,
      territoryInconsistencies: [
        ...allOffers.filter(row => !["FR", "REG-76", "DEP-11"].includes(row.territoryId)),
        ...bmoRows.filter(row => !["FR", "REG-76", "DEP-11"].includes(row.territoryId)),
        ...daresRows.filter(row => !["FR", "REG-76", "DEP-11"].includes(row.territoryId))
      ].length,
      duplicateKeys: duplicates,
      mixedBmoVintage: [...new Set(bmoRows.map(row => row.sourceVintage))],
      mixedDaresVintage: [...new Set(daresRows.map(row => row.sourceVintage))],
      missingSourceOrUnit: countMissingSourceOrUnit({ allOffers, bmoRows, daresRows }),
      inheritedMisnamedFieldsCleared: allOffers.filter(row => row.semanticMigrationStatus === "legacy_offer_fields_cleared").length
    },
    rankingPolicy: {
      observedOfferVolume: "limited_when_localized_and_reliable",
      recruitmentProjects: mappingEligible.length ? "controlled_mapping_only" : "not_allowed_unmapped",
      recruitmentDifficulty: "context_only_phase1",
      seasonality: "context_only_phase1",
      daresTension: mappingEligible.length ? "controlled_mapping_only" : "not_allowed_unmapped",
      weakOrAmbiguousMapping: "never"
    },
    sourceStatus: {
      offers: "connected_existing_static_package",
      bmo: bmoRows.length ? "official_source_normalized_fap_unmapped" : "not_run_needs_source_or_workflow",
      daresTension: daresRows.length ? "official_source_normalized_fap_unmapped" : "not_run_needs_source_or_workflow",
      fapRomeMapping: mappingEligible.length ? "partially_connected" : "not_run_needs_source_or_workflow"
    },
    blockers: semanticFailures.length ? ["offer_volume_still_creates_tension"] : [],
    knownLimits: [
      "BMO 2026 et la tension Dares 2024 sont normalises au niveau FAP2021, sans rattachement arbitraire aux codes ROME.",
      "La cause d'une difficulte BMO n'est jamais deduite automatiquement.",
      "Les cellules BMO masquees ne sont jamais converties en zero."
    ]
  };
}

function buildManifest({ identity, quality, dataFiles }) {
  return {
    schemaVersion: "2.0.0",
    datasetName: "Boussole Pro - couche marche phase 1",
    datasetVersion: `market-v2-phase1-${NORMALIZED_AT.slice(0, 10)}`,
    marketContractRevision: MARKET_SCHEMA_REVISION,
    generatedAt: NORMALIZED_AT,
    status: quality.status,
    outputPath: "creations/boussolepro/data/generated/market/",
    files: [...dataFiles, "market-package-identity.json", "market-quality-report.json", "market-import-manifest.json"],
    marketLayerIdentity: identity,
    sourcePolicy: {
      noActiveOffers: true,
      noBrowserToken: true,
      noSecretsWritten: true,
      offerVolumeIsNotTension: true,
      bmoUsedInMarketScore: false,
      daresTensionUsedInMarketScore: false,
      fapRomeUsedInMarketScore: identity.counts.fapRomeRankingEligible > 0,
      weakOrAmbiguousMappingCannotInfluenceRanking: true,
      activeOffersDisplayed: false
    }
  };
}

async function hashFiles(fileNames) {
  const results = [];
  for (const fileName of fileNames) {
    const buffer = await readFile(path.join(OUTPUT_DIR, fileName));
    const parsed = JSON.parse(buffer);
    results.push({ fileName, sha256: sha256(buffer), size: buffer.length, count: Array.isArray(parsed) ? parsed.length : 1 });
  }
  return results;
}

function countMissingSourceOrUnit({ allOffers, bmoRows, daresRows }) {
  let count = allOffers.filter(row => !(row.observedOfferVolume?.sourceName || row.sourceName) || !(row.observedOfferVolume?.unit || row.observedOfferVolumeUnit)).length;
  count += bmoRows.filter(row => !row.recruitmentProjectsDimension?.sourceName || !row.recruitmentProjectsDimension?.unit).length;
  count += daresRows.filter(row => !row.tension?.sourceName || !row.tension?.unit).length;
  return count;
}

function duplicateKeys(keys) {
  const seen = new Set();
  const duplicates = new Set();
  keys.forEach(key => { if (seen.has(key)) duplicates.add(key); else seen.add(key); });
  return [...duplicates];
}

function sourceMeasure(value) {
  if (String(value).trim() === "*") return "suppressed";
  return numberOrNull(value);
}

function rowObject(headers, cells) {
  return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
}

function normalizeHeader(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseDelimitedRows(text, delimiter) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitDelimitedLine(lines[0], delimiter);
  return lines.slice(1).map(line => {
    const cells = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index + 1] === "\"") { current += "\""; index += 1; }
    else if (char === "\"") quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "n.d." || value === "*") return null;
  const numeric = Number(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function compareTerritoryAndCode(a, b) {
  return String(a.territoryId).localeCompare(String(b.territoryId), "fr") || String(a.fapCode).localeCompare(String(b.fapCode), "fr");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch { return fallback; }
}

async function writeJson(fileName, value) {
  await writeFile(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) await main();
