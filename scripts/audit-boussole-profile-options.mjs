import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RUNTIME_DIR = path.join(ROOT, "creations/boussolepro/boussole-runtime");
const OUTPUT = path.join(ROOT, "tmp/monde-pro/boussole-v1.3/profile-options-coverage.json");
const core = JSON.parse(await readFile(path.join(RUNTIME_DIR, "boussole-core.json"), "utf8"));
const jobs = core.jobs || [];

const optionGroups = {
  trainingFamilies: {
    administratif_gestion: ["administratif", "gestion", "droit public", "collectivite"], numerique: ["numerique", "informatique", "developp"], social: ["social", "accompagnement", "insertion"], education_animation: ["education", "enseignement", "animation", "jeunesse"], petite_enfance: ["petite enfance", "garde d enfant", "assistant maternel", "creche"], sante_soin: ["sante", "soin", "medical"], culture_communication: ["culture", "communication", "creation"], commerce_relation_client: ["commerce", "vente", "client"], hotellerie_restauration: ["hotellerie", "hebergement", "tourisme", "restauration"], nature_agriculture_animaux: ["nature", "agriculture", "animal"], artisanat_batiment_maintenance: ["artisanat", "batiment", "maintenance"], industrie_qualite: ["industrie", "production", "qualite"], logistique_transport_securite: ["logistique", "transport", "securite"], proprete_services: ["proprete", "entretien"], recherche_analyse: ["recherche", "analyse", "laboratoire"]
  },
  interests: Object.fromEntries(["aider", "accompagner", "creer", "transmettre", "organiser", "analyser", "fabriquer", "reparer", "nature", "animaux", "enfants", "technique", "manuel", "communiquer", "proteger", "nourrir"].map(id => [id, [id]])),
  values: Object.fromEntries(["meaning", "service", "solidarity", "autonomy", "stability", "precision", "ecology", "team", "concrete", "security", "creativity", "clarity"].map(id => [id, [id]])),
  preferredWorkStyles: { relational: ["relationnel", "public"], team: ["equipe", "collectif"], autonomous: ["autonomie"], creative: ["creation", "creer"], manual: ["manuel", "outil"], structured: ["organisation", "procedure"], analytical: ["analyse", "analyser"], movement: ["terrain", "exterieur", "deplacement"] },
  preferredEnvironments: { office: ["bureau", "administratif"], field: ["terrain", "chantier"], outdoor: ["exterieur", "nature"], public: ["public", "client", "accueil"], children: ["enfant", "jeunesse", "scolaire"], animals: ["animal", "elevage", "veterinaire"], workshop: ["atelier", "usine"], quiet: ["quiet", "calme", "silencieux"], remote: ["teletravail", "distance", "numerique"] }
};

const contextLabels = new Map((core.workContexts || []).map(item => [item.id, [item.label, ...(item.constraintTags || [])].join(" ")]));
const normalized = jobs.map(job => ({
  job,
  text: normalize([job.title, job.mission, job.domain, job.family, ...(job.appellations || []), ...(job.interestTags || []), ...(job.valueTags || []), ...(job.transitionTags || []), ...(job.boussoleSectorIds || []), job.primarySectorId, ...(job.secondarySectorIds || []), ...(job.workContexts || []).flatMap(id => [id, contextLabels.get(id)])].join(" "))
}));
const groups = {};
for (const [groupId, options] of Object.entries(optionGroups)) {
  groups[groupId] = Object.fromEntries(Object.entries(options).map(([optionId, tokens]) => {
    const matches = normalized.filter(row => tokens.some(token => row.text.includes(normalize(token))));
    return [optionId, { jobsCount: matches.length, proportion: Number((matches.length / jobs.length).toFixed(4)), rule: "tags, secteurs, contextes ou vocabulaire source", examples: matches.slice(0, 5).map(row => ({ romeCode: row.job.romeCode, title: row.job.title })), warning: matches.length === 0 ? "zero_coverage" : matches.length / jobs.length > 0.85 ? "over_85_percent" : null }];
  }));
}
const failures = Object.entries(groups).flatMap(([groupId, options]) => Object.entries(options).filter(([, row]) => row.jobsCount === 0).map(([optionId]) => `${groupId}:${optionId}:zero_coverage`));
const report = { schemaVersion: "1.0.0", reportKind: "boussole_profile_options_coverage", generatedAt: new Date().toISOString(), datasetVersion: core.datasetVersion, jobsCount: jobs.length, status: failures.length ? "failed" : "passed", failures, groups };
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, jobsCount: jobs.length, options: Object.values(groups).reduce((sum, group) => sum + Object.keys(group).length, 0), failures, output: path.relative(ROOT, OUTPUT) }, null, 2));
if (failures.length) throw new Error(`Couverture des options insuffisante : ${failures.join(", ")}`);

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
