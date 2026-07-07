export function normalizeRomeMetier(raw = {}) {
  const id = raw.id || raw.code || raw.romeCode || raw.codeRome || raw.appellationCode || "";
  const romeCode = raw.romeCode || raw.codeRome || raw.code || "";
  const title = raw.title || raw.libelle || raw.intitule || raw.nom || "Metier ROME sans titre";
  return {
    id: `rome-${romeCode || slug(title)}`,
    schemaVersion: "1.0.0",
    romeCode,
    title,
    appellations: toArray(raw.appellations || raw.appellationsMetier || raw.libelles).map(String),
    domain: raw.domain || raw.domaine || raw.grandDomaine || "ROME",
    family: raw.family || raw.famille || raw.domaineProfessionnel || "ROME",
    description: raw.description || raw.resume || raw.definition || "Description a verifier dans les donnees ROME.",
    activities: toArray(raw.activities || raw.activites || raw.activitesPrincipales),
    accessConditions: { text: raw.accessConditions || raw.conditionsAcces || "A verifier.", source: "france_travail_rome", confidence: 0.7 },
    requiredSkills: toArray(raw.requiredSkills || raw.competences || raw.skills).map(toStableSkillId),
    optionalSkills: toArray(raw.optionalSkills),
    softSkills: toArray(raw.softSkills),
    knowledge: toArray(raw.knowledge || raw.savoirs),
    workContexts: toArray(raw.workContexts || raw.contextesTravail).map(toStableContextId),
    physicalConstraints: raw.physicalConstraints || { level: "unknown", tags: [], source: "rome_api", confidence: 0.5 },
    scheduleConstraints: raw.scheduleConstraints || { nightWork: "unknown", weekendWork: "unknown", irregularHours: "unknown", source: "rome_api", confidence: 0.5 },
    mobilityConstraints: raw.mobilityConstraints || { travelFrequency: "unknown", driverLicenseRequired: false, driverLicenseTypes: [], source: "rome_api", confidence: 0.5 },
    publicContactLevel: raw.publicContactLevel || "unknown",
    autonomyLevel: raw.autonomyLevel || "unknown",
    remoteCompatibility: raw.remoteCompatibility || "unknown",
    requiredDiplomaLevel: raw.requiredDiplomaLevel ?? null,
    recommendedDiplomaLevel: raw.recommendedDiplomaLevel ?? null,
    requiredCertifications: toArray(raw.requiredCertifications),
    recommendedCertifications: toArray(raw.recommendedCertifications),
    relatedJobs: toArray(raw.relatedJobs),
    transitionTags: toArray(raw.transitionTags || raw.tags),
    interestTags: toArray(raw.interestTags),
    valueTags: toArray(raw.valueTags),
    marketIndicators: toArray(raw.marketIndicators),
    sourceRefs: ["france_travail_rome_generated"],
    dataQuality: { status: "generated_to_verify", warnings: ["mapping_to_verify"], confidence: 0.65 },
    missingFields: [],
    source: "france_travail_rome",
    provenance: "generated_rome",
    confidence: 0.65
  };
}

export function normalizeRomeCompetence(raw = {}) {
  const label = raw.label || raw.libelle || raw.intitule || raw.nom || "Competence ROME";
  return {
    id: toStableSkillId(raw.id || raw.code || label),
    schemaVersion: "1.0.0",
    label,
    type: raw.type || raw.categorie || "savoir-faire",
    category: raw.category || raw.famille || "rome",
    aliases: toArray(raw.aliases),
    source: "france_travail_rome",
    provenance: "generated_rome",
    confidence: 0.65
  };
}

export function normalizeRomeContexte(raw = {}) {
  const label = raw.label || raw.libelle || raw.intitule || "Contexte ROME";
  return {
    id: toStableContextId(raw.id || raw.code || label),
    schemaVersion: "1.0.0",
    label,
    category: raw.category || raw.type || "rome",
    constraintTags: toArray(raw.constraintTags || raw.tags),
    description: raw.description || "Contexte issu d'une normalisation ROME a verifier.",
    source: "france_travail_rome",
    provenance: "generated_rome",
    confidence: 0.65
  };
}

export function normalizeRomeFicheMetier(raw = {}) {
  return normalizeRomeMetier(raw);
}

export function mergeRomeDatasets(parts = {}) {
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - donnees ROME generees",
    datasetVersion: `rome-generated-${new Date().toISOString().slice(0, 10)}`,
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    provenance: "generated_rome",
    confidence: 0.65,
    jobs: uniqueBy([...(parts.metiers || []), ...(parts.fichesMetiers || [])].map(normalizeRomeMetier), "id"),
    skills: uniqueBy((parts.competences || []).map(normalizeRomeCompetence), "id"),
    workContexts: uniqueBy((parts.contextes || []).map(normalizeRomeContexte), "id"),
    jobAppellations: [],
    mappings: [],
    sources: [{
      id: "france_travail_rome_generated",
      schemaVersion: "1.0.0",
      name: "France Travail ROME - synchronisation generee",
      producer: "GitHub Actions",
      url: null,
      license: "A verifier selon le contrat d'usage France Travail IO",
      sourceDate: new Date().toISOString().slice(0, 10),
      importedAt: new Date().toISOString(),
      format: "JSON",
      accessMode: "github-actions-generated",
      provenance: "generated_rome",
      confidence: 0.65,
      redistribution: "verify_license",
      notes: "Normalisation technique sans secret expose dans le front-end."
    }]
  };
}

function toStableSkillId(value) {
  return String(value || "").startsWith("skill-") ? String(value) : `skill-rome-${slug(value || "competence")}`;
}

function toStableContextId(value) {
  return String(value || "").startsWith("ctx-") ? String(value) : `ctx-rome-${slug(value || "contexte")}`;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "local";
}
