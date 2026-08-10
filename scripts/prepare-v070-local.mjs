import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const GENERATED_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");

const USER_CONCEPTS = [
  ["accompagner_ecouter", "Accompagner et écouter", "Relation d'aide, écoute, orientation, soutien.", "heart", ["social_insertion", "services_aux_collectivites"]],
  ["animer_transmettre", "Animer et transmettre", "Animation, pédagogie, ateliers, transmission.", "spark", ["education_enfance", "culture_communication"]],
  ["soigner_securiser", "Prendre soin et sécuriser", "Soin, prévention, sécurité des êtres.", "shield", ["sante_soin", "securite_prevention"]],
  ["accueillir_servir", "Accueillir et rendre service", "Accueil, service, relation client ou usager.", "hand", ["commerce_vente", "hotellerie_hebergement"]],
  ["organiser_coordonner", "Organiser et coordonner", "Planification, suivi, coordination, logistique légère.", "calendar", ["administratif_support"]],
  ["communiquer_creer", "Communiquer et créer", "Écrire, concevoir, diffuser, créer des supports.", "pen", ["culture_communication"]],
  ["observer_analyser_resoudre", "Observer, analyser et résoudre", "Comprendre une situation, diagnostiquer, améliorer.", "search", ["numerique", "industrie_production"]],
  ["gerer_dossiers_informations", "Gérer des dossiers et des informations", "Administration, classement, données, procédures.", "folder", ["administratif_support"]],
  ["numerique_donnees", "Utiliser le numérique et les données", "Outils numériques, support, analyse de données.", "screen", ["numerique"]],
  ["fabriquer_reparer", "Fabriquer, installer et réparer", "Gestes techniques, maintenance, installation.", "tool", ["maintenance", "batiment_construction"]],
  ["nettoyer_entretenir", "Nettoyer et entretenir", "Hygiène, entretien, propreté, protocoles.", "clean", ["proprete_entretien"]],
  ["produire_cuisiner", "Préparer, produire et cuisiner", "Cuisine, production, préparation alimentaire.", "bowl", ["restauration_alimentation"]],
  ["cultiver_proteger_vivant", "Cultiver et protéger le vivant", "Nature, espaces verts, agriculture, environnement.", "leaf", ["nature_agriculture"]],
  ["soigner_animaux", "Prendre soin des animaux", "Soins, observation et conduite auprès des animaux.", "paw", ["animaux"]],
  ["conduire_gerer_flux", "Conduire et gérer des flux", "Transport, stock, manutention, flux.", "route", ["logistique_transport"]],
  ["qualite_securite", "Contrôler la qualité et la sécurité", "Vérifier, prévenir, contrôler, sécuriser.", "check", ["industrie_production", "securite_prevention"]],
  ["encadrer_piloter", "Encadrer et piloter", "Encadrement, décisions, responsabilité, projets.", "flag", ["administratif_support"]],
  ["concevoir_rechercher", "Concevoir, étudier et rechercher", "Études, conception, recherche, synthèse.", "compass", ["numerique", "culture_communication"]]
];

const FACETS = [
  ["accompagner_enfants", "accompagner_ecouter", "Accompagner des enfants", "J'accompagne des enfants dans leur quotidien ou leurs apprentissages", ["Relation d'aide", "Conseil / transmission"]],
  ["accompagner_handicap", "accompagner_ecouter", "Accompagner le handicap", "J'aide des êtres en situation de handicap", ["Relation d'aide", "Prévention des risques"]],
  ["accompagner_insertion", "accompagner_ecouter", "Insertion et parcours", "J'aide à clarifier un parcours ou une insertion", ["Conseil / transmission", "Organisation"]],
  ["mediation_conflits", "accompagner_ecouter", "Médiation", "Je facilite le dialogue ou l'apaisement", ["Communication", "Relation client"]],
  ["autonomie_quotidienne", "accompagner_ecouter", "Autonomie quotidienne", "J'aide dans les gestes et repères du quotidien", ["Relation d'aide"]],
  ["ecoute_individuelle", "accompagner_ecouter", "Écoute individuelle", "J'écoute et j'oriente avec tact", ["Relation d'aide", "Communication"]],
  ["animation_ateliers_creatifs", "animer_transmettre", "Ateliers créatifs", "J'anime des activités créatives", ["Animation", "Communication"]],
  ["animation_jeu", "animer_transmettre", "Jeu et ludique", "J'anime des jeux ou activités ludiques", ["Animation"]],
  ["formation_adultes", "animer_transmettre", "Formation d'adultes", "Je transmets à des adultes", ["Conseil / transmission"]],
  ["enseignement_scolaire", "animer_transmettre", "Apprentissages scolaires", "J'aide à apprendre dans un cadre scolaire", ["Conseil / transmission"]],
  ["animation_groupes", "animer_transmettre", "Animation de groupes", "Je gère une dynamique collective", ["Animation", "Organisation"]],
  ["sensibilisation_nature", "animer_transmettre", "Sensibilisation nature", "Je transmets autour du vivant ou de l'environnement", ["Animation", "Prévention des risques"]],
  ["soins_hygiene", "soigner_securiser", "Soins et hygiène", "Je prends soin avec des règles d'hygiène", ["Prévention des risques"]],
  ["securite_personnes", "soigner_securiser", "Sécurité des personnes", "Je veille à la sécurité d'un public", ["Prévention des risques"]],
  ["premiers_secours", "soigner_securiser", "Premiers secours", "Je réagis face à une situation sensible", ["Prévention des risques"]],
  ["accueil_public", "accueillir_servir", "Accueil du public", "J'accueille et j'oriente", ["Relation client", "Communication"]],
  ["service_client", "accueillir_servir", "Service client", "Je réponds à une demande ou une réclamation", ["Relation client"]],
  ["reception_hoteliere", "accueillir_servir", "Accueil hôtelier", "J'accueille en hébergement ou tourisme", ["Relation client", "Organisation"]],
  ["service_restauration", "accueillir_servir", "Service en restauration", "Je rends service dans un cadre de restauration", ["Relation client"]],
  ["gestion_planning", "organiser_coordonner", "Planning", "J'organise un planning ou des priorités", ["Organisation"]],
  ["coordination_projets", "organiser_coordonner", "Coordination projet", "Je coordonne des actions ou intervenants", ["Organisation"]],
  ["organisation_reunions", "organiser_coordonner", "Réunions", "Je prépare ou anime des réunions", ["Organisation", "Communication"]],
  ["redaction_contenus", "communiquer_creer", "Rédaction", "J'écris des contenus clairs", ["Communication"]],
  ["creation_visuelle", "communiquer_creer", "Création visuelle", "Je crée des supports visuels", ["Communication"]],
  ["communication_numerique", "communiquer_creer", "Communication numérique", "Je communique en ligne", ["Communication"]],
  ["analyse_donnees", "observer_analyser_resoudre", "Analyse de données", "J'analyse des données ou indicateurs", ["Organisation"]],
  ["diagnostic_problemes", "observer_analyser_resoudre", "Diagnostic", "Je cherche la cause d'un problème", ["Maintenance, Réparation"]],
  ["amelioration_process", "observer_analyser_resoudre", "Amélioration", "J'améliore une méthode ou une organisation", ["Organisation"]],
  ["gestion_dossiers", "gerer_dossiers_informations", "Dossiers", "Je suis des dossiers administratifs", ["Organisation"]],
  ["classement_archivage", "gerer_dossiers_informations", "Classement", "Je classe, archive ou retrouve l'information", ["Organisation"]],
  ["saisie_donnees", "gerer_dossiers_informations", "Saisie de données", "Je renseigne des informations avec rigueur", ["Organisation"]],
  ["support_informatique", "numerique_donnees", "Support informatique", "J'aide à utiliser des outils numériques", ["Maintenance, Réparation", "Relation client"]],
  ["developpement_logiciel", "numerique_donnees", "Développement logiciel", "Je construis ou corrige un outil numérique", ["Production, Fabrication"]],
  ["outils_bureautiques", "numerique_donnees", "Outils bureautiques", "J'utilise les outils numériques du quotidien", ["Organisation"]],
  ["reparation_objets", "fabriquer_reparer", "Réparation", "Je répare ou remets en état", ["Maintenance, Réparation"]],
  ["installation_equipements", "fabriquer_reparer", "Installation", "J'installe du matériel ou un équipement", ["Aménagement", "Maintenance, Réparation"]],
  ["travail_chantier", "fabriquer_reparer", "Chantier", "Je travaille sur site ou chantier", ["Aménagement"]],
  ["nettoyage_locaux", "nettoyer_entretenir", "Nettoyage de locaux", "J'entretiens des espaces", ["Prévention des risques"]],
  ["protocoles_hygiene", "nettoyer_entretenir", "Protocoles d'hygiène", "Je respecte des protocoles précis", ["Prévention des risques"]],
  ["blanchisserie_pressing", "nettoyer_entretenir", "Linge et pressing", "Je traite du linge ou textiles", ["Production, Fabrication"]],
  ["preparation_cuisine", "produire_cuisiner", "Préparation cuisine", "Je prépare des ingrédients ou plats", ["Production, Fabrication"]],
  ["production_alimentaire", "produire_cuisiner", "Production alimentaire", "Je produis ou transforme des aliments", ["Production, Fabrication"]],
  ["service_haccp", "produire_cuisiner", "Hygiène alimentaire", "Je respecte les règles alimentaires", ["Prévention des risques"]],
  ["espaces_verts", "cultiver_proteger_vivant", "Espaces verts", "J'entretiens des espaces verts", ["Aménagement"]],
  ["culture_plantes", "cultiver_proteger_vivant", "Culture de plantes", "Je cultive ou protège des végétaux", ["Production, Fabrication"]],
  ["protection_environnement", "cultiver_proteger_vivant", "Protection environnement", "Je contribue à protéger les milieux", ["Prévention des risques"]],
  ["soins_animaux", "soigner_animaux", "Soins animaux", "Je prends soin d'animaux", ["Relation d'aide"]],
  ["conduite_animaux", "soigner_animaux", "Conduite animale", "Je conduis, observe ou surveille des animaux", ["Prévention des risques"]],
  ["stock_manutention", "conduire_gerer_flux", "Stock et manutention", "Je range, prépare ou déplace des stocks", ["Organisation"]],
  ["conduite_transport", "conduire_gerer_flux", "Conduite transport", "Je conduis ou organise des déplacements", ["Organisation"]],
  ["gestion_flux", "conduire_gerer_flux", "Gestion de flux", "Je coordonne des flux ou livraisons", ["Organisation"]],
  ["controle_qualite", "qualite_securite", "Contrôle qualité", "Je vérifie une conformité", ["Prévention des risques"]],
  ["prevention_risques", "qualite_securite", "Prévention des risques", "Je repère et limite les risques", ["Prévention des risques"]],
  ["securite_site", "qualite_securite", "Sécurité de site", "Je surveille ou sécurise un lieu", ["Prévention des risques"]],
  ["management_equipe", "encadrer_piloter", "Encadrement d'équipe", "J'encadre une équipe", ["Organisation"]],
  ["pilotage_activite", "encadrer_piloter", "Pilotage d'activité", "Je suis des objectifs et décisions", ["Organisation"]],
  ["gestion_budget", "encadrer_piloter", "Budget", "Je suis des moyens ou un budget", ["Organisation"]],
  ["conception_projet", "concevoir_rechercher", "Conception projet", "Je conçois une solution ou un projet", ["Organisation"]],
  ["etudes_recherche", "concevoir_rechercher", "Études et recherche", "Je réalise une étude ou recherche", ["Organisation"]],
  ["synthese_analyse", "concevoir_rechercher", "Synthèse", "Je synthétise des informations complexes", ["Communication", "Organisation"]]
];

const ESSENTIAL_CODES = [
  ["K1202", "Educateur / Educatrice de jeunes enfants"],
  ["K1206", "Animateur coordinateur socioculturel / Animatrice coordinatrice socioculturelle"],
  ["K1207", "Educateur spécialisé / Educatrice spécialisée"],
  ["K1208", "Moniteur éducateur / Monitrice éducatrice"],
  ["K1210", "Educateur / Educatrice de la protection judiciaire de la jeunesse"],
  ["K1215", "Moniteur / Monitrice d’atelier en milieu de travail protégé"],
  ["K1601", "Documentaliste / ludothèque, appellations à vérifier"],
  ["K2113", "Accompagnant / Accompagnante des élèves en situation de handicap - AESH"]
];

async function main() {
  await mkdir(GENERATED_DIR, { recursive: true });
  await mkdir(ROME500_DIR, { recursive: true });
  await mkdir(LOCAL_DIR, { recursive: true });

  const jobs = await readJson(path.join(ROME500_DIR, "jobs.rome.json"), []);
  const mappings = await readJson(path.join(ROME500_DIR, "mappings.rome.json"), []);
  const rawSkills = await readJson(path.join(ROME500_DIR, "rome-raw-skills.json"), []);
  const filteredSkills = await readJson(path.join(ROME500_DIR, "skills.rome.json"), []);
  const jobAppellations = await readJson(path.join(ROME500_DIR, "job-appellations.rome.json"), []);
  const rootJobs = await readJson(path.join(GENERATED_DIR, "jobs.rome.json"), []);
  const rootMappings = await readJson(path.join(GENERATED_DIR, "mappings.rome.json"), []);
  const rootRawSkills = await readJson(path.join(GENERATED_DIR, "rome-raw-skills.json"), rawSkills);
  const rootFilteredSkills = await readJson(path.join(GENERATED_DIR, "skills.rome.json"), filteredSkills);

  const { skillsEngine, integrityReport } = buildSkillsEngine({ jobs, mappings, rawSkills, filteredSkills }, "rome500-candidate-v0.7");
  const rootSkillLayer = buildSkillsEngine({
    jobs: rootJobs,
    mappings: rootMappings,
    rawSkills: rootRawSkills,
    filteredSkills: rootFilteredSkills
  }, "rome72-generated-v0.7");
  const taxonomy = buildSkillTaxonomy();
  const conceptMappings = buildConceptMappings(taxonomy, skillsEngine);
  const essentialGapReport = buildEssentialGapReport(jobs);
  const proposedCodes = buildRome500V2Proposal(jobs, essentialGapReport);
  const explorationAudit = buildExplorationFacetAudit(jobs);
  const pathwayAudit = buildResultsPathwayAudit(jobs, jobAppellations);
  const implementationReport = buildImplementationReport({ integrityReport, explorationAudit, pathwayAudit, essentialGapReport });

  await writeJson(path.join(ROME500_DIR, "skills-engine.rome.json"), skillsEngine);
  await writeJson(path.join(ROME500_DIR, "skill-reference-integrity-report.json"), integrityReport);
  await writeJson(path.join(GENERATED_DIR, "skills-engine.rome.json"), rootSkillLayer.skillsEngine);
  await writeJson(path.join(GENERATED_DIR, "skill-reference-integrity-report.json"), rootSkillLayer.integrityReport);
  await writeJson(path.join(LOCAL_DIR, "skill-taxonomy.user.json"), taxonomy);
  await writeJson(path.join(LOCAL_DIR, "skill-concept-mappings.rome.json"), conceptMappings);
  await writeJson(path.join(LOCAL_DIR, "essential-rome-codes.json"), buildEssentialCodesFile());
  await writeJson(path.join(LOCAL_DIR, "rome-codes-500-v2.proposed.json"), proposedCodes);
  await writeJson(path.join(GENERATED_DIR, "rome500-essential-gap-report.json"), essentialGapReport);
  await writeJson(path.join(GENERATED_DIR, "exploration-facet-audit.rome500.json"), explorationAudit);
  await writeJson(path.join(GENERATED_DIR, "results-pathway-audit.rome500.json"), pathwayAudit);
  await writeFile(path.join(ROOT, "CODEX_V0_7_0_IMPLEMENTATION_REPORT.md"), implementationReport, "utf8");

  console.log(`[Boussole Pro] v0.7.0 local: ${integrityReport.resolvedIdsCount}/${integrityReport.referencedIdsCount} compétences résolues, statut ${integrityReport.status}.`);
  console.log(`[Boussole Pro] ROME 72 racine: ${rootSkillLayer.integrityReport.resolvedIdsCount}/${rootSkillLayer.integrityReport.referencedIdsCount} compétences résolues, statut ${rootSkillLayer.integrityReport.status}.`);
  console.log(`[Boussole Pro] Appellations indexables: ${jobAppellations.length}. Codes essentiels absents: ${essentialGapReport.missingEssentialCodes.map(item => item.romeCode).join(", ") || "aucun"}.`);
}

export function buildSkillsEngine({ jobs, mappings, rawSkills, filteredSkills }, datasetVersion = "rome-generated-v0.7") {
  const referencedIds = unique([
    ...jobs.flatMap(job => [...arr(job.mobilizedSkillIds), ...arr(job.matchableSkillIds), ...arr(job.softSkillIds)]),
    ...mappings.flatMap(mapping => arr(mapping.skillIds))
  ]);
  const rawIndex = new Map();
  [...rawSkills, ...filteredSkills].forEach(row => {
    const ids = unique([row.id, row.officialId && `skill-rome-${row.officialId}`, row.rawId && `skill-rome-${row.rawId}`, row.rawKeyOrId && `skill-rome-${row.rawKeyOrId}`, ...arr(row.aliases)]);
    ids.forEach(id => rawIndex.set(id, row));
  });
  const unresolvedIds = [];
  const skillsEngine = referencedIds.map(id => {
    const row = rawIndex.get(id);
    if (!row?.label) unresolvedIds.push(id);
    return normalizeEngineSkill(id, row);
  }).sort((a, b) => a.label.localeCompare(b.label, "fr") || a.id.localeCompare(b.id));
  const engineIds = new Set(skillsEngine.map(row => row.id));
  const jobsWithUnresolvedSkillIds = jobs
    .map(job => {
      const ids = unique([...arr(job.mobilizedSkillIds), ...arr(job.matchableSkillIds), ...arr(job.softSkillIds)]);
      const missingIds = ids.filter(id => !engineIds.has(id));
      return missingIds.length ? { jobId: job.id, romeCode: job.romeCode, title: job.title, unresolvedIds: missingIds } : null;
    })
    .filter(Boolean);
  return {
    skillsEngine,
    integrityReport: {
      schemaVersion: "1.0.0",
      reportKind: "skill_reference_integrity",
      generatedAt: new Date().toISOString(),
      datasetVersion,
      referencedIdsCount: referencedIds.length,
      resolvedIdsCount: referencedIds.length - unresolvedIds.length,
      unresolvedIdsCount: unresolvedIds.length,
      unresolvedIds,
      jobsWithUnresolvedSkillIds,
      jobsWithUnresolvedSkillIdsCount: jobsWithUnresolvedSkillIds.length,
      fieldsChecked: ["jobs.mobilizedSkillIds", "jobs.matchableSkillIds", "jobs.softSkillIds", "mappings.skillIds"],
      status: unresolvedIds.length ? "blocking_unresolved_skill_references" : "ok",
      promotionBlocked: unresolvedIds.length > 0
    }
  };
}

function normalizeEngineSkill(id, row = null) {
  const label = row?.label || "Compétence officielle non chargée";
  return {
    id,
    officialId: row?.officialId || row?.rawId || id.replace(/^skill-rome-/, ""),
    label,
    normalizedLabel: row?.normalizedLabel || normalizeText(label),
    rawType: row?.rawType || row?.type || "unknown",
    type: row?.type || row?.rawType || "unknown",
    classification: row?.classification || "unknown",
    aliases: unique([id, ...arr(row?.aliases)]),
    source: row?.source || "missing_local_reference",
    provenance: row?.provenance || "generated_rome",
    confidence: row?.confidence ?? 0.75
  };
}

function buildSkillTaxonomy() {
  const facets = FACETS.map(([id, parentConceptId, label, questionLabel, relatedIssueLabels]) => ({
    id,
    parentConceptId,
    label,
    questionLabel,
    relatedIssueLabels,
    officialSkillIds: [],
    confidence: 0.62,
    mappingSource: "local_taxonomy_v0_7_0"
  }));
  const facetsByParent = new Map();
  facets.forEach(facet => {
    facetsByParent.set(facet.parentConceptId, [...(facetsByParent.get(facet.parentConceptId) || []), facet.id]);
  });
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - taxonomie utilisateur des compétences",
    version: "v0.7.0-alpha",
    generatedAt: new Date().toISOString(),
    concepts: USER_CONCEPTS.map(([id, label, shortDescription, iconKey, relatedSectorIds]) => ({
      id,
      label,
      shortDescription,
      iconKey,
      childFacetIds: facetsByParent.get(id) || [],
      relatedSectorIds
    })),
    facets
  };
}

function buildConceptMappings(taxonomy, skillsEngine) {
  const byText = skillsEngine.map(skill => ({ skill, text: normalizeText(`${skill.label} ${skill.classification} ${skill.rawType}`) }));
  const facets = taxonomy.facets.map(facet => {
    const tokens = unique([
      ...normalizeText(`${facet.label} ${facet.questionLabel} ${facet.relatedIssueLabels.join(" ")}`).split(/\s+/).filter(token => token.length > 4),
      facet.parentConceptId.split("_").join(" ")
    ]);
    const officialSkillIds = byText
      .filter(row => tokens.some(token => row.text.includes(token)))
      .slice(0, 30)
      .map(row => row.skill.id);
    return {
      facetId: facet.id,
      parentConceptId: facet.parentConceptId,
      officialSkillIds,
      relatedIssueLabels: facet.relatedIssueLabels,
      confidence: officialSkillIds.length ? 0.56 : 0.35,
      mappingSource: "local_textual_bridge_v0_7_0"
    };
  });
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - liaisons concepts utilisateur vers ROME",
    version: "v0.7.0-alpha",
    generatedAt: new Date().toISOString(),
    mappings: facets
  };
}

function buildEssentialCodesFile() {
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - codes ROME essentiels",
    version: "v0.7.0-alpha",
    generatedAt: new Date().toISOString(),
    codes: ESSENTIAL_CODES.map(([romeCode, label]) => ({ romeCode, label, priority: "essential", source: "local_audit_2026_07_16" }))
  };
}

function buildEssentialGapReport(jobs) {
  const present = new Set(jobs.map(job => job.romeCode).filter(Boolean));
  const rows = ESSENTIAL_CODES.map(([romeCode, label]) => ({
    romeCode,
    label,
    presentInRome500: present.has(romeCode),
    currentJob: jobs.find(job => job.romeCode === romeCode)?.title || null
  }));
  return {
    schemaVersion: "1.0.0",
    reportKind: "rome500_essential_gap",
    generatedAt: new Date().toISOString(),
    datasetVersion: "rome500-candidate-v0.7",
    checkedCodesCount: rows.length,
    presentEssentialCodes: rows.filter(row => row.presentInRome500),
    missingEssentialCodes: rows.filter(row => !row.presentInRome500),
    confirmations: {
      K1207Present: present.has("K1207"),
      K1601Present: present.has("K1601")
    },
    status: rows.some(row => !row.presentInRome500) ? "completed_with_gaps" : "ok"
  };
}

function buildRome500V2Proposal(jobs, gapReport) {
  const currentCodes = unique(jobs.map(job => job.romeCode).filter(Boolean));
  const mustAdd = gapReport.missingEssentialCodes.map(row => row.romeCode);
  const familyCounts = countBy(jobs.map(job => job.family || "unknown"));
  const overrepresentedFamilies = Object.entries(familyCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([family]) => family);
  const protectedCodes = new Set([...ESSENTIAL_CODES.map(([code]) => code), "G1202", "K1303", "K2106", "J1304"]);
  const proposedRemove = jobs
    .filter(job => overrepresentedFamilies.includes(job.family || "unknown") && !protectedCodes.has(job.romeCode))
    .slice(0, mustAdd.length)
    .map((job, index) => ({
      romeCode: job.romeCode,
      title: job.title,
      family: job.family,
      replacementFor: mustAdd[index] || null,
      justification: "Proposition technique pour rester autour de 500 codes ; à valider humainement avant tout run."
    }));
  return {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - proposition ROME 500 v2",
    version: "v0.7.0-alpha",
    generatedAt: new Date().toISOString(),
    currentCodes,
    proposedAdditions: gapReport.missingEssentialCodes.map(row => ({
      romeCode: row.romeCode,
      label: row.label,
      justification: "Métier essentiel identifié par audit utilisateur."
    })),
    proposedRemovals: proposedRemove,
    proposedCodes: unique([...currentCodes.filter(code => !proposedRemove.some(row => row.romeCode === code)), ...mustAdd]).slice(0, 500),
    warning: "Ne pas appliquer automatiquement : vérifier les retraits proposés avant une nouvelle synchronisation."
  };
}

function buildExplorationFacetAudit(jobs) {
  const domainRows = [...new Set(jobs.map(job => job.domain).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"))
    .map(domain => facetRow(domain, domain, jobs.filter(job => job.domain === domain).length, jobs.length, 0));
  const diplomaOptions = [
    ["quick", "Accès rapide / formation courte"],
    ["0_3", "Sans diplôme à CAP/BEP"],
    ["4", "Bac"],
    ["5_plus", "Bac +2 et plus"],
    ["unknown", "Niveau non renseigné"]
  ].map(([value, label]) => {
    const known = jobs.filter(job => knownDiplomaLevel(job) !== null);
    const count = jobs.filter(job => diplomaMatches(job, value)).length;
    return facetRow(value, label, count, known.length, jobs.length - known.length);
  });
  const constraints = [
    ["low_physical", "Physique faible confirmé", job => job.physicalConstraints?.level === "low", job => job.physicalConstraints?.level && job.physicalConstraints.level !== "unknown"],
    ["no_night", "Sans nuit confirmé", job => ["none", "unlikely", "no", "never"].includes(job.scheduleConstraints?.nightWork), job => job.scheduleConstraints?.nightWork && job.scheduleConstraints.nightWork !== "unknown"],
    ["no_weekend", "Sans week-end confirmé", job => ["none", "unlikely", "no", "never"].includes(job.scheduleConstraints?.weekendWork), job => job.scheduleConstraints?.weekendWork && job.scheduleConstraints.weekendWork !== "unknown"],
    ["no_driver_license", "Sans permis obligatoire confirmé", job => job.mobilityConstraints?.driverLicenseRequired === false && job.mobilityConstraints?.source !== "unknown", job => job.mobilityConstraints?.source !== "unknown"],
    ["remote", "Télétravail possible", job => ["high", "partial"].includes(job.remoteCompatibility), job => job.remoteCompatibility && job.remoteCompatibility !== "unknown"]
  ].map(([value, label, matches, known]) => facetRow(value, label, jobs.filter(matches).length, jobs.filter(known).length, jobs.filter(job => !known(job)).length));
  const contextCounts = new Map();
  jobs.forEach(job => arr(job.workContexts).forEach(id => contextCounts.set(id, (contextCounts.get(id) || 0) + 1)));
  const contexts = [...contextCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => facetRow(value, value, count, count, jobs.length - count));
  const market = [
    ["available", "Données disponibles", job => Boolean(job.marketStats?.national || job.marketStats?.regional || job.marketStats?.departmental)],
    ["aude", "Données Aude", job => Boolean(job.marketStats?.departmental)],
    ["occitanie", "Données Occitanie", job => Boolean(job.marketStats?.regional)],
    ["national", "Données France", job => Boolean(job.marketStats?.national)]
  ].map(([value, label, matches]) => facetRow(value, label, jobs.filter(matches).length, jobs.filter(matches).length, jobs.length - jobs.filter(matches).length));
  return {
    schemaVersion: "1.0.0",
    reportKind: "exploration_facet_audit_rome500",
    generatedAt: new Date().toISOString(),
    datasetVersion: "rome500-candidate-v0.7",
    jobsCount: jobs.length,
    domains: domainRows,
    diplomas: diplomaOptions,
    constraints,
    contexts,
    market,
    territories: ["FR", "REG-76", "DEP-11"].map(value => facetRow(value, value, jobs.length, jobs.length, 0)),
    status: "ok_with_unknowns_tracked"
  };
}

function buildResultsPathwayAudit(jobs, jobAppellations) {
  const rows = jobs.map(job => ({ jobId: job.id, romeCode: job.romeCode, title: job.title, careerPathwayId: inferCareerPathway(job), family: job.family }));
  return {
    schemaVersion: "1.0.0",
    reportKind: "results_pathway_audit_rome500",
    generatedAt: new Date().toISOString(),
    datasetVersion: "rome500-candidate-v0.7",
    jobsCount: jobs.length,
    pathways: countBy(rows.map(row => row.careerPathwayId)),
    examples: rows.slice(0, 80),
    appellationsIndexableCount: jobAppellations.length,
    status: "prepared"
  };
}

function inferCareerPathway(job) {
  const text = normalizeText(`${job.title} ${job.domain} ${job.family} ${arr(job.appellations).join(" ")}`);
  if (/animation|animateur|atelier|loisir|jeu|lud/.test(text)) return "animation_ateliers";
  if (/petite enfance|garde d'enfant|assistant maternel|creche/.test(text)) return "petite_enfance";
  if (/professeur|enseign|formateur|formation/.test(text)) return "enseignement_formation";
  if (/educateur|social|insertion|accompagn/.test(text)) return "intervention_socioeducative";
  if (/culture|document|bibli|mediat|ludothe/.test(text)) return "mediation_culture_jeu";
  if (/coord|projet|responsable|chef/.test(text)) return "coordination_projets";
  if (/informatique|web|data|logiciel|numerique/.test(text)) return "numerique_creatif";
  if (/nature|environnement|jardin|agric|animal|foret/.test(text)) return "nature_sensibilisation";
  if (/hotel|reception|restauration|serveur|etage/.test(text)) return "hotellerie_service";
  if (/nettoyage|proprete|entretien/.test(text)) return "proprete_entretien";
  return "autre_voie";
}

function facetRow(value, label, resultCount, knownDataCount, unknownDataCount) {
  return {
    value,
    label,
    resultCount,
    knownDataCount,
    unknownDataCount,
    availabilityStatus: resultCount === 0 ? "empty" : knownDataCount === 0 ? "data_unavailable" : "available"
  };
}

function knownDiplomaLevel(job) {
  const value = job.requiredDiplomaLevel ?? job.recommendedDiplomaLevel;
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function diplomaMatches(job, filter) {
  const level = knownDiplomaLevel(job);
  if (filter === "unknown") return level === null;
  if (level === null) return false;
  if (filter === "quick") return level <= 4 && !arr(job.requiredCertifications).length;
  if (filter === "0_3") return level <= 3;
  if (filter === "4") return level === 4;
  if (filter === "5_plus") return level >= 5;
  return true;
}

function buildImplementationReport({ integrityReport, explorationAudit, pathwayAudit, essentialGapReport }) {
  return `# Boussole Pro v0.7.0 — Rapport d’implémentation Codex

Date : ${new Date().toISOString()}

## Réalisé

- Génération locale du référentiel fermé \`skills-engine.rome.json\`.
- Rapport d’intégrité des compétences : ${integrityReport.resolvedIdsCount}/${integrityReport.referencedIdsCount} IDs résolus.
- Taxonomie utilisateur initiale à 18 concepts et ${FACETS.length} facettes.
- Préparation des codes essentiels ROME 500 v2.
- Audit dynamique des filtres Exploration.
- Audit des voies professionnelles pour les résultats.
- Préparation des workflows \`sync-rome-data\` et \`merge-rome500-batches\` pour reconstruire ces index après génération.

## Statut

- Intégrité compétences : ${integrityReport.status}.
- Filtres Exploration : ${explorationAudit.status}.
- Voies résultats : ${pathwayAudit.status}.
- Codes essentiels absents : ${essentialGapReport.missingEssentialCodes.map(row => row.romeCode).join(", ") || "aucun"}.

## Tests locaux à relancer

- \`node scripts/prepare-v070-local.mjs\`
- Vérifier que la recherche “ludothécaire” retrouve K1601 dans Exploration.
- Charger ROME 500 expérimental dans l’application puis ouvrir Résultats en modes Essentiel, Détaillé et Diagnostic.

## Reste à faire

- Valider humainement les retraits proposés pour ROME 500 v2.
- Brancher plus finement les facettes utilisateur sur les macro-compétences ROME.
- Ajouter une vraie prévisualisation d’import externe avant confirmation utilisateur.

## Actions GitHub

Aucune action GitHub n’a été lancée par Codex. Relancer Sync ROME uniquement après validation de \`rome-codes-500-v2.proposed.json\`.
`;
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

function arr(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function unique(values) {
  return [...new Set(arr(values).filter(Boolean))];
}

function countBy(values) {
  return arr(values).reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
