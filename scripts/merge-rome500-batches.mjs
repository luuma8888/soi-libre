import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRome500AuditArtifacts } from "./audit-rome-500-generated.mjs";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";

const GENERATED_DIR = path.join("creations", "boussolepro", "data", "generated");
const EXPERIMENTAL_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const BATCHES_DIR = path.join(EXPERIMENTAL_DIR, "batches");
const DATASET_VERSION = "rome500-experimental-v0.7";

async function main() {
  await mkdir(EXPERIMENTAL_DIR, { recursive: true });
  const batchFiles = await readdir(BATCHES_DIR).catch(() => []);
  const jobs = uniqueBy(await readBatchRows(batchFiles, /^jobs\.batch-\d+\.json$/), "id");
  const mappings = uniqueBy(await readBatchRows(batchFiles, /^mappings\.batch-\d+\.json$/), "jobId");
  const jobAppellations = uniqueBy(await readBatchRows(batchFiles, /^appellations\.batch-\d+\.json$/), "id");
  const batchReports = await readBatchRows(batchFiles, /^report\.batch-\d+\.json$/);

  if (!jobs.length) {
    throw new Error("Fusion ROME500 impossible : aucun fichier batches/jobs.batch-XX.json exploitable.");
  }

  const dataset = {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - corpus ROME 500 expérimental",
    datasetVersion: DATASET_VERSION,
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    provenance: "generated_rome_experimental",
    jobs,
    mappings,
    jobAppellations,
    rawSkills: await readJson(path.join(EXPERIMENTAL_DIR, "rome-raw-skills.json"), []),
    skills: await readJson(path.join(EXPERIMENTAL_DIR, "skills.rome.json"), []),
    matchableSkills: await readJson(path.join(EXPERIMENTAL_DIR, "skills-matchable.rome.json"), []),
    knowledge: await readJson(path.join(EXPERIMENTAL_DIR, "knowledge.rome.json"), []),
    certificationLike: await readJson(path.join(EXPERIMENTAL_DIR, "certification-like.rome.json"), []),
    workContexts: await readJson(path.join(EXPERIMENTAL_DIR, "work-contexts.rome.json"), []),
    trainings: [],
    certifications: [],
    marketIndicators: [],
    sources: [{
      id: "france_travail_rome500_experimental",
      name: "France Travail ROME 4.0 via GitHub Actions - corpus 500 expérimental",
      provenance: "generated_rome_experimental",
      accessMode: "github-actions-generated"
    }]
  };

  const successfulCodes = unique(jobs.map(job => job.romeCode).filter(Boolean));
  const requestedCodes = unique(batchReports.flatMap(report => report.codeSelection?.source === "ROME_CODES_FILE"
    ? []
    : report.successfulCodes || []
  ).concat(successfulCodes));
  const failedCodes = unique(batchReports.flatMap(report => report.failedCodes || []));
  const qualityReport = buildDataQualityReport(dataset, {
    generatedAt: new Date().toISOString(),
    branch: process.env.GITHUB_REF_NAME || "local",
    requestedCodes: requestedCodes.length ? requestedCodes : successfulCodes,
    successfulCodes,
    failedCodes,
    failures: failedCodes,
    optionalReferentials: [],
    datasetVersion: DATASET_VERSION
  });
  qualityReport.experimental500 = buildExperimental500Thresholds(dataset, qualityReport, batchReports);

  await writeJson(path.join(EXPERIMENTAL_DIR, "jobs.rome.json"), dataset.jobs);
  await writeJson(path.join(EXPERIMENTAL_DIR, "mappings.rome.json"), dataset.mappings);
  await writeJson(path.join(EXPERIMENTAL_DIR, "job-appellations.rome.json"), dataset.jobAppellations);
  await writeJson(path.join(EXPERIMENTAL_DIR, "data-quality-report.rome.json"), qualityReport);
  await writeJson(path.join(EXPERIMENTAL_DIR, "import-manifest.rome.json"), {
    schemaVersion: "1.0.0",
    datasetName: dataset.datasetName,
    datasetVersion: DATASET_VERSION,
    importedAt: dataset.importedAt,
    provenance: "generated_rome_experimental",
    jobsCount: jobs.length,
    mappingsCount: mappings.length,
    appellationsCount: jobAppellations.length,
    batchReportsCount: batchReports.length,
    promotionStatus: qualityReport.experimental500.promotable ? "candidate" : "experimental_only",
    warning: "Ce corpus ROME 500 ne remplace pas automatiquement le corpus ROME 72 de référence."
  });

  const audit = await buildRome500AuditArtifacts({ generatedDir: EXPERIMENTAL_DIR });
  console.log(`[Boussole Pro] Fusion ROME500: ${jobs.length} métiers, ${mappings.length} mappings, statut ${qualityReport.experimental500.promotable ? "candidate" : "experimental_only"}.`);
  console.log(`[Boussole Pro] Audit ROME500: score matching ${Math.round((audit.quality?.matchingReadiness?.score || 0) * 100)}%.`);
}

async function readBatchRows(batchFiles, pattern) {
  const files = batchFiles.filter(file => pattern.test(file)).sort();
  const rows = await Promise.all(files.map(file => readJson(path.join(BATCHES_DIR, file), [])));
  return rows.flatMap(row => Array.isArray(row) ? row : [row]).filter(Boolean);
}

function buildExperimental500Thresholds(dataset, qualityReport, batchReports) {
  const jobs = dataset.jobs || [];
  const coverage = qualityReport.coverage || {};
  const thresholds = {
    skills: ratio(coverage.jobsWithSkillsCount, jobs.length),
    primarySector: ratio(jobs.filter(job => job.primarySectorId).length, jobs.length),
    description: ratio(coverage.jobsWithOfficialDescriptionCount, jobs.length),
    appellations: ratio(coverage.jobsWithAppellationsCount, jobs.length),
    accessConditions: ratio(jobs.filter(job => job.accessConditions?.text).length, jobs.length),
    contexts: ratio(coverage.jobsWithContextsCount, jobs.length),
    shellJobs: ratio((qualityReport.missingMapping || []).filter(item => item.missingSkills).length, jobs.length)
  };
  const promotable = thresholds.skills >= 0.98 &&
    thresholds.primarySector >= 0.98 &&
    thresholds.description >= 0.9 &&
    thresholds.appellations >= 0.9 &&
    thresholds.accessConditions >= 0.85 &&
    thresholds.contexts >= 0.8 &&
    thresholds.shellJobs <= 0.05;
  return {
    status: promotable ? "candidate_after_regression_tests" : "experimental_only",
    promotable,
    thresholds,
    batchReports: batchReports.map(report => ({
      batchLabel: report.batchLabel,
      jobsCount: report.jobsCount,
      successfulCodesCount: report.successfulCodesCount,
      failedCodesCount: report.failedCodesCount
    })),
    warnings: promotable
      ? ["Relancer les profils de regression avant toute promotion."]
      : ["Seuils de couverture non atteints : conserver le corpus 500 en expérimental."]
  };
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

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = typeof key === "function" ? key(item) : item?.[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function ratio(part, total) {
  return total ? Number((part / total).toFixed(2)) : 0;
}

await main();
