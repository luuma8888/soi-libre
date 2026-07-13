const REQUIRED_JOB_FIELDS = ["id", "romeCode", "title", "sourceRefs"];
const COMPLETENESS_FIELDS = [
  "id",
  "romeCode",
  "title",
  "domain",
  "family",
  "appellations",
  "description",
  "activities",
  "requiredSkills",
  "workContexts",
  "accessConditions",
  "relatedJobs",
  "transitionTags",
  "interestTags",
  "valueTags",
  "sourceRefs"
];

export function buildDataQualityReport(dataset = {}, syncMeta = {}) {
  const jobs = dataset.jobs || [];
  const skills = dataset.skills || [];
  const workContexts = dataset.workContexts || [];
  const rawSkills = dataset.rawSkills || [];
  const matchableSkills = dataset.matchableSkills || [];
  const issues = [];
  const warnings = [];
  const ids = new Set();
  const missingFieldCounts = new Map();
  const jobCompleteness = jobs.map(job => {
    REQUIRED_JOB_FIELDS.forEach(field => {
      if (!hasValue(job[field])) issues.push(issue("blocking", `missing_${field}`, `${job.title || job.id || "Metier"} sans ${field}.`, job.romeCode || job.id || "unknown"));
    });
    if (ids.has(job.id)) issues.push(issue("blocking", "duplicate_job_id", `Doublon metier: ${job.id}.`, job.id));
    ids.add(job.id);
    const missing = getMissingFields(job);
    missing.forEach(field => missingFieldCounts.set(field, (missingFieldCounts.get(field) || 0) + 1));
    return ratio(COMPLETENESS_FIELDS.length - missing.length, COMPLETENESS_FIELDS.length);
  });
  const requestedCodes = syncMeta.requestedCodes || [];
  const successfulCodes = syncMeta.successfulCodes || jobs.map(job => job.romeCode).filter(Boolean);
  const failedCodes = syncMeta.failedCodes || [];
  const completionRate = requestedCodes.length ? Number((successfulCodes.length / requestedCodes.length).toFixed(2)) : ratio(jobs.length, jobs.length);
  const missingDomains = findMissingRomeDomains(jobs);
  const completeness = buildCompleteness(dataset, syncMeta, jobCompleteness);
  const completionScore = completeness.global.score;
  const optionalReferentials = syncMeta.optionalReferentials || [];
  const provenanceDistribution = buildProvenanceDistribution(dataset);
  if (jobs.length > 0 && jobs.length < 50) {
    warnings.push(issue("warning", "partial_official_corpus", "Corpus officiel partiel : ce jeu de donnees sert a tester la chaine ROME, pas encore a couvrir tous les metiers.", "dataset"));
  }
  if (failedCodes.length) {
    warnings.push(issue("warning", "sync_failures", `${failedCodes.length} code(s) ROME n'ont pas ete recuperes.`, "sync"));
  }
  if (missingDomains.length) {
    warnings.push(issue("warning", "missing_rome_domains", `Domaines ROME non representes : ${missingDomains.join(", ")}.`, "domainCoverage"));
  }
  if (!skills.length) warnings.push(issue("warning", "empty_generated_skills", "Aucun referentiel de competences genere. Le moteur utilisera les IDs metier mais affichera moins de libelles.", "skills"));
  if (!workContexts.length) warnings.push(issue("warning", "empty_generated_contexts", "Aucun contexte de travail genere. Le score cadre ideal sera moins precis.", "workContexts"));
  const mappings = dataset.mappings || [];
  const linkedSkillIds = getLinkedSkillIds(jobs, mappings);
  const linkedContextIds = getLinkedContextIds(jobs, mappings);
  const linkedAppellationIds = getLinkedAppellationIds(jobs, mappings, dataset.jobAppellations || []);
  const jobsWithSkillMappings = mappings.filter(mapping => mapping.skillIds?.length).length;
  const jobsWithContextMappings = mappings.filter(mapping => mapping.contextIds?.length).length;
  const jobsWithAppellationMappings = mappings.filter(mapping => mapping.appellationIds?.length).length;
  const officialDescriptionsCount = jobs.filter(job => hasValue(job.description) && job.fieldSources?.description === "official_rome_api").length;
  const jobsWithSkillsCount = Math.max(jobs.filter(job => job.requiredSkills?.length || job.optionalSkills?.length || job.softSkills?.length || job.mobilizedSkillIds?.length).length, jobsWithSkillMappings);
  const jobsWithContextsCount = Math.max(jobs.filter(job => job.workContexts?.length).length, jobsWithContextMappings);
  const jobsWithAppellationsCount = Math.max(jobs.filter(job => job.appellations?.length).length, jobsWithAppellationMappings);
  const matchableSkillIds = new Set(matchableSkills.map(skill => skill.id).filter(Boolean));
  const linkedMatchableSkillIds = new Set([...linkedSkillIds].filter(skillId => matchableSkillIds.has(skillId)));
  const matchablePerJob = jobs.map(job => [...new Set([
    ...(job.matchableSkillIds || []),
    ...(job.requiredSkills || []),
    ...(job.optionalSkills || []),
    ...(job.softSkills || [])
  ])].filter(skillId => matchableSkillIds.has(skillId)).length);
  if (rawSkills.length && linkedSkillIds.size === 0) {
    warnings.push(issue("warning", "referential_loaded_but_unlinked", "Des competences ROME globales sont chargees, mais aucune competence officielle n'est reliee aux metiers. Elles servent au profil, pas a prouver qu'un metier les exige.", "skills"));
  }
  optionalReferentials
    .filter(item => Number(item.failedCodesCount || 0) > 0)
    .forEach(item => warnings.push(issue("warning", `optional_${item.name}_partial`, `${item.name} partiellement exploitable : ${item.failedCodesCount} code(s) sans donnée enrichie.`, item.name)));
  const metiersReferential = optionalReferentials.find(item => item.name === "metiers" && item.status === "ok");
  const metiersDetails = optionalReferentials.find(item => item.name === "metiers_details" && item.status === "ok" && item.usedForDataset);
  if (metiersReferential && metiersReferential.usedForDataset === false && !metiersDetails) {
    warnings.push(issue("info", "rome_metiers_referential_not_used", "Le referentiel ROME Metiers global est charge a titre diagnostique mais n'enrichit pas les fiches : les echantillons disponibles ne fournissent pas encore descriptions, appellations, contextes ou conditions d'acces exploitables.", "metiers"));
  }
  if (jobs.length && officialDescriptionsCount === 0) {
    warnings.push(issue("warning", "missing_official_descriptions", "Aucune description officielle exploitable n'est reliee aux metiers generes. L'interface doit afficher cette limite sans inventer de resume.", "description"));
  }
  if (jobs.length && jobsWithAppellationsCount === 0) {
    warnings.push(issue("warning", "missing_official_appellations", "Aucune appellation officielle n'est reliee aux metiers generes. La recherche et la lisibilite restent limitees sur ce point.", "jobAppellations"));
  }
  if (workContexts.length && jobsWithContextMappings === 0) {
    warnings.push(issue("warning", "context_referential_unlinked", "Le referentiel contextes ROME est charge, mais aucun contexte n'est encore relie aux metiers. Il ne doit pas etre utilise comme preuve forte dans le matching.", "workContexts"));
  }
  if (matchableSkills.length > 900) {
    warnings.push(issue("warning", "too_many_matchable_skills", `${matchableSkills.length} competences matchables : reduire la liste pour le profil utilisateur.`, "matchableSkills"));
  }
  optionalReferentials
    .filter(item => item.status !== "ok")
    .forEach(item => warnings.push(issue("info", `optional_${item.name}_${item.status}`, item.message || `${item.name} non configure.`, item.name)));

  return {
    schemaVersion: "1.0.0",
    reportId: `quality-${new Date().toISOString().slice(0, 10)}`,
    generatedAt: syncMeta.generatedAt || new Date().toISOString(),
    branch: syncMeta.branch || process.env.GITHUB_REF_NAME || "local",
    datasetVersion: dataset.datasetVersion || "generated",
    status: issues.some(item => item.severity === "blocking") ? "blocked" : warnings.length ? "completed_with_warnings" : "completed",
    requestedCodesCount: requestedCodes.length,
    successfulCodesCount: successfulCodes.length,
    failedCodesCount: failedCodes.length,
    successfulCodes,
    failedCodes,
    completionRate,
    domainCoverage: {
      representedDomains: getRepresentedRomeDomains(jobs),
      missingDomains
    },
    optionalReferentials,
    provenanceDistribution,
    replacementReadiness: {
      generatedOfficialJobs: provenanceDistribution.jobs.official_rome_api || 0,
      sampleJobs: provenanceDistribution.jobs.sample_non_official || 0,
      curatedJobs: provenanceDistribution.jobs.curated_estimated || 0,
      generatedOfficialAppellations: provenanceDistribution.jobAppellations.official_rome_api || 0,
      generatedOfficialMappings: provenanceDistribution.mappings.generated_rome || provenanceDistribution.mappings.official_rome_api || 0
    },
    sync: {
      requestedCodes,
      requestedCodesCount: requestedCodes.length,
      successfulCodesCount: successfulCodes.length,
      failedCodesCount: failedCodes.length,
      fetchedCount: jobs.length,
      completionRate,
      successfulCodes,
      failedCodes,
      failures: (syncMeta.failures || []).map(failure => ({
        code: failure.code,
        status: failure.status,
        message: failure.message,
        endpoint: failure.endpoint
      }))
    },
    matchableSkillCoverage: {
      jobsTotal: jobs.length,
      jobsWithAtLeast5MatchableSkills: matchablePerJob.filter(count => count >= 5).length,
      jobsWithAtLeast10MatchableSkills: matchablePerJob.filter(count => count >= 10).length,
      averageMatchableSkillsPerJob: average(matchablePerJob),
      linkedOfficialSkillsTotal: linkedSkillIds.size,
      linkedMatchableSkillsTotal: linkedMatchableSkillIds.size
    },
    summary: {
      jobs: jobs.length,
      appellations: (dataset.jobAppellations || []).length,
      rawSkills: rawSkills.length,
      skills: skills.length,
      filteredSkills: skills.length,
      linkedSkills: linkedSkillIds.size,
      matchableSkills: matchableSkills.length,
      knowledge: (dataset.knowledge || []).length,
      certificationLike: (dataset.certificationLike || []).length,
      workContexts: workContexts.length,
      linkedContexts: linkedContextIds.size,
      linkedAppellations: linkedAppellationIds.size,
      officialDescriptions: officialDescriptionsCount,
      trainings: (dataset.trainings || []).length,
      certifications: (dataset.certifications || []).length,
      mappings: mappings.length,
      jobsWithSkillMappings,
      jobsWithContextMappings,
      jobsWithAppellationMappings,
      marketIndicators: (dataset.marketIndicators || []).length
    },
    completeness,
    coverage: {
      jobsWithSkillsCount,
      jobsWithSkillsRatio: ratio(jobsWithSkillsCount, jobs.length),
      jobsWithContextsCount,
      jobsWithContextsRatio: ratio(jobsWithContextsCount, jobs.length),
      linkedJobsWithSkillsCount: jobsWithSkillsCount,
      linkedJobsWithContextsCount: jobsWithContextsCount,
      linkedJobsWithAppellationsCount: jobsWithAppellationsCount,
      jobsWithOfficialDescriptionCount: officialDescriptionsCount,
      jobsWithOfficialDescriptionRatio: ratio(officialDescriptionsCount, jobs.length),
      jobsWithActivitiesCount: jobs.filter(job => job.activities?.length).length,
      jobsWithActivitiesRatio: ratio(jobs.filter(job => job.activities?.length).length, jobs.length),
      jobsWithAppellationsCount,
      jobsWithAppellationsRatio: ratio(jobsWithAppellationsCount, jobs.length),
      jobsWithRelatedJobsCount: jobs.filter(job => job.relatedJobs?.length).length,
      jobsWithRelatedJobsRatio: ratio(jobs.filter(job => job.relatedJobs?.length).length, jobs.length),
      jobsWithDiplomaLevelCount: jobs.filter(job => job.recommendedDiplomaLevel !== null && job.recommendedDiplomaLevel !== undefined).length,
      jobsWithDiplomaLevelRatio: ratio(jobs.filter(job => job.recommendedDiplomaLevel !== null && job.recommendedDiplomaLevel !== undefined).length, jobs.length),
      jobsWithMarketDataCount: jobs.filter(job => job.market?.source && job.market.source !== "unknown").length,
      jobsWithMarketDataRatio: ratio(jobs.filter(job => job.market?.source && job.market.source !== "unknown").length, jobs.length)
    },
    completenessScore: completionScore,
    globalCompletionScore: completionScore,
    missingMapping: jobs
      .filter(job => !(job.requiredSkills?.length || job.optionalSkills?.length || job.softSkills?.length) || !job.workContexts?.length)
      .map(job => ({
        jobId: job.id,
        romeCode: job.romeCode,
        title: job.title,
        missingSkills: !(job.requiredSkills?.length || job.optionalSkills?.length || job.softSkills?.length),
        missingContexts: !job.workContexts?.length
      })),
    topMissingFields: [...missingFieldCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([field, count]) => ({ field, count, ratio: ratio(count, jobs.length) })),
    issues,
    warnings,
    recommendations: [
      "Ce corpus ROME genere est utilisable pour tester la chaine officielle, mais reste partiel tant que peu de codes sont synchronises.",
      "Les tags de valeurs, envies et contraintes sont des deductions techniques : les verifier avant usage professionnel.",
      "Les donnees marche, diplomes, formations et certifications doivent etre enrichies par des sources dediees si elles ne sont pas presentes dans ROME.",
      "Ne pas utiliser un referentiel global de competences comme preuve de compatibilite tant qu'il n'est pas relie aux metiers du corpus.",
      "Ne jamais stocker FT_CLIENT_SECRET, access_token ou bearer token dans le front-end ni dans les JSON generes."
    ]
  };
}

function buildCompleteness(dataset = {}, syncMeta = {}, jobCompleteness = []) {
  const jobs = dataset.jobs || [];
  const requested = syncMeta.requestedCodes?.length || jobs.length;
  const skills = dataset.skills || [];
  const rawSkills = dataset.rawSkills || [];
  const matchableSkills = dataset.matchableSkills || [];
  const contexts = dataset.workContexts || [];
  const appellations = dataset.jobAppellations || [];
  const trainings = dataset.trainings || [];
  const certifications = dataset.certifications || [];
  const mappings = dataset.mappings || [];
  const linkedSkillIds = getLinkedSkillIds(jobs, mappings);
  const linkedContextIds = getLinkedContextIds(jobs, mappings);
  const linkedAppellationIds = getLinkedAppellationIds(jobs, mappings, appellations);
  const jobsWithSkillMappings = mappings.filter(mapping => mapping.skillIds?.length).length;
  const jobsWithContextMappings = mappings.filter(mapping => mapping.contextIds?.length).length;
  const jobsWithAppellations = Math.max(jobs.filter(job => job.appellations?.length).length, mappings.filter(mapping => mapping.appellationIds?.length).length);
  const jobsScore = jobCompleteness.length ? average(jobCompleteness) : 0;
  const skillsScore = ratio(Math.max(jobs.filter(job => job.requiredSkills?.length || job.optionalSkills?.length || job.softSkills?.length).length, jobsWithSkillMappings), jobs.length);
  const contextsScore = ratio(Math.max(jobs.filter(job => job.workContexts?.length).length, jobsWithContextMappings), jobs.length);
  const appellationsScore = ratio(jobsWithAppellations, jobs.length);
  const globalScore = average([jobsScore, skillsScore, contextsScore, appellationsScore].filter(value => Number.isFinite(value)));
  return {
    jobs: {
      status: jobs.length ? "connected" : "missing",
      count: jobs.length,
      expected: requested,
      score: jobsScore,
      label: `Métiers : ${jobs.length}/${requested || jobs.length}`
    },
    skills: {
      status: skills.length || linkedSkillIds.size ? "connected" : "missing",
      count: skills.length,
      rawCount: rawSkills.length,
      filteredCount: skills.length,
      linkedCount: linkedSkillIds.size,
      matchableCount: matchableSkills.length,
      jobsWithData: Math.max(jobs.filter(job => job.requiredSkills?.length || job.optionalSkills?.length || job.softSkills?.length).length, jobsWithSkillMappings),
      score: skillsScore,
      label: `Compétences : ${linkedSkillIds.size} liées aux ${jobs.length} métiers, ${skills.length} filtrées, ${matchableSkills.length} matchables, ${rawSkills.length} brutes`
    },
    contexts: {
      status: contexts.length || linkedContextIds.size ? "connected" : "missing",
      count: contexts.length,
      linkedCount: linkedContextIds.size,
      jobsWithData: Math.max(jobs.filter(job => job.workContexts?.length).length, jobsWithContextMappings),
      score: contextsScore,
      label: `Contextes : ${linkedContextIds.size} liés aux ${jobs.length} métiers, ${contexts.length} globaux`
    },
    appellations: {
      status: appellations.length || jobsWithAppellations ? "connected" : "missing",
      count: appellations.length,
      linkedCount: linkedAppellationIds.size,
      jobsWithData: jobsWithAppellations,
      score: appellationsScore,
      label: `Appellations : ${linkedAppellationIds.size || appellations.length} liées aux ${jobs.length} métiers`
    },
    trainings: {
      status: trainings.length ? "connected" : "source_not_connected",
      count: trainings.length,
      score: null,
      neutral: true,
      label: trainings.length ? `Formations : ${trainings.length}` : "Formations : source non encore connectée"
    },
    certifications: {
      status: certifications.length ? "connected" : "source_not_connected",
      count: certifications.length,
      score: null,
      neutral: true,
      label: certifications.length ? `Certifications : ${certifications.length}` : "Certifications : source non encore connectée"
    },
    global: {
      status: globalScore >= 0.7 ? "usable" : "partial",
      score: globalScore,
      globalCompletionScore: globalScore,
      label: `Complétude globale : ${Math.round(globalScore * 100)}%`
    }
  };
}

function getLinkedSkillIds(jobs = [], mappings = []) {
  return new Set([
    ...jobs.flatMap(job => [...(job.requiredSkills || []), ...(job.optionalSkills || []), ...(job.softSkills || [])]),
    ...mappings.flatMap(mapping => mapping.skillIds || [])
  ].filter(Boolean));
}

function getLinkedContextIds(jobs = [], mappings = []) {
  return new Set([
    ...jobs.flatMap(job => job.workContexts || []),
    ...mappings.flatMap(mapping => mapping.contextIds || [])
  ].filter(Boolean));
}

function getLinkedAppellationIds(jobs = [], mappings = [], appellations = []) {
  return new Set([
    ...appellations.filter(item => item.jobId).map(item => item.id),
    ...mappings.flatMap(mapping => mapping.appellationIds || []),
    ...jobs.flatMap(job => job.appellations || []).map(value => `label:${value}`)
  ].filter(Boolean));
}

function getMissingFields(job) {
  const explicit = new Set(job.dataQuality?.missingFields || job.missingFields || []);
  COMPLETENESS_FIELDS.forEach(field => {
    if (!hasValue(job[field])) explicit.add(field);
  });
  return [...explicit];
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    if ("text" in value) return Boolean(value.text);
    return Object.keys(value).length > 0;
  }
  return value !== undefined && value !== null && value !== "";
}

function issue(severity, type, message, target) {
  return { id: `${type}-${stableId(target || message)}`, severity, type, target, message };
}

function buildProvenanceDistribution(dataset = {}) {
  const collections = {
    jobs: dataset.jobs || [],
    skills: dataset.skills || [],
    matchableSkills: dataset.matchableSkills || [],
    workContexts: dataset.workContexts || [],
    jobAppellations: dataset.jobAppellations || [],
    mappings: dataset.mappings || [],
    trainings: dataset.trainings || [],
    certifications: dataset.certifications || [],
    marketIndicators: dataset.marketIndicators || []
  };
  return Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, countProvenance(rows)]));
}

function countProvenance(rows = []) {
  const counts = {
    official_rome_api: 0,
    generated_rome: 0,
    sample_non_official: 0,
    curated_estimated: 0,
    unknown: 0
  };
  rows.forEach(row => {
    const source = row?.source || row?.officialStatus || "";
    const provenance = row?.provenance || "";
    const value = source || provenance || "unknown";
    if (source === "official_rome_api") counts.official_rome_api += 1;
    else if (provenance === "generated_rome" || value === "generated_rome") counts.generated_rome += 1;
    else if (String(value).includes("sample")) counts.sample_non_official += 1;
    else if (String(value).includes("curated") || String(value).includes("estimated")) counts.curated_estimated += 1;
    else counts.unknown += 1;
  });
  return counts;
}

function ratio(part, total) {
  return total ? Number((part / total).toFixed(2)) : 0;
}

function average(values) {
  const clean = values.filter(value => typeof value === "number" && Number.isFinite(value));
  return clean.length ? Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(2)) : 0;
}

function getRepresentedRomeDomains(jobs) {
  return [...new Set(jobs.map(job => String(job.romeCode || "").charAt(0)).filter(Boolean))].sort();
}

function findMissingRomeDomains(jobs) {
  const expected = ["A", "D", "E", "F", "G", "H", "I", "J", "K", "M", "N"];
  const represented = new Set(getRepresentedRomeDomains(jobs));
  return expected.filter(domain => !represented.has(domain));
}

function stableId(value) {
  return String(value || "item")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "item";
}
