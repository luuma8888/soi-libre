import { readFileSync } from "node:fs";

const SOURCE_OFFICIAL = "official_rome_api";
const SOURCE_COMPUTED = "computed";
const SOURCE_UNKNOWN = "unknown";
const SOURCE_NOT_AVAILABLE = "not_available_in_connected_sources";
const SOURCE_OFFICIAL_DETAIL_UNAVAILABLE = "official_detail_unavailable";
const MATCHABLE_SKILLS_LIMIT = 500;
const ROME_SECTOR_MAPPING_V2 = loadRomeSectorMapping("rome-sector-mapping-v2.json", { exact: {}, prefix4: {}, prefix3: {}, textRules: [] });
const ROME_SECTOR_MAPPING = loadRomeSectorMapping("rome-sector-mapping.json", { mappings: {}, prefixFallbacks: {} });
const ROME_DOMAIN_BY_LETTER = {
  A: "Agriculture et pêche, espaces naturels et espaces verts, soins aux animaux",
  B: "Arts et façonnage d'ouvrages d'art",
  C: "Banque, assurance, immobilier",
  D: "Commerce, vente et grande distribution",
  E: "Communication, média et multimédia",
  F: "Construction, bâtiment et travaux publics",
  G: "Hôtellerie-restauration, tourisme, loisirs et animation",
  H: "Industrie",
  I: "Installation et maintenance",
  J: "Santé",
  K: "Services à la personne et à la collectivité",
  L: "Spectacle",
  M: "Support à l'entreprise",
  N: "Transport et logistique"
};

const BOUSSOLE_SECTOR_LABELS = {
  administratif: "Administration, bureau et gestion",
  numerique: "Numérique, data et support",
  soin_sante: "Santé, soin et bien-être",
  social_accompagnement: "Social, insertion et accompagnement",
  enfance_education: "Enfance, éducation et animation",
  nature_agriculture_animaux: "Nature, agriculture, animaux et écologie",
  artisanat_batiment_maintenance: "Artisanat, bâtiment et maintenance",
  commerce_relation_client: "Commerce et relation client",
  restauration_hotellerie_tourisme: "Restauration, hôtellerie, tourisme et accueil",
  industrie_qualite: "Industrie, laboratoire et qualité",
  logistique_transport_securite: "Logistique, transport et sécurité",
  culture_communication_creation: "Culture, communication et création",
  recherche_analyse: "Recherche, analyse et conseil",
  droit_gestion_publique: "Droit, gestion publique et protection",
  services_proprete: "Services, propreté et aide pratique"
};

const PROFILE_SECTOR_FROM_GENERATED = {
  administratif: ["administratif_support"],
  numerique: ["numerique"],
  soin_sante: ["sante_soin"],
  social_accompagnement: ["social_insertion"],
  enfance_education: ["education_enfance"],
  nature_agriculture_animaux: ["nature_agriculture", "animaux"],
  artisanat_batiment_maintenance: ["batiment_construction", "maintenance"],
  commerce_relation_client: ["commerce_vente"],
  restauration_hotellerie_tourisme: ["restauration_alimentation", "hotellerie_hebergement"],
  industrie_qualite: ["industrie_production"],
  logistique_transport_securite: ["logistique_transport", "securite_prevention"],
  culture_communication_creation: ["culture_communication"],
  recherche_analyse: ["administratif_support"],
  droit_gestion_publique: ["services_aux_collectivites"],
  services_proprete: ["proprete_entretien"]
};

const GENERATED_SECTOR_FROM_PROFILE = {
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

export function normalizeRomeMetier(raw = {}) {
  const source = unwrapFiche(raw);
  const romeCode = firstText(source.romeCode, source.codeRome, source.code, raw.romeCode, raw.codeRome, raw.code);
  const title = firstText(source.title, source.libelle, source.intitule, source.nom, source.appellation, source.metier?.libelle);
  const description = firstText(source.description, source.resume, source.definition, source.presentation);
  const appellationRefs = collectRelationRefs(source.appellations, source.appellationsMetier, source.appellationsPrincipales, source.libelles, source.intitules, ...findValuesByKeyHints(source, ["appellation"]));
  const appellations = unique(appellationRefs.map(ref => ref.label).filter(Boolean));
  const activities = collectLabels(source.activities, source.activites, source.activitesPrincipales, source.activitesDeBase, source.activitesSpecifiques);
  const mobilizedSkillRefs = collectRelationRefs(source.requiredSkills, source.competences, source.competencesMobilisees, source.groupesCompetencesMobilisees, source.groupesCompetences, source.savoirFaire, source.savoirsFaire, source["savoir-faire"], ...findValuesByKeyHints(source, ["competence", "savoirfaire", "savoir-faire"]));
  const optionalSkillRefs = collectRelationRefs(source.optionalSkills, source.competencesSpecifiques, ...findValuesByKeyHints(source, ["competencespecifique", "competence-specifique"]));
  const explicitSoftSkillRefs = collectRelationRefs(source.softSkills, source.savoirEtre, source.savoirEtreProfessionnels, source["savoir-être"], ...findValuesByKeyHints(source, ["savoiretre", "savoir-etre"]));
  const requiredSkillRefs = mobilizedSkillRefs.filter(ref => classifyRomeSkill({ label: ref.label, type: ref.rawType }) === "skill_action");
  const softSkillRefs = uniqueBy([...explicitSoftSkillRefs, ...mobilizedSkillRefs.filter(ref => classifyRomeSkill({ label: ref.label, type: ref.rawType }) === "soft_skill")], ref => `${ref.officialId || ""}|${normalizeText(ref.label)}`);
  const knowledgeRefs = collectRelationRefs(source.knowledge, source.savoirs, source.groupesSavoirs, source.connaissances, ...findValuesByKeyHints(source, ["savoirs", "connaissance", "knowledge"]));
  const contextRefs = collectRelationRefs(source.workContexts, source.contextesTravail, source.conditionsExerciceActivite, source.environnementsTravail, ...findValuesByKeyHints(source, ["contextetravail", "contexte-travail", "conditionexercice", "environnementtravail"]));
  const requiredSkillLabels = unique(requiredSkillRefs.map(ref => ref.label).filter(Boolean));
  const optionalSkillLabels = unique(optionalSkillRefs.map(ref => ref.label).filter(Boolean));
  const softSkillLabels = unique(softSkillRefs.map(ref => ref.label).filter(Boolean));
  const knowledgeLabels = unique(knowledgeRefs.map(ref => ref.label).filter(Boolean));
  const contextLabels = unique(contextRefs.map(ref => ref.label).filter(Boolean));
  const accessText = firstText(source.accessConditions, source.conditionsAcces, source.accesEmploi, source.accesEmploiMetier, source.accesMetier, ...findValuesByKeyHints(source, ["conditionacces", "accesemploi", "accesemploimetier", "accesmetier"]));
  const requiredCertificationRefs = collectRelationRefs(source.requiredCertifications, source.certificationsObligatoires, source.habilitationsObligatoires, ...findValuesByKeyHints(source, ["certificationobligatoire", "habilitationobligatoire"]));
  const recommendedCertificationRefs = collectRelationRefs(source.recommendedCertifications, source.certificationsRecommandees, source.habilitations, ...findValuesByKeyHints(source, ["certification", "habilitation"]));
  const requiredCertifications = unique(requiredCertificationRefs.map(ref => toStableCertificationId(ref.label, ref.officialId)));
  const recommendedCertifications = unique(recommendedCertificationRefs.map(ref => toStableCertificationId(ref.label, ref.officialId)));
  const relatedJobs = collectRelatedJobRefs(source.relatedJobs, source.metiersProches, source.prochesMetiers, ...findValuesByKeyHints(source, ["metierproche", "mobilite", "prochemetier"]));
  const officialRomeDomain = buildOfficialRomeDomain(romeCode, firstText(source.domain, source.domaine, source.grandDomaine));
  const domainOfficial = officialRomeDomain.label;
  const familyOfficial = firstText(source.family, source.famille, source.domaineProfessionnel);
  const boussoleSectorIds = mapBoussoleSectors({ romeCode, title, description, activities, appellations });
  const explicitSectorMapping = getRomeSectorMapping(romeCode, { title, description, activities, appellations, domain: domainOfficial, family: familyOfficial });
  const heuristicSectorMapping = mapProfileSectorsFromGenerated(boussoleSectorIds);
  const sectorMapping = explicitSectorMapping.primarySectorId ? explicitSectorMapping : heuristicSectorMapping;
  const stableBoussoleSectorIds = explicitSectorMapping.primarySectorId
    ? mapGeneratedSectorsFromProfile([sectorMapping.primarySectorId, ...sectorMapping.secondarySectorIds])
    : boussoleSectorIds;
  const domain = domainOfficial || inferDomainFromRomeCode(romeCode);
  const boussoleDomainLabel = sectorMapping.domainLabel || stableBoussoleSectorIds.map(id => BOUSSOLE_SECTOR_LABELS[id]).filter(Boolean)[0] || null;
  const family = familyOfficial || domainOfficial || inferFamilyFromRomeCode(romeCode);
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
    activities: activities.length ? SOURCE_OFFICIAL : SOURCE_NOT_AVAILABLE,
    requiredSkills: requiredSkillLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    optionalSkills: optionalSkillLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    softSkills: softSkillLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    knowledge: knowledgeLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    workContexts: contextLabels.length ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    constraints: constraints.source,
    accessConditions: accessText ? SOURCE_OFFICIAL : SOURCE_UNKNOWN,
    requiredDiplomaLevel: source.requiredDiplomaLevel !== undefined ? SOURCE_OFFICIAL : SOURCE_NOT_AVAILABLE,
    recommendedDiplomaLevel: source.recommendedDiplomaLevel !== undefined ? SOURCE_OFFICIAL : SOURCE_NOT_AVAILABLE,
    requiredCertifications: requiredCertifications.length ? SOURCE_OFFICIAL : SOURCE_NOT_AVAILABLE,
    recommendedCertifications: recommendedCertifications.length ? SOURCE_OFFICIAL : SOURCE_NOT_AVAILABLE,
    relatedJobs: relatedJobs.length ? SOURCE_OFFICIAL : SOURCE_NOT_AVAILABLE,
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
    sourceDomain: domain,
    sourceFamily: family,
    boussoleDomainLabel,
    officialRomeDomain,
    boussoleSectorIds: stableBoussoleSectorIds,
    primarySectorId: sectorMapping.primarySectorId,
    secondarySectorIds: sectorMapping.secondarySectorIds,
    sectorMappingConfidence: sectorMapping.confidence,
    sectorEvidence: [{
      source: sectorMapping.source || (officialRomeDomain.source === SOURCE_OFFICIAL ? "official_rome_domain" : "rome_code_domain_mapping"),
      value: sectorMapping.key || domainOfficial || officialRomeDomain.label || romeCode
    }],
    appellations,
    description: description || null,
    activities,
    skillGroups: collectSkillGroups(source.groupesCompetencesMobilisees, source.groupesCompetences),
    mobilizedSkillIds: unique(mobilizedSkillRefs.map(ref => toStableSkillId(ref.label, ref.officialId))),
    matchableSkillIds: unique(requiredSkillRefs.map(ref => toStableSkillId(ref.label, ref.officialId))),
    softSkillIds: unique(softSkillRefs.map(ref => toStableSkillId(ref.label, ref.officialId))),
    knowledgeIds: unique(knowledgeRefs.map(ref => toStableKnowledgeId(ref.label, ref.officialId))),
    requiredSkills: unique(requiredSkillRefs.map(ref => toStableSkillId(ref.label, ref.officialId))),
    optionalSkills: unique(optionalSkillRefs.map(ref => toStableSkillId(ref.label, ref.officialId))),
    softSkills: unique(softSkillRefs.map(ref => toStableSkillId(ref.label, ref.officialId))),
    knowledge: unique(knowledgeRefs.map(ref => toStableKnowledgeId(ref.label, ref.officialId))),
    workContexts: unique(contextRefs.map(ref => toStableContextId(ref.label, ref.officialId))),
    constraints,
    accessConditions: { text: accessText || null, source: accessText ? SOURCE_OFFICIAL : SOURCE_UNKNOWN, confidence: accessText ? 0.8 : 0 },
    physicalConstraints: constraints.physical,
    scheduleConstraints: constraints.schedule,
    mobilityConstraints: constraints.mobility,
    publicContactLevel: contextRefs.length ? inferPublicContactLevel(textPool) : "unknown",
    autonomyLevel: inferAutonomyLevel(textPool),
    remoteCompatibility: contextRefs.length ? inferRemoteCompatibility(textPool) : "unknown",
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
    romeSkillRefs: {
      required: requiredSkillRefs,
      optional: optionalSkillRefs,
      soft: softSkillRefs
    },
    romeKnowledgeRefs: knowledgeRefs,
    romeWorkContextRefs: contextRefs,
    romeAppellationRefs: appellationRefs,
    romeCertificationRefs: {
      required: requiredCertificationRefs,
      recommended: recommendedCertificationRefs
    },
    romeKnowledgeLabels: knowledgeLabels,
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
  const classification = classifyRomeSkill(raw);
  const rawType = firstText(raw.type, raw.categorie, raw.famille, raw.nature, raw.typeCompetence, raw.typeSavoir);
  const rawId = officialId(raw);
  const matchableCandidate = isMatchableSkillCandidate(label, raw, classification);
  return {
    id: toStableSkillId(label, rawId),
    officialId: rawId || null,
    rawId: rawId || null,
    rawKeyOrId: rawId || toStableSkillId(label),
    schemaVersion: "1.0.0",
    label,
    normalizedLabel: normalizedSkillLabel(label),
    type: typeForSkillClassification(classification, rawType),
    category: raw.category || raw.famille || rawType || "rome",
    rawType,
    classification,
    matchableCandidate,
    matchingUse: matchableCandidate ? "candidate" : "excluded",
    matchingScope: isMacroRomeSkill(raw) ? "macro" : "detail",
    aliases: unique([...toArray(raw.aliases), ...aliasesForSkill(label, rawId)]),
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

export function normalizeOfficialRomeJob({ ficheMetierRecord = null, metierRecord = null, skillsIndex = null, contextsIndex = null } = {}) {
  const base = normalizeRomeMetier(ficheMetierRecord || metierRecord || {});
  const metier = metierRecord ? normalizeRomeMetier(metierRecord) : null;
  if (!metier) return markOfficialDetailUnavailable(base);
  const merged = { ...base };
  mergeOfficialField(merged, metier, "title", value => value && value !== "Metier ROME sans titre");
  mergeOfficialField(merged, metier, "appellations", value => value?.length);
  mergeOfficialField(merged, metier, "description", value => Boolean(value));
  mergeOfficialField(merged, metier, "activities", value => value?.length);
  mergeOfficialField(merged, metier, "workContexts", value => value?.length);
  mergeOfficialField(merged, metier, "accessConditions", value => value?.text);
  mergeOfficialField(merged, metier, "requiredCertifications", value => value?.length);
  mergeOfficialField(merged, metier, "recommendedCertifications", value => value?.length);
  mergeOfficialField(merged, metier, "relatedJobs", value => value?.length);
  mergeOfficialField(merged, metier, "romeAppellationRefs", value => value?.length);
  mergeOfficialField(merged, metier, "romeWorkContextRefs", value => value?.length);
  mergeOfficialField(merged, metier, "romeWorkContextLabels", value => value?.length);
  mergeOfficialField(merged, metier, "romeCertificationRefs", value => toArray(value?.required).length || toArray(value?.recommended).length);
  if (metier.description) {
    merged.officialDescription = {
      definition: metier.description,
      purpose: null,
      characteristicsSummary: null,
      source: SOURCE_OFFICIAL
    };
  }
  const dataQuality = recomputeJobDataQuality(merged, {
    keepWarnings: ["official_detail_unavailable"],
    normalizer: "normalizeOfficialRomeJob",
    relationIndexesAvailable: {
      skills: Boolean(skillsIndex) || hasLinkedSkillEvidence(merged),
      contexts: Boolean(contextsIndex) || hasLinkedContextEvidence(merged)
    }
  });
  merged.dataQuality = dataQuality;
  merged.missingFields = dataQuality.missingFields;
  merged.confidence = dataQuality.confidence;
  return merged;
}

function markOfficialDetailUnavailable(job = {}) {
  const fieldSources = {
    ...(job.fieldSources || {}),
    description: job.description ? job.fieldSources?.description || SOURCE_OFFICIAL : SOURCE_OFFICIAL_DETAIL_UNAVAILABLE,
    appellations: toArray(job.appellations).length ? job.fieldSources?.appellations || SOURCE_OFFICIAL : SOURCE_OFFICIAL_DETAIL_UNAVAILABLE,
    workContexts: toArray(job.workContexts).length ? job.fieldSources?.workContexts || SOURCE_OFFICIAL : SOURCE_OFFICIAL_DETAIL_UNAVAILABLE,
    accessConditions: job.accessConditions?.text ? job.fieldSources?.accessConditions || SOURCE_OFFICIAL : SOURCE_OFFICIAL_DETAIL_UNAVAILABLE,
    activities: SOURCE_NOT_AVAILABLE,
    relatedJobs: SOURCE_NOT_AVAILABLE,
    requiredCertifications: SOURCE_NOT_AVAILABLE,
    recommendedCertifications: SOURCE_NOT_AVAILABLE,
    requiredDiplomaLevel: SOURCE_NOT_AVAILABLE,
    recommendedDiplomaLevel: SOURCE_NOT_AVAILABLE
  };
  const patched = {
    ...job,
    fieldSources,
    dataQuality: {
      ...(job.dataQuality || {}),
      status: "generated_partial_api_exception"
    }
  };
  const dataQuality = recomputeJobDataQuality(patched, {
    status: "generated_partial_api_exception",
    extraWarnings: ["official_detail_unavailable"]
  });
  return {
    ...patched,
    dataQuality,
    missingFields: dataQuality.missingFields,
    confidence: dataQuality.confidence
  };
}

function mergeOfficialField(target, source, field, hasMeaningfulValue) {
  if (!source || !hasMeaningfulValue(source[field])) return;
  target[field] = source[field];
  target.fieldSources = {
    ...(target.fieldSources || {}),
    [field]: source.fieldSources?.[field] || SOURCE_OFFICIAL
  };
}

export function classifyRomeSkill(entry = {}) {
  const label = firstText(entry.label, entry.libelle, entry.intitule, entry.nom, entry.title);
  const text = normalizeText(label);
  const rawType = normalizeText(firstText(entry.type, entry.categorie, entry.famille, entry.nature, entry.typeCompetence, entry.typeSavoir));
  if (!label) return "unknown";
  if (isCertificationLikeLabel(text) || /(certification|diplome|habilitation|titre|permis|rncp|rs)/.test(rawType)) return "certification_like";
  if (/(savoir.etre|savoir etre|macro.savoir.etre|savoir-etre|savoir-être|soft)/.test(rawType)) return "soft_skill";
  if (/(savoir|connaissance|knowledge)/.test(rawType) && !/(savoir.faire|savoir faire|savoir-faire)/.test(rawType)) return "knowledge";
  if (isJobLikeLabel(text) && !startsWithActionVerb(text)) return "job_like";
  if (isTooSpecificSkillLabel(text)) return "too_specific";
  if (startsWithActionVerb(text) || /(savoir.faire|savoir faire|savoir-faire|competence|macro.savoir.faire)/.test(rawType)) return "skill_action";
  return "unknown";
}

export function mergeRomeDatasets(parts = {}) {
  const metiersByCode = new Map(toArray(parts.metiers)
    .map(record => [extractRecordRomeCode(record), record])
    .filter(([code]) => code));
  const ficheJobs = toArray(parts.fichesMetiers).map(fiche => normalizeOfficialRomeJob({
    ficheMetierRecord: fiche,
    metierRecord: metiersByCode.get(extractRecordRomeCode(fiche))
  }));
  const ficheCodes = new Set(ficheJobs.map(job => job.romeCode).filter(Boolean));
  const metierOnlyJobs = toArray(parts.metiers)
    .filter(record => !ficheCodes.has(extractRecordRomeCode(record)))
    .map(metierRecord => normalizeOfficialRomeJob({ metierRecord }));
  const jobs = uniqueBy([...ficheJobs, ...metierOnlyJobs], "id")
    .map(job => ({
      ...job,
      dataQuality: recomputeJobDataQuality(job)
    }))
    .map(job => ({
      ...job,
      missingFields: job.dataQuality.missingFields,
      confidence: job.dataQuality.confidence
    }));
  const skillLayers = buildRomeSkillLayers(parts.competences || [], jobs);
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
    rawSkills: skillLayers.rawSkills,
    skills: skillLayers.filteredSkills,
    knowledge: skillLayers.knowledge,
    certificationLike: skillLayers.certificationLike,
    matchableSkills: skillLayers.matchableSkills,
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

function buildRomeSkillLayers(rawCompetences = [], jobs = []) {
  const linkedSkillIds = new Set(jobs.flatMap(job => [...toArray(job.requiredSkills), ...toArray(job.optionalSkills), ...toArray(job.softSkills)]));
  const rawSkills = uniqueBy(rawCompetences.map(normalizeRomeCompetence), "rawKeyOrId");
  const linkedFromJobs = deriveSkillsFromJobs(jobs).map(skill => ({
    ...skill,
    linkedToCorpusJobs: true,
    matchableCandidate: true,
    matchingUse: "linked_job_skill",
    matchingScope: "linked"
  }));
  const rawLinked = rawSkills
    .filter(skill => linkedSkillIds.has(skill.id))
    .map(skill => ({ ...skill, linkedToCorpusJobs: true, matchingUse: "linked_job_skill" }));
  const macroMatchable = rawSkills
    .filter(skill => skill.matchableCandidate && skill.matchingScope === "macro")
    .map(skill => ({ ...skill, matchingUse: "macro_matchable" }));
  const filteredSkills = uniqueBy([
    ...linkedFromJobs,
    ...rawLinked,
    ...macroMatchable,
    ...rawSkills.filter(skill => skill.matchableCandidate && linkedSkillIds.has(skill.id))
  ], "id");
  const matchableCandidates = uniqueBy([
    ...linkedFromJobs.filter(skill => isUserFacingSkillLabel(skill.label)),
    ...rawLinked.filter(skill => skill.matchableCandidate),
    ...macroMatchable.filter(skill => isUserFacingSkillLabel(skill.label))
  ], "id");
  const matchableSkills = selectMatchableSkills(matchableCandidates, jobs);
  const knowledge = uniqueBy([
    ...rawSkills.filter(skill => skill.classification === "knowledge").map(skill => knowledgeFromSkill(skill)),
    ...deriveKnowledgeFromJobs(jobs)
  ], "id");
  const certificationLike = uniqueBy([
    ...rawSkills.filter(skill => skill.classification === "certification_like"),
    ...deriveCertificationLikeFromJobs(jobs)
  ], "id");
  return {
    rawSkills,
    filteredSkills,
    knowledge,
    certificationLike,
    matchableSkills
  };
}

function selectMatchableSkills(candidates = [], jobs = []) {
  const byId = new Map(candidates.map(skill => [skill.id, skill]));
  const selected = [];
  const selectedIds = new Set();

  const addSkill = id => {
    if (!id || selectedIds.has(id) || !byId.has(id) || selected.length >= MATCHABLE_SKILLS_LIMIT) return;
    selectedIds.add(id);
    selected.push(byId.get(id));
  };

  jobs.forEach(job => {
    unique([
      ...toArray(job.matchableSkillIds),
      ...toArray(job.skillGroups?.matchable),
      ...toArray(job.softSkillIds),
      ...toArray(job.requiredSkills),
      ...toArray(job.softSkills)
    ]).slice(0, 10).forEach(addSkill);
  });

  candidates
    .filter(skill => skill.matchingScope === "macro" || skill.matchingUse === "macro_matchable")
    .forEach(skill => addSkill(skill.id));

  candidates.forEach(skill => addSkill(skill.id));
  return selected;
}

function buildMissingFields(fields) {
  const missing = [];
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value) && value.length === 0) missing.push(key);
    else if (value === undefined || value === null || value === "") missing.push(key);
  });
  return missing;
}

function hasKnownDiplomaLevel(job = {}) {
  return (
    job.requiredDiplomaLevel !== null &&
    job.requiredDiplomaLevel !== undefined &&
    Number.isFinite(Number(job.requiredDiplomaLevel))
  ) || (
    job.recommendedDiplomaLevel !== null &&
    job.recommendedDiplomaLevel !== undefined &&
    Number.isFinite(Number(job.recommendedDiplomaLevel))
  );
}

function hasLinkedSkillEvidence(job = {}) {
  return Boolean(
    toArray(job.requiredSkills).length ||
    toArray(job.optionalSkills).length ||
    toArray(job.softSkills).length ||
    toArray(job.matchableSkillIds).length ||
    toArray(job.mobilizedSkillIds).length ||
    toArray(job.romeSkillRefs?.required).length ||
    toArray(job.romeSkillRefs?.optional).length ||
    toArray(job.romeSkillRefs?.soft).length
  );
}

function hasLinkedContextEvidence(job = {}) {
  return Boolean(
    toArray(job.workContexts).length ||
    toArray(job.romeWorkContextRefs).length ||
    toArray(job.romeWorkContextLabels).length
  );
}

function calculateJobCompleteness(job = {}) {
  return completenessScore(buildJobMissingFields(job));
}

function calculateJobDataConfidence(job = {}) {
  const completeness = calculateJobCompleteness(job);
  const officialEvidence = [
    job.fieldSources?.title,
    job.fieldSources?.description,
    job.fieldSources?.appellations,
    job.fieldSources?.requiredSkills,
    job.fieldSources?.knowledge,
    job.fieldSources?.workContexts,
    job.fieldSources?.accessConditions
  ].filter(source => source === SOURCE_OFFICIAL).length;
  const evidenceBonus = Math.min(0.12, officialEvidence * 0.015);
  const exceptionPenalty = toArray(job.dataQuality?.warnings).includes("official_detail_unavailable") ? 0.08 : 0;
  return Number(Math.max(0.2, Math.min(0.92, completeness + evidenceBonus - exceptionPenalty)).toFixed(2));
}

function buildJobMissingFields(job = {}) {
  const missingFields = [];
  if (!job.romeCode) missingFields.push("romeCode");
  if (!job.title) missingFields.push("title");
  if (!job.description) missingFields.push("description");
  if (!toArray(job.activities).length) missingFields.push("activities");
  if (!toArray(job.appellations).length) missingFields.push("appellations");
  if (!toArray(job.requiredSkills).length) missingFields.push("requiredSkills");
  if (!toArray(job.knowledge).length) missingFields.push("knowledge");
  if (!toArray(job.workContexts).length) missingFields.push("workContexts");
  if (!job.accessConditions?.text) missingFields.push("accessConditions");
  if (!hasKnownDiplomaLevel(job)) {
    missingFields.push("requiredDiplomaLevel");
    missingFields.push("recommendedDiplomaLevel");
  }
  return unique(missingFields);
}

function recomputeJobDataQuality(job = {}, options = {}) {
  const missingFields = buildJobMissingFields(job);
  const previousWarnings = toArray(job.dataQuality?.warnings)
    .filter(warning => !String(warning).startsWith("missing_"))
    .filter(warning => warning !== "computed_tags_to_verify")
    .filter(warning => warning !== "computed_constraints_to_verify")
    .filter(warning => warning !== "official_rome_generated");
  const keep = new Set(options.keepWarnings || []);
  const carriedWarnings = previousWarnings.filter(warning => keep.has(warning) || warning === "official_detail_unavailable");
  const warnings = unique([
    "official_rome_generated",
    job.constraints?.source === "computed_low_confidence" ? "computed_constraints_to_verify" : null,
    ...carriedWarnings,
    ...toArray(options.extraWarnings),
    ...missingFields.map(field => `missing_${field}`)
  ]);
  const relationIndexesAvailable = {
    ...(job.dataQuality?.relationIndexesAvailable || {}),
    ...(options.relationIndexesAvailable || {}),
    skills: Boolean(options.relationIndexesAvailable?.skills) || hasLinkedSkillEvidence(job),
    contexts: Boolean(options.relationIndexesAvailable?.contexts) || hasLinkedContextEvidence(job)
  };
  return {
    ...(job.dataQuality || {}),
    ...(options.normalizer ? { normalizer: options.normalizer } : {}),
    status: options.status || (missingFields.length ? "generated_partial" : "generated_complete"),
    missingFields,
    warnings,
    relationIndexesAvailable,
    completenessScore: calculateJobCompleteness(job),
    confidence: calculateJobDataConfidence({ ...job, dataQuality: { ...(job.dataQuality || {}), warnings } })
  };
}

function inferConstraints(textPool) {
  const text = normalizeText(textPool.join(" "));
  const physicalTags = [];
  if (/\b(station debout|debout|marche prolongee|manutention|chantier|terrain|exterieur|plein air|atelier|cuisine|stock|magasin)\b/.test(text)) physicalTags.push("standing");
  if (/\b(port de charge|port de charges|charges lourdes|manutention lourde|manutention)\b/.test(text)) physicalTags.push("load");
  if (/\b(exterieur|plein air|jardin|chantier|terrain|agricole|agriculture)\b/.test(text)) physicalTags.push("outdoor");
  if (/\b(bruit|bruyant|machine|atelier|industrie|chantier)\b/.test(text)) physicalTags.push("noise");
  const nightWork = /\b(nuit|travail de nuit|astreinte nocturne|urgence)\b/.test(text) ? "possible" : "unknown";
  const weekendWork = /\b(week-end|weekend|dimanche|jours feries|jours fériés)\b/.test(text) ? "possible" : "unknown";
  const travelFrequency = /\b(deplacement|déplacement|deplacements|déplacements|itinerance|itinérance|livraison|transport|domicile|chantier|terrain)\b/.test(text) ? "medium" : "unknown";
  const driverLicenseRequired = /\b(permis b|permis de conduire|conduite de vehicule|conduite de véhicule|livraison|vehicule|véhicule)\b/.test(text);
  const hasSignal = physicalTags.length || nightWork !== "unknown" || weekendWork !== "unknown" || travelFrequency !== "unknown" || driverLicenseRequired;
  const source = hasSignal ? "computed_low_confidence" : SOURCE_UNKNOWN;
  return {
    source,
    physical: { level: physicalTags.length ? "medium" : "unknown", tags: unique(physicalTags), source, confidence: hasSignal ? 0.25 : 0 },
    schedule: { nightWork, weekendWork, irregularHours: nightWork === "possible" || weekendWork === "possible" ? "possible" : "unknown", source, confidence: hasSignal ? 0.25 : 0 },
    mobility: { travelFrequency, driverLicenseRequired, driverLicenseTypes: driverLicenseRequired ? ["B"] : [], source, confidence: hasSignal ? 0.25 : 0 }
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
    const refs = job.romeSkillRefs || {};
    return [
      ...toArray(refs.required).map(ref => skillFromRef(ref, "savoir-faire", "rome-required")),
      ...toArray(refs.optional).map(ref => skillFromRef(ref, "savoir-faire", "rome-optional")),
      ...toArray(refs.soft).map(ref => skillFromRef(ref, "savoir-etre", "rome-soft"))
    ];
  });
}

function skillFromRef(ref, type, category) {
  const label = ref?.label || String(ref || "");
  const classification = classifyRomeSkill({ label, type: ref?.rawType || type });
  return {
    id: toStableSkillId(label, ref?.officialId),
    schemaVersion: "1.0.0",
    officialId: ref?.officialId || null,
    label,
    normalizedLabel: normalizedSkillLabel(label),
    rawId: ref?.officialId || null,
    rawType: ref?.rawType || "",
    type: typeForSkillClassification(classification, ref?.rawType || type),
    classification,
    category,
    aliases: aliasesForSkill(label, ref?.officialId),
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.75
  };
}

function deriveKnowledgeFromJobs(jobs) {
  return jobs.flatMap(job => toArray(job.romeKnowledgeRefs).map(ref => ({
    id: toStableKnowledgeId(ref.label, ref.officialId),
    schemaVersion: "1.0.0",
    rawId: ref.officialId || null,
    label: ref.label,
    jobId: job.id,
    romeCode: job.romeCode,
    type: "knowledge",
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.7
  })));
}

function deriveCertificationLikeFromJobs(jobs) {
  return jobs.flatMap(job => [
    ...toArray(job.romeCertificationRefs?.required),
    ...toArray(job.romeCertificationRefs?.recommended)
  ].map(ref => ({
    id: toStableCertificationId(ref.label, ref.officialId),
    schemaVersion: "1.0.0",
    rawId: ref.officialId || null,
    label: ref.label,
    jobId: job.id,
    romeCode: job.romeCode,
    classification: "certification_like",
    source: SOURCE_OFFICIAL,
    provenance: "generated_rome",
    confidence: 0.7
  })));
}

function knowledgeFromSkill(skill) {
  return {
    id: toStableKnowledgeId(skill.label),
    schemaVersion: "1.0.0",
    rawId: skill.rawId || null,
    label: skill.label,
    type: "knowledge",
    category: skill.category || "rome",
    source: skill.source,
    provenance: skill.provenance,
    confidence: skill.confidence,
    classification: "knowledge"
  };
}

function typeForSkillClassification(classification, rawType = "") {
  if (classification === "soft_skill") return "savoir-etre";
  if (classification === "knowledge") return "savoir";
  if (classification === "certification_like") return "certification_like";
  if (classification === "job_like") return "job_like";
  if (classification === "too_specific") return "too_specific";
  return rawType || "savoir-faire";
}

function aliasesForSkill(label = "", rawId = null) {
  const normalized = normalizedSkillLabel(label);
  const aliases = [];
  if (rawId) aliases.push(`skill-rome-${slug(rawId)}`);
  if (normalized) aliases.push(`skill-rome-${slug(normalized)}`);
  const rules = [
    ["skill-active-listening", /ecoute.*empathie|empathie/],
    ["skill-teamwork", /esprit.*equipe/],
    ["skill-organisation", /organiser.*travail|priorites.*objectifs/],
    ["skill-admin-doc", /dossier|base de donnees|archiver|documentation/],
    ["skill-animation", /animer|atelier|activites d animation/],
    ["skill-cleaning", /nettoyer|entretenir un espace|desinfecter/],
    ["skill-gardening", /jardin|espace vert|vegetal|plante/],
    ["skill-animal-care", /animal|bien etre animal/],
    ["skill-writing", /rediger|rapport|compte rendu/],
    ["skill-data", /donnees|base de donnees/]
  ];
  rules.forEach(([alias, pattern]) => {
    if (pattern.test(normalized)) aliases.push(alias);
  });
  return unique(aliases);
}

function isMatchableSkillCandidate(label, raw, classification) {
  if (!["skill_action", "soft_skill"].includes(classification)) return false;
  if (!isUserFacingSkillLabel(label)) return false;
  if (classification === "soft_skill") return true;
  return startsWithActionVerb(normalizeText(label)) || isMacroRomeSkill(raw);
}

function isUserFacingSkillLabel(label) {
  const text = normalizeText(label);
  return Boolean(text)
    && text.length >= 8
    && text.length <= 130
    && !isCertificationLikeLabel(text)
    && !isTooSpecificSkillLabel(text)
    && !(isJobLikeLabel(text) && !startsWithActionVerb(text));
}

function isMacroRomeSkill(raw = {}) {
  const type = normalizeText(firstText(raw.type, raw.categorie, raw.famille, raw.nature, raw.typeCompetence, raw.typeSavoir));
  return /macro/.test(type);
}

function isCertificationLikeLabel(text) {
  return /\b(certificat|certification|diplome|diplôme|titre professionnel|cap|bac|bts|licence|master|caces|habilitation|permis|carte professionnelle|rncp|rs|attestation|brevet)\b/.test(text);
}

function isJobLikeLabel(text) {
  return /^(agent|assistante?|technicien(ne)?|responsable|charge de|chargee de|op[eé]rateur|operatrice|conducteur|conductrice|formateur|formatrice|conseiller|conseillere|animateur|animatrice|directeur|directrice)\b/.test(text);
}

function isTooSpecificSkillLabel(text) {
  if (text.length > 150) return true;
  if ((text.match(/\//g) || []).length >= 2) return true;
  if (/\b(version|module|logiciel proprietaire|machine specifique|norme iso [0-9]+|article [0-9]+)\b/.test(text)) return true;
  if (/\b[a-z]{1,3}[0-9]{2,}\b/.test(text)) return true;
  return false;
}

function startsWithActionVerb(text) {
  return /^(accueillir|accompagner|adapter|administrer|aider|alyser|analyser|animer|appliquer|assembler|assurer|classer|communiquer|concevoir|conduire|conseiller|controler|contrôler|coordonner|creer|créer|cultiver|decrire|décrire|developper|développer|diagnostiquer|ecouter|écouter|elaborer|élaborer|entretenir|evaluer|évaluer|fabriquer|faciliter|former|gerer|gérer|identifier|installer|mettre|mettre en oeuvre|nettoyer|observer|organiser|orienter|preparer|préparer|presenter|présenter|produire|realiser|réaliser|rediger|rédiger|reparer|réparer|respecter|securiser|sécuriser|servir|suivre|transmettre|trier|utiliser|verifier|vérifier)\b/.test(text);
}

function deriveContextsFromJobs(jobs) {
  return jobs.flatMap(job => toArray(job.romeWorkContextRefs).map(ref => buildContextFromLabel(ref.label, { id: ref.officialId, sourcePath: ref.sourcePath })));
}

function buildContextFromLabel(label, raw = {}) {
  const rawId = officialId(raw);
  return {
    id: toStableContextId(label, rawId),
    schemaVersion: "1.0.0",
    rawId: rawId || null,
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
  if (/\b(bureau|administratif)\b/.test(text)) tags.push("office", "quiet");
  if (/\b(domicile)\b/.test(text)) tags.push("field", "travel");
  if (/\b(exterieur|terrain|chantier|jardin|agricole|agriculture)\b/.test(text)) tags.push("outdoor", "field");
  if (/\b(equipe|collectif|collaboration)\b/.test(text)) tags.push("team");
  if (/\b(public|client|patient|usager|accueil)\b/.test(text)) tags.push("public-contact");
  if (/\b(enfant|petite enfance)\b/.test(text)) tags.push("children");
  if (/\b(animal|animaux)\b/.test(text)) tags.push("animals");
  if (/\b(atelier|outil|manuel)\b/.test(text)) tags.push("manual");
  if (/\b(bruit|bruyant|machine|industrie)\b/.test(text)) tags.push("noise");
  if (/\b(deplacement|deplacements|livraison|transport|itinerance)\b/.test(text)) tags.push("travel");
  return unique(tags);
}

function deriveAppellationsFromJobs(jobs) {
  return jobs.flatMap(job => toArray(job.romeAppellationRefs).map(ref => ({
    id: toStableAppellationId(job, ref),
    schemaVersion: "1.0.0",
    jobId: job.id,
    romeCode: job.romeCode,
    rawId: ref.officialId || null,
    label: ref.label,
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
    skillIds: [...toArray(job.requiredSkills), ...toArray(job.optionalSkills), ...toArray(job.softSkills)],
    contextIds: toArray(job.workContexts),
    appellationIds: toArray(job.romeAppellationRefs).map(ref => toStableAppellationId(job, ref)),
    knowledgeIds: toArray(job.romeKnowledgeRefs).map(ref => toStableKnowledgeId(ref.label, ref.officialId)),
    relatedJobIds: toArray(job.relatedJobs),
    relatedRomeCodes: toArray(job.relatedJobs)
      .map(value => String(value).replace(/^job-/, "").replace(/^rome-/, ""))
      .filter(value => /^[A-Z][0-9]{4}/.test(value)),
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

function extractRecordRomeCode(record = {}) {
  const source = unwrapFiche(record);
  return firstText(
    source.romeCode,
    source.codeRome,
    source.code,
    source.metier?.code,
    record.romeCode,
    record.codeRome,
    record.code,
    record.metier?.code
  );
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
  if (raw?.metier && (raw.code || raw.groupesCompetencesMobilisees || raw.groupesSavoirs || raw.obsolete !== undefined)) return raw;
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

function collectRelationRefs(...values) {
  const refs = [];
  const visit = (value, path = "$") => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value === "string" || typeof value === "number") {
      refs.push({ officialId: null, label: String(value), sourcePath: path });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      const label = firstText(value.libelle, value.intitule, value.label, value.title, value.nom, value.texte);
      const id = officialId(value);
      if (label || id) refs.push({ officialId: id || null, label: label || id, sourcePath: path, rawType: firstText(value.type, value.categorie, value.famille, value.nature) || null });
      Object.entries(value)
        .filter(([, child]) => Array.isArray(child))
        .forEach(([key, child]) => visit(child, `${path}.${key}`));
    }
  };
  values.forEach((value, index) => visit(value, `$[${index}]`));
  return uniqueBy(refs.filter(ref => ref.label || ref.officialId), ref => `${ref.officialId || ""}|${normalizeText(ref.label)}`);
}

function officialId(raw = {}) {
  return firstText(raw.id, raw.code, raw.identifiant, raw.uuid, raw.idCompetence, raw.codeCompetence, raw.idContexte, raw.codeContexte, raw.idAppellation, raw.codeAppellation);
}

function findValuesByKeyHints(source, hints = []) {
  const matches = [];
  const normalizedHints = hints.map(normalizeText).filter(Boolean);
  const seen = new Set();
  const visit = (value, key = "", depth = 0) => {
    if (value === undefined || value === null || depth > 8) return;
    const normalizedKey = normalizeText(key).replace(/[^a-z0-9]/g, "");
    if (normalizedHints.some(hint => normalizedKey.includes(hint.replace(/[^a-z0-9]/g, "")))) {
      matches.push(value);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach(item => visit(item, key, depth + 1));
      return;
    }
    Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey, depth + 1));
  };
  visit(source);
  return matches;
}

function buildOfficialRomeDomain(romeCode = "", fallbackLabel = "") {
  const code = String(romeCode || "").charAt(0).toUpperCase();
  return {
    code: code || null,
    label: fallbackLabel || ROME_DOMAIN_BY_LETTER[code] || "Domaine ROME non renseigné",
    source: fallbackLabel ? SOURCE_OFFICIAL : ROME_DOMAIN_BY_LETTER[code] ? SOURCE_COMPUTED : SOURCE_UNKNOWN
  };
}

function mapBoussoleSectors({ romeCode = "", title = "", description = "", activities = [], appellations = [] } = {}) {
  const code = String(romeCode || "").toUpperCase();
  const text = normalizeText([title, description, ...activities, ...appellations].join(" "));
  const sectors = [];
  const add = id => { if (BOUSSOLE_SECTOR_LABELS[id] && !sectors.includes(id)) sectors.push(id); };
  if (/^M18/.test(code) || /(informatique|logiciel|developp|développ|data|donnee|donnée|reseau|réseau|numerique|numérique|cyber|web)/.test(text)) add("numerique");
  if (/^M1[256]/.test(code) || /(administratif|secretariat|secrétariat|bureau|comptab|paie|ressources humaines|dossier)/.test(text)) add("administratif");
  if (/^J/.test(code)) add("soin_sante");
  if (/^K1[1248]/.test(code) || /(social|insertion|mediation|médiation|accompagn|aide a domicile|aide à domicile)/.test(text)) add("social_accompagnement");
  if (/^K1303|^K21|^G1202/.test(code) || /(enfant|petite enfance|education|éducation|formation|animation)/.test(text)) add("enfance_education");
  if (/^A/.test(code) || /(agric|jardin|paysage|animal|nature|environnement)/.test(text)) add("nature_agriculture_animaux");
  if (/^F|^I|^B/.test(code) || /(batiment|bâtiment|chantier|maintenance|artisan|reparer|réparer|fabrication|atelier)/.test(text)) add("artisanat_batiment_maintenance");
  if (/^D|^M17/.test(code) || /(vente|commerce|client|relation client|magasin)/.test(text)) add("commerce_relation_client");
  if (/^G/.test(code) || /(restauration|hotel|hôtel|tourisme|accueil|cuisine)/.test(text)) add("restauration_hotellerie_tourisme");
  if (/^H/.test(code) || /(industrie|production|qualite|qualité|laboratoire)/.test(text)) add("industrie_qualite");
  if (/^N|^K25/.test(code) || /(logistique|transport|livraison|stock|securite|sécurité|surveillance)/.test(text)) add("logistique_transport_securite");
  if (/^E|^L/.test(code) || /(communication|media|média|culture|spectacle|creation|création|artistique|documentaire)/.test(text)) add("culture_communication_creation");
  if (/^M14|^K24|^C/.test(code) || /(analyse|conseil|etude|étude|recherche|audit|assurance|banque|immobilier)/.test(text)) add("recherche_analyse");
  if (/^K19|^K14/.test(code) || /(juridique|judiciaire|droit|protection des majeurs|administration publique)/.test(text)) add("droit_gestion_publique");
  if (/^K22/.test(code) || /(proprete|propreté|nettoyage|entretien des locaux)/.test(text)) add("services_proprete");
  return sectors;
}

function mapProfileSectorsFromGenerated(boussoleSectorIds = []) {
  const mapped = unique(toArray(boussoleSectorIds).flatMap(id => PROFILE_SECTOR_FROM_GENERATED[id] || []));
  return {
    primarySectorId: mapped[0] || null,
    secondarySectorIds: mapped.slice(1, 3),
    confidence: mapped.length ? 0.82 : 0,
    source: mapped.length ? "generated_rome_heuristic_sector_mapping" : SOURCE_UNKNOWN,
    key: null
  };
}

function mapGeneratedSectorsFromProfile(profileSectorIds = []) {
  return unique(toArray(profileSectorIds)
    .map(id => GENERATED_SECTOR_FROM_PROFILE[id])
    .filter(id => BOUSSOLE_SECTOR_LABELS[id]));
}

function getRomeSectorMapping(romeCode = "", context = {}) {
  const code = String(romeCode || "").toUpperCase();
  const mappedV2 = getRomeSectorMappingV2(code, context);
  if (isStrongRomeSectorMappingV2(mappedV2)) return mappedV2;
  const direct = ROME_SECTOR_MAPPING.mappings?.[code];
  if (direct) return { ...direct, secondarySectorIds: toArray(direct.secondarySectorIds).filter(id => id !== direct.primarySectorId).slice(0, 2), source: "local_rome_sector_mapping_v062", key: code };
  const fallback = ROME_SECTOR_MAPPING.prefixFallbacks?.[code.charAt(0)];
  if (fallback) return { ...fallback, secondarySectorIds: toArray(fallback.secondarySectorIds).filter(id => id !== fallback.primarySectorId).slice(0, 1), source: "local_rome_sector_prefix_fallback_v062", key: code.charAt(0) };
  if (mappedV2.primarySectorId) return mappedV2;
  return { primarySectorId: null, secondarySectorIds: [], confidence: 0, source: SOURCE_UNKNOWN, key: null };
}

function isStrongRomeSectorMappingV2(mapping = {}) {
  return Boolean(mapping.primarySectorId) && /_exact$|_prefix4$|_prefix3$/.test(String(mapping.source || ""));
}

function getRomeSectorMappingV2(code = "", context = {}) {
  if (!code) return { primarySectorId: null, secondarySectorIds: [], confidence: 0, source: SOURCE_UNKNOWN, key: null };
  const exact = ROME_SECTOR_MAPPING_V2.exact?.[code];
  if (exact) return buildRomeSectorMappingV2Result(exact, code, "exact");
  const prefix4 = ROME_SECTOR_MAPPING_V2.prefix4?.[code.slice(0, 4)];
  if (prefix4) return buildRomeSectorMappingV2Result(prefix4, code.slice(0, 4), "prefix4");
  const prefix3 = ROME_SECTOR_MAPPING_V2.prefix3?.[code.slice(0, 3)];
  if (prefix3) return buildRomeSectorMappingV2Result(prefix3, code.slice(0, 3), "prefix3");
  const textRule = toArray(ROME_SECTOR_MAPPING_V2.textRules).find(rule => {
    const text = getRomeSectorTextRuleSource(rule, context);
    if (!rule?.pattern || !text) return false;
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return false;
    }
  });
  if (textRule) return buildRomeSectorMappingV2Result(textRule, textRule.pattern, textRule.source || "text_rule");
  return { primarySectorId: null, secondarySectorIds: [], confidence: 0, source: SOURCE_UNKNOWN, key: null };
}

function getRomeSectorTextRuleSource(rule = {}, context = {}) {
  if (rule.source === "family") return normalizeText(context.family || "");
  if (rule.source === "domain") return normalizeText(context.domain || "");
  if (rule.source === "title_heuristic") return normalizeText(context.title || "");
  return normalizeText([context.title, context.family, context.domain].join(" "));
}

function buildRomeSectorMappingV2Result(entry = {}, key = "", source = "unknown") {
  return {
    primarySectorId: entry.primarySectorId || null,
    secondarySectorIds: toArray(entry.secondarySectorIds).filter(id => id && id !== entry.primarySectorId).slice(0, 2),
    domainLabel: entry.domainLabel || null,
    confidence: Number(entry.confidence || 0),
    source: `local_rome_sector_mapping_v2_${source}`,
    key
  };
}

function collectSkillGroups(...values) {
  return collectRawItems(...values).flatMap((group, index) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    const issueId = firstText(group.id, group.code, group.identifiant) || `issue-${index + 1}`;
    const issueLabel = firstText(group.enjeu?.libelle, group.enjeu?.label, group.enjeu?.intitule, group.libelle, group.label, group.intitule, group.nom) || `Groupe de compétences ${index + 1}`;
    const refs = collectRelationRefs(
      group.competences,
      group.competencesMobilisees,
      group.competencesDetaillees,
      group.savoirFaire,
      group.savoirsFaire,
      group.items,
      group.elements,
      group.lignes
    );
    return [{
      issueId,
      issueLabel,
      skills: unique(refs.map(ref => toStableSkillId(ref.label, ref.officialId)))
    }];
  }).filter(group => group.skills.length);
}

function toStableSkillId(value, official = null) {
  if (String(value || "").startsWith("skill-")) return String(value);
  return official ? `skill-rome-${slug(official)}` : `skill-rome-${slug(value || "competence")}`;
}

function toStableContextId(value, official = null) {
  if (String(value || "").startsWith("ctx-")) return String(value);
  return official ? `ctx-rome-${slug(official)}` : `ctx-rome-${slug(value || "contexte")}`;
}

function toStableKnowledgeId(value, official = null) {
  if (String(value || "").startsWith("knowledge-")) return String(value);
  return official ? `knowledge-rome-${slug(official)}` : `knowledge-rome-${slug(value || "savoir")}`;
}

function toStableCertificationId(value, official = null) {
  if (String(value || "").startsWith("cert-")) return String(value);
  return official ? `cert-rome-${slug(official)}` : `cert-rome-${slug(value || "certification")}`;
}

function toStableAppellationId(job = {}, ref = {}) {
  if (ref.officialId) return `appellation-rome-${slug(ref.officialId)}`;
  return `appellation-${job.romeCode || slug(job.id)}-${slug(ref.label || "appellation")}`;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = typeof key === "function" ? key(item) : item[key];
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

function normalizedSkillLabel(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function loadRomeSectorMapping(fileName = "rome-sector-mapping.json", fallback = { mappings: {}, prefixFallbacks: {} }) {
  try {
    const url = new URL(`../creations/boussolepro/data/local/${fileName}`, import.meta.url);
    return { ...fallback, ...JSON.parse(readFileSync(url, "utf8")) };
  } catch {
    return fallback;
  }
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "local";
}
