export const SEMANTIC_CONTRACT_REVISION = "boussole-semantic-v1";

export const CAREER_DIRECTIONS = Object.freeze([
  ["grandir_transmettre", "Grandir et transmettre", "Enfance, école, éducation et formation"],
  ["accompagner_relier", "Accompagner et relier", "Social, inclusion, médiation et insertion"],
  ["soigner_soutenir", "Soigner et soutenir", "Santé, soin, rééducation et bien-être"],
  ["creer_exprimer", "Créer et exprimer", "Arts, culture, médias et communication"],
  ["animer_faire_vivre", "Animer et faire vivre", "Animation, sport, loisirs, tourisme et événementiel"],
  ["cultiver_proteger_vivant", "Cultiver et protéger le vivant", "Agriculture, nature, animaux et environnement"],
  ["comprendre_concevoir", "Comprendre et concevoir", "Sciences, recherche, études et ingénierie"],
  ["construire_numerique", "Construire le numérique", "Informatique, données, réseaux et systèmes"],
  ["faconner_fabriquer", "Façonner et fabriquer", "Artisanat, métiers d'art et fabrication matérielle"],
  ["produire_maintenir", "Produire et maintenir", "Industrie, énergie, équipements et maintenance"],
  ["batir_prendre_soin_lieux", "Bâtir et prendre soin des lieux", "Bâtiment, architecture, aménagement et propreté"],
  ["administrer_garantir_droits", "Administrer et garantir les droits", "Administration, dossiers, droit et service public"],
  ["gerer_piloter", "Gérer et piloter", "Finance, assurance, ressources humaines et direction"],
  ["accueillir_conseiller_vendre", "Accueillir, conseiller et vendre", "Commerce, accueil, relation client et services"],
  ["nourrir_recevoir", "Nourrir et recevoir", "Alimentation, restauration et hôtellerie"],
  ["transporter_organiser_flux", "Transporter et organiser les flux", "Transport, mobilité et logistique"],
  ["proteger_secourir", "Protéger et secourir", "Sécurité, prévention, secours et défense"]
].map(([id, label, description]) => Object.freeze({ id, label, description })));

const DOMAIN_DIRECTION_GROUPS = Object.freeze({
  cultiver_proteger_vivant: ["A11", "A12", "A13", "A14", "A15", "K23"],
  creer_exprimer: ["B11", "E11", "E12", "E14", "K16", "L11", "L12", "L13", "L15"],
  faconner_fabriquer: ["B12", "B13", "B14", "B15", "B16", "B17", "B18"],
  gerer_piloter: ["C11", "C12", "C13", "C14", "C15", "G14", "K14", "M11", "M12", "M13", "M15", "M17"],
  nourrir_recevoir: ["D11", "G15", "G16", "G17", "G18"],
  accueillir_conseiller_vendre: ["D12", "D13", "D14", "D15", "G13"],
  produire_maintenir: ["E13", "H11", "H14", "H15", "H21", "H22", "H23", "H24", "H25", "H26", "H27", "H28", "H29", "H31", "H32", "H33", "H34", "I11", "I12", "I13", "I14", "I15", "I16"],
  batir_prendre_soin_lieux: ["F11", "F12", "F13", "F14", "F15", "F16", "F17", "K22"],
  animer_faire_vivre: ["G11", "G12", "L14"],
  comprendre_concevoir: ["H12", "K24", "M14"],
  proteger_secourir: ["H13", "K17", "K25"],
  soigner_soutenir: ["J11", "J12", "J13", "J14", "J15", "K11"],
  accompagner_relier: ["K12", "K13", "K18", "K26"],
  administrer_garantir_droits: ["K15", "K19", "M16"],
  grandir_transmettre: ["K21"],
  construire_numerique: ["M18"],
  transporter_organiser_flux: ["N11", "N12", "N13", "N21", "N22", "N31", "N32", "N41", "N42", "N43", "N44"]
});

export const PROFESSIONAL_DOMAIN_DIRECTIONS = Object.freeze(Object.fromEntries(
  Object.entries(DOMAIN_DIRECTION_GROUPS).flatMap(([directionId, codes]) => codes.map(code => [code, directionId]))
));

export const CAREER_DIRECTION_OVERRIDES = Object.freeze({
  K1303: "grandir_transmettre", K1307: "grandir_transmettre", K1308: "grandir_transmettre",
  K1309: "grandir_transmettre", K1310: "grandir_transmettre", K1313: "grandir_transmettre",
  K1314: "grandir_transmettre", K1807: "batir_prendre_soin_lieux", K1808: "creer_exprimer",
  K1811: "batir_prendre_soin_lieux", K1813: "cultiver_proteger_vivant", K1815: "batir_prendre_soin_lieux",
  K2125: "comprendre_concevoir", K2133: "comprendre_concevoir", K2134: "comprendre_concevoir",
  K2135: "comprendre_concevoir", K2140: "comprendre_concevoir", K2143: "comprendre_concevoir",
  M1808: "comprendre_concevoir", M1809: "comprendre_concevoir", M1888: "comprendre_concevoir",
  M1890: "comprendre_concevoir", M1891: "comprendre_concevoir", M1893: "comprendre_concevoir",
  M1895: "comprendre_concevoir"
});

export const SECONDARY_DIRECTIONS = Object.freeze({
  G1203: ["grandir_transmettre"],
  K1206: ["gerer_piloter"],
  M1609: ["soigner_soutenir"],
  M1808: ["construire_numerique"],
  D1102: ["faconner_fabriquer"]
});

export const ACCESS_OVERRIDES = Object.freeze({
  K1308: Object.freeze({
    requirementKind: "multiple_routes_with_mandatory_conditions",
    specificCredentialRequired: true,
    mandatoryQualification: true,
    regulated: true,
    contradictoryEvidence: false,
    requiredCredentialLabels: ["CAP Accompagnant éducatif petite enfance ou équivalent selon la voie"],
    requiredExams: ["Concours territorial d'ATSEM pour la voie publique habituelle"],
    competitionRequired: true,
    accessPaths: [
      { pathId: "atsem-public", label: "École publique - voie territoriale habituelle", requiredCredentialLabels: ["CAP Accompagnant éducatif petite enfance ou équivalent"], examRequired: true, examLabel: "Concours territorial d'ATSEM", mandatory: true },
      { pathId: "atsem-private", label: "École privée", requiredCredentialLabels: ["Diplôme ou condition de recrutement propre à l'établissement"], examRequired: false, mandatory: true }
    ],
    warnings: ["Les dérogations et voies particulières doivent être vérifiées auprès de l'autorité organisatrice."],
    source: "semantic_override_from_official_access_text_v084",
    confidence: 0.92
  })
});

export const DIRECTION_LABELS = Object.freeze(Object.fromEntries(CAREER_DIRECTIONS.map(item => [item.id, item.label])));

export function classifyCareerDirection(job = {}) {
  const romeCode = String(job.romeCode || job.code || "").trim().toUpperCase();
  const professionalDomainCode = romeCode.slice(0, 3);
  const override = CAREER_DIRECTION_OVERRIDES[romeCode];
  const primaryDirection = override || PROFESSIONAL_DOMAIN_DIRECTIONS[professionalDomainCode] || "unclassified";
  return {
    primaryDirection,
    primaryDirectionLabel: DIRECTION_LABELS[primaryDirection] || "Direction non classée",
    secondaryDirections: [...(SECONDARY_DIRECTIONS[romeCode] || [])],
    classificationSource: override ? "rome_code_override" : primaryDirection === "unclassified" ? "unclassified" : "rome_professional_domain",
    romeGrandDomainCode: romeCode.slice(0, 1) || null,
    romeProfessionalDomainCode: professionalDomainCode.length === 3 ? professionalDomainCode : null,
    familyPrefix: professionalDomainCode.length === 3 ? professionalDomainCode : job.familyPrefix || null
  };
}

export function personalFitLevel(score) {
  if (score >= 80) return "very_aligned";
  if (score >= 65) return "well_matched";
  if (score >= 45) return "worth_exploring";
  return "fragile_match";
}

export function calculateCanonicalPersonalFit({ aspirationScore = 50, valueScore = 7.5, contextScore = 5, constraintScore = 12.5 } = {}) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const score = clamp(aspirationScore, 0, 100) * 0.35
    + clamp(valueScore, 0, 15) / 15 * 20
    + clamp(contextScore, 0, 10) / 10 * 20
    + clamp(constraintScore, 0, 25) / 25 * 25;
  return Math.round(clamp(score, 0, 100));
}

export function buildSkillsReadiness(skill = {}, hasEnoughEvidence = true) {
  if (!hasEnoughEvidence) return { score: null, level: "insufficient_information", label: "Informations insuffisantes" };
  const score = Math.round(Math.min(100, Math.max(0, Number(skill.score || 0) / 25 * 100)));
  const level = score >= 80 ? "solid_support" : score >= 60 ? "several_supports" : score >= 35 ? "some_supports" : "few_identified_supports";
  const labels = { solid_support: "Appuis déjà solides", several_supports: "Plusieurs appuis", some_supports: "Quelques appuis", few_identified_supports: "Peu d'appuis identifiés" };
  return { score, level, label: labels[level] };
}

export function deriveAccessStatus(facts = {}) {
  const warnings = [...(facts.warnings || [])];
  if (facts.contradictoryEvidence) return { status: "unknown", label: "Accès à vérifier", warnings: [...warnings, "Données d'accès contradictoires."] };
  if (!facts.evidenceAvailable) return { status: "unknown", label: "Accès à vérifier", warnings: [...warnings, "Informations d'accès insuffisantes."] };
  if (facts.regulated && !facts.regulationResolved) return { status: "unknown", label: "Accès réglementé à vérifier", warnings: [...warnings, "Obligation réglementaire non résolue."] };
  if (facts.currentBlocker) return { status: "current_blocker", label: "Obstacle actuel identifié", warnings };
  if ((facts.competitionRequired && !facts.competitionSatisfied) || facts.missingMandatoryCredentials?.length) {
    return { status: "qualification_or_competition", label: "Qualification ou concours nécessaire", warnings };
  }
  const gap = Number.isFinite(facts.levelGap) ? facts.levelGap : null;
  if (gap === null) return facts.noDiplomaPossible
    ? { status: "direct_or_near_direct", label: "Accès direct ou proche", warnings }
    : { status: "unknown", label: "Accès à vérifier", warnings };
  if (gap >= 2) return { status: "long_path", label: "Parcours long", warnings };
  if (gap === 1) return { status: "one_step", label: "Une étape", warnings };
  return { status: "direct_or_near_direct", label: "Accès direct ou proche", warnings };
}
