const REQUIRED_JOB_FIELDS = ["id", "romeCode", "title", "description", "sourceRefs"];
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
  const completionScore = jobCompleteness.length ? Number((jobCompleteness.reduce((sum, value) => sum + value, 0) / jobCompleteness.length).toFixed(2)) : 0;
  const completionRate = requestedCodes.length ? Number((successfulCodes.length / requestedCodes.length).toFixed(2)) : ratio(jobs.length, jobs.length);
  const missingDomains = findMissingRomeDomains(jobs);
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
    summary: {
      jobs: jobs.length,
      appellations: (dataset.jobAppellations || []).length,
      skills: skills.length,
      workContexts: workContexts.length,
      trainings: (dataset.trainings || []).length,
      certifications: (dataset.certifications || []).length,
      mappings: (dataset.mappings || []).length,
      marketIndicators: (dataset.marketIndicators || []).length
    },
    coverage: {
      jobsWithSkills: ratio(jobs.filter(job => job.requiredSkills?.length).length, jobs.length),
      jobsWithContexts: ratio(jobs.filter(job => job.workContexts?.length).length, jobs.length),
      jobsWithActivities: ratio(jobs.filter(job => job.activities?.length).length, jobs.length),
      jobsWithAppellations: ratio(jobs.filter(job => job.appellations?.length).length, jobs.length),
      jobsWithRelatedJobs: ratio(jobs.filter(job => job.relatedJobs?.length).length, jobs.length),
      jobsWithDiplomaLevel: ratio(jobs.filter(job => job.recommendedDiplomaLevel !== null && job.recommendedDiplomaLevel !== undefined).length, jobs.length),
      jobsWithMarketData: ratio(jobs.filter(job => job.market?.source && job.market.source !== "unknown").length, jobs.length)
    },
    completenessScore: completionScore,
    topMissingFields: [...missingFieldCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([field, count]) => ({ field, count, ratio: ratio(count, jobs.length) })),
    issues,
    warnings,
    recommendations: [
      "Ce corpus ROME genere est utilisable pour tester la chaine officielle, mais reste partiel tant que peu de codes sont synchronises.",
      "Les tags de valeurs, envies et contraintes sont des deductions techniques : les verifier avant usage professionnel.",
      "Les donnees marche, diplomes et certifications doivent etre enrichies par des sources dediees si elles ne sont pas presentes dans ROME.",
      "Ne jamais stocker FT_CLIENT_SECRET, access_token ou bearer token dans le front-end ni dans les JSON generes."
    ]
  };
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

function ratio(part, total) {
  return total ? Number((part / total).toFixed(2)) : 0;
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
