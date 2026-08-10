import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const OUTPUT_SUBDIR = process.env.ROME_MERGE_OUTPUT_SUBDIR || "rome500-experimental";
const BASE_SUBDIR = process.env.ROME_MERGE_BASE_SUBDIR || "";
const OUTPUT_DIR = path.join(GENERATED_DIR, OUTPUT_SUBDIR);
const BASE_DIR = BASE_SUBDIR ? path.join(GENERATED_DIR, BASE_SUBDIR) : null;
const BATCHES_DIR = path.join(OUTPUT_DIR, "batches");
const EXPECTED_COUNT = Number(process.env.ROME_MERGE_EXPECTED_COUNT || 500);
const DATASET_VERSION = process.env.ROME_MERGE_DATASET_VERSION || (EXPECTED_COUNT === 800 ? "rome800-candidate-v0.1" : "rome500-candidate-v0.7");
const STRICT = String(process.env.ROME_MERGE_STRICT || "false").toLowerCase() === "true";

const COLLECTIONS = [
  ["jobs.rome.json", /^jobs\.batch-\d+\.json$/, "id"],
  ["mappings.rome.json", /^mappings\.batch-\d+\.json$/, row => row.jobId || row.romeCode],
  ["job-appellations.rome.json", /^appellations\.batch-\d+\.json$/, "id"],
  ["rome-raw-skills.json", /^rome-raw-skills\.batch-\d+\.json$/, referenceId],
  ["skills.rome.json", /^skills\.batch-\d+\.json$/, referenceId],
  ["knowledge.rome.json", /^knowledge\.batch-\d+\.json$/, referenceId],
  ["certification-like.rome.json", /^certification-like\.batch-\d+\.json$/, referenceId],
  ["skills-matchable.rome.json", /^skills-matchable\.batch-\d+\.json$/, referenceId],
  ["work-contexts.rome.json", /^work-contexts\.batch-\d+\.json$/, referenceId]
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const batchFiles = await readdir(BATCHES_DIR).catch(() => []);
  const merged = {};
  for (const [outputName, pattern, key] of COLLECTIONS) {
    const baseRows = BASE_DIR ? await readJson(path.join(BASE_DIR, outputName), []) : [];
    const batchRows = await readBatchRows(batchFiles, pattern);
    merged[outputName] = uniqueBy([...baseRows, ...batchRows], key);
  }

  const jobs = merged["jobs.rome.json"];
  const codes = unique(jobs.map(job => job.romeCode).filter(Boolean));
  const baseCodes = new Set((BASE_DIR ? await readJson(path.join(BASE_DIR, "jobs.rome.json"), []) : []).map(job => job.romeCode));
  const additionsCount = codes.filter(code => !baseCodes.has(code)).length;
  const batchReports = await readBatchRows(batchFiles, /^report\.batch-\d+\.json$/);
  const selectionDocument = await readJson(path.join(ROOT, "creations", "boussolepro", "data", "local", `rome-codes-${EXPECTED_COUNT}.json`), null);
  const selectedCodes = new Set((selectionDocument?.codes || []).map(row => typeof row === "string" ? row : row.romeCode));
  if (!jobs.length) throw new Error("Fusion ROME impossible : aucun métier de base ou de lot exploitable.");
  if (STRICT && codes.length !== EXPECTED_COUNT) throw new Error(`Fusion ROME incomplète : ${codes.length}/${EXPECTED_COUNT} codes uniques.`);

  const dataset = {
    schemaVersion: "1.0.0",
    datasetName: `Boussole Pro — corpus ROME ${EXPECTED_COUNT} candidat consolidé`,
    datasetVersion: DATASET_VERSION,
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    provenance: "generated_rome_candidate",
    jobs,
    mappings: merged["mappings.rome.json"],
    jobAppellations: merged["job-appellations.rome.json"],
    rawSkills: merged["rome-raw-skills.json"],
    skills: merged["skills.rome.json"],
    matchableSkills: merged["skills-matchable.rome.json"],
    knowledge: merged["knowledge.rome.json"],
    certificationLike: merged["certification-like.rome.json"],
    workContexts: merged["work-contexts.rome.json"],
    trainings: [], certifications: [], marketIndicators: [],
    sources: [{ id: `france_travail_rome${EXPECTED_COUNT}_candidate`, name: `France Travail ROME 4.0 — corpus ${EXPECTED_COUNT} candidat`, provenance: "generated_rome_candidate", accessMode: "github-actions-generated" }]
  };
  const reportedFailedCodes = unique(batchReports.flatMap(report => (report.failedCodes || []).map(item => typeof item === "string" ? item : item.code)));
  const failedCodes = selectedCodes.size ? reportedFailedCodes.filter(code => selectedCodes.has(code)) : reportedFailedCodes;
  const qualityReport = buildDataQualityReport(dataset, {
    generatedAt: new Date().toISOString(), branch: process.env.GITHUB_REF_NAME || "local",
    requestedCodes: codes, successfulCodes: codes, failedCodes, failures: failedCodes,
    optionalReferentials: [], datasetVersion: DATASET_VERSION
  });
  qualityReport.candidateCorpus = {
    expectedCodesCount: EXPECTED_COUNT, actualCodesCount: codes.length, uniqueCodesCount: codes.length,
    baseCodesPreserved: baseCodes.size, additionsCount, batchReportsCount: batchReports.length,
    recoveredOrReplacedFailuresCount: reportedFailedCodes.length - failedCodes.length,
    status: codes.length === EXPECTED_COUNT && !failedCodes.length ? "complete" : "incomplete",
    resumable: true
  };

  await Promise.all(COLLECTIONS.map(([name]) => writeJson(path.join(OUTPUT_DIR, name), merged[name])));
  await writeJson(path.join(OUTPUT_DIR, "data-quality-report.rome.json"), qualityReport);
  await writeJson(path.join(OUTPUT_DIR, "import-manifest.rome.json"), {
    schemaVersion: "1.0.0", datasetName: dataset.datasetName, datasetVersion: DATASET_VERSION,
    importedAt: dataset.importedAt, provenance: dataset.provenance, jobsCount: jobs.length,
    mappingsCount: dataset.mappings.length, appellationsCount: dataset.jobAppellations.length,
    retainedBaseCodesCount: baseCodes.size, additionsCount, batchReportsCount: batchReports.length,
    promotionStatus: codes.length === EXPECTED_COUNT && !failedCodes.length ? "candidate" : "incomplete",
    warning: codes.length === EXPECTED_COUNT ? null : `Corpus incomplet : ${codes.length}/${EXPECTED_COUNT} codes.`
  });
  console.log(`[Boussole Pro] Fusion ROME${EXPECTED_COUNT}: ${codes.length} métiers uniques, ${baseCodes.size} conservés, ${additionsCount} ajouts.`);
}

async function readBatchRows(batchFiles, pattern) {
  const files = batchFiles.filter(file => pattern.test(file)).sort();
  const rows = await Promise.all(files.map(file => readJson(path.join(BATCHES_DIR, file), [])));
  return rows.flatMap(row => Array.isArray(row) ? row : [row]).filter(Boolean);
}

async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; } }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function referenceId(item = {}) { return item.id || item.officialId || item.rawId || item.code || item.label; }
function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => { const value = typeof key === "function" ? key(item) : item?.[key]; if (!value || seen.has(value)) return false; seen.add(value); return true; });
}
function unique(items = []) { return [...new Set(items.filter(Boolean))]; }

main().catch(error => { console.error(error); process.exit(1); });
