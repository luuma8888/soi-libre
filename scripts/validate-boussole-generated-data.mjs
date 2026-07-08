import { readFile } from "node:fs/promises";

const JOBS_PATH = "creations/boussolepro/data/generated/jobs.rome.json";
const REPORT_PATH = "creations/boussolepro/data/generated/data-quality-report.rome.json";
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
  console.log(`Validation OK : ${jobs.length} metier(s) ROME, rapport ${report.status || "sans statut"}.`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Impossible de lire ${path}: ${error.message}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
