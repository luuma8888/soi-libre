export function buildDataQualityReport(dataset = {}) {
  const jobs = dataset.jobs || [];
  const skills = dataset.skills || [];
  const workContexts = dataset.workContexts || [];
  const issues = [];
  const warnings = [];
  const ids = new Set();
  jobs.forEach(job => {
    if (!job.id) issues.push(issue("blocking", "missing_job_id", "Metier sans identifiant."));
    if (ids.has(job.id)) issues.push(issue("blocking", "duplicate_job_id", `Doublon metier: ${job.id}.`));
    ids.add(job.id);
    if (!job.title) issues.push(issue("blocking", "missing_title", `Metier sans titre: ${job.id || "inconnu"}.`));
    if (!job.romeCode) warnings.push(issue("warning", "missing_rome_code", `${job.title || job.id} sans code ROME.`));
    if (!job.sourceRefs?.length) warnings.push(issue("warning", "missing_source", `${job.title || job.id} sans source.`));
  });
  return {
    schemaVersion: "1.0.0",
    reportId: `quality-${new Date().toISOString().slice(0, 10)}`,
    generatedAt: new Date().toISOString(),
    datasetVersion: dataset.datasetVersion || "generated",
    status: issues.some(item => item.severity === "blocking") ? "blocked" : warnings.length ? "completed_with_warnings" : "completed",
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
      jobsWithTraining: 0,
      jobsWithDiplomaLevel: ratio(jobs.filter(job => job.recommendedDiplomaLevel !== undefined).length, jobs.length),
      jobsWithMarketData: 0
    },
    issues,
    warnings,
    recommendations: [
      "Verifier les licences et droits de redistribution avant publication.",
      "Verifier les mappings ROME vers le modele canonique Boussole Pro.",
      "Ne jamais stocker FT_CLIENT_SECRET dans le front-end."
    ]
  };
}

function issue(severity, type, message) {
  return { id: `${type}-${Math.random().toString(36).slice(2, 8)}`, severity, type, message };
}

function ratio(part, total) {
  return total ? Number((part / total).toFixed(2)) : 0;
}
