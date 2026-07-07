export function normalizeRomeMetier(raw = {}) {
  const source = unwrapFiche(raw);
  const romeCode = firstText(source.romeCode, source.codeRome, source.code, raw.romeCode, raw.codeRome, raw.code);
  const title = firstText(source.title, source.libelle, source.intitule, source.nom, source.appellation, source.metier?.libelle, "Metier ROME sans titre");
  const appellations = collectLabels(source.appellations, source.appellationsMetier, source.appellationsPrincipales, source.libelles, source.intitules);
  const activities = collectLabels(source.activities, source.activites, source.activitesPrincipales, source.activitesDeBase, source.activitesSpecifiques);
  const requiredSkillLabels = collectLabels(source.requiredSkills, source.competences, source.competencesMobilisees, source.savoirFaire, source.savoirsFaire, source["savoir-faire"]);
  const softSkillLabels = collectLabels(source.softSkills, source.savoirEtre, source.savoirEtreProfessionnels, source["savoir-être"]);
  const knowledgeLabels = collectLabels(source.knowledge, source.savoirs, source.connaissances);
  const contextLabels = collectLabels(source.workContexts, source.contextesTravail, source.conditionsExerciceActivite, source.environnementsTravail);
  const missingFields = [];
  if (!requiredSkillLabels.length) missingFields.push("requiredSkills");
  if (!contextLabels.length) missingFields.push("workContexts");
  if (!activities.length) missingFields.push("activities");
  return {
    id: `rome-${romeCode || slug(title)}`,
    schemaVersion: "1.0.0",
    romeCode,
    title,
    appellations,
    domain: firstText(source.domain, source.domaine, source.grandDomaine, "ROME / France Travail"),
    family: firstText(source.family, source.famille, source.domaineProfessionnel, "ROME"),
    description: firstText(source.description, source.resume, source.definition, source.presentation, "Description a verifier dans les donnees ROME."),
    activities,
    accessConditions: { text: firstText(source.accessConditions, source.conditionsAcces, source.accesEmploiMetier, source.accesMetier, "A verifier."), source: "france_travail_rome", confidence: 0.7 },
    requiredSkills: requiredSkillLabels.map(toStableSkillId),
    optionalSkills: collectLabels(source.optionalSkills, source.competencesSpecifiques).map(toStableSkillId),
    softSkills: softSkillLabels,
    knowledge: knowledgeLabels,
    workContexts: contextLabels.map(toStableContextId),
    physicalConstraints: source.physicalConstraints || { level: "unknown", tags: [], source: "rome_api", confidence: 0.5 },
    scheduleConstraints: source.scheduleConstraints || { nightWork: "unknown", weekendWork: "unknown", irregularHours: "unknown", source: "rome_api", confidence: 0.5 },
    mobilityConstraints: source.mobilityConstraints || { travelFrequency: "unknown", driverLicenseRequired: false, driverLicenseTypes: [], source: "rome_api", confidence: 0.5 },
    publicContactLevel: source.publicContactLevel || "unknown",
    autonomyLevel: source.autonomyLevel || "unknown",
    remoteCompatibility: source.remoteCompatibility || "unknown",
    requiredDiplomaLevel: source.requiredDiplomaLevel ?? null,
    recommendedDiplomaLevel: source.recommendedDiplomaLevel ?? null,
    requiredCertifications: collectLabels(source.requiredCertifications, source.certificationsObligatoires),
    recommendedCertifications: collectLabels(source.recommendedCertifications, source.certificationsRecommandees),
    relatedJobs: collectLabels(source.relatedJobs, source.metiersProches),
    transitionTags: collectLabels(source.transitionTags, source.tags, source.centresInteret),
    interestTags: collectLabels(source.interestTags),
    valueTags: collectLabels(source.valueTags),
    marketIndicators: toArray(source.marketIndicators),
    sourceRefs: ["france_travail_rome_generated"],
    dataQuality: { status: "generated_to_verify", warnings: ["mapping_to_verify", ...missingFields.map(field => `missing_${field}`)], confidence: 0.65 },
    missingFields,
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

function unwrapFiche(raw = {}) {
  if (Array.isArray(raw)) return raw[0] || {};
  return raw.ficheMetier || raw.fiche || raw.resultat || raw.metier || raw.data || raw;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "object") {
      const nested = firstText(value.libelle, value.intitule, value.label, value.title, value.nom, value.texte, value.description);
      if (nested) return nested;
    }
  }
  return "";
}

function collectLabels(...values) {
  const labels = [];
  const visit = value => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "string" || typeof value === "number") {
      labels.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      const label = firstText(value.libelle, value.intitule, value.label, value.title, value.nom, value.texte);
      if (label) labels.push(label);
      Object.values(value).filter(Array.isArray).forEach(visit);
    }
  };
  values.forEach(visit);
  return [...new Set(labels.map(item => item.trim()).filter(Boolean))];
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
