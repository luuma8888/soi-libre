import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSkillsEngine } from "./prepare-v070-local.mjs";
import { buildAccessQualityReport, buildAccessSummary, buildOfficialConstraintSummary, buildOfficialContextConstraintMapping } from "./prepare-v071-local.mjs";

const ROOT = process.cwd();
const TARGET_SUBDIR = process.env.ROME_CANDIDATE_SUBDIR || "rome800-candidate";
const DATASET_VERSION = process.env.ROME_CANDIDATE_VERSION || "rome800-candidate-v0.1";
const TARGET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", TARGET_SUBDIR);
const BASE_SUBDIR = process.env.ROME_CANDIDATE_BASE_SUBDIR || "rome500-experimental";
const BASE_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", BASE_SUBDIR);
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");

async function main() {
  const [jobs, mappings, rawSkills, filteredSkills, contexts, accessRulesDocument, baseAccessSummary, baseConstraintSummary] = await Promise.all([
    readTarget("jobs.rome.json", []), readTarget("mappings.rome.json", []), readTarget("rome-raw-skills.json", []),
    readTarget("skills.rome.json", []), readTarget("work-contexts.rome.json", []),
    readJson(path.join(LOCAL_DIR, "access-rules-v074.json"), { rules: {}, verifiedAt: null }),
    readJson(path.join(BASE_DIR, "access-summary.rome500.json"), []),
    readJson(path.join(BASE_DIR, "official-constraint-summary.rome500.json"), [])
  ]);
  if (!jobs.length) throw new Error(`Aucun métier à dériver dans ${TARGET_SUBDIR}.`);
  const { skillsEngine, integrityReport } = buildSkillsEngine({ jobs, mappings, rawSkills, filteredSkills }, DATASET_VERSION);
  const generatedAt = new Date().toISOString();
  const baseAccessByCode = new Map(baseAccessSummary.map(row => [row.romeCode, row]));
  const baseConstraintByCode = new Map(baseConstraintSummary.map(row => [row.romeCode, row]));
  const accessSummary = jobs.map(job => baseAccessByCode.get(job.romeCode) || buildAccessSummary(job, accessRulesDocument.rules?.[job.romeCode], { generatedAt, verifiedAt: accessRulesDocument.verifiedAt }));
  const contextMapping = buildOfficialContextConstraintMapping(contexts);
  const officialConstraintSummary = jobs.map(job => baseConstraintByCode.get(job.romeCode) || buildOfficialConstraintSummary(job, contextMapping));
  const accessQuality = buildAccessQualityReport(accessSummary, jobs, accessRulesDocument, generatedAt);
  Object.assign(accessQuality, {
    datasetVersion: DATASET_VERSION,
    buildId: process.env.RUNTIME_BUILD_ID || "20260810-rome800-market-continuity-01",
    identityScope: "runtime_bundle_component",
    status: accessSummary.length === jobs.length && !accessQuality.truthFailures.length ? "complete" : "incomplete"
  });
  const qualityReport = await readTarget("data-quality-report.rome.json", {});
  qualityReport.summary = { ...(qualityReport.summary || {}), jobsWithAccessSummary: accessSummary.length };
  qualityReport.provenanceDistribution = {
    ...(qualityReport.provenanceDistribution || {}),
    mappings: { generated_rome: mappings.length, unknown: 0 }
  };
  qualityReport.accessCatalogExplanation = { note: "Synthèses prudentes dérivées des textes officiels et des règles locales sourcées ; le texte source reste prioritaire." };
  await Promise.all([
    writeTarget("skills-engine.rome.json", skillsEngine),
    writeTarget("skill-reference-integrity-report.json", integrityReport),
    writeTarget("access-summary.rome800.json", accessSummary),
    writeTarget("access-summary-quality-report.json", accessQuality),
    writeTarget("official-constraint-summary.rome800.json", officialConstraintSummary),
    writeTarget("data-quality-report.rome.json", qualityReport)
  ]);
  console.log(`[Boussole Pro] Dérivés ${DATASET_VERSION}: ${skillsEngine.length} compétences moteur, ${baseAccessByCode.size} accès historiques conservés, ${accessSummary.length - baseAccessByCode.size} accès ajoutés.`);
}

async function readTarget(name, fallback) { return readJson(path.join(TARGET_DIR, name), fallback); }
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; } }
async function writeTarget(name, value) { await writeFile(path.join(TARGET_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

main().catch(error => { console.error(error); process.exit(1); });
