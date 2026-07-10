import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATASET_PATH = resolve(ROOT, "creations/boussolepro/data/curated/clairmetier-curated-v0.4.json");
const OUT_PATH = resolve(ROOT, "creations/boussolepro/data/generated/exploration-filter-coverage-report.json");

const CONTEXT_FILTERS = {
  office: ["ctx-office"],
  quiet: ["ctx-quiet"],
  outdoor: ["ctx-outdoor"],
  home: ["ctx-home-care"],
  children: ["ctx-children"],
  animals: ["ctx-animal"],
  team: ["ctx-team"],
  remote: ["ctx-remote"]
};

async function main() {
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  const jobs = dataset.jobs || [];
  const contextIds = new Set((dataset.workContexts || []).map(item => item.id));
  const usedContexts = new Set(jobs.flatMap(job => job.workContexts || []));
  const coveredContextIds = new Set(Object.values(CONTEXT_FILTERS).flat());
  const unmappedUsedContexts = [...usedContexts].filter(id => contextIds.has(id) && !coveredContextIds.has(id));
  const emptyFilterOptions = Object.entries(CONTEXT_FILTERS)
    .filter(([, ids]) => !jobs.some(job => ids.some(id => (job.workContexts || []).includes(id))))
    .map(([id]) => id);
  const jobsWithoutAccessLevel = jobs.filter(job => job.requiredDiplomaLevel == null && job.recommendedDiplomaLevel == null).map(summary);
  const jobsWithoutMarket = jobs.filter(job => !job.market && !(job.marketIndicators || []).length).map(summary);
  const jobsWithoutRome = jobs.filter(job => !job.romeCode).map(summary);
  const jobsWithoutContext = jobs.filter(job => !(job.workContexts || []).length).map(summary);

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    datasetVersion: dataset.datasetVersion,
    jobsCount: jobs.length,
    filters: {
      domains: [...new Set(jobs.map(job => job.domain).filter(Boolean))].length,
      diplomaAccess: ["all", "quick", "0_3", "4", "5_plus"],
      constraints: ["low_physical", "no_night", "no_weekend", "no_driver_license", "remote"],
      contexts: Object.keys(CONTEXT_FILTERS),
      market: ["high", "medium", "low"],
      territory: ["FR", "REG-76", "DEP-11"]
    },
    unmappedUsedContexts,
    emptyFilterOptions,
    jobsWithoutAccessLevel,
    jobsWithoutMarket,
    jobsWithoutRome,
    jobsWithoutContext,
    status: jobsWithoutContext.length || jobsWithoutMarket.length ? "completed_with_warnings" : "ok",
    recommendations: [
      "Générer les filtres de contexte depuis les contextes réellement utilisés par le corpus.",
      "Conserver un libellé ROME/localVariant pour les métiers locaux.",
      "Ne pas afficher les indicateurs marché comme données France Travail tant que Data Emploi/BMO ne sont pas branchés."
    ]
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Audit Exploration: ${report.status}, rapport ${relative(OUT_PATH)}`);
}

function summary(job) {
  return { id: job.id, title: job.title, romeCode: job.romeCode || null, domain: job.domain };
}

function relative(path) {
  return path.replace(`${ROOT}/`, "");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
