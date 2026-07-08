import { readFile } from "node:fs/promises";

const JOBS_PATH = "creations/boussolepro/data/generated/jobs.rome.json";
const REPORT_PATH = "creations/boussolepro/data/generated/data-quality-report.rome.json";
const OPTIONAL_ARRAY_FILES = [
  "creations/boussolepro/data/generated/rome-raw-skills.json",
  "creations/boussolepro/data/generated/skills.rome.json",
  "creations/boussolepro/data/generated/knowledge.rome.json",
  "creations/boussolepro/data/generated/certification-like.rome.json",
  "creations/boussolepro/data/generated/skills-matchable.rome.json",
  "creations/boussolepro/data/generated/work-contexts.rome.json",
  "creations/boussolepro/data/generated/job-appellations.rome.json",
  "creations/boussolepro/data/generated/mappings.rome.json"
];
const GENERATED_SCAN_FILES = [
  JOBS_PATH,
  "creations/boussolepro/data/generated/job-appellations.rome.json",
  "creations/boussolepro/data/generated/mappings.rome.json"
];
const REQUIRED_FIELDS = ["id", "romeCode", "title", "sourceRefs"];
const PLACEHOLDER_PATTERNS = [
  /Description non fournie par la fiche ROME synchronisee/i,
  /Conditions d'acces non fournies par la fiche ROME synchronisee/i,
  /Activites a verifier/i,
  /Description absente du corpus local/i
];

async function main() {
  const jobs = await readJson(JOBS_PATH);
  if (!Array.isArray(jobs)) fail(`${JOBS_PATH} doit contenir un tableau JSON.`);
  if (!jobs.length) fail(`${JOBS_PATH} ne contient aucune fiche exploitable.`);
  const errors = [];
  jobs.forEach((job, index) => {
    REQUIRED_FIELDS.forEach(field => {
      const value = job[field];
      if (Array.isArray(value) ? value.length === 0 : !value) {
        errors.push(`jobs[${index}] ${job.romeCode || job.id || ""} : champ requis absent ${field}`);
      }
    });
    if (job.romeCode && job.id !== `rome-${job.romeCode}`) {
      errors.push(`jobs[${index}] ${job.romeCode || job.id || ""} : id attendu rome-${job.romeCode}, obtenu ${job.id}`);
    }
    if (typeof job.description === "string" && PLACEHOLDER_PATTERNS.some(pattern => pattern.test(job.description))) {
      errors.push(`jobs[${index}] ${job.romeCode || job.id || ""} : description placeholder a remplacer par null`);
    }
    if (typeof job.accessConditions?.text === "string" && PLACEHOLDER_PATTERNS.some(pattern => pattern.test(job.accessConditions.text))) {
      errors.push(`jobs[${index}] ${job.romeCode || job.id || ""} : conditions d'acces placeholder a remplacer par null`);
    }
  });
  if (errors.length) fail(errors.slice(0, 20).join("\n"));
  const report = await readJson(REPORT_PATH);
  if (!report || typeof report !== "object") fail(`${REPORT_PATH} doit contenir un objet JSON.`);
  if (!report.generatedAt) fail("Rapport qualite sans generatedAt.");
  if (!report.summary || typeof report.summary.jobs !== "number") fail("Rapport qualite sans summary.jobs.");
  for (const path of OPTIONAL_ARRAY_FILES) {
    const value = await readOptionalJson(path);
    if (value !== null && !Array.isArray(value)) fail(`${path} doit contenir un tableau JSON.`);
  }
  const matchable = await readOptionalJson("creations/boussolepro/data/generated/skills-matchable.rome.json");
  if (Array.isArray(matchable) && matchable.length > 900) fail(`skills-matchable.rome.json contient ${matchable.length} entrees, limite attendue : 900.`);
  const knownJobIds = new Set(jobs.map(job => job.id));
  const mappings = await readOptionalJson("creations/boussolepro/data/generated/mappings.rome.json");
  if (Array.isArray(mappings)) {
    const badMapping = mappings.find(item => item.jobId && !knownJobIds.has(item.jobId));
    if (badMapping) fail(`mappings.rome.json contient un jobId inconnu ou non canonique : ${badMapping.jobId}`);
  }
  const appellations = await readOptionalJson("creations/boussolepro/data/generated/job-appellations.rome.json");
  if (Array.isArray(appellations)) {
    const badAppellation = appellations.find(item => item.jobId && !knownJobIds.has(item.jobId));
    if (badAppellation) fail(`job-appellations.rome.json contient un jobId inconnu ou non canonique : ${badAppellation.jobId}`);
  }
  for (const path of GENERATED_SCAN_FILES) {
    const text = await readOptionalText(path);
    if (!text) continue;
    if (/job-rome-[A-Z][0-9]{4}/.test(text)) fail(`${path} contient encore l'ancien prefixe job-rome-.`);
    const placeholder = PLACEHOLDER_PATTERNS.find(pattern => pattern.test(text));
    if (placeholder) fail(`${path} contient encore un placeholder trompeur : ${placeholder}`);
  }
  console.log(`Validation OK : ${jobs.length} metier(s) ROME, rapport ${report.status || "sans statut"}.`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Impossible de lire ${path}: ${error.message}`);
  }
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`Impossible de lire ${path}: ${error.message}`);
  }
}

async function readOptionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`Impossible de lire ${path}: ${error.message}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
