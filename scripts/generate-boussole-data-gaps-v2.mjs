import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RUNTIME_DIR = path.join(ROOT, "creations/boussolepro/boussole-runtime");
const OUTPUT = path.join(ROOT, "reports/boussole-data-gaps-v2.json");
const [core, manifest] = await Promise.all([
  readFile(path.join(RUNTIME_DIR, "boussole-core.json"), "utf8").then(JSON.parse),
  readFile(path.join(RUNTIME_DIR, "boussole-runtime-manifest.json"), "utf8").then(JSON.parse)
]);

const allowedValuesByType = {
  schedule: ["present_characteristic", "not_characteristic_in_rome", "explicit_requirement_unknown", "insufficient_for_exclusion", "confirmed_structural_incompatibility"],
  physical: ["present_characteristic", "not_characteristic_in_rome", "explicit_requirement_unknown", "insufficient_for_exclusion", "confirmed_structural_incompatibility"],
  environment: ["present_characteristic", "not_characteristic_in_rome", "explicit_requirement_unknown", "insufficient_for_exclusion", "confirmed_structural_incompatibility"],
  mobility: ["required", "not_required", "possible", "unknown"],
  access: ["required", "recommended", "alternative", "not_required", "unknown", "conflicting"],
  audience: ["essential", "dominant", "possible", "absent", "unknown"],
  frequency: ["systematic", "frequent", "possible", "not_characteristic", "unknown"],
  obligation: ["mandatory", "recommended", "possible", "not_mandatory", "unknown"],
  provenance: ["official_direct", "curated_documented", "technical_inference", "unknown"]
};

const item = ({ field, informationType, reason, currentEvidence, neededEvidence, sourcesChecked, impact, researchPriority, allowedValuesType }) => ({
  field, informationType, reason, currentEvidence, neededEvidence, sourcesChecked, impact, researchPriority,
  allowedValuesRef: `general.allowedValuesByType.${allowedValuesType}`
});

const jobs = (core.jobs || []).map(job => {
  const actualUnknowns = [];
  const exclusionResearch = [];
  const access = job.accessSummary || {};
  const constraints = job.constraints || {};
  if (!access.requirementKind || access.requirementKind === "unknown" || access.contradictoryEvidence) actualUnknowns.push(item({
    field: "accessSummary.requirementKind", informationType: "access", reason: access.contradictoryEvidence ? "Les preuves d’accès sont contradictoires." : "La voie d’accès explicite n’est pas résolue.",
    currentEvidence: access, neededEvidence: "Une source officielle précisant obligation, recommandation ou voies alternatives.", sourcesChecked: ["ROME", "runtime compact"], impact: "feasibility", researchPriority: access.contradictoryEvidence ? "high" : "medium", allowedValuesType: "access"
  }));
  if (access.regulated && !(job.requiredQualificationIds || []).length && !(access.requiredExams || []).length) exclusionResearch.push(item({
    field: "accessSummary.regulatedRequirements", informationType: "certification_obligatoire", reason: "Le métier est signalé réglementé sans exigence canonique résolue.",
    currentEvidence: { regulated: true }, neededEvidence: "Le texte réglementaire et la qualification ou le concours obligatoire.", sourcesChecked: ["ROME", "catalogue des qualifications"], impact: "exclusion", researchPriority: "high", allowedValuesType: "obligation"
  }));
  if (!constraints.remoteCompatibility || constraints.remoteCompatibility === "unknown") actualUnknowns.push(item({
    field: "constraints.remoteCompatibility", informationType: "teletravail", reason: "L’absence d’un contexte ROME ne permet pas de garantir la possibilité de télétravail.",
    currentEvidence: "explicit_requirement_unknown", neededEvidence: "Une source métier ou des offres décrivant explicitement la possibilité selon les postes.", sourcesChecked: ["ROME"], impact: "confidence", researchPriority: "low", allowedValuesType: "environment"
  }));
  for (const signal of job.audienceSignals || []) if (signal.id === "petite_enfance" && ["possible", "unknown"].includes(signal.centrality)) exclusionResearch.push(item({
    field: "audienceSignals.petite_enfance", informationType: "public_indispensable", reason: "La petite enfance peut être concernée sans être démontrée comme public systématique.",
    currentEvidence: signal, neededEvidence: "Une source officielle établissant le caractère indispensable et systématique du public 0–3 ans.", sourcesChecked: ["ROME", "taxonomie d’audience"], impact: "exclusion", researchPriority: "medium", allowedValuesType: "audience"
  }));
  return { jobId: job.id, romeCode: job.romeCode, title: job.title, actualUnknowns, exclusionResearch };
}).filter(job => job.actualUnknowns.length || job.exclusionResearch.length);

const report = {
  schemaVersion: "2.0.0", generatedAt: process.env.BOUSSOLE_REPORT_GENERATED_AT || new Date().toISOString(),
  datasetVersions: { runtime: manifest.datasetVersion, resourceSchema: manifest.resourceSchemaVersion },
  general: {
    fieldStates: Object.fromEntries(allowedValuesByType.schedule.map(value => [value, value])),
    informationTypes: { horaires: "schedule", nuit_weekend: "schedule", port_charge_station_debout: "physical", bruit_exterieur: "environment", deplacements: "mobility", contact_public: "environment", teletravail: "environment", permis: "mobility", certifications_obligatoires: "access", niveau_voie_acces: "access", public_indispensable: "audience", frequence: "frequency", caractere_obligatoire: "obligation", provenance: "provenance" },
    allowedValuesByType, researchPriorityValues: ["none", "low", "medium", "high"]
  },
  summary: {
    jobsInRuntime: core.jobs.length, jobsWithActualUnknowns: jobs.filter(job => job.actualUnknowns.length).length,
    jobsWithExclusionResearch: jobs.filter(job => job.exclusionResearch.length).length,
    actualUnknowns: jobs.reduce((sum, job) => sum + job.actualUnknowns.length, 0), exclusionResearch: jobs.reduce((sum, job) => sum + job.exclusionResearch.length, 0),
    omittedSparseRomeAbsences: true
  },
  jobs
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "passed", output: path.relative(ROOT, OUTPUT), summary: report.summary }, null, 2));
