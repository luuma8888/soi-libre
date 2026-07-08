const SOURCE_OFFICIAL = "official_rome_api";
const SOURCE_COMPUTED = "computed";
const SOURCE_UNKNOWN = "unknown";

export function normalizeRomeMetier(raw = {}) {
  const source = unwrapFiche(raw);
  const romeCode = firstText(source.romeCode, source.codeRome, source.code, raw.romeCode, raw.codeRome, raw.code);
  const title = firstText(source.title, source.libelle, source.intitule, source.nom, source.appellation, source.metier?.libelle);
  const description = firstText(source.description, source.resume, source.definition, source.presentation);
  const appellations = collectLabels(source.appellations, source.appellationsMetier, source.appellationsPrincipales, source.libelles, source.intitules);
  const activities = collectLabels(source.activities, source.activites, source.activitesPrincipales, source.activitesDeBase, source.activitesSpecifiques);
  const requiredSkillLabels = collectLabels(source.requiredSkills, source.competences, source.competencesMobilisees, source.savoirFaire, source.savoirsFaire, source["savoir-faire"]);
  const optionalSkillLabels = collectLabels(source.optionalSkills, source.competencesSpecifiques);
  const softSkillLabels = collectLabels(source.softSkills, source.savoirEtre, source.savoirEtreProfessionnels, source["savoir-être"]);
  const knowledgeLabels = collectLabels(source.knowledge, source.savoirs, source.connaissances);
  const contextLabels = collectLabels(source.workContexts, source.contextesTravail, source.conditionsExerciceActivite, source.environnementsTravail);
  const accessText = firstText(source.accessConditions, source.conditionsAcces, source.accesEmploiMetier, source.accesMetier);
  const requiredCertifications = collectLabels(source.requiredCertifications, source.certificationsObligatoires, source.habilitationsObligatoires);
  const recommendedCertifications = collectLabels(source.recommendedCertifications, source.certificationsRecommandees, source.habilitations);
  const relatedJobs = collectRelatedJobRefs(source.relatedJobs, source.metiersProches, source.prochesMetiers);
  const domainOfficial = firstText(source.domain, source.domaine, source.grandDomaine);
  const familyOfficial = firstText(source.family, source.famille, source.domaineProfessionnel);
  const domain = domainOfficial || inferDomainFromRomeCode(romeCode);
  const family = familyOfficial || inferFamilyFromRomeCode(romeCode);
  const textPool = unique([title, description, domain, family, ...appellations, ...activities, ...contextLabels, ...requiredSkillLabels, ...knowledgeLabels].filter(Boolean));
  const constraints = inferConstraints(textPool);
  const transitionTags = deriveTransitionTags({ romeCode, title, domain, family, textPool });
  const interestTags = deriveInterestTags(textPool, transitionTags);
  const valueTags = deriveValueTags(textPool, transitionTags);
  const missingFields = buildMissingFields({
    romeCode,
    title,
    description,
    activities,
    requiredSkills: requiredSkillLabels,
    workContexts: contextLabels,
    accessConditions: accessText,
    requiredDiplomaLevel: source.requiredDiplomaLevel,
    recommendedDiplomaLevel: source.recommendedDiplomaLevel,
    market: source.market || source.marketIndicators
  });
  const fieldSources = {
    id: romeCode ? SOURCE_OFFICIAL : SOURCE_COMPUTED,
    romeCode: romeCode ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    title: title ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    domain: domainOfficial ? SOURCE_OFFICIAL : SOURCE_COMPUTED,
    family: familyOfficial ? SOURCE_OFFICIAL : SOURCE_COMPUTED,
    appellations: appellations.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    description: description ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    activities: activities.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    requiredSkills: requiredSkillLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    optionalSkills: optionalSkillLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    softSkills: softSkillLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    knowledge: knowledgeLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    workContexts: contextLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    constraints: constraints.source,
    accessConditions: accessText ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    requiredDiplomaLevel: source.requiredDiplomaLevel !== undefined ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    recommendedDiplomaLevel: source.recommendedDiplomaLevel !== undefined ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    requiredCertifications: requiredCertifications.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    recommendedCertifications: recommendedCertifications.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    relatedJobs: relatedJobs.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    transitionTags: SOURCE_COMPUTED,
    interestTags: SOURCE_COMPUTED,
    valueTags: SOURCE_COMPUTED,
    market: SOURCE_UNKNOWN
  };

  return {
    id: `rome-${romeCode || slug(title || "metier")}`,
    schemaVersion: "1.0.0",
    romeCode,
    title: title || "Metier ROME sans titre",
    domain,
    family,
    appellations,
    description: description || "Description non fournie par la fiche ROME synchronisee.",
    activities,
    requiredSkills: requiredSkillLabels.map(toStableSkillId),
    optionalSkills: optionalSkillLabels.map(toStableSkillId),
    softSkills: softSkillLabels,
    knowledge: knowledgeLabels,
    workContexts: contextLabels.map(toStableContextId),
    constraints,
    accessConditions: { text: accessText || "Conditions d'acces non fournies par la fiche ROME synchronisee.", source: accessText ? SOURCE_OFFICIAL : SOURCE_UNKNOWN, confidence: accessText ? 0.8 : 0.2 },
    physicalConstraints: constraints.physical,
    scheduleConstraints: constraints.schedule,
    mobilityConstraints: constraints.mobility,
    publicContactLevel: inferPublicContactLevel(textPool),
    autonomyLevel: inferAutonomyLevel(textPool),
    remoteCompatibility: inferRemoteCompatibility(textPool),
    requiredDiplomaLevel: numberOrNull(source.requiredDiplomaLevel),
    recommendedDiplomaLevel: numberOrNull(source.recommendedDiplomaLevel),
    requiredCertifications,
    recommendedCertifications,
    relatedJobs,
    transitionTags,
    interestTags,
    valueTags,
    market: { status: "unknown", source: SOURCE_UNKNOWN, confidence: 0 },
    marketIndicators: [],
    sourceRefs: ["france_travail_rome_generated"],
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: completenessScore(missingFields),
    fieldSources,
    romeSkillLabels: {
      required: requiredSkillLabels,
      optional: optionalSkillLabels,
      soft: softSkillLabels
    },
    romeWorkContextLabels: contextLabels,
    dataQuality: {
      status: missingFields.length ? "generated_partial" : "generated_complete",
      missingFields,
      warnings: [
        "official_rome_generated",
        "computed_tags_to_verify",
        ...missingFields.map(field => `missing_${field}`)
      ],
      completenessScore: completenessScore(missingFields),
      confidence: completenessScore(missingFields)
    },
    missingFields
  };
}

export function normalizeRomeCompetence(raw = {}) {
  const label = firstText(raw.label, raw.libelle, raw.intitule, raw.nom) || "Competence ROME";
  return {
    id: toStableSkillId(raw.id || raw.code || label),
    schemaVersion: "1.0.0",
    label,
    type: raw.type || raw.categorie || "savoir-faire",
    category: raw.category || raw.famille || "rome",
    aliases: toArray(raw.aliases),
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.75
  };
}

export function normalizeRomeContexte(raw = {}) {
  const label = firstText(raw.label, raw.libelle, raw.intitule, raw.nom) || "Contexte ROME";
  return buildContextFromLabel(label, raw);
}

export function normalizeRomeFicheMetier(raw = {}) {
  return normalizeRomeMetier(raw);
}

export function mergeRomeDatasets(parts = {}) {
  const jobs = uniqueBy([...(parts.metiers || []), ...(parts.fichesMetiers || [])].map(normalizeRomeMetier), "id");
  const skills = uniqueBy([
    ...(parts.competences || []).map(normalizeRomeCompetence),
    ...deriveSkillsFromJobs(jobs)
  ], "id");
  const workContexts = uniqueBy([
    ...(parts.contextes || []).map(normalizeRomeContexte),
    ...deriveContextsFromJobs(jobs)
  ], "id");
  const jobAppellations = deriveAppellationsFromJobs(jobs);
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - donnees ROME generees",
    datasetVersion: `rome-generated-${new Date().toISOString().slice(0, 10)}`,
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    provenance: "generated_rome",
    confidence: average(jobs.map(job => job.dataQuality?.completenessScore ?? 0.5)),
    jobs,
    skills,
    workContexts,
    jobAppellations,
    mappings: deriveMappingsFromJobs(jobs),
    sources: [{
      id: "france_travail_rome_generated",
      schemaVersion: "1.0.0",
      name: "France Travail ROME 4.0 via GitHub Actions",
      producer: "GitHub Actions",
      url: null,
      license: "A verifier selon le contrat d'usage France Travail IO",
      sourceDate: new Date().toISOString().slice(0, 10),
      importedAt: new Date().toISOString(),
      format: "JSON",
      accessMode: "github-actions-generated",
      provenance: "generated_rome",
      confidence: 0.75,
      redistribution: "verify_license",
      notes: "Synchronisation serveur sans secret expose dans le front-end."
    }]
  };
}

function buildMissingFields(fields) {
  const missing = [];
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value) && value.length === 0) missing.push(key);
    else if (value === undefined || value === null || value === "") missing.push(key);
  });
  return missing;
}

function inferConstraints(textPool) {
  const text = normalizeText(textPool.join(" "));
  const physicalTags = [];
  if (/(port|charge|manutention|debout|chantier|terrain|exterieur|outil|atelier|cuisine|soin|conduite|stock|magasin)/.test(text)) physicalTags.push("standing");
  if (/(charge|manutention|port)/.test(text)) physicalTags.push("load");
  if (/(exterieur|plein air|jardin|chantier|terrain|agric)/.test(text)) physicalTags.push("outdoor");
  if (/(bruit|machine|atelier|industrie|chantier)/.test(text)) physicalTags.push("noise");
  const nightWork = /(nuit|astreinte|urgence|hospitalier|restauration|securite)/.test(text) ? "possible" : "unknown";
  const weekendWork = /(week-end|weekend|dimanche|restauration|tourisme|animation|soin|securite)/.test(text) ? "possible" : "unknown";
  const travelFrequency = /(deplacement|terrain|domicile|chantier|livraison|conduite|transport)/.test(text) ? "medium" : "unknown";
  const driverLicenseRequired = /(permis|conduite|vehicule|livraison|chantier|deplacement)/.test(text);
  const hasSignal = physicalTags.length || nightWork !== "unknown" || weekendWork !== "unknown" || travelFrequency !== "unknown" || driverLicenseRequired;
  return {
    source: hasSignal ? SOURCE_COMPUTED : SOURCE_UNKNOWN,
    physical: { level: physicalTags.includes("load") ? "high" : physicalTags.length ? "medium" : "unknown", tags: unique(physicalTags), source: hasSignal ? SOURCE_COMPUTED : SOURCE_UNKNOWN, confidence: hasSignal ? 0.45 : 0.1 },
    schedule: { nightWork, weekendWork, irregularHours: nightWork === "possible" || weekendWork === "possible" ? "possible" : "unknown", source: hasSignal ? SOURCE_COMPUTED : SOURCE_UNKNOWN, confidence: hasSignal ? 0.4 : 0.1 },
    mobility: { travelFrequency, driverLicenseRequired, driverLicenseTypes: driverLicenseRequired ? ["B"] : [], source: hasSignal ? SOURCE_COMPUTED : SOURCE_UNKNOWN, confidence: hasSignal ? 0.4 : 0.1 }
  };
}

function inferDomainFromRomeCode(code = "") {
  const map = {
    A: "Agriculture, nature et vivant",
    D: "Commerce, vente et distribution",
    F: "Construction et batiment",
    G: "Hotellerie, restauration, tourisme et animation",
    H: "Industrie",
    J: "Sante",
    K: "Services a la personne, social et formation",
    M: "Support a l'entreprise et numerique",
    N: "Transport et logistique"
  };
  return map[String(code).charAt(0)] || "ROME / France Travail";
}

function inferFamilyFromRomeCode(code = "") {
  return inferDomainFromRomeCode(code);
}

function inferPublicContactLevel(textPool) {
  const text = normalizeText(textPool.join(" "));
  if (/(accueil|client|public|patient|enfant|usager|vente|service|accompagn)/.test(text)) return "high";
  if (/(equipe|relation|communication)/.test(text)) return "medium";
  return "unknown";
}

function inferAutonomyLevel(textPool) {
  const text = normalizeText(textPool.join(" "));
  if (/(autonomie|independant|responsable|pilot|coordonn)/.test(text)) return "high";
  if (/(equipe|procedure|consigne)/.test(text)) return "medium";
  return "unknown";
}

function inferRemoteCompatibility(textPool) {
  const text = normalizeText(textPool.join(" "));
  if (/(developpement|web|data|analyse|administratif|communication|redaction|support informatique)/.test(text)) return "partial";
  if (/(chantier|soin|cuisine|livraison|magasin|jardin|animal|enfant|atelier|production)/.test(text)) return "none";
  return "unknown";
}

function deriveTransitionTags({ romeCode, title, domain, family, textPool }) {
  const text = normalizeText([romeCode, title, domain, family, ...textPool].join(" "));
  const tags = [];
  const rules = [
    ["numerique", /web|logiciel|informatique|data|donnee|developp/],
    ["administratif", /administratif|secretariat|bureau|dossier|gestion/],
    ["soin", /soin|sante|patient|hospital|aide-soignant/],
    ["social", /social|insertion|mediation|accompagn/],
    ["enfance", /enfant|petite enfance|education/],
    ["nature", /jardin|paysage|agric|nature|animal/],
    ["commerce", /vente|commerce|client|magasin/],
    ["logistique", /logistique|stock|transport|livraison|magasinier/],
    ["batiment", /batiment|chantier|electric|construction/],
    ["restauration", /cuisine|restauration|service en salle/],
    ["manuel", /outil|atelier|chantier|reparer|fabriquer|manutention/],
    ["relationnel", /accueil|public|client|patient|usager|communication/],
    ["analyse", /analyse|etude|controle|diagnostic|qualite/],
    ["securite", /securite|surveillance|protection/],
    ["animation", /animation|activite|socioculturel/]
  ];
  rules.forEach(([tag, pattern]) => {
    if (pattern.test(text)) tags.push(tag);
  });
  return unique(tags);
}

function deriveInterestTags(textPool, transitionTags) {
  const text = normalizeText([...textPool, ...transitionTags].join(" "));
  const tags = [];
  const rules = [
    ["aider", /aide|soin|social|accompagn|service|patient|usager/],
    ["organiser", /administratif|gestion|coordonn|dossier|logistique/],
    ["technique", /technique|informatique|electric|machine|outil|logiciel/],
    ["nature", /nature|jardin|animal|agric/],
    ["enfants", /enfant|petite enfance|education/],
    ["relationnel", /accueil|client|public|communication/],
    ["analyser", /analyse|controle|diagnostic|qualite|donnee/],
    ["fabriquer", /fabriquer|atelier|chantier|cuisine|construction/],
    ["transmettre", /formation|animation|education|accompagn/]
  ];
  rules.forEach(([tag, pattern]) => {
    if (pattern.test(text)) tags.push(tag);
  });
  return unique(tags);
}

function deriveValueTags(textPool, transitionTags) {
  const text = normalizeText([...textPool, ...transitionTags].join(" "));
  const tags = [];
  const rules = [
    ["service", /service|aide|accueil|client|usager|patient/],
    ["meaning", /soin|social|education|insertion|accompagn|sante/],
    ["stability", /administratif|procedure|gestion|qualite|logistique/],
    ["autonomy", /autonomie|responsable|independant|coordonn/],
    ["precision", /controle|qualite|analyse|technique|diagnostic/],
    ["concrete", /chantier|atelier|terrain|cuisine|jardin|fabrication/],
    ["ecology", /nature|jardin|agric|animal|environnement/],
    ["security", /securite|surveillance|protection/],
    ["team", /equipe|coordonn|collectif/]
  ];
  rules.forEach(([tag, pattern]) => {
    if (pattern.test(text)) tags.push(tag);
  });
  return unique(tags);
}

function deriveSkillsFromJobs(jobs) {
  return jobs.flatMap(job => {
    const labels = job.romeSkillLabels || {};
    return [
      ...toArray(labels.required).map(label => skillFromLabel(label, "savoir-faire", "rome-required")),
      ...toArray(labels.optional).map(label => skillFromLabel(label, "savoir-faire", "rome-optional")),
      ...toArray(labels.soft).map(label => skillFromLabel(label, "savoir-etre", "rome-soft"))
    ];
  });
}

function skillFromLabel(label, type, category) {
  return {
    id: toStableSkillId(label),
    schemaVersion: "1.0.0",
    label,
    type,
    category,
    aliases: [],
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.75
  };
}

function deriveContextsFromJobs(jobs) {
  return jobs.flatMap(job => toArray(job.romeWorkContextLabels).map(label => buildContextFromLabel(label)));
}

function buildContextFromLabel(label, raw = {}) {
  return {
    id: toStableContextId(raw.id || raw.code || label),
    schemaVersion: "1.0.0",
    label,
    category: raw.category || raw.type || "rome",
    constraintTags: inferContextTags(label),
    description: raw.description || `Contexte ROME synchronise : ${label}`,
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.7
  };
}

function inferContextTags(label) {
  const text = normalizeText(label);
  const tags = [];
  if (/bureau|administratif/.test(text)) tags.push("office", "quiet");
  if (/domicile/.test(text)) tags.push("field", "travel");
  if (/exterieur|terrain|chantier|jardin|agric/.test(text)) tags.push("outdoor", "field");
  if (/equipe/.test(text)) tags.push("team");
  if (/public|client|patient|usager|accueil/.test(text)) tags.push("public-contact");
  if (/enfant|petite enfance/.test(text)) tags.push("children");
  if (/animal/.test(text)) tags.push("animals");
  if (/atelier|outil|manuel/.test(text)) tags.push("manual");
  if (/bruit|machine|industrie/.test(text)) tags.push("noise");
  if (/deplacement|livraison|transport/.test(text)) tags.push("travel");
  return unique(tags);
}

function deriveAppellationsFromJobs(jobs) {
  return jobs.flatMap(job => toArray(job.appellations).map(label => ({
    id: `appellation-${job.romeCode || slug(job.id)}-${slug(label)}`,
    schemaVersion: "1.0.0",
    jobId: job.id,
    romeCode: job.romeCode,
    label,
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.75
  })));
}

function deriveMappingsFromJobs(jobs) {
  return jobs.map(job => ({
    id: `mapping-${job.id}`,
    schemaVersion: "1.0.0",
    jobId: job.id,
    romeCode: job.romeCode,
    skillIds: [...toArray(job.requiredSkills), ...toArray(job.optionalSkills)],
    contextIds: toArray(job.workContexts),
    relatedJobIds: toArray(job.relatedJobs),
    source: SOURCE_COMPUTED,
    provenance: "generated_rome",
    confidence: 0.55
  }));
}

function collectRelatedJobRefs(...values) {
  return collectRawItems(...values).map(item => {
    if (typeof item === "string" || typeof item === "number") {
      const value = String(item);
      return /^[A-Z][0-9]{4}/.test(value) ? `rome-${value.slice(0, 5)}` : value;
    }
    const code = firstText(item.romeCode, item.codeRome, item.code);
    if (code) return `rome-${code}`;
    return firstText(item.id, item.libelle, item.intitule, item.label, item.nom);
  }).filter(Boolean);
}

function collectRawItems(...values) {
  const items = [];
  const visit = value => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) value.forEach(visit);
    else items.push(value);
  };
  values.forEach(visit);
  return items;
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
  return unique(labels.map(item => item.trim()).filter(Boolean));
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
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function average(values) {
  const clean = values.filter(value => typeof value === "number");
  return clean.length ? Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(2)) : 0;
}

function completenessScore(missingFields = []) {
  const expected = 16;
  return Number(Math.max(0.25, (expected - missingFields.length) / expected).toFixed(2));
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "local";
}
