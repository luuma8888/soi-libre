import { createHash } from "node:crypto";

export const RUNTIME_SCHEMA_VERSION = "1.0.0";
export const RUNTIME_TERRITORIES = Object.freeze({
  FR: "France",
  "REG-76": "Occitanie",
  "DEP-11": "Aude"
});

const TERRITORY_KEYS = Object.freeze({ FR: "national", "REG-76": "regional", "DEP-11": "departmental" });
const SOURCE_LEVELS = Object.freeze({ FR: "national", "REG-76": "regional", "DEP-11": "departmental" });
const DIPLOMA_LABELS = Object.freeze({ 0: "Sans diplôme", 1: "Brevet", 2: "CAP/BEP", 3: "CAP/BEP", 4: "Bac", 5: "Bac +2", 6: "Bac +3", 7: "Bac +5" });
const DIRECTION_LABELS = Object.freeze({
  accompagner_relier: "Accompagner et relier",
  accueillir_conseiller_vendre: "Accueillir, conseiller et vendre",
  administrer_garantir_droits: "Administrer et garantir les droits",
  animer_faire_vivre: "Animer et faire vivre",
  batir_prendre_soin_lieux: "Bâtir et prendre soin des lieux",
  comprendre_concevoir: "Comprendre et concevoir",
  construire_numerique: "Construire le numérique",
  creer_exprimer: "Créer et exprimer",
  cultiver_proteger_vivant: "Cultiver et protéger le vivant",
  faconner_fabriquer: "Façonner et fabriquer",
  gerer_piloter: "Gérer et piloter",
  grandir_transmettre: "Grandir et transmettre",
  nourrir_recevoir: "Nourrir et recevoir",
  produire_maintenir: "Produire et maintenir",
  proteger_secourir: "Protéger et secourir",
  soigner_soutenir: "Soigner et soutenir",
  transporter_organiser_flux: "Transporter et organiser les flux"
});

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildCompactRuntime(dataset, metadata) {
  const jobs = array(dataset?.jobs);
  if (jobs.length !== 1000) throw new Error(`Le corpus maître doit contenir 1000 métiers, reçu : ${jobs.length}.`);
  const generatedAt = requiredText(metadata.generatedAt, "generatedAt");
  const datasetVersion = requiredText(metadata.datasetVersion, "datasetVersion");
  const sourceDate = requiredText(metadata.sourceDate, "sourceDate");

  const relations = buildCompetenceRelations(jobs);
  const knowledgeLabels = buildKnowledgeLabels(dataset, jobs, relations.knowledgeIds);
  const skillItems = buildSkillItems(dataset, relations.skillIds, relations.softSkillIds);
  const knowledgeItems = [...relations.knowledgeIds].sort().map(id => ({ id, label: knowledgeLabels.get(id), type: "knowledge" }));
  const groupDictionary = buildGroupDictionary(jobs);
  const contextDictionary = buildContextDictionary(dataset, jobs);
  const directionDictionary = buildDirectionDictionary(jobs);
  const sectorDictionary = buildSectorDictionary(jobs);
  const romeDomains = buildRomeDomainDictionaries(jobs);
  const accessWarnings = buildAccessWarningDictionary(jobs);

  const core = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    datasetVersion,
    generatedAt,
    sourceDate,
    jobs: jobs.map(job => compactCoreJob(job)),
    workContexts: contextDictionary.items,
    diplomaLevels: compactDiplomaLevels(dataset.diplomaLevels),
    dictionaries: { directions: directionDictionary, sectors: sectorDictionary, accessWarnings, ...romeDomains }
  };
  const competences = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    datasetVersion,
    generatedAt,
    items: [...skillItems, ...knowledgeItems],
    groups: groupDictionary.items,
    jobs: jobs.map(job => compactCompetenceJob(job, groupDictionary.idByLabel))
  };
  const marche = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    datasetVersion,
    generatedAt,
    vintages: inferMarketVintages(jobs),
    territories: { ...RUNTIME_TERRITORIES },
    jobs: jobs.map(compactMarketJob)
  };

  const diagnostics = {
    unresolvedKnowledgeIds: [...relations.knowledgeIds].filter(id => !knowledgeLabels.get(id)),
    referencedSkillIds: relations.skillIds.size,
    referencedKnowledgeIds: relations.knowledgeIds.size,
    softSkillIds: relations.softSkillIds.size,
    droppedNonScoringMobilizedIds: relations.droppedMobilizedIds.size,
    groupOccurrences: jobs.reduce((sum, job) => sum + array(job.skillGroups).length, 0),
    contextReferences: contextDictionary.references,
    accessPaths: jobs.reduce((sum, job) => sum + array(job.accessPaths || job.accessSummary?.accessPaths).length, 0)
  };
  const validation = validateCompactRuntime({ core, competences, marche }, diagnostics);
  if (validation.failures.length) throw new Error(`Projection runtime invalide : ${validation.failures.join(", ")}`);
  return { core, competences, marche, diagnostics, validation };
}

function compactCoreJob(job) {
  const accessSummary = compactAccessSummary(job.accessSummary);
  const accessPaths = array(job.accessPaths || job.accessSummary?.accessPaths).map(compactAccessPath);
  const classification = {
    romeGrandDomainCode: job.romeGrandDomainCode || String(job.romeCode || "").slice(0, 1),
    romeProfessionalDomainCode: job.romeProfessionalDomainCode || String(job.romeCode || "").slice(0, 3),
  };
  return omitEmpty({
    id: job.id || `rome-${job.romeCode}`,
    romeCode: job.romeCode,
    title: job.title,
    description: job.description,
    appellations: unique(array(job.appellations).map(item => typeof item === "string" ? item : item?.label).filter(Boolean)),
    ...classification,
    domain: job.domain,
    family: job.family === job.domain ? null : job.family,
    boussoleDomainLabel: job.boussoleDomainLabel,
    primaryDirection: job.primaryDirection,
    primarySectorId: job.primarySectorId,
    secondarySectorIds: unique(array(job.secondarySectorIds)),
    boussoleSectorIds: unique(array(job.boussoleSectorIds)),
    sectorMappingConfidence: numberOrNull(job.sectorMappingConfidence),
    interestTags: unique(array(job.interestTags)),
    valueTags: unique(array(job.valueTags)),
    transitionTags: unique(array(job.transitionTags)),
    workContexts: unique(array(job.workContexts).map(contextId)),
    confidence: numberOrNull(job.confidence),
    missingFields: unique(array(job.missingFields)),
    accessSummary,
    accessPaths,
    constraints: compactConstraints(job)
  });
}

function compactAccessSummary(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const summary = omitEmpty({
    displayLabel: raw.displayLabel,
    accessLevelCategory: raw.accessLevelCategory || "unknown",
    requirementKind: raw.requirementKind || "unknown",
    minimumDiplomaLevel: numberOrNull(raw.minimumDiplomaLevel),
    maximumDiplomaLevel: numberOrNull(raw.maximumDiplomaLevel),
    specificCredentialRequired: Boolean(raw.specificCredentialRequired),
    requiredCredentialLabels: unique(array(raw.requiredCredentialLabels)),
    optionalCredentialLabels: unique(array(raw.optionalCredentialLabels)),
    requiredExams: unique(array(raw.requiredExams)),
    noDiplomaPossible: Boolean(raw.noDiplomaPossible),
    regulated: Boolean(raw.regulated),
    contradictoryEvidence: Boolean(raw.contradictoryEvidence),
    mandatoryQualification: Boolean(raw.mandatoryQualification),
    trainingDuration: compactTrainingDuration(raw.trainingDuration),
    citedDiplomas: unique(array(raw.citedDiplomas)),
    citedCertifications: unique(array(raw.citedCertifications)),
    confidence: numberOrZero(raw.confidence),
    warnings: unique(array(raw.warnings).map(shortWarningCode))
  });
  return summary;
}

function compactAccessPath(raw = {}) {
  return omitEmpty({
    id: raw.id || raw.pathId,
    label: raw.label,
    routeType: raw.routeType,
    examRequired: Boolean(raw.examRequired),
    examLabel: raw.examLabel,
    minimumDiplomaLevel: numberOrNull(raw.minimumDiplomaLevel),
    maximumDiplomaLevel: numberOrNull(raw.maximumDiplomaLevel),
    requiredCredentialLabels: unique(array(raw.requiredCredentialLabels)),
    requiredExperienceYears: numberOrNull(raw.requiredExperienceYears),
    requiredExperienceScope: raw.requiredExperienceScope,
    validFrom: raw.validFrom,
    validThrough: raw.validThrough,
    trainingDuration: compactTrainingDuration(raw.trainingDuration),
    confidence: numberOrZero(raw.confidence)
  });
}

function compactTrainingDuration(raw = null) {
  const duration = raw && typeof raw === "object" ? raw : {};
  return {
    category: ["unknown", "none", "short", "intermediate", "long"].includes(duration.category) ? duration.category : "unknown",
    minimumMonths: numberOrNull(duration.minimumMonths),
    maximumMonths: numberOrNull(duration.maximumMonths),
    confidence: numberOrZero(duration.confidence)
  };
}

function compactConstraints(job) {
  const base = job.constraints || {};
  const physical = job.physicalConstraints || base.physical || {};
  const schedule = job.scheduleConstraints || base.schedule || {};
  const mobility = job.mobilityConstraints || base.mobility || {};
  const official = job.officialConstraintSummary || {};
  return {
    physical: {
      level: physical.level || "unknown",
      tags: unique(array(physical.tags)),
      sourceKind: sourceKind(physical.source || base.source),
      confidence: numberOrZero(physical.confidence)
    },
    schedule: {
      nightWork: normalizeFrequency(schedule.nightWork),
      weekendWork: normalizeFrequency(schedule.weekendWork),
      irregularHours: normalizeFrequency(schedule.irregularHours),
      sourceKind: sourceKind(schedule.source || base.source),
      confidence: numberOrZero(schedule.confidence)
    },
    mobility: {
      travelFrequency: mobility.travelFrequency || "unknown",
      driverLicenseRequired: Boolean(mobility.driverLicenseRequired),
      driverLicenseTypes: unique(array(mobility.driverLicenseTypes)),
      sourceKind: sourceKind(mobility.source || base.source),
      confidence: numberOrZero(mobility.confidence)
    },
    publicContactLevel: job.publicContactLevel || "unknown",
    autonomyLevel: job.autonomyLevel || "unknown",
    remoteCompatibility: job.remoteCompatibility || "unknown",
    officialSignals: array(official.confirmedSignals).map(signal => omitEmpty({
      target: signal.target,
      value: signal.value,
      contextId: signal.contextId || signal.sourceContextId,
      confidence: numberOrZero(signal.confidence)
    })),
    unknownDimensions: unique(array(official.unknownDimensions)),
    confidence: numberOrZero(official.confidence)
  };
}

function buildCompetenceRelations(jobs) {
  const skillIds = new Set();
  const softSkillIds = new Set();
  const knowledgeIds = new Set();
  const droppedMobilizedIds = new Set();
  for (const job of jobs) {
    const required = relationIds(job.requiredSkills?.length ? job.requiredSkills : job.matchableSkillIds);
    const soft = relationIds(job.softSkillIds?.length ? job.softSkillIds : job.softSkills);
    const knowledge = relationIds(job.knowledgeIds?.length ? job.knowledgeIds : job.knowledge);
    required.forEach(id => skillIds.add(id));
    soft.forEach(id => { skillIds.add(id); softSkillIds.add(id); });
    knowledge.forEach(id => knowledgeIds.add(id));
    const retained = new Set([...required, ...soft]);
    relationIds(job.mobilizedSkillIds).filter(id => !retained.has(id)).forEach(id => droppedMobilizedIds.add(id));
  }
  return { skillIds, softSkillIds, knowledgeIds, droppedMobilizedIds };
}

function buildSkillItems(dataset, referencedIds, softIds) {
  const source = [...array(dataset.skillsEngine), ...array(dataset.skills)];
  const byId = new Map(source.filter(item => item?.id).map(item => [item.id, item]));
  const missing = [...referencedIds].filter(id => !byId.get(id)?.label);
  if (missing.length) throw new Error(`Compétences référencées sans libellé : ${missing.slice(0, 20).join(", ")}`);
  const orderedIds = unique(source.map(item => item?.id).filter(id => referencedIds.has(id)));
  return orderedIds.map(id => {
    const item = byId.get(id);
    const aliases = unique(array(item.aliases)).filter(alias => alias !== id && alias !== generatedAlias(id, item.label));
    const type = softIds.has(id) ? "soft_skill" : item.classification || item.type || "skill_action";
    return omitEmpty({ id, label: String(item.label).trim(), type, aliases });
  });
}

function buildKnowledgeLabels(dataset, jobs, referencedIds) {
  const labels = new Map();
  for (const item of array(dataset.knowledge)) if (item?.id && humanLabel(item.label, item.id)) labels.set(item.id, String(item.label).trim());
  for (const job of jobs) {
    for (const ref of array(job.romeKnowledgeRefs)) {
      const id = ref?.officialId ? `knowledge-rome-${ref.officialId}` : null;
      if (id && humanLabel(ref.label, id)) labels.set(id, String(ref.label).trim());
    }
  }
  const unresolved = [...referencedIds].filter(id => !labels.has(id));
  if (unresolved.length) throw new Error(`Savoirs référencés sans libellé humain : ${unresolved.slice(0, 20).join(", ")} (${unresolved.length}).`);
  return labels;
}

function buildGroupDictionary(jobs) {
  const labels = [...new Set(
    jobs.flatMap(job => array(job.skillGroups)
      .map(group => String(group.issueLabel || "").trim())
      .filter(Boolean))
  )].sort((a, b) => a.localeCompare(b, "fr"));
  const idByLabel = new Map();
  const labelById = new Map();
  for (const label of labels) {
    const id = slug(label);
    if (labelById.has(id) && labelById.get(id) !== label) throw new Error(`Collision de groupes de compétences : ${labelById.get(id)} / ${label}.`);
    idByLabel.set(label, id);
    labelById.set(id, label);
  }
  return { idByLabel, items: labels.map(label => ({ id: idByLabel.get(label), label })) };
}

function compactCompetenceJob(job, groupIds) {
  const requiredSkillIds = relationIds(job.requiredSkills?.length ? job.requiredSkills : job.matchableSkillIds);
  const optionalSkillIds = relationIds(job.optionalSkills);
  const softSkillIds = relationIds(job.softSkillIds?.length ? job.softSkillIds : job.softSkills);
  const knowledgeIds = relationIds(job.knowledgeIds?.length ? job.knowledgeIds : job.knowledge);
  const retained = new Set([...requiredSkillIds, ...optionalSkillIds, ...softSkillIds]);
  return omitEmpty({
    jobId: job.id,
    requiredSkillIds,
    optionalSkillIds,
    softSkillIds,
    knowledgeIds,
    skillGroups: array(job.skillGroups).map(group => ({
      groupId: groupIds.get(String(group.issueLabel || "").trim()),
      skillIds: relationIds(group.skills).filter(id => retained.has(id))
    })).filter(group => group.skillIds.length)
  });
}

function buildContextDictionary(dataset, jobs) {
  const ids = new Set();
  for (const job of jobs) {
    array(job.workContexts).map(contextId).filter(Boolean).forEach(id => ids.add(id));
    array(job.officialConstraintSummary?.confirmedSignals).map(signal => signal.contextId || signal.sourceContextId).filter(Boolean).forEach(id => ids.add(id));
  }
  const byId = new Map(array(dataset.workContexts).map(item => [item.id, item]));
  const missing = [...ids].filter(id => !byId.get(id)?.label);
  if (missing.length) throw new Error(`Contextes de travail orphelins : ${missing.slice(0, 20).join(", ")}`);
  const items = [...ids].sort().map(id => omitEmpty({ id, label: byId.get(id).label, category: byId.get(id).category, constraintTags: unique(array(byId.get(id).constraintTags)) }));
  return { items, references: ids.size };
}

function buildDirectionDictionary(jobs) {
  const ids = [...new Set(jobs.map(job => job.primaryDirection).filter(Boolean))].sort();
  return ids.map(id => ({ id, label: DIRECTION_LABELS[id] || id.replaceAll("_", " ") }));
}

function buildSectorDictionary(jobs) {
  const labels = new Map();
  for (const job of jobs) {
    if (job.primarySectorId) labels.set(job.primarySectorId, job.boussoleDomainLabel || job.domain || job.primarySectorId);
    for (const id of array(job.secondarySectorIds)) if (!labels.has(id)) labels.set(id, id.replaceAll("_", " "));
  }
  return [...labels].sort(([a], [b]) => a.localeCompare(b)).map(([id, label]) => ({ id, label }));
}

function buildRomeDomainDictionaries(jobs) {
  const grand = new Map();
  const professional = new Map();
  for (const job of jobs) {
    const grandCode = job.romeGrandDomainCode || String(job.romeCode || "").slice(0, 1);
    const grandLabel = job.romeGrandDomainLabel || job.officialRomeDomain?.label;
    const professionalCode = job.romeProfessionalDomainCode || String(job.romeCode || "").slice(0, 3);
    if (grandCode && grandLabel) grand.set(grandCode, grandLabel);
    if (professionalCode && job.romeProfessionalDomainLabel) professional.set(professionalCode, job.romeProfessionalDomainLabel);
  }
  const rows = map => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([code, label]) => ({ code, label }));
  return { romeGrandDomains: rows(grand), romeProfessionalDomains: rows(professional) };
}

function buildAccessWarningDictionary(jobs) {
  const labels = new Map();
  for (const job of jobs) {
    for (const warning of array(job.accessSummary?.warnings)) {
      const id = shortWarningCode(warning);
      if (labels.has(id) && labels.get(id) !== warning) throw new Error(`Collision de codes d’avertissement d’accès : ${id}.`);
      labels.set(id, warning);
    }
  }
  return [...labels].sort(([a], [b]) => a.localeCompare(b)).map(([id, label]) => ({ id, label }));
}

function compactDiplomaLevels(raw) {
  const levels = array(raw);
  if (levels.length) return levels.map(item => omitEmpty({ level: numberOrNull(item.level), label: item.label }));
  return Object.entries(DIPLOMA_LABELS).map(([level, label]) => ({ level: Number(level), label }));
}

function compactMarketJob(job) {
  return {
    jobId: job.id,
    territories: Object.fromEntries(Object.keys(RUNTIME_TERRITORIES).map(territoryId => [territoryId, compactMarketTerritory(job.marketStats || {}, territoryId)]))
  };
}

function compactMarketTerritory(stats, territoryId) {
  const raw = stats[TERRITORY_KEYS[territoryId]] || {};
  const offersCount = numberOrNull(raw.offersFranceTravail12m ?? raw.offers12m);
  const families = array(stats.fapEnrichment?.territories?.[territoryId]);
  const synthesis = synthesizeFapFamilies(families);
  const ambiguous = synthesis.status === "ambiguous";
  const family = synthesis.family;
  const dares = family?.dares || null;
  const bmo = family?.bmo || null;
  const tensionImputed = Boolean(dares?.imputed || dares?.tension?.details?.imputed);
  const difficultyAvailable = bmo?.recruitmentDifficulty?.status === "available";
  const hasOffers = Number.isFinite(offersCount);
  const hasContext = Boolean(dares || difficultyAvailable);
  const availability = ambiguous ? "ambiguous" : hasOffers && hasContext ? "available" : hasOffers || hasContext ? "partial" : "unavailable";
  return {
    availability,
    offersCount,
    offersLevel: raw.absoluteOfferSignal || (offersCount === 0 ? "zero" : "unknown"),
    territorialSignal: raw.territorialOfferSignal || (offersCount === 0 ? "zero_local" : "unknown"),
    tensionClass: !tensionImputed && dares?.displayAsOfficialClass ? numberOrNull(dares.publishedDiscreteClass ?? dares.tension?.details?.publishedDiscreteClass) : null,
    tensionLevel: dares?.tension?.level || "unknown",
    tensionImputed,
    recruitmentDifficultyRate: difficultyAvailable ? numberOrNull(bmo.recruitmentDifficulty.value) : null,
    statisticalScope: family ? "fap_family" : hasOffers ? "rome" : "unknown",
    sharedFamily: Boolean(stats.fapEnrichment?.sharedFamily || synthesis.shared),
    confidence: ambiguous ? Math.min(0.35, numberOrZero(raw.confidence)) : numberOrZero(raw.confidence)
  };
}

function synthesizeFapFamilies(families) {
  if (!families.length) return { status: "absent", family: null, shared: false };
  if (families.length === 1) return { status: "available", family: families[0], shared: false };
  const signatures = families.map(family => JSON.stringify({
    difficulty: family?.bmo?.recruitmentDifficulty?.status === "available" ? family.bmo.recruitmentDifficulty.value : null,
    tension: family?.dares?.tension?.level || "unknown",
    tensionClass: family?.dares?.publishedDiscreteClass ?? null,
    imputed: Boolean(family?.dares?.imputed)
  }));
  if (new Set(signatures).size > 1) return { status: "ambiguous", family: null, shared: true };
  return { status: "available", family: families[0], shared: true };
}

function inferMarketVintages(jobs) {
  const periods = jobs.flatMap(job => Object.values(job.marketStats || {}).filter(value => value && typeof value === "object").map(value => value.latestPeriodCode)).filter(Boolean).sort();
  const bmoYears = jobs.flatMap(job => Object.values(job.marketStats?.fapEnrichment?.territories || {}).flatMap(array).map(row => Number(row?.bmo?.year))).filter(Number.isFinite);
  const daresYears = jobs.flatMap(job => Object.values(job.marketStats?.fapEnrichment?.territories || {}).flatMap(array).map(row => Number(row?.dares?.year))).filter(Number.isFinite);
  return { offers: periods.at(-1) || null, bmo: String(Math.max(0, ...bmoYears) || ""), daresTension: String(Math.max(0, ...daresYears) || "") };
}

export function adaptCompactRuntime({ core, competences, marche }, manifest = null) {
  const relations = new Map(array(competences?.jobs).map(item => [item.jobId, item]));
  const marketRows = new Map(array(marche?.jobs).map(item => [item.jobId, item]));
  const groups = new Map(array(competences?.groups).map(item => [item.id, item.label]));
  const contexts = new Map(array(core?.workContexts).map(item => [item.id, item]));
  const grandDomains = new Map(array(core?.dictionaries?.romeGrandDomains).map(item => [item.code, item.label]));
  const professionalDomains = new Map(array(core?.dictionaries?.romeProfessionalDomains).map(item => [item.code, item.label]));
  const accessWarnings = new Map(array(core?.dictionaries?.accessWarnings).map(item => [item.id, item.label]));
  const skills = array(competences?.items).filter(item => item.type !== "knowledge").map(item => ({
    id: item.id,
    label: item.label,
    classification: item.type,
    type: item.type,
    aliases: array(item.aliases)
  }));
  const skillLabels = new Map(skills.map(item => [item.id, item.label]));
  const knowledge = array(competences?.items).filter(item => item.type === "knowledge").map(item => ({ id: item.id, label: item.label, type: "knowledge", classification: "knowledge" }));
  const jobs = array(core?.jobs).map(job => {
    const relation = relations.get(job.id) || {};
    const required = array(relation.requiredSkillIds);
    const optional = array(relation.optionalSkillIds);
    const soft = array(relation.softSkillIds);
    const knowledgeIds = array(relation.knowledgeIds);
    const displayed = array(relation.skillGroups).flatMap(group => array(group.skillIds));
    const accessSummary = expandAccessSummary(job.accessSummary, job.accessPaths, core.diplomaLevels, accessWarnings);
    const constraints = expandConstraints(job.constraints, contexts);
    return {
      ...job,
      canonicalId: job.id,
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      provenance: "generated_rome",
      romeGrandDomainLabel: grandDomains.get(job.romeGrandDomainCode) || null,
      romeProfessionalDomainLabel: professionalDomains.get(job.romeProfessionalDomainCode) || null,
      domain: job.domain,
      family: job.family || job.domain,
      sourceDomain: job.domain,
      sourceFamily: job.family || job.domain,
      appellations: array(job.appellations),
      boussoleSectorIds: array(job.boussoleSectorIds),
      secondarySectorIds: array(job.secondarySectorIds),
      interestTags: array(job.interestTags),
      valueTags: array(job.valueTags),
      transitionTags: array(job.transitionTags),
      workContexts: array(job.workContexts),
      romeWorkContextLabels: array(job.workContexts).map(id => contexts.get(id)?.label).filter(Boolean),
      missingFields: array(job.missingFields),
      activities: [],
      accessConditions: { text: null, source: "compact_structured_runtime", confidence: accessSummary?.confidence || 0 },
      accessSummary,
      accessPaths: array(job.accessPaths),
      skillGroups: array(relation.skillGroups).map(group => ({ issueId: group.groupId, issueLabel: groups.get(group.groupId) || group.groupId, skills: array(group.skillIds) })),
      requiredSkills: required,
      matchableSkillIds: required,
      scorableSkillIds: required,
      optionalSkills: optional,
      softSkillIds: soft,
      softSkills: soft,
      mobilizedSkillIds: unique([...displayed, ...required, ...optional, ...soft]),
      romeSkillLabels: {
        required: required.map(id => skillLabels.get(id)).filter(Boolean),
        optional: optional.map(id => skillLabels.get(id)).filter(Boolean),
        soft: soft.map(id => skillLabels.get(id)).filter(Boolean)
      },
      knowledgeIds,
      knowledge: knowledgeIds,
      constraints: constraints.constraints,
      physicalConstraints: constraints.physicalConstraints,
      scheduleConstraints: constraints.scheduleConstraints,
      mobilityConstraints: constraints.mobilityConstraints,
      officialConstraintSummary: constraints.officialConstraintSummary,
      publicContactLevel: job.constraints?.publicContactLevel || "unknown",
      autonomyLevel: job.constraints?.autonomyLevel || "unknown",
      remoteCompatibility: job.constraints?.remoteCompatibility || "unknown",
      requiredDiplomaLevel: null,
      recommendedDiplomaLevel: null,
      requiredCertifications: [],
      recommendedCertifications: [],
      relatedJobs: [],
      market: { status: "unknown", source: "unknown", confidence: 0 },
      marketIndicators: [],
      marketStats: expandMarketStats(marketRows.get(job.id), marche)
    };
  });
  return {
    schemaVersion: core.schemaVersion,
    datasetName: "Boussole Pro - runtime compact ROME1000",
    datasetVersion: core.datasetVersion,
    sourceDate: core.sourceDate,
    importedAt: core.generatedAt,
    provenance: "generated_rome",
    confidence: 0.75,
    jobs,
    skills,
    skillsEngine: skills,
    matchableSkills: skills.filter(item => item.classification === "skill_action"),
    knowledge,
    workContexts: array(core.workContexts).map(item => ({ ...item, constraintTags: array(item.constraintTags) })),
    jobAppellations: [],
    diplomaLevels: array(core.diplomaLevels),
    marketTrends: { schemaVersion: marche.schemaVersion, generatedAt: marche.generatedAt, jobs: [] },
    runtimeBundleIdentity: {
      inputMode: "compact_runtime_v1",
      runtimeBundleRevision: core.datasetVersion,
      fingerprintSha256: manifest?.runtimeFingerprintSha256 || null,
      sourceDatasetVersion: core.datasetVersion,
      status: "validated_compact_runtime",
      counts: { jobs: jobs.length, skillsEngine: skills.length, knowledge: knowledge.length }
    }
  };
}

function expandAccessSummary(summary, paths, diplomaLevels, warningLabels = new Map()) {
  if (!summary) return null;
  const labels = new Map(array(diplomaLevels).map(item => [Number(item.level), item.label]));
  return {
    ...summary,
    warnings: array(summary.warnings).map(id => warningLabels.get(id) || id),
    minimumDiplomaLabel: summary.minimumDiplomaLevel == null ? null : labels.get(Number(summary.minimumDiplomaLevel)) || DIPLOMA_LABELS[summary.minimumDiplomaLevel] || null,
    maximumDiplomaLabel: summary.maximumDiplomaLevel == null ? null : labels.get(Number(summary.maximumDiplomaLevel)) || DIPLOMA_LABELS[summary.maximumDiplomaLevel] || null,
    examRequired: array(summary.requiredExams).length > 0,
    accessPaths: array(paths),
    source: "compact_structured_runtime",
    matchedExcerpts: [],
    generatedAt: null
  };
}

function expandConstraints(compact = {}, contexts) {
  const source = kind => kind === "official" ? "official_work_contexts" : kind === "computed" ? "computed_low_confidence" : "unknown";
  const physicalConstraints = { ...(compact.physical || {}), source: source(compact.physical?.sourceKind) };
  const scheduleConstraints = { ...(compact.schedule || {}), source: source(compact.schedule?.sourceKind) };
  const mobilityConstraints = { ...(compact.mobility || {}), source: source(compact.mobility?.sourceKind) };
  delete physicalConstraints.sourceKind;
  delete scheduleConstraints.sourceKind;
  delete mobilityConstraints.sourceKind;
  const confirmedSignals = array(compact.officialSignals).map(signal => ({
    label: contexts.get(signal.contextId)?.label || signal.target,
    target: signal.target,
    value: signal.value,
    evidenceStatus: "official_confirmed",
    sourceContextId: signal.contextId,
    confidence: signal.confidence
  }));
  return {
    constraints: { source: [compact.physical?.sourceKind, compact.schedule?.sourceKind, compact.mobility?.sourceKind].includes("official") ? "official_work_contexts" : "computed_low_confidence", physical: physicalConstraints, schedule: scheduleConstraints, mobility: mobilityConstraints },
    physicalConstraints,
    scheduleConstraints,
    mobilityConstraints,
    officialConstraintSummary: { confirmedSignals, unknownDimensions: array(compact.unknownDimensions), source: confirmedSignals.length ? "official_work_contexts" : "unknown", confidence: numberOrZero(compact.confidence) }
  };
}

function expandMarketStats(row, marche) {
  const empty = { sourceLevel: "none", sourceName: null, offersFranceTravail12m: null, offersAll12m: null, offers12m: null, absoluteOfferSignal: "unknown", territorialOfferSignal: "unknown", marketFreshness: "unknown", confidence: 0 };
  const territoryStats = {};
  const fapTerritories = {};
  for (const territoryId of Object.keys(RUNTIME_TERRITORIES)) {
    const key = TERRITORY_KEYS[territoryId];
    const item = row?.territories?.[territoryId];
    if (!item) { territoryStats[key] = { ...empty }; continue; }
    const sourceLevel = Number.isFinite(item.offersCount) ? SOURCE_LEVELS[territoryId] : "none";
    territoryStats[key] = {
      sourceLevel,
      sourceName: sourceLevel === "none" ? null : "api_marche_travail",
      sourceUpdatedAt: null,
      territoryId,
      territoryLabel: RUNTIME_TERRITORIES[territoryId],
      marketDataKind: "offers_volume",
      marketInterpretationLabel: "Volume d’offres observé",
      latestPeriodCode: marche?.vintages?.offers || null,
      latestPeriodLabel: marche?.vintages?.offers || null,
      offersFranceTravail12m: item.offersCount,
      offersAll12m: item.offersCount,
      offers12m: item.offersCount,
      absoluteOfferSignal: item.offersLevel === "very_high" ? "high" : item.offersLevel,
      territorialOfferSignal: item.territorialSignal,
      marketFreshness: "unknown",
      confidence: item.confidence
    };
    if (item.statisticalScope === "fap_family" && item.availability !== "ambiguous") {
      const difficulty = Number.isFinite(item.recruitmentDifficultyRate) ? { status: "available", value: item.recruitmentDifficultyRate, confidence: item.confidence } : { status: "unavailable", value: null, confidence: 0 };
      const dares = item.tensionLevel !== "unknown" ? {
        year: marche?.vintages?.daresTension,
        territoryLabel: RUNTIME_TERRITORIES[territoryId],
        tension: { status: "available", value: null, level: item.tensionLevel, confidence: item.confidence, details: { publishedDiscreteClass: item.tensionClass, imputed: item.tensionImputed } },
        publishedDiscreteClass: item.tensionClass,
        imputed: item.tensionImputed,
        displayAsOfficialClass: !item.tensionImputed && item.tensionClass !== null
      } : null;
      fapTerritories[territoryId] = [{
        bmo: { year: marche?.vintages?.bmo, territoryLabel: RUNTIME_TERRITORIES[territoryId], recruitmentProjects: { status: "unavailable", value: null, confidence: 0 }, recruitmentDifficulty: difficulty, seasonality: { status: "unavailable", value: null, confidence: 0 } },
        dares
      }];
    }
  }
  return {
    romeCode: String(row?.jobId || "").replace(/^rome-/, ""),
    sourceLevel: Object.values(territoryStats).some(item => item.sourceLevel === "departmental") ? "departmental" : Object.values(territoryStats).some(item => item.sourceLevel === "regional") ? "regional" : Object.values(territoryStats).some(item => item.sourceLevel === "national") ? "national" : "none",
    sourceName: "api_marche_travail",
    sourceUpdatedAt: null,
    marketDataKind: "offers_volume",
    marketInterpretationLabel: "Volume d’offres observé",
    ...territoryStats,
    bmo: { year: marche?.vintages?.bmo, status: "not_connected", sourceLevel: "not_connected", usedInMarketScore: false, confidence: 0, mappingConfidence: 0 },
    fapEnrichment: Object.keys(fapTerritories).length ? { sharedFamily: Object.values(row?.territories || {}).some(item => item.sharedFamily), territories: fapTerritories, displayEligible: true, rankingEligible: false, warning: "Statistique de famille FAP partagée ; elle ne décrit pas exclusivement ce métier." } : null
  };
}

export function validateCompactRuntime(runtime, diagnostics = {}) {
  const failures = [];
  const { core, competences, marche } = runtime;
  const jobs = array(core?.jobs);
  const codes = jobs.map(job => job.romeCode);
  const jobIds = new Set(jobs.map(job => job.id));
  const items = new Map(array(competences?.items).map(item => [item.id, item]));
  const groups = new Set(array(competences?.groups).map(item => item.id));
  const contexts = new Set(array(core?.workContexts).map(item => item.id));
  const relationJobs = new Set(array(competences?.jobs).map(item => item.jobId));
  const marketJobs = new Set(array(marche?.jobs).map(item => item.jobId));
  if (jobs.length !== 1000) failures.push("jobs_count");
  if (new Set(codes).size !== 1000 || codes.some(code => !/^[A-Z][0-9]{4}$/.test(code || ""))) failures.push("rome_codes");
  if (new Set([core?.schemaVersion, competences?.schemaVersion, marche?.schemaVersion]).size !== 1) failures.push("schema_versions");
  if (new Set([core?.datasetVersion, competences?.datasetVersion, marche?.datasetVersion]).size !== 1) failures.push("dataset_versions");
  if (new Set([core?.generatedAt, competences?.generatedAt, marche?.generatedAt]).size !== 1) failures.push("generated_at");
  if (relationJobs.size !== jobIds.size || [...jobIds].some(id => !relationJobs.has(id))) failures.push("competence_job_relations");
  if (marketJobs.size !== jobIds.size || [...jobIds].some(id => !marketJobs.has(id))) failures.push("market_job_relations");
  for (const relation of array(competences?.jobs)) {
    if (!jobIds.has(relation.jobId)) failures.push(`orphan_job:${relation.jobId}`);
    for (const id of [...array(relation.requiredSkillIds), ...array(relation.optionalSkillIds), ...array(relation.softSkillIds), ...array(relation.knowledgeIds)]) if (!items.has(id)) failures.push(`orphan_item:${id}`);
    for (const group of array(relation.skillGroups)) {
      if (!groups.has(group.groupId)) failures.push(`orphan_group:${group.groupId}`);
      for (const id of array(group.skillIds)) if (!items.has(id)) failures.push(`orphan_group_item:${id}`);
    }
  }
  for (const job of jobs) {
    for (const id of array(job.workContexts)) if (!contexts.has(id)) failures.push(`orphan_context:${id}`);
    for (const signal of array(job.constraints?.officialSignals)) if (signal.contextId && !contexts.has(signal.contextId)) failures.push(`orphan_signal_context:${signal.contextId}`);
  }
  if (array(competences?.items).some(item => !humanLabel(item.label, item.id))) failures.push("technical_item_label");
  if (diagnostics.unresolvedKnowledgeIds?.length) failures.push("unresolved_knowledge_labels");
  const forbidden = [];
  walkKeys(runtime, key => { if (["fapEnrichment", "accessConditions", "requiredSkills", "matchableSkillIds", "scorableSkillIds"].includes(key)) forbidden.push(key); });
  if (forbidden.length) failures.push(`forbidden_runtime_keys:${unique(forbidden).join("|")}`);
  return { status: failures.length ? "failed" : "passed", failures: unique(failures), counts: { jobs: jobs.length, skills: array(competences?.items).filter(item => item.type !== "knowledge").length, knowledge: array(competences?.items).filter(item => item.type === "knowledge").length, skillGroups: groups.size, workContexts: contexts.size } };
}

function walkKeys(value, visitor) {
  if (Array.isArray(value)) return value.forEach(item => walkKeys(item, visitor));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) { visitor(key, child); walkKeys(child, visitor); }
}

function shortWarningCode(value) {
  return slug(String(value || "warning")).replace(/^_+|_+$/g, "") || "warning";
}

function sourceKind(value) {
  const source = String(value || "").toLowerCase();
  if (source.includes("official")) return "official";
  if (source.includes("computed") || source.includes("estimated")) return "computed";
  return "unknown";
}

function normalizeFrequency(value) {
  if (["unknown", "none", "possible", "frequent", "frequent_or_possible"].includes(value)) return value;
  return "unknown";
}

function contextId(value) {
  if (typeof value === "string") return value;
  return value?.id || value?.contextId || value?.workContextId || null;
}

function relationIds(value) {
  return unique(array(value).map(item => typeof item === "string" ? item : item?.id || item?.skillId || item?.knowledgeId).filter(Boolean));
}

function generatedAlias(id, label) {
  return `${id.startsWith("skill-rome-") ? "skill-rome" : id.split("-").slice(0, -1).join("-")}-${slug(label)}`;
}

function humanLabel(label, id) {
  const text = String(label || "").trim();
  if (!text || text === id) return false;
  return !/^(?:skill|knowledge|ctx|group)-[a-z0-9_-]+$/i.test(text);
}

function slug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function omitEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "" && (!Array.isArray(item) || item.length > 0)));
}

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} est obligatoire.`);
  return text;
}

function numberOrNull(value) {
  const number = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(number) ? null : number;
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function unique(values) {
  return [...new Set(values)];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
