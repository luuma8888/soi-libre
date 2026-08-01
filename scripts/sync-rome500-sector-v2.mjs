import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const LOCAL_MAPPING_PATH = path.join(ROOT, "creations", "boussolepro", "data", "local", "rome-sector-mapping-v2.json");

const PROFILE_TO_GENERATED = {
  administratif_support: "administratif",
  numerique: "numerique",
  sante_soin: "soin_sante",
  social_insertion: "social_accompagnement",
  education_enfance: "enfance_education",
  nature_agriculture: "nature_agriculture_animaux",
  animaux: "nature_agriculture_animaux",
  batiment_construction: "artisanat_batiment_maintenance",
  maintenance: "artisanat_batiment_maintenance",
  commerce_vente: "commerce_relation_client",
  restauration_alimentation: "restauration_hotellerie_tourisme",
  hotellerie_hebergement: "restauration_hotellerie_tourisme",
  industrie_production: "industrie_qualite",
  logistique_transport: "logistique_transport_securite",
  securite_prevention: "logistique_transport_securite",
  culture_communication: "culture_communication_creation",
  recherche_analyse: "recherche_analyse",
  services_aux_collectivites: "droit_gestion_publique",
  proprete_entretien: "services_proprete"
};

const GOLDEN_SECTOR_CASES = {
  G1201: { primarySectorId: "hotellerie_hebergement", domainLabel: "Restauration, hôtellerie, tourisme et accueil", forbidden: ["education_enfance"] },
  G1202: { primarySectorId: "culture_communication", secondarySectorIds: ["education_enfance"], domainLabel: "Culture, création, loisirs et animation", forbidden: ["hotellerie_hebergement"] },
  G1203: { primarySectorId: "education_enfance", forbidden: ["hotellerie_hebergement"] },
  G1235: { primarySectorId: "education_enfance", forbidden: ["batiment_construction"] },
  G1238: { primarySectorId: "education_enfance", forbidden: ["batiment_construction"] },
  B1101: { forbidden: ["batiment_construction"] },
  B1201: { forbidden: ["batiment_construction"] },
  B1303: { forbidden: ["batiment_construction"] },
  B1401: { forbidden: ["batiment_construction"] },
  B1502: { forbidden: ["batiment_construction"] },
  B1604: { forbidden: ["batiment_construction"] },
  B1701: { forbidden: ["batiment_construction"] },
  B1803: { forbidden: ["batiment_construction"] },
  B1805: { forbidden: ["batiment_construction"] },
  B1806: { forbidden: ["batiment_construction"] },
  B1808: { forbidden: ["batiment_construction"] },
  B1816: { forbidden: ["batiment_construction"] }
};

async function main() {
  const mapping = await readJson(LOCAL_MAPPING_PATH, { exact: {} });
  const exact = mapping.exact || {};
  const jobFiles = await findJobFiles();
  const report = {
    schemaVersion: "1.0.0",
    reportKind: "sector_mapping_v2_sync",
    mappingVersion: mapping.version || "unknown",
    generatedAt: new Date().toISOString(),
    files: [],
    goldenCases: {},
    status: "ok",
    errors: []
  };

  for (const filePath of jobFiles) {
    const jobs = await readJson(filePath, []);
    let changed = 0;
    for (const job of jobs) {
      const code = normalizeRomeCode(job.romeCode);
      const entry = exact[code];
      if (!entry) continue;
      applySectorEntry(job, code, entry);
      changed += 1;
    }
    await writeJson(filePath, jobs);
    report.files.push({
      file: path.relative(ROOT, filePath),
      jobsCount: jobs.length,
      changedJobsCount: changed
    });
  }

  const rome500Jobs = await readJson(path.join(ROME500_DIR, "jobs.rome.json"), []);
  for (const [code, expected] of Object.entries(GOLDEN_SECTOR_CASES)) {
    const job = rome500Jobs.find(item => item.romeCode === code);
    const actual = {
      title: job?.title || null,
      domain: job?.domain || null,
      boussoleDomainLabel: job?.boussoleDomainLabel || null,
      primarySectorId: job?.primarySectorId || null,
      secondarySectorIds: job?.secondarySectorIds || [],
      boussoleSectorIds: job?.boussoleSectorIds || [],
      sectorEvidence: job?.sectorEvidence || []
    };
    const failures = [];
    if (!job) failures.push("missing_job");
    if (expected.domain && actual.domain !== expected.domain) failures.push("unexpected_domain");
    if (expected.domainLabel && actual.boussoleDomainLabel !== expected.domainLabel) failures.push("unexpected_boussole_domain_label");
    if (expected.primarySectorId && actual.primarySectorId !== expected.primarySectorId) failures.push("unexpected_primary_sector");
    if (expected.secondarySectorIds && expected.secondarySectorIds.some(id => !actual.secondarySectorIds.includes(id))) failures.push("missing_secondary_sector");
    if ((expected.forbidden || []).includes(actual.primarySectorId)) failures.push("forbidden_primary_sector");
    if ((expected.forbidden || []).some(id => actual.secondarySectorIds.includes(id))) failures.push("forbidden_secondary_sector");
    report.goldenCases[code] = { expected, actual, status: failures.length ? "failed" : "ok", failures };
    report.errors.push(...failures.map(failure => `${code}:${failure}`));
  }

  report.status = report.errors.length ? "failed" : "ok";
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeJson(path.join(GENERATED_DIR, "sector-mapping-v2-sync-report.json"), report);

  if (report.status !== "ok") {
    throw new Error(`[Boussole Pro] Synchronisation secteur incomplète: ${report.errors.join(", ")}`);
  }

  console.log(`[Boussole Pro] Mapping secteur v2 synchronisé sur ${jobFiles.length} fichier(s).`);
}

async function findJobFiles() {
  const files = [
    path.join(GENERATED_DIR, "jobs.rome.json"),
    path.join(ROME500_DIR, "jobs.rome.json")
  ];
  const batchesDir = path.join(ROME500_DIR, "batches");
  for (const entry of await readdir(batchesDir, { withFileTypes: true })) {
    if (entry.isFile() && /^jobs\.batch-\d+\.json$/.test(entry.name)) {
      files.push(path.join(batchesDir, entry.name));
    }
  }
  return files;
}

function applySectorEntry(job, code, entry) {
  const profileSectorIds = unique([entry.primarySectorId, ...toArray(entry.secondarySectorIds)]);
  const sourceDomain = job.sourceDomain || job.officialRomeDomain?.label || job.domain || null;
  job.primarySectorId = entry.primarySectorId;
  job.secondarySectorIds = toArray(entry.secondarySectorIds).filter(id => id && id !== entry.primarySectorId).slice(0, 2);
  job.boussoleSectorIds = unique(profileSectorIds.map(id => PROFILE_TO_GENERATED[id]).filter(Boolean));
  if (sourceDomain) {
    job.sourceDomain = sourceDomain;
    job.domain = sourceDomain;
  }
  job.sourceFamily = job.sourceFamily || job.family || null;
  if (entry.domainLabel) job.boussoleDomainLabel = entry.domainLabel;
  job.sectorMappingConfidence = Number(entry.confidence || 0.98);
  job.sectorEvidence = [{
    source: `local_rome_sector_mapping_v2_${entry.source || "exact"}`,
    value: code
  }];
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRomeCode(value = "") {
  return String(value || "").trim().toUpperCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
