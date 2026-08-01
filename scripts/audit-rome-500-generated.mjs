import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const GENERATED_DIR = path.join("creations", "boussolepro", "data", "generated");
const MARKET_DIR = path.join(GENERATED_DIR, "market");
const HTML_PATH = path.join("creations", "boussolepro", "boussole-pro.html");
const ROME_DOMAIN_BY_LETTER = {
  A: "Agriculture et pêche, espaces naturels et espaces verts, soins aux animaux",
  B: "Arts et façonnage d'ouvrages d'art",
  C: "Banque, assurance, immobilier",
  D: "Commerce, vente et grande distribution",
  E: "Communication, média et multimédia",
  F: "Construction, bâtiment et travaux publics",
  G: "Hôtellerie-restauration, tourisme, loisirs et animation",
  H: "Industrie",
  I: "Installation et maintenance",
  J: "Santé",
  K: "Services à la personne et à la collectivité",
  L: "Spectacle",
  M: "Support à l'entreprise",
  N: "Transport et logistique"
};

export async function buildRome500AuditArtifacts(options = {}) {
  const generatedDir = options.generatedDir || GENERATED_DIR;
  const configuredMarketDir = options.marketDir || process.env.ROME_MARKET_DIR || MARKET_DIR;
  const bundledMarketDir = path.join(generatedDir, "market");
  const startedAt = Date.now();
  const buildMetadata = await readBoussoleBuildMetadata(HTML_PATH);
  const [
    jobs,
    mappings,
    appellations,
    skills,
    contexts,
    rawSkills,
    qualityReport,
    accessSummary,
    accessQualityReport,
    downstreamValidationReport
  ] = await Promise.all([
    readJson(path.join(generatedDir, "jobs.rome.json"), []),
    readJson(path.join(generatedDir, "mappings.rome.json"), []),
    readJson(path.join(generatedDir, "job-appellations.rome.json"), []),
    readJson(path.join(generatedDir, "skills.rome.json"), []),
    readJson(path.join(generatedDir, "work-contexts.rome.json"), []),
    readJson(path.join(generatedDir, "rome-raw-skills.json"), []),
    readJson(path.join(generatedDir, "data-quality-report.rome.json"), {}),
    readJson(path.join(generatedDir, "access-summary.rome500.json"), []),
    readJson(path.join(generatedDir, "access-summary-quality-report.json"), {}),
    readJson(path.join(GENERATED_DIR, "boussole-v074-targeted-validation-report.json"), {})
  ]);

  const bundledMarket = await readMarketBundle(bundledMarketDir);
  const configuredMarket = path.resolve(configuredMarketDir) === path.resolve(bundledMarketDir)
    ? bundledMarket
    : await readMarketBundle(configuredMarketDir);
  const bundledHasRows = hasMarketRows(bundledMarket);
  const configuredHasRows = hasMarketRows(configuredMarket);
  const marketBundleStatus = bundledHasRows
    ? "bundled_in_corpus_folder"
    : configuredHasRows
      ? "loaded_from_shared_market_folder"
      : (bundledMarket.hasReport || configuredMarket.hasReport ? "not_loaded" : "not_generated");
  const selectedMarket = bundledHasRows ? bundledMarket : configuredMarket;

  const linked = buildLinkedCoverage(jobs, mappings);
  const shellJobs = jobs.filter(isShellJob);
  const sectorMappingCoverage = buildSectorCoverage(jobs);
  const rawReferentialIntegrity = buildRawReferentialIntegrity(rawSkills, await checksumFile(path.join(generatedDir, "rome-raw-skills.json")));
  const marketAvailability = buildMarketAvailability(
    jobs,
    selectedMarket.national,
    selectedMarket.regional,
    selectedMarket.departmental,
    selectedMarket.qualityReport,
    {
      marketBundleStatus,
      marketDir: bundledHasRows ? bundledMarketDir : configuredMarketDir
    }
  );
  const matchingReadiness = buildMatchingReadiness({ jobs, linked, shellJobs, sectorMappingCoverage });
  const activeRomeCodes = new Set(jobs.map(job => job.romeCode).filter(Boolean));
  const activeAccessSummary = accessSummary.filter(row => activeRomeCodes.has(row.romeCode));
  const accessPaths = activeAccessSummary.flatMap(row => toArray(row.accessPaths));
  const quality = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: "local_generated_files_audit",
    jobsTotal: jobs.length,
    requestedCodesCount: qualityReport.requestedCodesCount ?? qualityReport.sync?.requestedCodesCount ?? jobs.length,
    successfulCodesCount: qualityReport.successfulCodesCount ?? qualityReport.sync?.successfulCodesCount ?? jobs.length,
    failedCodesCount: qualityReport.failedCodesCount ?? qualityReport.sync?.failedCodesCount ?? 0,
    completionRate: qualityReport.completionRate ?? qualityReport.sync?.completionRate ?? ratio(jobs.length, jobs.length),
    linkedDataCoverage: linked,
    sectorMappingCoverage,
    rawReferentialIntegrity,
    marketAvailability,
    shellJobs: {
      count: shellJobs.length,
      ratio: ratio(shellJobs.length, jobs.length),
      samples: shellJobs.slice(0, 30).map(jobSummary)
    },
    readiness: {
      dataReadiness: "enriched_usable",
      engineReadiness: "validated_on_8_profiles",
      performanceReadiness: "compact_export_improved",
      overallReadiness: "usable_for_validation"
    },
    matchingReadiness,
    accessCoverage: {
      jobsWithAccessSummary: activeAccessSummary.length,
      jobsWithSpecificCredentialRequired: activeAccessSummary.filter(row => row.specificCredentialRequired).length,
      jobsWithStructuredAccessPaths: activeAccessSummary.filter(row => toArray(row.accessPaths).length).length,
      accessPaths: accessPaths.length,
      accessPathsWithKnownDuration: accessPaths.filter(path => path.trainingDuration?.category && path.trainingDuration.category !== "unknown").length,
      accessPathsWithUnknownDuration: accessPaths.filter(path => !path.trainingDuration?.category || path.trainingDuration.category === "unknown").length,
      regulatedJobsResolved: activeAccessSummary.filter(row => row.regulated && (toArray(row.requiredCredentialLabels).length || toArray(row.accessPaths).length)).length,
      regulatedJobsUnresolved: activeAccessSummary.filter(row => row.regulated && !toArray(row.requiredCredentialLabels).length && !toArray(row.accessPaths).length).length,
      contradictions: activeAccessSummary.filter(row => row.contradictoryEvidence).length,
      downstreamInconsistenciesDetected: toArray(downstreamValidationReport.failures).length,
      truthCases: accessQualityReport.summary?.truthCasesCount ?? null,
      truthFailures: accessQualityReport.summary?.truthFailuresCount ?? null,
      catalogExplanation: qualityReport.accessCatalogExplanation?.note || "Les catalogues formation/certification et les conditions d’accès sont comptés séparément."
    },
    warnings: buildWarnings({ jobs, linked, shellJobs, sectorMappingCoverage, marketAvailability })
  };
  Object.assign(quality, buildMetadata, { datasetVersion: qualityReport.datasetVersion || buildMetadata.datasetVersion });

  const performance = await buildPerformanceReport(generatedDir, startedAt);
  Object.assign(performance, buildMetadata, { datasetVersion: qualityReport.datasetVersion || buildMetadata.datasetVersion });
  const markdown = buildMarkdownReport({ quality, performance, qualityReport, marketQualityReport: selectedMarket.qualityReport });
  await writeJson(path.join(generatedDir, "rome-corpus-quality-report.json"), quality);
  await writeJson(path.join(generatedDir, "rome-corpus-performance-report.json"), performance);
  await writeFile(path.join(generatedDir, "rome-corpus-audit.md"), markdown, "utf8");
  await writeJson(path.join(generatedDir, "rome-500-quality-report.json"), quality);
  await writeJson(path.join(generatedDir, "rome-500-performance-report.json"), performance);
  await writeFile(path.join(generatedDir, "rome-500-audit.md"), markdown, "utf8");
  return { quality, performance, markdown };
}

async function readMarketBundle(marketDir) {
  const [national, regional, departmental, qualityReport] = await Promise.all([
    readJson(path.join(marketDir, "market-national.rome.json"), []),
    readJson(path.join(marketDir, "market-occitanie.rome.json"), []),
    readJson(path.join(marketDir, "market-aude.rome.json"), []),
    readJson(path.join(marketDir, "market-quality-report.json"), null)
  ]);
  return {
    marketDir,
    national,
    regional,
    departmental,
    qualityReport: qualityReport || {},
    hasReport: Boolean(qualityReport)
  };
}

function hasMarketRows(bundle = {}) {
  return toArray(bundle.national).length + toArray(bundle.regional).length + toArray(bundle.departmental).length > 0;
}

function buildMatchingReadiness({ jobs, linked, shellJobs, sectorMappingCoverage }) {
  const score = average([
    ratio(linked.jobsWithSkillMappings, jobs.length),
    ratio(linked.jobsWithContextMappings, jobs.length),
    ratio(linked.jobsWithAppellationMappings, jobs.length),
    ratio(jobs.length - shellJobs.length, jobs.length),
    ratio(sectorMappingCoverage.jobsWithBoussoleSector, jobs.length)
  ]);
  let status = "not_ready";
  if (score >= 0.35) status = "technical_preview";
  if (score >= 0.5 && linked.jobsWithSkillMappings / Math.max(1, jobs.length) >= 0.9) status = "partial_matching";
  if (score >= 0.75 && linked.jobsWithContextMappings / Math.max(1, jobs.length) >= 0.75 && linked.jobsWithAppellationMappings / Math.max(1, jobs.length) >= 0.75) status = "usable";
  if (score >= 0.92 && shellJobs.length === 0) status = "usable_for_validation";
  return {
    usableForMatchingJobs: jobs.length - shellJobs.length,
    usableForMatchingRatio: ratio(jobs.length - shellJobs.length, jobs.length),
    score,
    status
  };
}

function buildLinkedCoverage(jobs = [], mappings = []) {
  const mapByJob = new Map(mappings.map(mapping => [mapping.jobId, mapping]));
  const rows = jobs.map(job => mapByJob.get(job.id) || {});
  return {
    mappingsTotal: mappings.length,
    jobsWithSkillMappings: rows.filter(row => row.skillIds?.length).length,
    jobsWithContextMappings: rows.filter(row => row.contextIds?.length).length,
    jobsWithAppellationMappings: rows.filter(row => row.appellationIds?.length).length,
    jobsWithKnowledgeMappings: rows.filter(row => row.knowledgeIds?.length).length,
    jobsWithRelatedRomeCodes: rows.filter(row => row.relatedRomeCodes?.length).length,
    jobsWithActivities: jobs.filter(job => job.activities?.length).length,
    jobsWithOfficialDescription: jobs.filter(job => job.description && job.fieldSources?.description === "official_rome_api").length,
    jobsWithAccessConditions: jobs.filter(job => job.accessConditions?.text).length,
    jobsWithDiplomaLevel: jobs.filter(hasKnownDiplomaLevel).length
  };
}

function hasKnownDiplomaLevel(job = {}) {
  return (
    job.requiredDiplomaLevel !== null &&
    job.requiredDiplomaLevel !== undefined &&
    Number.isFinite(Number(job.requiredDiplomaLevel))
  ) || (
    job.recommendedDiplomaLevel !== null &&
    job.recommendedDiplomaLevel !== undefined &&
    Number.isFinite(Number(job.recommendedDiplomaLevel))
  );
}

function buildSectorCoverage(jobs = []) {
  const ambiguousMappings = [];
  let jobsWithOfficialDomain = 0;
  let jobsWithBoussoleSector = 0;
  let jobsWithGenericFallback = 0;
  jobs.forEach(job => {
    const official = job.officialRomeDomain?.label || ROME_DOMAIN_BY_LETTER[String(job.romeCode || "").charAt(0)];
    if (official) jobsWithOfficialDomain += 1;
    if (Array.isArray(job.boussoleSectorIds) && job.boussoleSectorIds.length) jobsWithBoussoleSector += 1;
    if (!job.boussoleSectorIds?.length || job.domain === "ROME / France Travail") {
      jobsWithGenericFallback += 1;
      ambiguousMappings.push(jobSummary(job));
    }
  });
  return {
    jobsTotal: jobs.length,
    jobsWithOfficialDomain,
    jobsWithBoussoleSector,
    jobsWithGenericFallback,
    ambiguousMappings: ambiguousMappings.slice(0, 80)
  };
}

function buildRawReferentialIntegrity(rawSkills = [], checksum = "") {
  const ids = rawSkills.map(item => item.rawId || item.rawKeyOrId || item.id || item.code).filter(Boolean);
  const duplicateOfficialIds = ids.length - new Set(ids).size;
  const missingOfficialIds = rawSkills.length - ids.length;
  return {
    previousCount: null,
    currentCount: rawSkills.length,
    duplicateOfficialIds,
    missingOfficialIds,
    checksum
  };
}

function buildMarketAvailability(jobs = [], national = [], regional = [], departmental = [], report = {}, options = {}) {
  const byLevel = { national, regional, departmental };
  const requestedCodes = new Set(jobs.map(job => job.romeCode).filter(Boolean));
  const nationalCodes = new Set(national.map(row => row.romeCode).filter(Boolean));
  const regionalCodes = new Set(regional.map(row => row.romeCode).filter(Boolean));
  const departmentalCodes = new Set(departmental.map(row => row.romeCode).filter(Boolean));
  const levelCoverage = Object.fromEntries(Object.entries(byLevel).map(([level, rows]) => {
    const codes = new Set(rows.map(row => row.romeCode).filter(Boolean));
    return [level, {
      rows: rows.length,
      jobsWithOfficialMarket: [...requestedCodes].filter(code => codes.has(code)).length,
      jobsWithZeroOffers: rows.filter(row => row.offers12m === 0).length,
      jobsUnavailable: [...requestedCodes].filter(code => !codes.has(code)).length,
      staleRows: rows.filter(row => ["stale", "very_stale"].includes(row.marketFreshness)).length
    }];
  }));
  const nationallyUnavailable = [...requestedCodes].filter(code => !nationalCodes.has(code));
  const regionallyUnavailable = [...requestedCodes].filter(code => nationalCodes.has(code) && !regionalCodes.has(code));
  const departmentallyUnavailable = [...requestedCodes].filter(code => (nationalCodes.has(code) || regionalCodes.has(code)) && !departmentalCodes.has(code));
  const codesWithAnyOfficialMarket = new Set([
    ...national,
    ...regional,
    ...departmental
  ].map(row => row.romeCode).filter(code => requestedCodes.has(code)));
  const rawMarketFileCoverage = {
    nationalRows: national.length,
    regionalRows: regional.length,
    departmentalRows: departmental.length
  };
  const activeCorpusMarketCoverage = {
    jobsTotal: jobs.length,
    jobsWithOfficialMarket: codesWithAnyOfficialMarket.size,
    jobsWithoutMarket: Math.max(0, jobs.length - codesWithAnyOfficialMarket.size),
    nationalJobsWithMarket: levelCoverage.national?.jobsWithOfficialMarket || 0,
    regionalJobsWithMarket: levelCoverage.regional?.jobsWithOfficialMarket || 0,
    departmentalJobsWithMarket: levelCoverage.departmental?.jobsWithOfficialMarket || 0
  };
  return {
    source: "api_marche_travail",
    method: report.apiMethod || report.marketApi?.method || "POST",
    marketBundleStatus: options.marketBundleStatus || "not_loaded",
    marketDir: options.marketDir || "",
    bmoUsedInScore: false,
    fapRomeUsedInScore: false,
    rawMarketFileCoverage,
    activeCorpusMarketCoverage,
    marketCoverage: {
      rawFiles: rawMarketFileCoverage,
      activeCorpus: activeCorpusMarketCoverage
    },
    levelCoverage,
    unavailableByLevel: {
      nationalUnavailableCount: nationallyUnavailable.length,
      nationalUnavailableCodes: nationallyUnavailable,
      regionalAdditionalUnavailableCount: regionallyUnavailable.length,
      regionalAdditionalUnavailableCodes: regionallyUnavailable,
      departmentalAdditionalUnavailableCount: departmentallyUnavailable.length,
      departmentalAdditionalUnavailableCodes: departmentallyUnavailable
    },
    unsupportedMarketRomeCodes: nationallyUnavailable,
    unsupportedMarketRomeCodesCount: nationallyUnavailable.length,
    optimizationHint: nationallyUnavailable.length
      ? `Eviter les appels regional/departemental pour ${nationallyUnavailable.length} code(s) indisponibles au national pendant le meme run.`
      : "Aucun code indisponible au national dans ce lot."
  };
}

async function buildPerformanceReport(generatedDir, startedAt) {
  const files = await listFiles(generatedDir);
  const fileRows = await Promise.all(files.map(async file => {
    const stats = await stat(file);
    return {
      file: path.relative(generatedDir, file),
      bytes: stats.size,
      megabytes: Number((stats.size / 1024 / 1024).toFixed(2))
    };
  }));
  const estimatedCompactExport = await estimateCompactExportSize(generatedDir);
  const sourceArtifactSha256 = await checksumFile(HTML_PATH);
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    generatedDir,
    sourceArtifactSha256,
    measurementScope: "local_file_audit_and_compact_export_estimate",
    scenarioId: "ui_scenario_not_executed_by_file_audit",
    scenarioStepsCompleted: [],
    browserName: null,
    browserVersion: null,
    uiScenarioMetrics: {
      resultsFirstRenderMs: null,
      explorationFirstRenderMs: null,
      filterFacetMs: null,
      jobCardOpenMs: null,
      whyModalOpenMs: null,
      comparisonRenderMs: null,
      compactExportMs: null,
      measurementStatus: {
        resultsFirstRenderMs: "not_measured",
        explorationFirstRenderMs: "not_measured",
        filterFacetMs: "not_measured",
        jobCardOpenMs: "not_measured",
        whyModalOpenMs: "not_measured",
        comparisonRenderMs: "not_measured",
        compactExportMs: "not_measured"
      },
      note: "Non mesuré par ce script : utiliser une validation navigateur/Playwright pour ces métriques."
    },
    filesTotal: fileRows.length,
    totalBytes: fileRows.reduce((sum, file) => sum + file.bytes, 0),
    totalMegabytes: Number((fileRows.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(2)),
    largestFiles: fileRows.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
    estimatedCompactExport,
    auditRuntimeMs: Date.now() - startedAt,
    exportRecommendations: [
      "Garder l'export resultats JSON en mode compact par defaut.",
      "Reserver les diagnostics complets aux exports avances.",
      "Ne pas dupliquer les historiques marche dans chaque resultat."
    ]
  };
}

async function estimateCompactExportSize(generatedDir) {
  const jobs = (await readJson(path.join(generatedDir, "jobs.rome.json"), [])).map(compactJobForEstimate);
  const mappings = await readJson(path.join(generatedDir, "mappings.rome.json"), []);
  const matchableSkills = await readJson(path.join(generatedDir, "skills-matchable.rome.json"), []);
  const matchableSkillIds = new Set(matchableSkills.map(item => item.id).filter(Boolean));
  const skillIds = new Set([
    ...jobs.flatMap(job => [
      ...toArray(job.requiredSkills),
      ...toArray(job.optionalSkills),
      ...toArray(job.softSkills),
      ...toArray(job.matchableSkillIds),
      ...toArray(job.mobilizedSkillIds)
    ]),
    ...mappings.flatMap(mapping => toArray(mapping.skillIds)),
    ...matchableSkillIds
  ].filter(Boolean));
  const knowledgeIds = new Set([
    ...jobs.flatMap(job => [...toArray(job.knowledge), ...toArray(job.knowledgeIds)]),
    ...mappings.flatMap(mapping => toArray(mapping.knowledgeIds))
  ].filter(Boolean));
  const certificationIds = new Set([
    ...jobs.flatMap(job => [...toArray(job.requiredCertifications), ...toArray(job.recommendedCertifications)]),
    ...mappings.flatMap(mapping => toArray(mapping.certificationIds))
  ].filter(Boolean));
  const compact = {
    jobs,
    mappings: [],
    matchableSkills,
    skills: (await readJson(path.join(generatedDir, "skills.rome.json"), [])).filter(item => skillIds.has(item.id)),
    knowledge: (await readJson(path.join(generatedDir, "knowledge.rome.json"), [])).filter(item => knowledgeIds.has(item.id)),
    certificationLike: certificationIds.size
      ? (await readJson(path.join(generatedDir, "certification-like.rome.json"), [])).filter(item => certificationIds.has(item.id))
      : [],
    workContexts: await readJson(path.join(generatedDir, "work-contexts.rome.json"), []),
    jobAppellations: await readJson(path.join(generatedDir, "job-appellations.rome.json"), [])
  };
  const bytes = Buffer.byteLength(JSON.stringify(compact));
  return {
    bytes,
    megabytes: Number((bytes / 1024 / 1024).toFixed(2)),
    skillsCount: compact.skills.length,
    knowledgeCount: compact.knowledge.length,
    mappingsExcludedCount: mappings.length,
    note: "Estimation locale de l'export compact minifié, hors rapport diagnostic complet et sans mappings détaillés."
  };
}

function compactJobForEstimate(job = {}) {
  const compact = { ...job };
  if (arraysEqualAsSets(compact.requiredSkills, compact.matchableSkillIds)) delete compact.requiredSkills;
  if (arraysEqualAsSets(compact.softSkills, compact.softSkillIds)) delete compact.softSkills;
  if (arraysEqualAsSets(compact.knowledge, compact.knowledgeIds)) delete compact.knowledge;
  if (Array.isArray(compact.appellations)) compact.appellations = compact.appellations.slice(0, 5);
  if (compact.constraints) {
    delete compact.physicalConstraints;
    delete compact.scheduleConstraints;
    delete compact.mobilityConstraints;
  }
  if (compact.dataQuality || compact.fieldSources) {
    compact.dataQualitySummary = {
      completenessScore: compact.dataQuality?.completenessScore ?? null,
      confidence: compact.dataQuality?.confidence ?? compact.confidence ?? null,
      status: compact.dataQuality?.status || compact.officialStatus || ""
    };
    delete compact.dataQuality;
    delete compact.fieldSources;
  }
  delete compact.romeSkillLabels;
  delete compact.romeWorkContextLabels;
  delete compact.romeKnowledgeLabels;
  delete compact.romeSkillRefs;
  delete compact.romeKnowledgeRefs;
  delete compact.romeWorkContextRefs;
  delete compact.romeAppellationRefs;
  delete compact.romeCertificationRefs;
  delete compact.skillGroups;
  delete compact.romeRawDiagnostic;
  return compact;
}

function buildMarkdownReport({ quality, performance, qualityReport, marketQualityReport }) {
  const linked = quality.linkedDataCoverage;
  const market = quality.marketAvailability.levelCoverage;
  const rawMarket = quality.marketAvailability.rawMarketFileCoverage || {};
  const activeMarket = quality.marketAvailability.activeCorpusMarketCoverage || {};
  return `# Audit Boussole Pro - corpus ROME

Généré le ${quality.generatedAt}.

## Synthèse

- Métiers demandés : ${quality.requestedCodesCount}
- Métiers récupérés : ${quality.successfulCodesCount}
- Échecs : ${quality.failedCodesCount}
- Coquilles code + titre : ${quality.shellJobs.count}/${quality.jobsTotal}
- Score de préparation données : ${Math.round(quality.matchingReadiness.score * 100)}%
- Readiness globale : ${quality.readiness.overallReadiness}

## Données réellement reliées aux métiers

- Mappings compétences : ${linked.jobsWithSkillMappings}/${quality.jobsTotal}
- Mappings contextes : ${linked.jobsWithContextMappings}/${quality.jobsTotal}
- Mappings appellations : ${linked.jobsWithAppellationMappings}/${quality.jobsTotal}
- Mappings savoirs : ${linked.jobsWithKnowledgeMappings}/${quality.jobsTotal}
- Activités : ${linked.jobsWithActivities}/${quality.jobsTotal}
- Descriptions officielles : ${linked.jobsWithOfficialDescription}/${quality.jobsTotal}

## Endpoints et sources

- Fiches métiers : workflow GitHub Actions, source \`rome-fiches-metiers\` quand configurée.
- Métiers / compétences / contextes : référentiels optionnels selon variables \`FT_ROME_METIERS_URL\`, \`FT_ROME_COMPETENCES_URL\`, \`FT_ROME_CONTEXTES_URL\`.
- Marché : \`api_marche_travail\`, méthode ${quality.marketAvailability.method}, volumes d'offres observés.

## Champs absents ou insuffisants

${(qualityReport.topMissingFields || []).slice(0, 12).map(item => `- ${item.field} : ${item.count}`).join("\n") || "- Rapport qualité source non renseigné."}

## Marché officiel

- Statut bundle marché : ${quality.marketAvailability.marketBundleStatus}
- Lignes brutes : France ${rawMarket.nationalRows || 0}, région ${rawMarket.regionalRows || 0}, département ${rawMarket.departmentalRows || 0}
- Couverture corpus actif : ${activeMarket.jobsWithOfficialMarket || 0}/${activeMarket.jobsTotal || quality.jobsTotal} métier(s), sans marché ${activeMarket.jobsWithoutMarket || 0}
- France : ${market.national.jobsWithOfficialMarket}/${quality.jobsTotal}, zéros ${market.national.jobsWithZeroOffers}, absents ${market.national.jobsUnavailable}
- Occitanie : ${market.regional.jobsWithOfficialMarket}/${quality.jobsTotal}, zéros ${market.regional.jobsWithZeroOffers}, absents ${market.regional.jobsUnavailable}
- Aude : ${market.departmental.jobsWithOfficialMarket}/${quality.jobsTotal}, zéros ${market.departmental.jobsWithZeroOffers}, absents ${market.departmental.jobsUnavailable}
- Codes sans statistique nationale : ${quality.marketAvailability.unsupportedMarketRomeCodesCount}
- Codes nationaux absents en Occitanie : ${quality.marketAvailability.unavailableByLevel?.regionalAdditionalUnavailableCount || 0}
- Codes nationaux ou régionaux absents dans l’Aude : ${quality.marketAvailability.unavailableByLevel?.departmentalAdditionalUnavailableCount || 0}

## Domaines et secteurs

- Domaine officiel estimable depuis code ROME : ${quality.sectorMappingCoverage.jobsWithOfficialDomain}/${quality.jobsTotal}
- Secteur Boussole explicite : ${quality.sectorMappingCoverage.jobsWithBoussoleSector}/${quality.jobsTotal}
- Fallback générique : ${quality.sectorMappingCoverage.jobsWithGenericFallback}/${quality.jobsTotal}

## Référentiel brut compétences

- Entrées brutes : ${quality.rawReferentialIntegrity.currentCount}
- Doublons d'identifiants : ${quality.rawReferentialIntegrity.duplicateOfficialIds}
- Identifiants manquants : ${quality.rawReferentialIntegrity.missingOfficialIds}
- Checksum : \`${quality.rawReferentialIntegrity.checksum}\`

## Taille et performance

- Taille totale générée : ${performance.totalMegabytes} Mo
- Nombre de fichiers : ${performance.filesTotal}
- Plus gros fichiers : ${performance.largestFiles.slice(0, 5).map(file => `${file.file} (${file.megabytes} Mo)`).join(", ")}

## Limite actuelle

Le corpus ROME 500 est techniquement chargeable, mais il ne doit pas encore être considéré comme prêt pour un matching fiable tant que les liens compétences, contextes, appellations et activités restent quasi absents.

## Warnings

${quality.warnings.map(item => `- ${item}`).join("\n")}
`;
}

function buildWarnings({ jobs, linked, shellJobs, sectorMappingCoverage, marketAvailability }) {
  const warnings = [];
  if (linked.jobsWithSkillMappings === 0) warnings.push("Aucune compétence officielle n'est reliée aux métiers : le score compétences reste neutre et peu discriminant.");
  if (linked.jobsWithContextMappings === 0) warnings.push("Aucun contexte officiel n'est relié aux métiers : les contraintes doivent rester neutres ou faiblement pondérées.");
  if (shellJobs.length > jobs.length * 0.05) warnings.push("Trop de métiers sont des coquilles code + titre seulement pour promouvoir ce corpus.");
  if (sectorMappingCoverage.jobsWithGenericFallback > 0) warnings.push(`${sectorMappingCoverage.jobsWithGenericFallback} métier(s) utilisent encore un fallback de secteur générique.`);
  if (marketAvailability.unsupportedMarketRomeCodesCount) warnings.push(`${marketAvailability.unsupportedMarketRomeCodesCount} code(s) n'ont pas de ligne marché nationale dans le lot actuel.`);
  return warnings;
}

function isShellJob(job = {}) {
  return !job.description
    && !job.activities?.length
    && !job.requiredSkills?.length
    && !job.optionalSkills?.length
    && !job.softSkills?.length
    && !job.workContexts?.length
    && !job.appellations?.length;
}

function jobSummary(job = {}) {
  return {
    jobId: job.id,
    romeCode: job.romeCode,
    title: job.title,
    domain: job.domain,
    family: job.family
  };
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
}

async function checksumFile(file) {
  try {
    const buffer = await readFile(file);
    return createHash("sha256").update(buffer).digest("hex");
  } catch {
    return "";
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ratio(part, total) {
  return total ? Number((part / total).toFixed(2)) : 0;
}

function average(values) {
  const clean = values.filter(value => Number.isFinite(value));
  return clean.length ? Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(2)) : 0;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function arraysEqualAsSets(a = [], b = []) {
  const left = [...new Set(toArray(a))].sort();
  const right = [...new Set(toArray(b))].sort();
  return left.length > 0 && left.length === right.length && left.every((value, index) => value === right[index]);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await buildRome500AuditArtifacts({
    generatedDir: process.env.ROME_AUDIT_DIR || GENERATED_DIR,
    marketDir: process.env.ROME_MARKET_DIR || MARKET_DIR
  });
}
