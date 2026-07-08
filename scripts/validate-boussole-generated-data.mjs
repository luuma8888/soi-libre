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
const REQUIRED_FIELDS = ["id", "romeCode", "title", "description", "sourceRefs"];

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

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
