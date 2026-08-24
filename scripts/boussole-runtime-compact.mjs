import { createHash } from "node:crypto";

export const RUNTIME_SCHEMA_VERSION = "1.3.0";
export const RUNTIME_TERRITORIES = Object.freeze({
  FR: "France",
  "REG-76": "Occitanie",
  "DEP-11": "Aude"
});

const TERRITORY_KEYS = Object.freeze({ FR: "national", "REG-76": "regional", "DEP-11": "departmental" });
const SOURCE_LEVELS = Object.freeze({ FR: "national", "REG-76": "regional", "DEP-11": "departmental" });
const DIPLOMA_LABELS = Object.freeze({ 0: "Non renseigné ou sans diplôme", 3: "CAP / BEP", 4: "Bac", 5: "Bac +2", 6: "Bac +3 / Bac +4", 7: "Bac +5", 8: "Doctorat" });
const ACCESS_WARNING_LABELS = Object.freeze({
  "access-text-missing": "Conditions d’accès détaillées non disponibles.",
  "context-specific-requirement": "Certaines exigences dépendent du poste ou de l’employeur.",
  "contradictory-access-evidence": "Les sources disponibles donnent des indications contradictoires.",
  "mixed-required-and-optional-wording": "Le texte mélange exigences obligatoires et recommandations.",
  "multiple-diploma-mentions": "Plusieurs niveaux de diplôme sont mentionnés ; le parcours exact est à vérifier.",
  "negated-obligation-detected": "Une absence d’obligation a été détectée ; vérifiez le détail des conditions d’accès."
});
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
const AUDIENCE_LABELS = Object.freeze({
  petite_enfance: "Petite enfance (0–3 ans)",
  children_preschool_3_6: "Enfants de maternelle (3–6 ans)",
  children_multi_age: "Enfants de plusieurs âges",
  youth: "Jeunesse"
});

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildCompactRuntime(dataset, metadata) {
  const jobs = array(dataset?.jobs).map(job => ({ ...job, ...enrichProfileOptionTags(job) }));
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
  const relatedGraph = buildRelatedJobGraph(jobs);
  const qualificationProjection = metadata.qualificationProjection || { catalog: [], byJobId: new Map(), report: null };
  const coreJobs = jobs.map(job => compactCoreJob(job, relatedGraph.byJobId.get(job.id) || [], qualificationProjection.byJobId.get(job.id)));
  const tagStatistics = buildTagStatistics(coreJobs);

  const core = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    datasetVersion,
    generatedAt,
    sourceDate,
    qualifications: qualificationProjection.catalog,
    jobs: coreJobs,
    tagStatistics,
    workContexts: contextDictionary.items,
    diplomaLevels: compactDiplomaLevels(dataset.diplomaLevels),
    dictionaries: { directions: directionDictionary, sectors: sectorDictionary, audiences: buildAudienceDictionary(jobs), accessWarnings, ...romeDomains }
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
    accessPaths: jobs.reduce((sum, job) => sum + array(job.accessPaths || job.accessSummary?.accessPaths).length, 0),
    tagStatistics,
    relationGraph: relatedGraph.diagnostics,
    qualificationAudit: qualificationProjection.report
  };
  const validation = validateCompactRuntime({ core, competences, marche }, diagnostics);
  if (validation.failures.length) throw new Error(`Projection runtime invalide : ${validation.failures.join(", ")}`);
  return { core, competences, marche, diagnostics, validation };
}

function compactCoreJob(job, relatedJobIds = [], qualificationProjection = {}) {
  const content = splitMissionAndActivities(job);
  const accessSummary = compactAccessSummary(job.accessSummary, qualificationProjection.summary);
  const pathProjection = new Map(array(qualificationProjection.accessPaths).map(row => [row.pathId, row]));
  const accessPaths = array(job.accessPaths || job.accessSummary?.accessPaths).map(path => compactAccessPath(path, pathProjection.get(path.id || path.pathId)));
  const classification = {
    romeGrandDomainCode: job.romeGrandDomainCode || String(job.romeCode || "").slice(0, 1),
    romeProfessionalDomainCode: job.romeProfessionalDomainCode || String(job.romeCode || "").slice(0, 3),
  };
  const compact = omitEmpty({
    id: job.id || `rome-${job.romeCode}`,
    romeCode: job.romeCode,
    title: job.title,
    mission: content.mission,
    description: content.mission,
    activities: content.activities,
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
    interestTags: unique(array(job.interestTags)).slice(0, 6),
    valueTags: unique(array(job.valueTags)).slice(0, 6),
    transitionTags: unique(array(job.transitionTags)).slice(0, 6),
    relatedJobIds: unique(relatedJobIds).slice(0, 12),
    audienceSignals: compactAudienceSignals(job.audienceSignals),
    workContexts: unique(array(job.workContexts).map(contextId)),
    confidence: numberOrNull(job.confidence),
    missingFields: recalculateMissingFields(job, content),
    accessSummary,
    accessPaths,
    constraints: compactConstraints(job)
  });
  compact.activities = content.activities;
  return compact;
}

export function enrichProfileOptionTags(job = {}, options = {}) {
  const title = normalizedEvidence(job.title);
  const direct = normalizedEvidence([job.title, job.mission, job.description, ...array(job.activities)].join(" "));
  const contexts = normalizedEvidence(array(job.romeWorkContextLabels).join(" "));
  const sectorIds = unique([job.primarySectorId, ...array(job.secondarySectorIds)]);
  const scored = rules => rules.flatMap(rule => {
    const titleMatch = rule.pattern.test(title);
    rule.pattern.lastIndex = 0;
    const directMatch = rule.pattern.test(direct);
    rule.pattern.lastIndex = 0;
    const contextMatch = rule.contextPattern ? rule.contextPattern.test(contexts) : false;
    if (!titleMatch && !directMatch && !contextMatch && !array(rule.sectors).some(id => sectorIds.includes(id))) return [];
    return [{ id: rule.id, score: (titleMatch ? 8 : 0) + (directMatch ? 4 : 0) + (contextMatch ? 2 : 0) + (array(rule.sectors).some(id => sectorIds.includes(id)) ? 3 : 0) + (rule.specificity || 0) }];
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "fr")).slice(0, 6).map(row => row.id);

  const interestTags = scored([
    { id: "petite_enfance", pattern: /petite enfance|creche|nourrisson|moins de trois ans/, sectors: [], specificity: 5 },
    { id: "enfants", pattern: /enfant|jeunesse|mineur|scolaire|eleve/, sectors: ["education_enfance"], specificity: 4 },
    { id: "animaux", pattern: /animal|elevage|veterinaire|canin|felin/, sectors: ["animaux"], specificity: 5 },
    { id: "accompagner", pattern: /accompagn|soutien|mediation|insertion|autonomie/, sectors: ["social_insertion"], specificity: 4 },
    { id: "transmettre", pattern: /enseign|format|pedagog|educat|transmet|animation/, sectors: ["education_enfance"], specificity: 3 },
    { id: "creer", pattern: /crea|artist|concep|design|graph|atelier|ludique/, sectors: ["culture_communication"], specificity: 3 },
    { id: "proteger", pattern: /protec|securit|prevention|secour|surveill/, sectors: ["securite_prevention"], specificity: 3 },
    { id: "nature", pattern: /nature|environnement|biodivers|paysag|agric|foret/, sectors: ["nature_agriculture"], specificity: 4 },
    { id: "nourrir", pattern: /cuisine|aliment|restauration|boulanger|patiss|repas/, sectors: ["restauration_alimentation"], specificity: 4 },
    { id: "reparer", pattern: /repar|maintenance|depann|mecan|electric/, sectors: ["maintenance"], specificity: 4 },
    { id: "fabriquer", pattern: /fabric|production|assembl|usin|constru/, sectors: ["industrie_production"], specificity: 3 },
    { id: "communiquer", pattern: /communication|accueil|relation|conseil|informer/, sectors: ["culture_communication"], specificity: 2 },
    { id: "organiser", pattern: /organis|coordonn|planif|gestion/, sectors: ["administratif_support"], specificity: 1 },
    { id: "analyser", pattern: /analys|recherche|diagnostic|etude/, sectors: ["recherche_analyse"], specificity: 2 },
    { id: "manuel", pattern: /manuel|artisan|chantier|outillage/, sectors: ["batiment_construction"], specificity: 2 },
    { id: "aider", pattern: /aide|service aux personnes|assistance/, sectors: [], specificity: 0 }
  ]);
  const valueTags = scored([
    { id: "care", pattern: /soin|prendre soin|sante|bien etre/, sectors: ["sante_soin"], specificity: 4 },
    { id: "solidarity", pattern: /solidarit|social|insertion|entraide|mediation|accompagn/, sectors: ["social_insertion"], specificity: 3 },
    { id: "creativity", pattern: /crea|artist|design|concep|atelier|ludique/, sectors: ["culture_communication"], specificity: 3 },
    { id: "ecology", pattern: /ecolog|environnement|nature|biodivers|durable/, sectors: ["nature_agriculture"], specificity: 4 },
    { id: "security", pattern: /securit|prevention|protection|controle/, sectors: ["securite_prevention"], specificity: 3 },
    { id: "team", pattern: /equipe|collectif|coordonn|collabor/, sectors: [], specificity: 2 },
    { id: "autonomy", pattern: /autonom|independant|responsabil/, sectors: [], specificity: 2 },
    { id: "concrete", pattern: /terrain|manuel|fabric|repar|production/, sectors: ["maintenance", "batiment_construction"], specificity: 2 },
    { id: "clarity", pattern: /procedure|dossier|reglement|qualite|document/, sectors: ["administratif_support"], specificity: 1 },
    { id: "precision", pattern: /precision|controle|mesure|qualite|diagnostic/, sectors: [], specificity: 1 },
    { id: "service", pattern: /service|accueil|conseil|accompagn|aide/, sectors: [], specificity: 0 },
    { id: "meaning", pattern: /educat|social|sante|protection|environnement|transmission/, sectors: ["education_enfance", "social_insertion"], specificity: 1 },
    { id: "stability", pattern: /gestion|administr|controle|maintenance/, sectors: [], specificity: 0 }
  ]);
  const transitionTags = scored([
    { id: "enfance", pattern: /enfant|jeunesse|scolaire|eleve|educat/, sectors: ["education_enfance"], specificity: 4 },
    { id: "social", pattern: /social|insertion|mediation|accompagn/, sectors: ["social_insertion"], specificity: 4 },
    { id: "nature", pattern: /nature|agric|environnement|animal|paysag/, sectors: ["nature_agriculture", "animaux"], specificity: 4 },
    { id: "commerce", pattern: /vente|commerce|boutique|client/, sectors: ["commerce_vente"], specificity: 3 },
    { id: "numerique", pattern: /numerique|informat|logiciel|data|reseau/, sectors: ["numerique"], specificity: 3 },
    { id: "sante", pattern: /sante|soin|medical|therap/, sectors: ["sante_soin"], specificity: 3 },
    { id: "batiment", pattern: /batiment|chantier|construction/, sectors: ["batiment_construction"], specificity: 3 },
    { id: "industrie", pattern: /industrie|usine|production|fabrication/, sectors: ["industrie_production"], specificity: 3 },
    { id: "logistique", pattern: /logistique|transport|stock|livraison/, sectors: ["logistique_transport"], specificity: 3 },
    { id: "administratif", pattern: /administr|gestion|dossier|procedure/, sectors: ["administratif_support"], specificity: 2 },
    { id: "animation", pattern: /animation|animateur|ludique|loisir/, sectors: [], specificity: 3 },
    { id: "relationnel", pattern: /public|accueil|relation|accompagn|conseil/, sectors: [], specificity: 1 },
    { id: "manuel", pattern: /manuel|atelier|outillage|repar|fabric/, sectors: [], specificity: 1 },
    { id: "analyse", pattern: /analys|recherche|diagnostic|etude/, sectors: ["recherche_analyse"], specificity: 2 },
    { id: "securite", pattern: /securit|prevention|protection|surveill/, sectors: ["securite_prevention"], specificity: 2 }
  ]);
  const deniedInterestTags = new Set(array(job.deniedInterestTags));
  const deniedTransitionTags = new Set(array(job.deniedTransitionTags));
  const audienceOverride = options.audienceOverrides?.[String(job.romeCode || "").toUpperCase()];
  const audienceSignals = audienceOverride !== undefined
    ? normalizeAudienceSignals(audienceOverride)
    : normalizeAudienceSignals(job.audienceSignals?.length ? job.audienceSignals : inferAudienceSignals(job, title, direct));
  return {
    interestTags: interestTags.filter(id => !deniedInterestTags.has(id)),
    valueTags,
    transitionTags: transitionTags.filter(id => !deniedTransitionTags.has(id)),
    audienceSignals
  };
}

export function buildTagStatistics(jobs = []) {
  const rows = [];
  const count = array(jobs).length || 1;
  for (const [kind, field] of [["interest", "interestTags"], ["value", "valueTags"], ["transition", "transitionTags"]]) {
    const frequencies = new Map();
    for (const job of array(jobs)) for (const id of new Set(array(job[field]))) frequencies.set(id, (frequencies.get(id) || 0) + 1);
    for (const [id, df] of frequencies) {
      const prevalence = df / count;
      const raw = Math.log((count + 1) / (df + 1));
      const maximum = Math.log(count + 1);
      const normalized = 0.1 + (maximum ? raw / maximum : 0) * 0.9;
      rows.push({ kind, id, df, prevalence: Number(prevalence.toFixed(6)), weight: Number(Math.min(prevalence > 0.7 ? 0.15 : 1, Math.max(0.1, normalized)).toFixed(6)) });
    }
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function normalizedEvidence(value) {
  return slug(String(value || "")).replaceAll("-", " ");
}

function inferAudienceSignals(job, title, direct) {
  const evidence = normalizedEvidence([title, direct, ...array(job.romeWorkContextLabels)].join(" "));
  const output = [];
  const add = (id, centrality, proof) => output.push({ id, centrality, evidence: proof, source: "rome_semantic_inference" });
  if (/petite enfance|creche|nourrisson|bebe|moins de trois ans|assistant maternel|auxiliaire de puericulture/.test(evidence)) {
    const centrality = /petite enfance|assistant maternel|auxiliaire de puericulture/.test(title) ? "essential" : "dominant";
    add("petite_enfance", centrality, "Public de petite enfance explicitement mentionné dans le titre ou la mission.");
  }
  if (/enfant|scolaire|eleve|mineur/.test(evidence) && !/film d animation|image 2d|image 3d|effets visuels/.test(evidence)) {
    add("children_multi_age", /enfant/.test(title) ? "dominant" : "possible", "Public enfant explicitement mentionné dans la fiche métier.");
  }
  if (/jeunesse|adolescent|jeune public/.test(evidence)) add("youth", /jeunesse/.test(title) ? "essential" : "dominant", "Public jeune explicitement mentionné dans la fiche métier.");
  return output;
}

function normalizeAudienceSignals(values) {
  const centralities = new Set(["essential", "dominant", "possible", "unknown"]);
  const rank = { essential: 4, dominant: 3, possible: 2, unknown: 1 };
  const byId = new Map();
  for (const raw of array(values)) {
    if (!raw?.id) continue;
    const signal = {
      id: String(raw.id),
      centrality: centralities.has(raw.centrality) ? raw.centrality : "unknown",
      evidence: String(raw.evidence || "Signal d'audience à vérifier."),
      source: raw.source || "reviewed_override",
      reviewedAt: raw.reviewedAt || null
    };
    const previous = byId.get(signal.id);
    if (!previous || rank[signal.centrality] > rank[previous.centrality]) byId.set(signal.id, signal);
  }
  return [...byId.values()].sort((a, b) => rank[b.centrality] - rank[a.centrality] || a.id.localeCompare(b.id)).slice(0, 3);
}

function compactAudienceSignals(values) {
  return normalizeAudienceSignals(values).map(({ id, centrality }) => ({ id, centrality }));
}

function recalculateMissingFields(job, content) {
  const fields = unique(array(job.missingFields)).filter(field => field !== "activities");
  if (!array(content.activities).length) fields.push("activities");
  return unique(fields);
}

function buildRelatedJobGraph(jobs) {
  const maximumDegree = 10;
  const features = new Map(jobs.map(job => [job.id, relationFeatures(job)]));
  const candidates = [];
  for (let leftIndex = 0; leftIndex < jobs.length; leftIndex += 1) {
    const left = jobs[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < jobs.length; rightIndex += 1) {
      const right = jobs[rightIndex];
      if (relationBlocked(left, right)) continue;
      const metrics = relationSimilarity(features.get(left.id), features.get(right.id));
      if (metrics.evidenceFamilyCount >= 2 && metrics.score >= 0.14) candidates.push({ leftId: left.id, rightId: right.id, leftCode: left.romeCode, rightCode: right.romeCode, ...metrics });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.leftCode.localeCompare(b.leftCode) || a.rightCode.localeCompare(b.rightCode));
  const byJobId = new Map(jobs.map(job => [job.id, []]));
  const selected = [];
  for (const edge of candidates) {
    const left = byJobId.get(edge.leftId);
    const right = byJobId.get(edge.rightId);
    if (left.length >= maximumDegree || right.length >= maximumDegree) continue;
    left.push(edge.rightId);
    right.push(edge.leftId);
    selected.push(edge);
  }
  const candidateByPair = new Map(candidates.map(edge => [[edge.leftCode, edge.rightCode].sort().join("|"), edge]));
  const references = [["G1203", "G1235"], ["G1203", "G1202"], ["K1208", "K1207"], ["K1206", "K1209"], ["K1206", "K1217"], ["K2110", "K2138"], ["K2110", "K2116"], ["K2110", "K2113"], ["K1206", "K1212"], ["G1203", "G1206"], ["G1203", "L1510"]]
    .map(([leftCode, rightCode]) => ({ leftCode, rightCode, candidate: candidateByPair.get([leftCode, rightCode].sort().join("|")) || null, selected: selected.some(edge => [edge.leftCode, edge.rightCode].sort().join("|") === [leftCode, rightCode].sort().join("|")) }));
  return {
    byJobId,
    diagnostics: {
      maximumDegree,
      candidateEdges: candidates.length,
      selectedEdges: selected.length,
      reciprocalRate: 1,
      isolatedJobs: [...byJobId.values()].filter(values => !values.length).length,
      minimumDegree: Math.min(...[...byJobId.values()].map(values => values.length)),
      averageDegree: Number((selected.length * 2 / jobs.length).toFixed(3)),
      references
    }
  };
}

function relationFeatures(job) {
  const groups = array(job.skillGroups).map(group => slug(group.issueLabel || group.groupId || "")).filter(id => id && id !== "savoir-etre-professionnels");
  const skills = relationIds(job.requiredSkills?.length ? job.requiredSkills : job.matchableSkillIds);
  const contexts = array(job.workContexts).map(contextId).filter(Boolean);
  const sectors = unique([job.primarySectorId, ...array(job.secondarySectorIds)].filter(Boolean));
  const titleTokens = normalizedEvidence(job.title).split(" ").filter(token => token.length >= 5 && !["animatrice", "educatrice", "assistant", "assistante", "responsable"].includes(token));
  return { groups, skills, contexts, sectors, titleTokens, primarySectorId: job.primarySectorId, professionalDomain: String(job.romeCode || "").slice(0, 3), title: normalizedEvidence(job.title) };
}

function relationSimilarity(left, right) {
  const skill = jaccardIndex(left.skills, right.skills);
  const group = jaccardIndex(left.groups, right.groups);
  const context = jaccardIndex(left.contexts, right.contexts);
  const sector = jaccardIndex(left.sectors, right.sectors);
  const title = jaccardIndex(left.titleTokens, right.titleTokens);
  const samePrimarySector = left.primarySectorId && left.primarySectorId === right.primarySectorId ? 1 : 0;
  const sameProfessionalDomain = left.professionalDomain && left.professionalDomain === right.professionalDomain ? 1 : 0;
  const evidenceFamilies = [skill > 0, group > 0, context > 0, sector > 0 || samePrimarySector > 0, sameProfessionalDomain > 0].filter(Boolean);
  const score = skill * 0.42 + group * 0.24 + context * 0.14 + sector * 0.12 + title * 0.03 + samePrimarySector * 0.03 + sameProfessionalDomain * 0.02;
  return { score: Number(score.toFixed(6)), evidenceFamilyCount: evidenceFamilies.length, skill: Number(skill.toFixed(6)), group: Number(group.toFixed(6)), context: Number(context.toFixed(6)), sector: Number(sector.toFixed(6)), title: Number(title.toFixed(6)), samePrimarySector, sameProfessionalDomain };
}

function relationBlocked(left, right) {
  const a = normalizedEvidence(left.title);
  const b = normalizedEvidence(right.title);
  const pair = `${a} | ${b}`;
  if (/croupier|casino|jeux d argent/.test(pair) && /jeunesse|enfant|educat|socioculturel/.test(pair)) return true;
  if (/film d animation|image 2d|image 3d|effets visuels|infograph/.test(pair) && /jeunesse|enfant|educat|socioculturel|centre de loisirs/.test(pair)) return true;
  if (/conduite|routiere|auto ecole/.test(pair) && /eleve|handicap|scolaire/.test(pair)) return true;
  if (/culte|religieux/.test(pair) && /socioculturel|socioeducatif|animation/.test(pair)) return true;
  return false;
}

function jaccardIndex(left, right) {
  const a = new Set(array(left));
  const b = new Set(array(right));
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

function compactAccessSummary(raw = null, qualificationProjection = {}) {
  if (!raw || typeof raw !== "object") return null;
  const summary = omitEmpty({
    displayLabel: raw.displayLabel,
    accessLevelCategory: raw.accessLevelCategory || "unknown",
    requirementKind: raw.requirementKind || "unknown",
    minimumDiplomaLevel: numberOrNull(raw.minimumDiplomaLevel),
    maximumDiplomaLevel: numberOrNull(raw.maximumDiplomaLevel),
    specificCredentialRequired: Boolean(raw.specificCredentialRequired),
    requiredQualificationIds: unique(array(qualificationProjection.requiredQualificationIds)),
    optionalQualificationIds: unique(array(qualificationProjection.optionalQualificationIds)),
    requiredLicenseIds: unique(array(qualificationProjection.requiredLicenseIds)),
    optionalLicenseIds: unique(array(qualificationProjection.optionalLicenseIds)),
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

function compactAccessPath(raw = {}, qualificationProjection = {}) {
  return omitEmpty({
    id: raw.id || raw.pathId,
    label: raw.label,
    routeType: raw.routeType,
    examRequired: Boolean(raw.examRequired),
    examLabel: raw.examLabel,
    minimumDiplomaLevel: numberOrNull(raw.minimumDiplomaLevel),
    maximumDiplomaLevel: numberOrNull(raw.maximumDiplomaLevel),
    requiredQualificationIds: unique(array(qualificationProjection.requiredQualificationIds)),
    optionalQualificationIds: unique(array(qualificationProjection.optionalQualificationIds)),
    requiredLicenseIds: unique(array(qualificationProjection.requiredLicenseIds)),
    optionalLicenseIds: unique(array(qualificationProjection.optionalLicenseIds)),
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

function buildAudienceDictionary(jobs) {
  const ids = unique(jobs.flatMap(job => array(job.audienceSignals).map(signal => signal.id))).sort();
  return ids.map(id => ({ id, label: AUDIENCE_LABELS[id] || id.replaceAll("_", " ") }));
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
      const label = ACCESS_WARNING_LABELS[id] || String(warning || "").trim();
      if (labels.has(id) && labels.get(id) !== label) throw new Error(`Collision de codes d’avertissement d’accès : ${id}.`);
      labels.set(id, label);
    }
  }
  return [...labels].sort(([a], [b]) => a.localeCompare(b)).map(([id, label]) => ({ id, label }));
}

function splitMissionAndActivities(job = {}) {
  const explicitMission = String(job.mission || "").trim();
  const explicitActivities = unique(array(job.activities).map(item => String(item || "").trim()).filter(Boolean));
  if (explicitMission || explicitActivities.length) return {
    mission: explicitMission || String(job.description || "").split(/\r?\n/).map(line => line.trim()).find(Boolean) || "",
    activities: explicitActivities
  };
  const lines = String(job.description || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { mission: lines[0] || "", activities: unique(lines.slice(1).filter(line => line !== lines[0])) };
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
  // Les signaux publiés sont calculés sur le volume total observé. Le sous-volume
  // France Travail peut être arrondi à zéro et ne doit donc pas les contredire.
  const rawOffersCount = numberOrNull(raw.offers12m ?? raw.offersAll12m ?? raw.offersFranceTravail12m);
  const offersLevel = raw.absoluteOfferSignal || (rawOffersCount === 0 ? "zero" : "unknown");
  const territorialSignal = raw.territorialOfferSignal || (rawOffersCount === 0 ? "zero_local" : "unknown");
  const contradictoryZero = rawOffersCount === 0 && (offersLevel === "medium" || ["medium_local", "strong_local", "top_local"].includes(territorialSignal));
  const offersCount = contradictoryZero ? null : rawOffersCount;
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
  const availability = ambiguous ? "ambiguous" : contradictoryZero ? "partial" : hasOffers && hasContext ? "available" : hasOffers || hasContext ? "partial" : "unavailable";
  return {
    availability,
    offersCount,
    offersLevel: contradictoryZero ? "unknown" : offersLevel,
    territorialSignal: contradictoryZero ? "unknown" : territorialSignal,
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
      relatedJobIds: array(job.relatedJobIds),
      audienceSignals: normalizeAudienceSignals(job.audienceSignals),
      workContexts: array(job.workContexts),
      romeWorkContextLabels: array(job.workContexts).map(id => contexts.get(id)?.label).filter(Boolean),
      missingFields: array(job.missingFields),
      mission: job.mission || job.description || "",
      description: [job.mission || job.description || "", ...array(job.activities)].filter(Boolean).join("\n"),
      activities: array(job.activities),
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
      relatedJobs: array(job.relatedJobIds),
      market: { status: "unknown", source: "unknown", confidence: 0 },
      marketIndicators: [],
      marketStats: expandMarketStats(marketRows.get(job.id), marche)
    };
  });
  applyMarketPresencePercentiles(jobs);
  return {
    schemaVersion: core.schemaVersion,
    datasetName: "Boussole Pro - runtime compact ROME1000",
    datasetVersion: core.datasetVersion,
    sourceDate: core.sourceDate,
    importedAt: core.generatedAt,
    provenance: "generated_rome",
    confidence: 0.75,
    jobs,
    qualifications: array(core.qualifications),
    skills,
    skillsEngine: skills,
    matchableSkills: skills.filter(item => item.classification === "skill_action"),
    knowledge,
    workContexts: array(core.workContexts).map(item => ({ ...item, constraintTags: array(item.constraintTags) })),
    tagStatistics: array(core.tagStatistics),
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

export function applyMarketPresencePercentiles(jobs = []) {
  const territoryKeys = ["national", "regional", "departmental"];
  const fallback = { zero: 0, low: 25, medium: 55, high: 82, very_high: 95 };
  for (const key of territoryKeys) {
    const positives = jobs.map(job => job.marketStats?.[key]?.offersFranceTravail12m ?? job.marketStats?.[key]?.offers12m)
      .filter(value => Number.isFinite(value) && value > 0);
    for (const job of jobs) {
      const row = job.marketStats?.[key];
      if (!row) continue;
      const offers = row.offersFranceTravail12m ?? row.offers12m;
      let presencePercentile = null;
      let presenceSource = "unavailable";
      if (Number.isFinite(offers)) {
        if (offers === 0) {
          presencePercentile = 0;
          presenceSource = "observed_zero";
        } else if (offers > 0 && positives.length) {
          const less = positives.filter(value => value < offers).length;
          const equal = positives.filter(value => value === offers).length;
          presencePercentile = 100 * (less + 0.5 * equal) / positives.length;
          presenceSource = "territory_percentile";
        } else if (fallback[row.offersLevel] !== undefined) {
          presencePercentile = fallback[row.offersLevel];
          presenceSource = "offers_level_fallback";
        }
      }
      row.presencePercentile = presencePercentile;
      row.presenceSource = presenceSource;
    }
  }
  return jobs;
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
      availability: item.availability || "unavailable",
      marketDataKind: "offers_volume",
      marketInterpretationLabel: "Volume d’offres observé",
      latestPeriodCode: marche?.vintages?.offers || null,
      latestPeriodLabel: marche?.vintages?.offers || null,
      offersFranceTravail12m: item.offersCount,
      offersAll12m: item.offersCount,
      offers12m: item.offersCount,
      absoluteOfferSignal: item.offersLevel === "very_high" ? "high" : item.offersLevel,
      territorialOfferSignal: item.territorialSignal,
      offersLevel: item.offersLevel || "unknown",
      tensionClass: item.tensionClass ?? null,
      tensionLevel: item.tensionLevel || "unknown",
      tensionImputed: Boolean(item.tensionImputed),
      recruitmentDifficultyRate: item.recruitmentDifficultyRate ?? null,
      statisticalScope: item.statisticalScope || "unknown",
      sharedFamily: Boolean(item.sharedFamily),
      periods: { offers: marche?.vintages?.offers || null, bmo: marche?.vintages?.bmo || null, daresTension: marche?.vintages?.daresTension || null },
      sources: [Number.isFinite(item.offersCount) ? "France Travail — offres observées" : null, item.tensionLevel !== "unknown" ? "Dares — tension" : null, Number.isFinite(item.recruitmentDifficultyRate) ? "France Travail — BMO" : null].filter(Boolean),
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
  const qualificationIds = new Set(array(core?.qualifications).map(item => item.id));
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
    for (const id of [...array(job.accessSummary?.requiredQualificationIds), ...array(job.accessSummary?.optionalQualificationIds), ...array(job.accessPaths).flatMap(path => [...array(path.requiredQualificationIds), ...array(path.optionalQualificationIds)])]) if (!qualificationIds.has(id)) failures.push(`orphan_qualification:${job.id}:${id}`);
    for (const id of array(job.workContexts)) if (!contexts.has(id)) failures.push(`orphan_context:${id}`);
    for (const signal of array(job.constraints?.officialSignals)) if (signal.contextId && !contexts.has(signal.contextId)) failures.push(`orphan_signal_context:${signal.contextId}`);
    if (!Array.isArray(job.activities)) failures.push(`invalid_activities:${job.id}`);
    if ([job.interestTags, job.valueTags, job.transitionTags].some(tags => array(tags).length > 6)) failures.push(`tag_limit:${job.id}`);
    if (array(job.missingFields).includes("activities") !== !array(job.activities).length) failures.push(`activity_missing_metadata:${job.id}`);
    if (array(job.relatedJobIds).length > 12) failures.push(`related_degree:${job.id}`);
    for (const relatedId of array(job.relatedJobIds)) {
      const related = jobs.find(candidate => candidate.id === relatedId);
      if (!related) failures.push(`orphan_related_job:${job.id}:${relatedId}`);
      else if (!array(related.relatedJobIds).includes(job.id)) failures.push(`asymmetric_related_job:${job.id}:${relatedId}`);
    }
  }
  if (!array(core?.tagStatistics).length || array(core?.tagStatistics).some(row => !Number.isFinite(row.df) || !Number.isFinite(row.prevalence) || !Number.isFinite(row.weight))) failures.push("tag_statistics");
  if (array(competences?.items).some(item => !humanLabel(item.label, item.id))) failures.push("technical_item_label");
  if (diagnostics.unresolvedKnowledgeIds?.length) failures.push("unresolved_knowledge_labels");
  const forbidden = [];
  walkKeys(runtime, key => { if (["fapEnrichment", "accessConditions", "requiredSkills", "matchableSkillIds", "scorableSkillIds"].includes(key)) forbidden.push(key); });
  if (forbidden.length) failures.push(`forbidden_runtime_keys:${unique(forbidden).join("|")}`);
  if (!qualificationIds.size) failures.push("qualification_catalog_empty");
  return { status: failures.length ? "failed" : "passed", failures: unique(failures), counts: { jobs: jobs.length, skills: array(competences?.items).filter(item => item.type !== "knowledge").length, knowledge: array(competences?.items).filter(item => item.type === "knowledge").length, qualifications: qualificationIds.size, skillGroups: groups.size, workContexts: contexts.size } };
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
