import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATASET_PATH = resolve(ROOT, "creations/boussolepro/data/curated/clairmetier-curated-v0.4.json");
const OUT_PATH = resolve(ROOT, "creations/boussolepro/data/local/curated-corpus-audit.json");

const LOCAL_VARIANT_ROME_MAP = {
  "curated-coordinateur-administratif-associatif": "M1605",
  "curated-ux-ui-designer-junior": "E1205",
  "curated-conseiller-mediation-numerique": "K1204",
  "curated-analyste-cybersecurite-junior": "M1802",
  "curated-createur-no-code-automatisation": "M1805",
  "curated-charge-de-projet-associatif": "K1204",
  "curated-accompagnant-vae-parcours": "K1801",
  "curated-intervenant-socio-educatif": "K1207",
  "curated-referent-handicap-insertion": "K1801",
  "curated-accompagnant-administratif-social": "K1205",
  "curated-conseiller-budget-familial": "K1102",
  "curated-animateur-prevention-sante-social": "K1204",
  "curated-sophrologue-praticien-bien-etre": "K1103",
  "curated-masseur-bien-etre-non-medical": "K1103",
  "curated-coordinateur-parcours-sante": "K1403",
  "curated-moniteur-atelier-creatif-enfants": "G1202",
  "curated-agent-refuge-animaux": "A1501",
  "curated-technicien-riviere-milieux-aquatiques": "A1204",
  "curated-charge-mission-biodiversite": "A1303",
  "curated-crepier-restauration-rapide-qualitative": "G1602",
  "curated-preparateur-snacking-sain": "G1603",
  "curated-coordinateur-chambres-d-hotes": "G1502",
  "curated-gestionnaire-conciergerie-locale": "G1703",
  "curated-operateur-impression-3d": "H2906",
  "curated-facilitateur-de-tiers-lieu": "K1204",
  "curated-coordinateur-jardin-partage": "A1203",
  "curated-animateur-cooperatif": "G1202",
  "curated-mediateur-numerique-itinerant": "K1204",
  "curated-conseiller-transition-ecologique-locale": "K1801",
  "curated-concierge-solidaire": "K1302",
  "curated-coordinateur-benevoles": "K1204",
  "curated-organisateur-evenements-citoyens": "E1107",
  "curated-artisan-reparateur-reemploi": "I1304",
  "curated-animateur-bien-etre-au-travail": "K1103",
  "curated-accompagnant-autonomie-administrative": "K1205",
  "curated-createur-d-ateliers-pedagogiques": "G1202",
  "curated-coordinateur-ressourcerie": "K2304"
};

const REQUIRED_BY_FAMILY = [
  { id: "care_no_ux", match: /sant|soin|aide a la personne|services a la personne|puericulture|auxiliaire|petite enfance/i, forbid: ["skill-user-research", "skill-design"], expectOne: ["skill-care-basic", "skill-active-listening", "skill-cleanliness", "skill-child-safety"] },
  { id: "education_children", match: /education|enfance|enfant|animation|scolaire/i, expectOne: ["skill-child-safety", "skill-teaching", "skill-animation", "skill-early-childhood", "skill-learning-support"] },
  { id: "cleaning_hygiene", match: /proprete|nettoyage|hygiene|entretien/i, expectOne: ["skill-cleaning", "skill-cleanliness", "skill-cleaning-protocol", "skill-hygiene-rules"] },
  { id: "administrative_docs", match: /administratif|bureau|dossier|gestion/i, expectOne: ["skill-admin-doc", "skill-organisation"] },
  { id: "digital_skill", match: /numerique|informatique|web|cyber|data/i, expectOne: ["skill-code", "skill-support-user", "skill-data", "skill-analysis", "skill-network"] },
  { id: "nature_outdoor", match: /nature|agri|jardin|biodiversite|environnement|riviere/i, expectOne: ["skill-gardening", "skill-environment", "skill-craft", "skill-animal-care"] },
  { id: "building_manual", match: /batiment|chantier|maintenance|artisan|reparation/i, expectOne: ["skill-building", "skill-craft", "skill-repair"] }
];

const JOB_REPAIRS = {
  "curated-auxiliaire-de-vie": {
    requiredSkills: ["skill-care-basic", "skill-daily-life-support", "skill-active-listening", "skill-care-hygiene-comfort"],
    optionalSkills: ["skill-cleanliness", "skill-emotional-stability", "skill-driving", "skill-privacy-respect"],
    workContexts: ["ctx-home-care", "ctx-public-contact", "ctx-field", "ctx-emotional-load"]
  },
  "curated-auxiliaire-de-puericulture": {
    requiredSkills: ["skill-early-childhood", "skill-child-safety", "skill-care-basic", "skill-child-development"],
    optionalSkills: ["skill-cleanliness", "skill-active-listening", "skill-care-hygiene-comfort", "skill-team-transmission"],
    workContexts: ["ctx-children", "ctx-care-setting", "ctx-team", "ctx-emotional-load"]
  },
  "curated-teleconseiller-administratif": {
    requiredSkills: ["skill-admin-doc", "skill-phone-support", "skill-communication"],
    optionalSkills: ["skill-organisation", "skill-active-listening"],
    workContexts: ["ctx-phone", "ctx-office", "ctx-team"]
  },
  "curated-analyste-cybersecurite-junior": {
    requiredSkills: ["skill-analysis", "skill-network", "skill-security"],
    optionalSkills: ["skill-data", "skill-writing", "skill-support-user"],
    workContexts: ["ctx-office", "ctx-remote", "ctx-quiet"]
  },
  "curated-accompagnant-administratif-social": {
    requiredSkills: ["skill-admin-doc", "skill-social-support", "skill-active-listening"],
    optionalSkills: ["skill-organisation", "skill-orientation-referral", "skill-writing"],
    workContexts: ["ctx-public-contact", "ctx-office", "ctx-association", "ctx-emotional-load"]
  },
  "curated-animateur-nature-enfants": {
    requiredSkills: ["skill-environment", "skill-animation", "skill-child-safety"],
    optionalSkills: ["skill-gardening", "skill-pedagogy", "skill-activity-design"],
    workContexts: ["ctx-outdoor", "ctx-children", "ctx-team"]
  },
  "curated-gestionnaire-conciergerie-locale": {
    requiredSkills: ["skill-organisation", "skill-hospitality", "skill-admin-doc"],
    optionalSkills: ["skill-communication", "skill-local-network"],
    workContexts: ["ctx-public-contact", "ctx-office", "ctx-field"]
  },
  "curated-artisan-d-art-polyvalent": {
    requiredSkills: ["skill-craft", "skill-design", "skill-cultural"],
    optionalSkills: ["skill-sales", "skill-communication"],
    workContexts: ["ctx-workshop", "ctx-cultural-place", "ctx-public-contact"]
  },
  "curated-artisan-reparateur-reemploi": {
    requiredSkills: ["skill-repair", "skill-craft", "skill-cleaning"],
    optionalSkills: ["skill-customer-care", "skill-waste-sorting", "skill-environment"],
    workContexts: ["ctx-recycling", "ctx-workshop", "ctx-public-contact"]
  }
};

async function main() {
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  const jobs = (dataset.jobs || []).map(applyRuntimeAnchors);
  const mappings = dataset.mappings || [];
  const issues = [];

  for (const job of jobs) {
    const haystack = `${job.title} ${job.domain} ${job.family}`;
    if (!job.romeCode && !job.localVariantOfRomeCode) issues.push(issue("missing_rome_anchor", job, "Métier sans romeCode ni localVariantOfRomeCode."));
    if (!job.requiredSkills?.length) issues.push(issue("empty_required_skills", job, "Métier sans compétences cœur."));
    if (!job.workContexts?.length) issues.push(issue("empty_work_contexts", job, "Métier sans contexte de travail."));
    for (const rule of REQUIRED_BY_FAMILY) {
      if (!rule.match.test(haystack)) continue;
      const skills = new Set([...(job.requiredSkills || []), ...(job.optionalSkills || []), ...(job.softSkills || [])]);
      if (rule.forbid?.some(skill => skills.has(skill))) issues.push(issue(`${rule.id}_forbidden_skill`, job, `Compétence incohérente détectée: ${rule.forbid.filter(skill => skills.has(skill)).join(", ")}`));
      if (rule.expectOne?.length && !rule.expectOne.some(skill => skills.has(skill))) issues.push(issue(`${rule.id}_missing_expected_skill`, job, `Aucune compétence attendue parmi: ${rule.expectOne.join(", ")}`));
    }
  }

  mappings.forEach(mapping => {
    const job = jobs.find(item => item.id === mapping.jobId);
    if (!mapping.romeCode && !job?.romeCode && !job?.localVariantOfRomeCode) {
      issues.push({ type: "mapping_missing_rome", jobId: mapping.jobId, message: "Mapping sans romeCode et métier sans ancrage ROME." });
    }
  });

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    datasetVersion: dataset.datasetVersion,
    jobsCount: jobs.length,
    checkedRules: REQUIRED_BY_FAMILY.map(rule => rule.id),
    missingRomeAfterRuntimeAnchors: jobs.filter(job => !job.romeCode && !job.localVariantOfRomeCode).map(job => job.id),
    issuesCount: issues.length,
    issues,
    status: issues.length ? "completed_with_warnings" : "ok",
    note: "Audit local v0.5.1. Les variantes locales de ROME restent à vérifier avec les sources officielles."
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Audit corpus local: ${issues.length} alerte(s), rapport ${relative(OUT_PATH)}`);
}

function applyRuntimeAnchors(job) {
  const code = job.romeCode || LOCAL_VARIANT_ROME_MAP[job.id] || "";
  return {
    ...job,
    romeCode: code || null,
    localVariantOfRomeCode: job.romeCode ? job.localVariantOfRomeCode || null : code || null,
    isLocalVariant: Boolean(!job.romeCode && code),
    requiredSkills: repairSkills(job).requiredSkills,
    optionalSkills: repairSkills(job).optionalSkills,
    workContexts: repairSkills(job).workContexts
  };
}

function repairSkills(job) {
  if (JOB_REPAIRS[job.id]) return JOB_REPAIRS[job.id];
  return {
    requiredSkills: job.requiredSkills || [],
    optionalSkills: job.optionalSkills || [],
    workContexts: job.workContexts || []
  };
}

function issue(type, job, message) {
  return { type, jobId: job.id, title: job.title, romeCode: job.romeCode || job.localVariantOfRomeCode || null, message };
}

function relative(path) {
  return path.replace(`${ROOT}/`, "");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
