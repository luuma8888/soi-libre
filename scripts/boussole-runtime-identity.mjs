import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_BUNDLE_REVISION = "rome500-runtime-v0.7.6-r1";
export const APP_BUILD = Object.freeze({
  appVersion: "v0.7.6-alpha",
  buildId: "20260802-runtime-parity-01",
  buildDate: "2026-08-02"
});

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations", "boussolepro");
const ROME_DIR = path.join(APP_DIR, "data", "generated", "rome500-experimental");
const MARKET_DIR = path.join(APP_DIR, "data", "generated", "market");
const LOCAL_DIR = path.join(APP_DIR, "data", "local");

export const RUNTIME_COMPONENTS = Object.freeze([
  ["manifest", "rome", "import-manifest.rome.json", "object", true],
  ["jobs", "rome", "jobs.rome.json", "array", true],
  ["skills", "rome", "skills.rome.json", "array", true],
  ["skillsEngine", "rome", "skills-engine.rome.json", "array", true],
  ["skillIntegrityReport", "rome", "skill-reference-integrity-report.json", "object", true],
  ["matchableSkills", "rome", "skills-matchable.rome.json", "array", true],
  ["knowledge", "rome", "knowledge.rome.json", "array", true],
  ["certificationLike", "rome", "certification-like.rome.json", "array", true],
  ["workContexts", "rome", "work-contexts.rome.json", "array", true],
  ["jobAppellations", "rome", "job-appellations.rome.json", "array", true],
  ["mappings", "rome", "mappings.rome.json", "array", true],
  ["qualityReport", "rome", "data-quality-report.rome.json", "object", true],
  ["accessSummary", "rome", "access-summary.rome500.json", "array", true],
  ["accessSummaryQualityReport", "rome", "access-summary-quality-report.json", "object", true],
  ["officialConstraintSummary", "rome", "official-constraint-summary.rome500.json", "array", true],
  ["skillConceptImpactReport", "rome", "skill-concept-impact-report.json", "object", false],
  ["trainings", "rome", "formations.onisep.json", "array", false],
  ["certifications", "rome", "certifications.certifinfo.json", "array", false],
  ["mappingsRomeFormations", "rome", "mappings-rome-formations.json", "array", false],
  ["mappingsRomeCertifications", "rome", "mappings-rome-certifications.json", "array", false],
  ["marketManifest", "market", "market-import-manifest.json", "object", true],
  ["marketQualityReport", "market", "market-quality-report.json", "object", true],
  ["marketNational", "market", "market-national.rome.json", "array", true],
  ["marketOccitanie", "market", "market-occitanie.rome.json", "array", true],
  ["marketAude", "market", "market-aude.rome.json", "array", true],
  ["bmoFap2021", "market", "bmo-fap2021.json", "array", false],
  ["fapRomeMappings", "market", "fap-rome-mappings.json", "array", false],
  ["accessRules", "local", "access-rules-v074.json", "object", true],
  ["sectorRules", "local", "rome-sector-mapping-v2.json", "object", true]
]);

export async function buildRuntimeBundleManifest(options = {}) {
  const derivedAt = options.derivedAt || new Date().toISOString();
  const components = [];
  for (const [role, area, fileName, kind, required] of RUNTIME_COMPONENTS) {
    const baseDir = area === "rome" ? ROME_DIR : area === "market" ? MARKET_DIR : LOCAL_DIR;
    const filePath = path.join(baseDir, fileName);
    let buffer;
    try {
      buffer = await readFile(filePath);
    } catch (error) {
      if (required) throw new Error(`Composant runtime requis absent : ${path.relative(ROOT, filePath)}`);
      continue;
    }
    const parsed = JSON.parse(buffer);
    const count = kind === "array" ? parsed.length : 1;
    components.push({
      role,
      area,
      fileName,
      relativePath: path.relative(APP_DIR, filePath).replaceAll(path.sep, "/"),
      required,
      count,
      size: buffer.length,
      sha256: sha256(buffer),
      sourceGeneratedAt: sourceDateOf(parsed)
    });
  }

  const sourceManifest = JSON.parse(await readFile(path.join(ROME_DIR, "import-manifest.rome.json"), "utf8"));
  const accessRules = JSON.parse(await readFile(path.join(LOCAL_DIR, "access-rules-v074.json"), "utf8"));
  const sectorRules = JSON.parse(await readFile(path.join(LOCAL_DIR, "rome-sector-mapping-v2.json"), "utf8"));
  const accessQuality = JSON.parse(await readFile(path.join(ROME_DIR, "access-summary-quality-report.json"), "utf8"));
  const identityMaterial = components
    .map(component => `${component.area}/${component.fileName}:${component.sha256}:${component.count}`)
    .sort()
    .join("\n");
  const fingerprintSha256 = sha256(identityMaterial);
  const manifest = {
    schemaVersion: "2.0.0",
    manifestKind: "boussole_runtime_bundle_identity",
    derivedAt,
    inputMode: "packaged_corpus",
    runtimeBundleRevision: RUNTIME_BUNDLE_REVISION,
    fingerprintAlgorithm: "sha256_of_sorted_component_hashes_and_counts",
    fingerprintSha256,
    appBuild: APP_BUILD,
    datasetIdentity: {
      publicLabel: "Corpus ROME 500 candidat consolide",
      sourceDatasetVersion: sourceManifest.datasetVersion || "rome500-candidate-v0.7",
      sourceDatasetAliases: sourceManifest.datasetVersionAliases || ["rome500-experimental-v0.7"],
      corpusMaturity: "candidate_consolidated",
      validationScope: "validated_for_boussole_pro_v0_7",
      historicalStoragePath: "data/generated/rome500-experimental",
      historicalPathIsMaturitySignal: false
    },
    ruleVersions: {
      access: accessRules.version || null,
      sectors: sectorRules.version || null,
      scoring: APP_BUILD.appVersion
    },
    counts: Object.fromEntries(components.map(component => [component.role, component.count])),
    componentRoles: {
      skills: "filtered_reference_and_display",
      skillsEngine: "active_scoring_reference",
      matchableSkills: "profile_selection_reference"
    },
    components,
    coherence: buildCoherence({ components, accessQuality, accessRules }),
    verifiedScope: [
      "500 packaged jobs",
      "active scoring referentials",
      "access and sector rules",
      "packaged market rows",
      "local deterministic test bench"
    ],
    notVerifiedScope: ["real_import_user_environment", "interactive_user_performance"]
  };
  manifest.status = manifest.coherence.failures.length ? "incoherent_runtime_bundle" : "coherent";
  return manifest;
}

export async function writeRuntimeBundleManifest(outputPath = path.join(ROME_DIR, "runtime-bundle-manifest.json")) {
  const manifest = await buildRuntimeBundleManifest();
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSha256(value) {
  return sha256(canonicalJson(value));
}

function buildCoherence({ components, accessQuality, accessRules }) {
  const counts = Object.fromEntries(components.map(component => [component.role, component.count]));
  const failures = [];
  if (counts.jobs !== 500) failures.push(`jobs_count_${counts.jobs}`);
  if (!counts.skillsEngine) failures.push("skills_engine_missing");
  if (counts.accessSummary !== counts.jobs) failures.push("access_summary_count_mismatch");
  if (accessQuality.rulesVersion !== accessRules.version) failures.push("access_rules_version_mismatch");
  if (accessQuality.summary?.jobsCount !== counts.jobs) failures.push("access_quality_jobs_count_mismatch");
  if (Date.parse(accessQuality.generatedAt || 0) < Date.parse(accessQuality.accessSummaryGeneratedAt || 0)) failures.push("access_quality_older_than_summary");
  return {
    status: failures.length ? "incoherent_runtime_bundle" : "coherent",
    failures,
    accessSummaryGeneratedAt: accessQuality.accessSummaryGeneratedAt || null,
    accessQualityGeneratedAt: accessQuality.generatedAt || null,
    accessRulesVersion: accessQuality.rulesVersion || null
  };
}

function sourceDateOf(value) {
  if (Array.isArray(value)) return null;
  return value.sourceGeneratedAt || value.generatedAt || value.sourceDate || value.sourceVintage || value.sync?.generatedAt || null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const manifest = await writeRuntimeBundleManifest();
  console.log(`[Boussole Pro] Paquet runtime ${manifest.runtimeBundleRevision}: ${manifest.fingerprintSha256}, statut ${manifest.status}.`);
}
