import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");

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

  const jobs = await readJson(path.join(ROME500_DIR, "jobs.rome.json"), []);
  const contexts = await readJson(path.join(ROME500_DIR, "work-contexts.rome.json"), []);
  const taxonomy = await readJson(path.join(LOCAL_DIR, "skill-taxonomy.user.json"), { concepts: [], facets: [] });
  const conceptMappings = await readJson(path.join(LOCAL_DIR, "skill-concept-mappings.rome.json"), { mappings: [] });

  const accessSummary = jobs.map(buildAccessSummary);
  const accessQuality = buildAccessQualityReport(accessSummary, jobs);
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

function buildAccessSummary(job = {}) {
  const text = normalizeMultilineText(job.accessConditions?.text || "");
  const normalized = normalizeText(text);
  const hasText = Boolean(text);
  const noDiplomaPossible = /\baccessible sans qualification\b|\bsans dipl[oô]me\b|\bsans qualification\b/.test(normalized);
  const possibleOnly = /peut|peuvent|faciliter|atout|souhaite|apprecie|demandees?|necessaire/.test(normalized);
  const mandatory = /est requis|sont requis|obligatoire|exige|necessite|doit etre|indispensable/.test(normalized);
  const regulated = /reglement|carte professionnelle|habilitation|autorisation|certificat d'aptitude|caces|permis/.test(normalized);
  const citedDiplomas = extractMatches(text, /(CAP|Bac\s*\+?\s*\d?|BTS|BUT|DUT|licence|master|doctorat|dipl[oô]me[^.,;\n]*)/gi);
  const citedCertifications = extractMatches(text, /(CACES|habilitation[^.,;\n]*|permis[^.,;\n]*|carte professionnelle|certificat[^.,;\n]*)/gi);
  const accessLevelCategory = inferAccessCategory(normalized, { noDiplomaPossible, citedDiplomas, mandatory });
  const warnings = [];
  if (!hasText) warnings.push("access_text_missing");
  if (mandatory && possibleOnly) warnings.push("mixed_required_and_optional_wording");
  if (citedDiplomas.length > 3) warnings.push("multiple_diploma_mentions");
  return {
    jobId: job.id,
    romeCode: job.romeCode,
    displayLabel: accessDisplayLabel(accessLevelCategory, { noDiplomaPossible, mandatory, citedDiplomas, citedCertifications }),
    accessLevelCategory,
    noDiplomaPossible,
    regulated,
    mandatoryQualification: Boolean(mandatory && (citedDiplomas.length || citedCertifications.length || regulated)),
    citedDiplomas,
    citedCertifications,
    source: hasText ? "derived_from_official_access_text" : "unknown",
    confidence: hasText ? confidenceForAccess({ mandatory, possibleOnly, citedDiplomas, citedCertifications }) : 0,
    matchedExcerpts: hasText ? extractRelevantSentences(text).slice(0, 4) : [],
    warnings
  };
}

function inferAccessCategory(text, flags) {
  if (!text) return "unknown";
  if (flags.noDiplomaPossible) return "no_diploma_possible";
  if (/bac\s*\+\s*5|master|doctorat|ingenieur/.test(text)) return "bac_plus_5";
  if (/bac\s*\+\s*3|licence|bachelor/.test(text)) return "bac_plus_3";
  if (/bac\s*\+\s*2|bts|dut|but/.test(text)) return "bac_plus_2";
  if (/\bbac\b|baccalaureat/.test(text)) return "bac";
  if (/\bcap\b|bep/.test(text)) return "cap_or_equivalent";
  if (flags.citedDiplomas.length > 1) return "mixed_or_multiple_routes";
  return "unknown";
}

function accessDisplayLabel(category, flags = {}) {
  if (category === "unknown") return "Niveau exact à vérifier";
  if (category === "no_diploma_possible") return "Accès possible sans diplôme selon le texte officiel";
  const labels = {
    cap_or_equivalent: "CAP ou équivalent cité",
    bac: "Bac cité",
    bac_plus_2: "Bac +2 cité",
    bac_plus_3: "Bac +3 cité",
    bac_plus_5: "Bac +5 cité",
    mixed_or_multiple_routes: "Plusieurs voies d'accès citées"
  };
  const base = labels[category] || "Accès à vérifier";
  return flags.mandatoryQualification ? `${base} comme exigence possible` : `${base}, obligation à vérifier`;
}

function confidenceForAccess({ mandatory, possibleOnly, citedDiplomas, citedCertifications }) {
  let score = 0.68;
  if (mandatory) score += 0.1;
  if (possibleOnly) score -= 0.08;
  if (citedDiplomas.length || citedCertifications.length) score += 0.08;
  return Math.max(0.45, Math.min(0.86, Number(score.toFixed(2))));
}

function buildAccessQualityReport(accessSummary, jobs) {
  const ambiguous = accessSummary.filter(row => row.warnings.length);
  const categoryCounts = countBy(accessSummary.map(row => row.accessLevelCategory));
  return {
    schemaVersion: "1.0.0",
    reportKind: "access_summary_quality",
    generatedAt: new Date().toISOString(),
    summary: {
      jobsCount: jobs.length,
      accessTextsCount: accessSummary.filter(row => row.source !== "unknown").length,
      unknownCount: accessSummary.filter(row => row.accessLevelCategory === "unknown").length,
      ambiguousCount: ambiguous.length,
      categoryCounts
    },
    ambiguousCases: ambiguous.slice(0, 120),
    warnings: [
      "Synthèse prudente issue de textes officiels : le texte source reste prioritaire.",
      "Les formulations avec 'peut' ou 'atout' ne sont pas traitées comme obligations."
    ]
  };
}

function buildOfficialContextConstraintMapping(contexts) {
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

function buildOfficialConstraintSummary(job, mapping) {
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
- Ouvrir Boussole Pro et charger ROME 500 expérimental.

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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
