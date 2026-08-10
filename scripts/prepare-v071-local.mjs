import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");
const ACCESS_RULES_PATH = path.join(LOCAL_DIR, "access-rules-v074.json");

const CONTEXT_CONSTRAINT_RULES = [
  ["Travail de nuit", "schedule.nightWork", "frequent_or_possible"],
  ["Travail les week-ends et jours fériés", "schedule.weekendWork", "frequent_or_possible"],
  ["Travail en horaires fixes", "schedule.pattern", "fixed"],
  ["Travail en horaires variables", "schedule.pattern", "variable"],
  ["Travail en horaires décalés", "schedule.shiftedHours", true],
  ["Travail en horaires fractionnés", "schedule.splitHours", true],
  ["Station debout prolongée", "physical.prolongedStanding", true],
  ["Port et manipulation de charges lourdes ou encombrantes", "physical.heavyLoad", true],
  ["Déplacements professionnels", "mobility.professionalTravel", true],
  ["En extérieur", "environment.outdoor", true],
  ["En contact avec du public", "publicContact", true]
];

const CONTEXT_CATEGORIES = [
  ["publics", "Publics", /contact|public|patient|enfant|eleve|client|usager|animaux?/],
  ["lieux", "Lieux", /exterieur|chantier|domicile|bureau|atelier|commerce|restaurant|etablissement|site|vehicule/],
  ["horaires_rythmes", "Horaires et rythmes", /nuit|week-end|ferie|horaire|journee|decale|fractionne|astreinte/],
  ["deplacements", "Déplacements", /deplacement|mobilite|conduite|vehicule|route|itin/],
  ["environnement_physique", "Environnement physique", /charge|debout|bruit|humide|temperature|hauteur|poussiere|exterieur|physique/],
  ["structures", "Structures", /entreprise|association|collectivite|public|prive|secteur|media|etablissement/],
  ["risques_protections", "Risques et protections", /risque|dangereux|protection|epi|chute|securite|toxique/],
  ["organisation_travail", "Organisation du travail", /equipe|autonomie|projet|partenaire|international|saisonnier|teletravail|organisation/]
];

async function main() {
  await mkdir(GENERATED_DIR, { recursive: true });
  await mkdir(ROME500_DIR, { recursive: true });
  await mkdir(LOCAL_DIR, { recursive: true });

  const accessRulesDocument = await readJson(ACCESS_RULES_PATH, { rules: {} });
  const buildMetadata = await readBoussoleBuildMetadata();
  const runtimeReportBuildMetadata = {
    appVersion: buildMetadata.appVersion,
    buildId: buildMetadata.buildId,
    buildDate: buildMetadata.buildDate,
    datasetVersion: buildMetadata.datasetVersion,
    identityScope: "runtime_bundle_component"
  };
  await synchronizeAccessRules(accessRulesDocument);
  const jobs = await readJson(path.join(ROME500_DIR, "jobs.rome.json"), []);
  const contexts = await readJson(path.join(ROME500_DIR, "work-contexts.rome.json"), []);
  const taxonomy = await readJson(path.join(LOCAL_DIR, "skill-taxonomy.user.json"), { concepts: [], facets: [] });
  const conceptMappings = await readJson(path.join(LOCAL_DIR, "skill-concept-mappings.rome.json"), { mappings: [] });

  const accessSummaryGeneratedAt = new Date().toISOString();
  const accessSummary = jobs.map(job => buildAccessSummary(job, accessRulesDocument.rules?.[job.romeCode], {
    generatedAt: accessSummaryGeneratedAt,
    verifiedAt: accessRulesDocument.verifiedAt
  }));
  const accessQuality = buildAccessQualityReport(accessSummary, jobs, accessRulesDocument, accessSummaryGeneratedAt);
  Object.assign(accessQuality, runtimeReportBuildMetadata, {
    datasetVersion: "rome500-candidate-v0.7",
    corpusMaturity: "candidate_consolidated",
    validationScope: "validated_for_boussole_pro_v0_7",
    derivedAt: accessSummaryGeneratedAt
  });
  const contextMapping = buildOfficialContextConstraintMapping(contexts);
  const constraintSummary = jobs.map(job => buildOfficialConstraintSummary(job, contextMapping));
  const workContextTaxonomy = buildWorkContextUserTaxonomy(contexts, jobs);
  const explorationAudit = buildExplorationFacetAudit(jobs, workContextTaxonomy);
  const impactReport = buildSkillConceptImpactReport(taxonomy, conceptMappings, jobs);
  const implementationReport = buildImplementationReport({ accessQuality, contextMapping, explorationAudit, impactReport });

  await writeJson(path.join(GENERATED_DIR, "access-summary.rome500.json"), accessSummary);
  await writeJson(path.join(ROME500_DIR, "access-summary.rome500.json"), accessSummary);
  await writeJson(path.join(GENERATED_DIR, "access-summary-quality-report.json"), accessQuality);
  await writeJson(path.join(ROME500_DIR, "access-summary-quality-report.json"), accessQuality);
  await enrichExistingDataQualityReport(GENERATED_DIR, accessSummary, runtimeReportBuildMetadata);
  await enrichExistingDataQualityReport(ROME500_DIR, accessSummary, runtimeReportBuildMetadata);
  await writeJson(path.join(LOCAL_DIR, "official-context-constraint-mapping.json"), contextMapping);
  await writeJson(path.join(GENERATED_DIR, "official-constraint-summary.rome500.json"), constraintSummary);
  await writeJson(path.join(ROME500_DIR, "official-constraint-summary.rome500.json"), constraintSummary);
  await writeJson(path.join(GENERATED_DIR, "skill-concept-impact-report.json"), impactReport);
  await writeJson(path.join(LOCAL_DIR, "work-context-user-taxonomy.json"), workContextTaxonomy);
  await writeJson(path.join(GENERATED_DIR, "exploration-facet-audit.rome500.json"), explorationAudit);
  await writeFile(path.join(ROOT, "CODEX_V0_7_1_IMPLEMENTATION_REPORT.md"), implementationReport, "utf8");

  console.log(`[Boussole Pro] v0.7.1: ${accessQuality.summary.accessTextsCount}/${jobs.length} textes d'accès synthétisés.`);
  console.log(`[Boussole Pro] v0.7.1: ${contextMapping.confirmedRules.length} règles de contextes confirmées, ${constraintSummary.filter(row => row.confirmedSignals.length).length} métiers avec contrainte officielle.`);
}

export function buildAccessSummary(job = {}, explicitRule = null, metadata = {}) {
  const text = normalizeMultilineText(job.accessConditions?.text || "");
  const normalized = normalizeText(text);
  const hasText = Boolean(text);
  const sentences = splitSentences(text);
  const noDiplomaSentences = sentences.filter(sentence => isNoDiplomaPossibleSentence(sentence));
  const negatedObligationSentences = sentences.filter(sentence => isNegatedObligationSentence(sentence));
  const mandatorySentences = sentences.filter(sentence => isMandatoryAccessSentence(sentence));
  const optionalSentences = sentences.filter(sentence => isOptionalAccessSentence(sentence) || isRecommendedAccessSentence(sentence));
  const noDiplomaPossible = noDiplomaSentences.length > 0;
  const contradictoryEvidence = noDiplomaPossible && mandatorySentences.length > 0;
  const citedDiplomas = extractDiplomaMentions(text);
  const citedCertifications = extractCertificationMentions(text);
  const directRequiredCredentials = mandatorySentences.flatMap(extractRequiredCredentialLabels);
  const globalRequiredCredentials = !directRequiredCredentials.length && hasMandatorySpecificCredentialEvidence(text, mandatorySentences)
    ? extractSpecificCredentialLabels(text)
    : [];
  const mandatoryDiplomas = unique(mandatorySentences.flatMap(extractDiplomaMentions));
  const recommendedDiplomas = unique(optionalSentences.flatMap(extractDiplomaMentions));
  const requiredCredentialLabels = unique([...directRequiredCredentials, ...globalRequiredCredentials])
    .filter(label => !isGenericRequiredCredentialLabel(label));
  const optionalCredentialLabels = unique(optionalSentences.flatMap(extractOptionalCredentialLabels));
  const regulated = mandatorySentences.some(sentence => isRegulatedAccessSentence(sentence));
  const diplomaRange = inferDiplomaRange(text, { noDiplomaPossible, mandatorySentences, optionalSentences });
  const requirementKind = inferRequirementKind({
    hasText,
    noDiplomaPossible,
    contradictoryEvidence,
    mandatorySentences,
    optionalSentences,
    requiredCredentialLabels,
    diplomaRange,
    regulated
  });
  const mandatory = requirementKind === "mandatory" || requirementKind === "regulated";
  const accessLevelCategory = inferAccessCategory(normalized, { noDiplomaPossible, citedDiplomas, diplomaRange, mandatory });
  const warnings = [];
  if (!hasText) warnings.push("access_text_missing");
  if (mandatorySentences.length && optionalSentences.length) warnings.push("mixed_required_and_optional_wording");
  if (contradictoryEvidence) warnings.push("contradictory_access_evidence");
  if (negatedObligationSentences.length) warnings.push("negated_obligation_detected");
  if (citedDiplomas.length > 3) warnings.push("multiple_diploma_mentions");
  const derived = {
    jobId: job.id,
    romeCode: job.romeCode,
    displayLabel: accessDisplayLabel(accessLevelCategory, {
      noDiplomaPossible,
      mandatory,
      citedDiplomas,
      citedCertifications,
      diplomaRange,
      requirementKind,
      requiredCredentialLabels
    }),
    accessLevelCategory,
    requirementKind,
    minimumDiplomaLevel: diplomaRange.minimumDiplomaLevel,
    maximumDiplomaLevel: diplomaRange.maximumDiplomaLevel,
    minimumDiplomaLabel: diplomaRange.minimumDiplomaLabel,
    maximumDiplomaLabel: diplomaRange.maximumDiplomaLabel,
    specificCredentialRequired: requiredCredentialLabels.length > 0,
    requiredCredentialLabels,
    optionalCredentialLabels,
    optionalDiplomas: recommendedDiplomas,
    mandatoryDiplomas,
    noDiplomaPossible,
    regulated,
    contradictoryEvidence,
    mandatoryQualification: Boolean(mandatory && !contradictoryEvidence && (mandatoryDiplomas.length || requiredCredentialLabels.length || regulated)),
    trainingDuration: normalizeTrainingDuration(null),
    citedDiplomas,
    citedCertifications,
    source: hasText ? "derived_from_official_access_text" : "unknown",
    confidence: hasText ? confidenceForAccess({
      requirementKind,
      contradictoryEvidence,
      negatedObligation: negatedObligationSentences.length > 0,
      citedDiplomas,
      citedCertifications,
      requiredCredentialLabels
    }) : 0,
    matchedExcerpts: unique([
      ...mandatorySentences,
      ...optionalSentences,
      ...noDiplomaSentences,
      ...negatedObligationSentences,
      ...extractRelevantSentences(text)
    ]).slice(0, 5),
    warnings,
    generatedAt: metadata.generatedAt || new Date().toISOString()
  };
  return applyExplicitAccessRule(derived, explicitRule, metadata);
}

function applyExplicitAccessRule(summary, rule, metadata = {}) {
  if (!rule) return summary;
  const merged = {
    ...summary,
    ...rule,
    jobId: summary.jobId,
    romeCode: summary.romeCode,
    source: "local_explicit_access_rule",
    verifiedAt: metadata.verifiedAt || null,
    generatedAt: metadata.generatedAt || summary.generatedAt,
    accessPaths: arr(rule.accessPaths).map(path => ({ ...path, trainingDuration: normalizeTrainingDuration(path.trainingDuration), verifiedAt: metadata.verifiedAt || null })),
    trainingDuration: normalizeTrainingDuration(rule.trainingDuration || summary.trainingDuration),
    requiredCredentialLabels: unique(rule.requiredCredentialLabels ?? summary.requiredCredentialLabels),
    optionalCredentialLabels: unique(rule.optionalCredentialLabels ?? summary.optionalCredentialLabels),
    warnings: unique(rule.warnings ?? summary.warnings)
  };
  merged.displayLabel = explicitAccessDisplayLabel(merged);
  merged.accessLevelCategory = accessCategoryFromLevels(merged.minimumDiplomaLevel, merged.maximumDiplomaLevel, merged.noDiplomaPossible);
  return merged;
}

function explicitAccessDisplayLabel(summary = {}) {
  if (summary.romeCode === "K2106") return "Accès par CRPE : plusieurs voies datées, concours obligatoire";
  if (summary.requirementKind === "conditional") return "Condition particulière selon les fonctions exercées";
  const credential = unique(summary.requiredCredentialLabels)[0];
  if (credential) return `${formatRequiredCredentialLabel(credential)}${summary.accessPaths?.length > 1 ? " selon plusieurs voies" : ""}`;
  return accessDisplayLabel(accessCategoryFromLevels(summary.minimumDiplomaLevel, summary.maximumDiplomaLevel, summary.noDiplomaPossible), summary);
}

function formatRequiredCredentialLabel(label = "") {
  const clean = String(label || "").trim().replace(/[.;:,]+$/, "");
  if (!clean) return "Qualification spécifique requise";
  if (/\b(obligatoire|requis(?:e|es|s)?)\b/i.test(clean)) return clean;
  return `${clean} requis`;
}

function accessCategoryFromLevels(minimum, maximum, noDiplomaPossible = false) {
  if (noDiplomaPossible && minimum === null && maximum === null) return "no_diploma_possible";
  if (minimum !== null && maximum !== null && minimum !== maximum) return "mixed_or_multiple_routes";
  return diplomaLevelToAccessCategory(maximum ?? minimum) || "unknown";
}

function inferAccessCategory(text, flags) {
  if (!text) return "unknown";
  if (flags.noDiplomaPossible) return "no_diploma_possible";
  if (flags.diplomaRange?.minimumDiplomaLevel !== null && flags.diplomaRange?.maximumDiplomaLevel !== null) {
    if (flags.diplomaRange.minimumDiplomaLevel !== flags.diplomaRange.maximumDiplomaLevel) return "mixed_or_multiple_routes";
    return diplomaLevelToAccessCategory(flags.diplomaRange.maximumDiplomaLevel);
  }
  if (flags.citedDiplomas.length > 1) return "mixed_or_multiple_routes";
  return "unknown";
}

function accessDisplayLabel(category, flags = {}) {
  if (category === "unknown") return "Niveau exact à vérifier";
  if (category === "no_diploma_possible") return "Accès possible sans diplôme selon le texte officiel";
  const labels = {
    cap_or_equivalent: "CAP ou niveau équivalent",
    bac: "Niveau Bac",
    bac_plus_2: "Niveau Bac +2",
    bac_plus_3: "Niveau Bac +3",
    bac_plus_5: "Niveau Bac +5",
    mixed_or_multiple_routes: "Plusieurs voies d'accès"
  };
  const rangeLabel = diplomaRangeLabel(flags.diplomaRange);
  const base = rangeLabel || labels[category] || "Accès à vérifier";
  if (flags.requiredCredentialLabels?.length) return `${base} avec qualification spécifique requise`;
  if (flags.requirementKind === "mandatory" || flags.requirementKind === "regulated") return `${base} comme exigence probable`;
  if (flags.requirementKind === "recommended") return category === "mixed_or_multiple_routes" ? `${base} recommandées ou possibles` : `${base} généralement recommandé`;
  if (flags.requirementKind === "conflicting") return `${base}, texte contradictoire à vérifier`;
  return `${base}, obligation à vérifier`;
}

function inferRequirementKind({
  hasText,
  noDiplomaPossible,
  contradictoryEvidence,
  mandatorySentences,
  optionalSentences,
  requiredCredentialLabels,
  diplomaRange,
  regulated
}) {
  if (!hasText) return "unknown";
  if (contradictoryEvidence) return "conflicting";
  if (regulated || requiredCredentialLabels.length || mandatorySentences.length) return regulated ? "regulated" : "mandatory";
  if (optionalSentences.length || diplomaRange.minimumDiplomaLevel !== null) return "recommended";
  if (noDiplomaPossible) return "no_diploma_possible";
  return "unknown";
}

function confidenceForAccess({ requirementKind, contradictoryEvidence, negatedObligation, citedDiplomas, citedCertifications, requiredCredentialLabels }) {
  let score = 0.68;
  if (requirementKind === "mandatory" || requirementKind === "regulated") score += 0.12;
  if (requirementKind === "recommended") score += 0.03;
  if (negatedObligation) score += 0.04;
  if (contradictoryEvidence) score -= 0.18;
  if (requiredCredentialLabels.length) score += 0.08;
  if (citedDiplomas.length || citedCertifications.length) score += 0.08;
  return Math.max(0.35, Math.min(0.9, Number(score.toFixed(2))));
}

function splitSentences(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isNegatedObligationSentence(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  return /aucun(?:e)?\s+(formation|certification|habilitation|diplome|qualification)[^.]*obligatoire/.test(text) ||
    /aucun(?:e)?\s+(formation|certification|habilitation|diplome|qualification)[^.]*exige/.test(text) ||
    /aucun(?:e)?\s+certification[^.]*legalement obligatoire/.test(text) ||
    /aucun(?:e)?\s+(certification|habilitation)[^.]*reglementairement/.test(text) ||
    /sans\s+(formation|certification|habilitation)[^.]*obligatoire/.test(text) ||
    /n[' ]?est\s+(legalement\s+|reglementairement\s+)?pas\s+obligatoire/.test(text) ||
    /ne\s+sont\s+pas\s+obligatoires?/.test(text) ||
    /n[' ]?est\s+pas\s+obligatoire/.test(text) ||
    /pas\s+(legalement|reglementairement)\s+obligatoire/.test(text);
}

function isNoDiplomaPossibleSentence(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  return /\baccessible\s+sans\s+(diplome|qualification|formation)\b/.test(text) ||
    /\baccessible\s+avec\s+ou\s+sans\s+diplome\b/.test(text) ||
    /\bsans\s+diplome\s+particulier\b/.test(text) ||
    /aucun\s+diplome\s+n[' ]?est\s+(legalement\s+)?obligatoire/.test(text) ||
    /aucun\s+diplome\s+n[' ]?est\s+requis/.test(text) ||
    /sans\s+formation\s+et\s+sans\s+certification\s+obligatoire/.test(text);
}

function isOptionalAccessSentence(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  return /peut\s+etre\s+un\s+atout/.test(text) ||
    /peuvent\s+etre\s+un\s+atout/.test(text) ||
    /\batout\b/.test(text) ||
    /facilitent?\s+l[' ]?entree/.test(text) ||
    /peuvent?\s+etre\s+(proposees?|recommandees?|appreciees?|utiles?)/.test(text) ||
    /reste(?:nt)?\s+des?\s+atouts?/.test(text);
}

function isRecommendedAccessSentence(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  return /recommand/.test(text) ||
    /generalement\s+accessible/.test(text) ||
    /souhaite/.test(text) ||
    /pertinent/.test(text) ||
    /utile/.test(text);
}

function isMandatoryAccessSentence(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  if (isNegatedObligationSentence(sentence) || isOptionalAccessSentence(sentence)) return false;
  if (/pour certaines? (fonctions?|missions?|publics?|equipements?)|selon (les fonctions?|le public|les publics|les equipements?)/.test(text)) return false;
  if (/niveaux?\s+d[' ]?etudes?\s+requis\s+varient/.test(text)) return false;
  if (/parfois\s+avoir\s+le\s+permis/.test(text) && !/\b(permis|carte professionnelle|habilitation|agrement|certification|certificat)[^.]*obligatoire/.test(text)) return false;
  const statesMinimumAccess = /\b(accessible|acces|exercice)\b[^.]*\b(au minimum|a minima)\b/.test(text) && (hasCredentialSignal(sentence) || hasDiplomaSignal(sentence));
  const statesPreciseStateDiplomaAccess = /\baccessible\s+avec\s+(?:un |le )?diplome d[' ]?etat\b/.test(text);
  if (statesMinimumAccess || statesPreciseStateDiplomaAccess) return true;
  const hasMandatoryWord = /obligatoire|exigee?s?|requise?s?|est requis|sont requis|necessite|doit etre|indispensable|reglementee?|soumis(?:e)? a|imperativement|il faut/.test(text);
  if (!hasMandatoryWord) return false;
  return hasCredentialSignal(sentence) || hasDiplomaSignal(sentence) || /\bformation\b/.test(text) || isRegulatedAccessSentence(sentence);
}

function isRegulatedAccessSentence(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  if (isNegatedObligationSentence(sentence)) return false;
  return /profession\s+reglementee?|metier\s+reglemente/.test(text) ||
    /carte\s+professionnelle/.test(text) ||
    /\bagrement\b/.test(text) ||
    /\bautorisation\b/.test(text) ||
    /\bhabilitation\b/.test(text) ||
    /\bpermis\s+[a-z0-9]\b/.test(text) ||
    /\bcaces\b/.test(text);
}

function hasDiplomaSignal(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  return /\bdiplome\b|\bbac\b|\bbac\s*\+\s*\d\b|\bbts\b|\bdut\b|\bbut\b|\blicence\b|\bmaster\b|\bdoctorat\b|\bcap\b|\bbep\b|\bniveau\s+[3-7]\b/.test(text);
}

function hasCredentialSignal(sentence = "") {
  const text = normalizeText(sentence).replace(/\s+/g, " ");
  return /\bcertification\b|\bcertificat\b|\bcqp\b|\bhabilitation\b|\bpermis\b|\bcarte professionnelle\b|\bagrement\b|\bautorisation\b|\bdiplome d[' ]?etat\b|\bdeass\b|\bcaces\b|\bcapacite professionnelle\b/.test(text);
}

function extractDiplomaMentions(text = "") {
  return unique(extractMatches(text, /\bCAP\b|\bBEP\b|Bac\s*\+?\s*\d?|BTS|BUT|DUT|licence|master|doctorat|ing[ée]nieur|Dipl[oô]me d['’ ]?Etat[^.,;\n]*|Dipl[oô]me d['’ ]?État[^.,;\n]*|Dipl[oô]me des M[ée]tiers d['’ ]Art[^.,;\n]*|dipl[oô]me[^.,;\n]*/gi)
    .filter(label => !/\bcapacit[ée]\b/i.test(label) || /\bcertificat\b/i.test(label)));
}

function extractCertificationMentions(text = "") {
  return unique(extractMatches(text, /CACES|CQP[^.,;\n]*|habilitation[^.,;\n]*|permis\s+[A-Z0-9][^.,;\n]*|carte professionnelle[^.,;\n]*|certificat[^.,;\n]*|agr[ée]ment[^.,;\n]*|autorisation[^.,;\n]*|capacit[ée] professionnelle[^.,;\n]*/gi));
}

function extractRequiredCredentialLabels(sentence = "") {
  if (!isMandatoryAccessSentence(sentence)) return [];
  const requiredPart = String(sentence || "").split(/qui peut être complété|peut être complété|complété par/i)[0] || sentence;
  return unique([
    ...extractMatches(requiredPart, /Dipl[oô]me d['’ ]?Etat[^.,;\n]*|Dipl[oô]me d['’ ]?État[^.,;\n]*|\bDEASS\b|CQP[^.,;\n]*|Certificat de Qualification Professionnelle[^.,;\n]*/gi),
    ...extractMatches(requiredPart, /certificat[^.,;\n]*|certification[^.,;\n]*|habilitation[^.,;\n]*|permis\s+[A-Z0-9][^.,;\n]*|carte professionnelle[^.,;\n]*|agr[ée]ment[^.,;\n]*|autorisation[^.,;\n]*|capacit[ée] professionnelle[^.,;\n]*/gi)
  ]).map(cleanCredentialLabel).filter(Boolean);
}

function extractOptionalCredentialLabels(sentence = "") {
  if (isNegatedObligationSentence(sentence)) return [];
  const optionalPart = String(sentence || "").split(/qui peut être complété|peut être complété|complété par/i).slice(1).join(" ");
  if (optionalPart) return extractCertificationMentions(optionalPart).map(cleanCredentialLabel).filter(Boolean);
  if (!isOptionalAccessSentence(sentence) && !isRecommendedAccessSentence(sentence)) return [];
  return extractCertificationMentions(sentence).map(cleanCredentialLabel).filter(Boolean);
}

function cleanCredentialLabel(label = "") {
  return String(label || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function inferDiplomaRange(text = "", flags = {}) {
  const mentions = [];
  const sentences = splitSentences(text);
  for (const sentence of sentences.length ? sentences : [text]) {
    const normalized = normalizeText(sentence).replace(/\s+/g, " ");
    for (const match of normalized.matchAll(/\bniveau\s+([3-7])\b/g)) {
      mentions.push(levelMention(Number(match[1]), sentence));
    }
    if (/\bbac\s*\+\s*5\b|\bmaster\b|\bdoctorat\b|\bingenieur\b/.test(normalized)) mentions.push(levelMention(7, sentence));
    if (/\bbac\s*\+\s*3\b|\bbac\s*\+\s*4\b|\blicence\b|\bbachelor\b|\bniveau\s+6\b/.test(normalized)) mentions.push(levelMention(6, sentence));
    if (/\bbac\s*\+\s*2\b|\bbts\b|\bdut\b|\bbut\b|\bniveau\s+5\b/.test(normalized)) mentions.push(levelMention(5, sentence));
    if (/\bbac\b(?!\s*\+)|\bbaccalaureat\b|\bniveau\s+4\b/.test(normalized)) mentions.push(levelMention(4, sentence));
    if (/\bcap\b|\bbep\b|\bniveau\s+3\b/.test(normalized)) mentions.push(levelMention(3, sentence));
  }
  if (flags.noDiplomaPossible) mentions.push({ level: 0, label: "Sans diplôme possible" });
  const levels = unique(mentions.map(item => item.level).filter(level => Number.isFinite(level))).sort((a, b) => a - b);
  const min = levels.length ? levels[0] : null;
  const max = levels.length ? levels[levels.length - 1] : null;
  return {
    minimumDiplomaLevel: min,
    maximumDiplomaLevel: max,
    minimumDiplomaLabel: diplomaLevelLabel(min),
    maximumDiplomaLabel: diplomaLevelLabel(max),
    mentions
  };
}

function hasMandatorySpecificCredentialEvidence(text = "", mandatorySentences = []) {
  if (!mandatorySentences.length) return false;
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  return /\bdiplome d[' ]?etat\b|\bdeass\b|\bcqp\b|\bcertificat\b|\bcertification\b|\bhabilitation\b|\bpermis\b|\bcarte professionnelle\b|\bagrement\b|\bautorisation\b|\bcapacite professionnelle\b/.test(normalized);
}

function extractSpecificCredentialLabels(text = "") {
  return unique([
    ...extractMatches(text, /Dipl[oô]me d['’ ]?Etat[^.,;\n]*|Dipl[oô]me d['’ ]?État[^.,;\n]*|\bDEASS\b|CQP[^.,;\n]*|Certificat de Qualification Professionnelle[^.,;\n]*/gi),
    ...extractCertificationMentions(text)
  ]).map(cleanCredentialLabel).filter(Boolean);
}

function levelMention(level, sentence) {
  return { level, label: diplomaLevelLabel(level), excerpt: sentence };
}

function diplomaLevelToAccessCategory(level) {
  return {
    0: "no_diploma_possible",
    3: "cap_or_equivalent",
    4: "bac",
    5: "bac_plus_2",
    6: "bac_plus_3",
    7: "bac_plus_5"
  }[level] || "unknown";
}

function diplomaLevelLabel(level) {
  return {
    0: "sans diplôme",
    3: "CAP/BEP",
    4: "Bac",
    5: "Bac +2",
    6: "Bac +3",
    7: "Bac +5"
  }[level] || null;
}

function diplomaRangeLabel(range = {}) {
  const min = range.minimumDiplomaLabel;
  const max = range.maximumDiplomaLabel;
  if (!min || !max) return "";
  if (min === max) return `Niveau ${max}`;
  return `Niveau ${min} à ${max}`;
}

function normalizeTrainingDuration(raw = null) {
  const category = ["none", "short", "intermediate", "long", "unknown"].includes(raw?.category) ? raw.category : "unknown";
  return {
    category,
    minimumMonths: numberOrNull(raw?.minimumMonths),
    maximumMonths: numberOrNull(raw?.maximumMonths),
    confidence: Number(raw?.confidence || 0),
    sourceRefs: arr(raw?.sourceRefs),
    verifiedAt: raw?.verifiedAt || null
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildAccessQualityReport(accessSummary, jobs, rulesDocument = {}, accessSummaryGeneratedAt = null) {
  const ambiguous = accessSummary.filter(row => row.warnings.length);
  const categoryCounts = countBy(accessSummary.map(row => row.accessLevelCategory));
  const requirementKindCounts = countBy(accessSummary.map(row => row.requirementKind));
  const regulatedUnresolved = accessSummary.filter(row => row.regulated && !row.requiredCredentialLabels.length && !row.accessPaths?.length);
  const genericRequiredLabels = accessSummary.flatMap(row => row.requiredCredentialLabels.map(label => ({ romeCode: row.romeCode, label })))
    .filter(item => isGenericRequiredCredentialLabel(item.label));
  const truthCases = buildAccessTruthCases(accessSummary);
  const truthFailures = truthCases.filter(item => item.status !== "ok");
  const durationCounts = countBy(accessSummary.map(row => normalizeTrainingDuration(row.trainingDuration).category));
  const accessPaths = accessSummary.flatMap(row => arr(row.accessPaths));
  const pathDurationCounts = countBy(accessPaths.map(path => normalizeTrainingDuration(path.trainingDuration).category));
  return {
    schemaVersion: "1.1.0",
    reportKind: "access_summary_quality",
    generatedAt: new Date().toISOString(),
    accessSummaryGeneratedAt,
    rulesVersion: rulesDocument.version || null,
    rulesVerifiedAt: rulesDocument.verifiedAt || null,
    summary: {
      jobsCount: jobs.length,
      accessTextsCount: accessSummary.filter(row => row.source !== "unknown").length,
      unknownCount: accessSummary.filter(row => row.accessLevelCategory === "unknown").length,
      ambiguousCount: ambiguous.length,
      regulatedCount: accessSummary.filter(row => row.regulated).length,
      regulatedUnresolvedCount: regulatedUnresolved.length,
      specificCredentialRequiredCount: accessSummary.filter(row => row.specificCredentialRequired).length,
      accessPathsCount: accessSummary.reduce((sum, row) => sum + arr(row.accessPaths).length, 0),
      accessDurationKnownCount: accessSummary.filter(row => normalizeTrainingDuration(row.trainingDuration).category !== "unknown").length,
      accessDurationUnknownCount: accessSummary.filter(row => normalizeTrainingDuration(row.trainingDuration).category === "unknown").length,
      accessDurationCategoryCounts: durationCounts,
      accessPathsDurationKnownCount: accessPaths.filter(path => normalizeTrainingDuration(path.trainingDuration).category !== "unknown").length,
      accessPathsDurationUnknownCount: accessPaths.filter(path => normalizeTrainingDuration(path.trainingDuration).category === "unknown").length,
      accessPathDurationCategoryCounts: pathDurationCounts,
      genericRequiredLabelsRejectedCount: genericRequiredLabels.length,
      truthCasesCount: truthCases.length,
      truthFailuresCount: truthFailures.length,
      categoryCounts,
      requirementKindCounts
    },
    ambiguousCases: ambiguous.slice(0, 120),
    regulatedUnresolved,
    genericRequiredLabels,
    truthCases,
    truthFailures,
    warnings: [
      "Synthèse prudente issue de textes officiels : le texte source reste prioritaire.",
      "Les formulations avec 'peut' ou 'atout' ne sont pas traitées comme obligations.",
      "Les règles locales explicites sourcées prévalent pour les professions réglementées et les voies parallèles."
    ]
  };
}

function buildAccessTruthCases(accessSummary = []) {
  const byCode = new Map(accessSummary.map(row => [row.romeCode, row]));
  const expectations = {
    G1201: row => [row.requirementKind === "recommended", !row.specificCredentialRequired],
    G1202: row => [Boolean(row)],
    G1203: row => [Boolean(row)],
    G1235: row => [row.requirementKind === "conditional", !row.contradictoryEvidence, !row.mandatoryQualification],
    K1201: row => [row.requirementKind === "regulated", includesCredential(row, /deass|assistant de service social/), row.trainingDuration?.category === "long"],
    K1207: row => [row.requirementKind === "regulated", includesCredential(row, /dees|educateur specialise/), row.trainingDuration?.category === "long"],
    K1307: row => [row.requirementKind === "mandatory", includesCredential(row, /cap.*aepe|accompagnant educatif petite enfance/), row.trainingDuration?.category === "unknown"],
    K2106: row => [arr(row.accessPaths).length >= 3, !includesCredential(row, /cap.*aepe/)],
    K2111: row => [row.requirementKind === "recommended", !row.specificCredentialRequired],
    J1104: row => [row.requirementKind === "regulated", includesCredential(row, /sage-femme|maieutique/)],
    J1202: row => [row.requirementKind === "regulated", includesCredential(row, /pharmacie/)],
    J1405: row => [row.requirementKind === "regulated", includesCredential(row, /opticien/)],
    J1407: row => [row.requirementKind === "regulated", includesCredential(row, /orthoptiste/), row.trainingDuration?.category === "long"],
    J1506: row => [row.requirementKind === "regulated", includesCredential(row, /infirmier/), row.optionalCredentialLabels.length >= 1, row.trainingDuration?.category === "long"],
    N1210: row => [row.requirementKind === "conflicting", row.contradictoryEvidence],
    M1501: row => [row.minimumDiplomaLevel === 5, row.maximumDiplomaLevel === 7],
    D1424: row => [!row.specificCredentialRequired, !row.mandatoryQualification]
  };
  return Object.entries(expectations).map(([romeCode, assert]) => {
    const row = byCode.get(romeCode);
    const checks = row ? assert(row) : [false];
    return { romeCode, status: checks.every(Boolean) ? "ok" : "failed", checks, requirementKind: row?.requirementKind || null, requiredCredentialLabels: row?.requiredCredentialLabels || [] };
  });
}

function includesCredential(row = {}, pattern) {
  return pattern.test(normalizeText(arr(row.requiredCredentialLabels).join(" ")));
}

function isGenericRequiredCredentialLabel(label = "") {
  const text = normalizeText(label);
  return /^(certification|diplome|qualification) (est |reste |peut )?(obligatoire|exigee|requise)/.test(text) || text.length < 5;
}

export function buildOfficialContextConstraintMapping(contexts) {
  const byLabel = new Map(contexts.map(context => [normalizeText(context.label), context]));
  const confirmedRules = CONTEXT_CONSTRAINT_RULES.map(([label, target, value]) => {
    const context = byLabel.get(normalizeText(label));
    return {
      contextId: context?.id || null,
      label,
      target,
      value,
      source: context ? "official_work_context_label" : "missing_in_current_referential",
      confidence: context ? 0.8 : 0
    };
  });
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - mapping contraintes depuis contextes ROME officiels",
    version: "v0.7.1-alpha",
    generatedAt: new Date().toISOString(),
    confirmedRules,
    warnings: confirmedRules.filter(rule => !rule.contextId).map(rule => `${rule.label} absent du référentiel chargé.`)
  };
}

export function buildOfficialConstraintSummary(job, mapping) {
  const contextIds = new Set(arr(job.workContexts));
  const labels = new Set(arr(job.romeWorkContextLabels).map(normalizeText));
  const confirmedSignals = mapping.confirmedRules
    .filter(rule => (rule.contextId && contextIds.has(rule.contextId)) || labels.has(normalizeText(rule.label)))
    .map(rule => ({ label: rule.label, target: rule.target, value: rule.value, evidenceStatus: "official_confirmed", sourceContextId: rule.contextId, confidence: rule.confidence }));
  const knownTargets = new Set(confirmedSignals.map(rule => rule.target.split(".")[0]));
  const unknownDimensions = ["schedule", "physical", "mobility", "environment", "publicContact"].filter(key => !knownTargets.has(key));
  return {
    jobId: job.id,
    romeCode: job.romeCode,
    confirmedSignals,
    unknownDimensions,
    source: confirmedSignals.length ? "official_work_contexts" : "unknown",
    confidence: confirmedSignals.length ? 0.8 : 0
  };
}

function buildWorkContextUserTaxonomy(contexts, jobs) {
  const jobUsage = countBy(jobs.flatMap(job => arr(job.workContexts)));
  const categories = CONTEXT_CATEGORIES.map(([id, label]) => ({ id, label }));
  const options = contexts.map(context => {
    const category = categorizeContext(context.label);
    const resultCount = jobUsage[context.id] || 0;
    return {
      id: context.id,
      label: context.label,
      categoryId: category.id,
      resultCount,
      knownDataCount: resultCount,
      unknownDataCount: jobs.length - resultCount,
      coverageRatio: jobs.length ? Number((resultCount / jobs.length).toFixed(3)) : 0,
      modeAvailability: resultCount > 0 ? { essential: resultCount >= 3, detailed: true, diagnostic: true } : { essential: false, detailed: false, diagnostic: true }
    };
  }).sort((a, b) => a.categoryId.localeCompare(b.categoryId) || b.resultCount - a.resultCount || a.label.localeCompare(b.label, "fr"));
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - taxonomie utilisateur des contextes ROME",
    version: "v0.7.1-alpha",
    generatedAt: new Date().toISOString(),
    categories,
    options
  };
}

function buildExplorationFacetAudit(jobs, contextTaxonomy) {
  const contextOptions = contextTaxonomy.options.map(option => ({
    id: option.id,
    label: option.label,
    categoryId: option.categoryId,
    resultCount: option.resultCount,
    knownDataCount: option.knownDataCount,
    unknownDataCount: option.unknownDataCount,
    coverageRatio: option.coverageRatio,
    modeAvailability: option.modeAvailability
  }));
  return {
    schemaVersion: "1.0.0",
    reportKind: "exploration_facet_audit_rome500",
    version: "v0.7.1-alpha",
    generatedAt: new Date().toISOString(),
    jobsCount: jobs.length,
    contextCategories: contextTaxonomy.categories,
    contexts: contextOptions,
    zeroCountOptions: contextOptions.filter(option => option.resultCount === 0).length,
    warnings: ["Les filtres Essentiel masquent les options sans résultat et les dimensions inconnues."]
  };
}

function buildSkillConceptImpactReport(taxonomy, conceptMappings, jobs) {
  const concepts = arr(taxonomy.concepts);
  const mappings = arr(conceptMappings.mappings);
  const mappedSkillIds = new Set(mappings.flatMap(row => arr(row.officialSkillIds)));
  const jobSkillIds = new Set(jobs.flatMap(job => [...arr(job.matchableSkillIds), ...arr(job.mobilizedSkillIds), ...arr(job.softSkillIds)]));
  const linkedMapped = [...mappedSkillIds].filter(id => jobSkillIds.has(id));
  return {
    schemaVersion: "1.0.0",
    reportKind: "skill_concept_impact",
    version: "v0.7.1-alpha",
    generatedAt: new Date().toISOString(),
    summary: {
      conceptCount: concepts.length,
      facetCount: arr(taxonomy.facets).length,
      mappedOfficialSkillIds: mappedSkillIds.size,
      mappedSkillIdsLinkedToJobs: linkedMapped.length,
      jobsCount: jobs.length
    },
    impactModel: {
      before: "Le profil pouvait cocher directement des compétences officielles nombreuses.",
      after: "Les concepts niveau 1 ajoutent une preuve utilisateur simple ; les compétences officielles restent disponibles en affinement.",
      scoringUse: "Preuve complémentaire faible à moyenne, sans supprimer les anciennes compétences du profil."
    },
    warnings: ["Le poids exact des concepts doit être audité avec profils tests avant hausse forte du score."]
  };
}

function categorizeContext(label) {
  const normalized = normalizeText(label);
  const row = CONTEXT_CATEGORIES.find(([, , pattern]) => pattern.test(normalized));
  return row ? { id: row[0], label: row[1] } : { id: "organisation_travail", label: "Organisation du travail" };
}

function buildImplementationReport({ accessQuality, contextMapping, explorationAudit, impactReport }) {
  return `# Boussole Pro v0.7.1 — Rapport d'implémentation Codex

Date : ${new Date().toISOString()}

## Modifications effectuées

- Synthèse prudente des conditions d'accès ROME 500.
- Rapport qualité des accès : ${accessQuality.summary.accessTextsCount}/${accessQuality.summary.jobsCount} textes exploités.
- Mapping local des contextes officiels vers contraintes confirmées.
- Taxonomie utilisateur des contextes : ${explorationAudit.contextCategories.length} catégories.
- Rapport d'impact des concepts compétences : ${impactReport.summary.conceptCount} concepts, ${impactReport.summary.facetCount} facettes.
- Préparation de l'interface v0.7.1 : mode global, cartes allégées, marché une ligne, comparateur modal.

## Tests locaux

- Lancer \`node scripts/prepare-v071-local.mjs\`.
- Vérifier JSON des fichiers générés.
- Ouvrir Boussole Pro et charger ROME 500 candidat consolidé.

## Limitations restantes

- La synthèse d'accès reste textuelle et prudente : le texte officiel prime.
- Les contraintes ne sont confirmées que si un contexte ROME explicite est présent.
- L'import complet de tests externes reste une architecture préparée, pas un assistant finalisé.

## Fichiers à commit

- \`creations/boussolepro/boussole-pro.html\`
- \`scripts/prepare-v071-local.mjs\`
- \`creations/boussolepro/data/generated/access-summary.rome500.json\`
- \`creations/boussolepro/data/generated/access-summary-quality-report.json\`
- \`creations/boussolepro/data/generated/official-constraint-summary.rome500.json\`
- \`creations/boussolepro/data/generated/skill-concept-impact-report.json\`
- \`creations/boussolepro/data/generated/exploration-facet-audit.rome500.json\`
- \`creations/boussolepro/data/local/official-context-constraint-mapping.json\`
- \`creations/boussolepro/data/local/work-context-user-taxonomy.json\`

## Actions manuelles

- Relire les cas ambigus dans \`access-summary-quality-report.json\`.
- Tester les modes Essentiel, Détaillé et Diagnostic.
- Exporter un profil et un diagnostic de résultat pour le prochain audit.

Aucune API ni GitHub Actions n'a été appelée par Codex.
`;
}

function extractRelevantSentences(text) {
  return text.split(/[.\n]/).map(item => item.trim()).filter(item => /dipl|cap|bac|bts|licence|master|caces|permis|certificat|habilitation|qualification|accessible/i.test(item));
}

function extractMatches(text, regex) {
  return unique([...String(text || "").matchAll(regex)].map(match => match[0].trim().replace(/\s+/g, " "))).slice(0, 12);
}

function normalizeMultilineText(value) {
  return String(value || "").replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n|\r/g, "\n").trim();
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function arr(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function unique(values) {
  return [...new Set(arr(values).filter(Boolean))];
}

function countBy(values) {
  return arr(values).reduce((acc, value) => {
    const key = value || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function synchronizeAccessRules(document = {}) {
  const rules = document.rules || {};
  const files = [
    path.join(GENERATED_DIR, "jobs.rome.json"),
    path.join(ROME500_DIR, "jobs.rome.json")
  ];
  const batchesDir = path.join(ROME500_DIR, "batches");
  try {
    for (const entry of await readdir(batchesDir, { withFileTypes: true })) {
      if (entry.isFile() && /^jobs\.batch-\d+\.json$/.test(entry.name)) files.push(path.join(batchesDir, entry.name));
    }
  } catch {
    // Les batches sont optionnels dans un corpus partiel.
  }
  for (const file of files) {
    const jobs = await readJson(file, null);
    if (!Array.isArray(jobs)) continue;
    let changed = false;
    for (const job of jobs) {
      const rule = rules[job.romeCode];
      if (!rule) continue;
      if (rule.accessTextOverride) {
        job.accessConditions = typeof job.accessConditions === "object" && job.accessConditions ? job.accessConditions : {};
        job.accessConditions.text = rule.accessTextOverride;
        job.accessConditions.source = "local_explicit_access_rule";
        job.accessConditions.confidence = 0.96;
      }
      if (rule.accessPaths) job.accessPaths = rule.accessPaths.map(path => ({ ...path, verifiedAt: document.verifiedAt || null }));
      if (job.romeCode === "K2106") {
        job.requiredDiplomaLevel = null;
        job.recommendedDiplomaLevel = null;
        job.requiredCertifications = arr(job.requiredCertifications).filter(item => !/cap[-_ ]?aepe|petite enfance/i.test(String(item)));
      }
      changed = true;
    }
    if (changed) await writeJson(file, jobs);
  }
}

async function enrichExistingDataQualityReport(directory, accessSummary = [], buildMetadata = {}) {
  const file = path.join(directory, "data-quality-report.rome.json");
  const report = await readJson(file, null);
  if (!report || typeof report !== "object") return;
  const directoryJobs = await readJson(path.join(directory, "jobs.rome.json"), []);
  const activeCodes = new Set(directoryJobs.map(job => job.romeCode).filter(Boolean));
  accessSummary = accessSummary.filter(row => activeCodes.has(row.romeCode));
  const paths = accessSummary.flatMap(row => arr(row.accessPaths));
  report.summary = {
    ...(report.summary || {}),
    jobsWithAccessSummary: accessSummary.length,
    jobsWithSpecificCredentialRequired: accessSummary.filter(row => row.specificCredentialRequired).length,
    jobsWithStructuredAccessPaths: accessSummary.filter(row => arr(row.accessPaths).length).length,
    accessPaths: paths.length,
    accessPathsWithKnownDuration: paths.filter(item => normalizeTrainingDuration(item.trainingDuration).category !== "unknown").length,
    accessPathsWithUnknownDuration: paths.filter(item => normalizeTrainingDuration(item.trainingDuration).category === "unknown").length,
    regulatedJobsResolved: accessSummary.filter(row => row.regulated && (arr(row.requiredCredentialLabels).length || arr(row.accessPaths).length)).length,
    regulatedJobsUnresolved: accessSummary.filter(row => row.regulated && !arr(row.requiredCredentialLabels).length && !arr(row.accessPaths).length).length,
    accessContradictions: accessSummary.filter(row => row.contradictoryEvidence).length
  };
  report.accessCatalogExplanation = {
    trainingsCatalogCount: report.summary.trainings || 0,
    certificationsCatalogCount: report.summary.certifications || 0,
    jobsWithAccessSummary: accessSummary.length,
    note: "Les compteurs trainings et certifications décrivent les catalogues dédiés. Une valeur nulle ne signifie pas que les conditions d’accès métier sont absentes."
  };
  Object.assign(report, buildMetadata, { datasetVersion: report.datasetVersion || buildMetadata.datasetVersion });
  delete report.sourceArtifactSha256;
  await writeJson(file, report);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
