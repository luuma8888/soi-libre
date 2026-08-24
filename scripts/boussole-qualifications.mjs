const TYPES = new Set(["diplome_reglemente", "titre", "certification", "habilitation", "brevet", "carte_professionnelle", "agrement"]);
const RUNTIME_FIELDS = ["id", "label", "shortLabel", "type", "searchTerms", "selectableInProfile"];

const RULES = [
  ["cert-bafa", /\bbafa\b/], ["cert-bafd", /\bbafd\b/], ["cert-psc1", /\bpsc ?1\b/], ["cert-sst", /sauveteur secouriste du travail|\bsst\b/],
  ["cert-bnssa", /\bbnssa\b/], ["cert-afgsu-2", /afgsu.*niveau 2/], ["cert-amf", /certification amf|autorite des marches financiers/],
  ["cert-haccp", /\bhaccp\b/], ["cert-adr", /formation adr/], ["cert-cfs", /certificat de formation a la securite|\bcfs\b/],
  ["cert-caces-r484-1", /caces r ?484.*categorie 1/], ["cert-caces-grues", /caces.*grues/], ["cert-caces-engins-chantier", /caces.*engins de chantier/],
  ["cert-caces-nacelles", /caces.*nacelles/], ["cert-caces-chariots", /caces.*chariots|caces.*engins de manutention|conduite de chariots elevateurs/],
  ["habilitation-electrique-b0l-bcl-b2vl", /b0l.*bcl.*b2vl/], ["habilitation-aipr", /\baipr\b/], ["habilitation-fluides-frigorigenes", /fluides frigorigenes/],
  ["habilitation-echafaudages", /montage d echafaudages/], ["habilitation-drone", /pilotage de drone/], ["habilitation-hyperbarie", /aptitude a l hyperbarie/],
  ["habilitation-nucleaire", /risques? d origine nucleaire|habilitation nucleaire/], ["habilitation-armes", /usage des armes/],
  ["credential-cap-aepe", /cap accompagnant educatif petite enfance|cap aepe/], ["credential-deaes", /diplome d etat d accompagnant educatif et social|\bdeaes\b/],
  ["credential-deass", /diplome d etat d assistant de service social|\bdeass\b/], ["credential-deeje", /diplome d etat d educateur de jeunes enfants|\bdeeje\b/],
  ["credential-dees", /diplome d etat d educateur specialise|\bdees\b/], ["credential-deme", /diplome d etat de moniteur educateur|\bdeme\b/],
  ["credential-de-infirmier", /diplome d etat d infirmier/], ["credential-de-aide-soignant", /diplome d etat d aide soignant/], ["credential-de-ambulancier", /diplome d etat d ambulancier/],
  ["credential-de-orthoptiste", /certificat de capacite d orthoptiste|\borthoptiste\b/], ["credential-de-ergotherapeute", /diplome d etat d ergotherapeute/],
  ["credential-de-medecin", /diplome d etat (de )?docteur en medecine/], ["credential-de-pharmacien", /diplome d etat (de )?docteur en pharmacie/],
  ["credential-de-dentiste", /diplome d etat de docteur en chirurgie dentaire/], ["credential-de-sage-femme", /diplome d etat de sage femme/],
  ["credential-de-veterinaire", /diplome d etat de veterinaire/], ["credential-de-architecte", /diplome d etat d architecte/],
  ["credential-decesf", /conseiller en economie sociale familiale|\bdecesf\b/], ["credential-detisf", /technicien d intervention sociale et familiale|\btisf\b/],
  ["credential-bts-opticien", /bts opticien lunetier/], ["credential-cafdes", /\bcafdes\b/], ["credential-caferuis", /\bcaferuis\b/],
  ["credential-conseiller-funeraire", /certification de conseiller funeraire/], ["credential-controleur-aerien", /certification (specifique )?de controleur aerien/],
  ["credential-agent-escale", /certificat d agent d escale commercial/], ["credential-cqp-operateur-pah", /cqp.*operateur parcours acrobatique/],
  ["credential-cqp-agent-surete-portuaire", /cqp.*agent de surete portuaire/], ["credential-cqp-plongeur-professionnel", /cqp.*plongeur professionnel/],
  ["credential-carte-cnaps-cynophile", /carte professionnelle.*cnaps.*chien/], ["credential-carte-cnaps-surveillance", /carte professionnelle.*cnaps/],
  ["credential-carte-immobilier-transaction", /carte professionnelle.*transaction sur immeubles/], ["credential-agrement-dreets", /agrement.*dreets|direction regionale de l economie.*emploi.*travail/],
  ["credential-agrement-acpr", /agrement.*acpr|autorite de controle prudentiel/], ["credential-agrement-departemental", /agrement.*conseil departemental/],
  ["credential-agrement-prefectoral", /agrement.*prefecture|agrement.*prefectoral/], ["habilitation-electrique-generic", /habilitation.*electrique|risques? d origine electrique/],
  ["credential-capacite-animaux-non-domestiques", /certificat de capacite pour l elevage d animaux non domestiques/],
  ["credential-capacite-intermediaire-assurance-orias", /capacite professionnelle des intermediaires en assurance/], ["credential-controleur-securite-sociale", /controleur de la securite sociale/],
  ["habilitation-gaz-pgn", /habilitation gaz pgn/], ["habilitation-soudure-gaz", /habilitation soudure gaz/], ["credential-de-cadre-sante", /diplome d etat de cadre de sante/],
  ["credential-mandataire-protection-majeurs", /certificat national de competence de mandataire judiciaire/], ["credential-enseignement-musique", /certificat d aptitude a l enseignement de la musique/],
  ["credential-gestion-operations-aeroportuaires", /diplome d etat en gestion des operations aeroportuaires/], ["credential-gestion-securite-portuaire", /certification de gestion de la securite portuaire/],
  ["credential-securite-ferroviaire", /certificat de securite ferroviaire/], ["credential-matelot-pont", /certificat de matelot pont/], ["credential-cqp-conducteur-equipements-industriels", /cqp conducteur d equipements industriels|cqpi conducteur d equipements industriels/],
  ["credential-de-notaire", /diplome d etat de notaire/], ["credential-aptitude-gendarmerie", /certificat d aptitude professionnelle de la gendarmerie/], ["credential-de-professeur-theatre", /diplome d etat de professeur de theatre/],
  ["credential-diplome-comptabilite", /diplome d etat de comptabilite|diplome de comptabilite et de gestion|\bdcg\b/], ["credential-gestion-hospitaliere", /diplome d etat en gestion hospitaliere/],
  ["credential-arboriste-elagueur", /certificat de specialisation d arboriste elagueur/], ["credential-psychologue-clinicien", /diplome d etat de psychologue clinicien/],
  ["credential-conseiller-insertion-probation", /conseiller d insertion et de probation/], ["credential-de-puericultrice", /diplome d etat de puericulture/], ["credential-desjeps", /\bdesjeps\b/],
  ["credential-de-educateur-sportif", /diplome d etat d educateur sportif/], ["cert-caces-r318", /caces r ?318/], ["cert-cfbs", /\bcfbs\b|certificat de base a la securite/],
  ["cert-cqali", /\bcqali\b|certificat de qualification avancee a la lutte incendie/], ["cert-cfmh", /\bcfmh\b|certificat de formation maritime hoteliere/],
  ["credential-capacite-prelevements-sanguins", /certificat de capacite de prelevements sanguins/],
  ["cert-caces-generic", /\bcaces\b|certificat.*aptitude a la conduite en securite/]
];

const LICENSE_RULES = [
  ["license-c1e", /\bpermis (?:de conduire )?(?:ce ou )?c1e\b/], ["license-ce", /\bpermis (?:de conduire )?ce\b/],
  ["license-c1", /\bpermis (?:de conduire )?(?:c ou )?c1\b/], ["license-c", /\bpermis (?:de conduire )?c\b|permis poids lourd/],
  ["license-d", /\bpermis (?:de conduire )?d\b/], ["license-b", /\bpermis (?:de conduire )?(?:categorie )?b\b/]
];

export function projectQualificationAccess(jobs = [], sourceCatalog = {}) {
  const catalog = (sourceCatalog.qualifications || []).map(row => Object.fromEntries(RUNTIME_FIELDS.map(key => [key, row[key]])));
  const ids = catalog.map(row => row.id);
  const labels = catalog.map(row => normalize(row.label));
  const duplicateIds = duplicates(ids);
  const duplicateLabels = duplicates(labels);
  const invalidCatalogRows = catalog.filter(row => !row.id || !row.label || !TYPES.has(row.type) || !Array.isArray(row.searchTerms) || typeof row.selectableInProfile !== "boolean").map(row => row.id || "missing-id");
  const knownIds = new Set(ids);
  const used = new Set();
  const stats = { requiredLinks: 0, optionalLinks: 0, requiredLicenseLinks: 0, optionalLicenseLinks: 0 };
  const unmappedRequiredPhrases = [];
  const unmappedOptionalPhrases = [];
  const ambiguousMappings = [];
  const byJobId = new Map();
  for (const job of jobs) {
    const summary = job.accessSummary || {};
    const projectedSummary = projectRows(job, summary.requiredCredentialLabels, summary.optionalCredentialLabels);
    const accessPaths = (job.accessPaths || summary.accessPaths || []).map(path => ({
      pathId: path.id || path.pathId,
      ...projectRows(job, path.requiredCredentialLabels, [])
    }));
    byJobId.set(job.id, { summary: projectedSummary, accessPaths });
  }
  const orphanQualificationIds = [...used].filter(id => !knownIds.has(id));
  const report = {
    qualificationCatalogCount: catalog.length,
    selectableQualificationCount: catalog.filter(row => row.selectableInProfile).length,
    ...stats,
    unmappedRequiredPhrases,
    unmappedOptionalPhrases,
    ambiguousMappings,
    orphanQualificationIds,
    unusedCatalogIds: ids.filter(id => !used.has(id)),
    duplicateIds,
    duplicateLabels,
    invalidCatalogRows
  };
  report.blockingFailures = [
    ...duplicateIds.map(id => `duplicate-id:${id}`),
    ...duplicateLabels.map(label => `duplicate-label:${label}`),
    ...orphanQualificationIds.map(id => `orphan:${id}`),
    ...invalidCatalogRows.map(id => `invalid:${id}`)
  ];
  return { catalog, byJobId, report };

  function projectRows(job, requiredRows = [], optionalRows = []) {
    const requiredQualificationIds = [];
    const optionalQualificationIds = [];
    const requiredLicenseIds = [];
    const optionalLicenseIds = [];
    for (const [kind, rows] of [["required", requiredRows || []], ["optional", optionalRows || []]]) {
      for (const phrase of rows) {
        const mapped = mapPhrase(phrase);
        if (mapped.ambiguous) {
          ambiguousMappings.push({ romeCode: job.romeCode, phrase, reason: mapped.reason, candidates: mapped.ids });
          continue;
        }
        if (!mapped.ids.length && !mapped.licenseIds.length) {
          (kind === "required" ? unmappedRequiredPhrases : unmappedOptionalPhrases).push({ romeCode: job.romeCode, phrase });
          continue;
        }
        const effectiveKind = kind === "required" && /peut|peuvent|parfois|selon le poste|non obligatoire|atout|apprecie|souhait|utile/i.test(normalize(phrase)) ? "optional" : kind;
        const qTarget = effectiveKind === "required" ? requiredQualificationIds : optionalQualificationIds;
        const lTarget = effectiveKind === "required" ? requiredLicenseIds : optionalLicenseIds;
        mapped.ids.forEach(id => { qTarget.push(id); used.add(id); });
        mapped.licenseIds.forEach(id => lTarget.push(id));
      }
    }
    const result = {
      requiredQualificationIds: unique(requiredQualificationIds), optionalQualificationIds: unique(optionalQualificationIds),
      requiredLicenseIds: unique(requiredLicenseIds), optionalLicenseIds: unique(optionalLicenseIds)
    };
    stats.requiredLinks += result.requiredQualificationIds.length; stats.optionalLinks += result.optionalQualificationIds.length;
    stats.requiredLicenseLinks += result.requiredLicenseIds.length; stats.optionalLicenseLinks += result.optionalLicenseIds.length;
    return result;
  }
}

function mapPhrase(value) {
  const text = normalize(value);
  if (!text || /^certification(s)? (specifique|professionnelle|dans le domaine|en gestion)|^diplome d etat$|^autorisation/i.test(text)) return { ids: [], licenseIds: [], ambiguous: false };
  if (/permis de conduire( souvent| est| pour|$)|permis poids lourds?\)?$/.test(text) && !/\bpermis (b|c|c1|ce|c1e|d)\b/.test(text)) return { ids: [], licenseIds: [], ambiguous: true, reason: "catégorie de permis non déterminée" };
  const ids = unique(RULES.filter(([, pattern]) => pattern.test(text)).map(([id]) => id));
  const licenseIds = unique(LICENSE_RULES.filter(([, pattern]) => pattern.test(text)).map(([id]) => id));
  const specificCaces = ids.filter(id => id.startsWith("cert-caces-") && id !== "cert-caces-generic");
  const cleanedIds = specificCaces.length ? ids.filter(id => id !== "cert-caces-generic") : ids;
  const specificElectrical = cleanedIds.includes("habilitation-electrique-b0l-bcl-b2vl");
  const finalIds = specificElectrical ? cleanedIds.filter(id => id !== "habilitation-electrique-generic") : cleanedIds;
  const alternatives = /\bou\b/.test(text) && finalIds.length + licenseIds.length > 0;
  const conditional = /peu\(ven\)t|peut etre exige|peuvent etre requis|selon le poste/.test(text);
  return { ids: alternatives || conditional ? [] : finalIds, licenseIds: alternatives || conditional ? [] : licenseIds, ambiguous: alternatives || conditional, reason: alternatives ? "alternatives non représentables sans faux obligatoire" : conditional ? "exigence conditionnelle" : null };
}

function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, " ").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function duplicates(values) { const seen = new Set(); const duplicate = new Set(); values.forEach(value => seen.has(value) ? duplicate.add(value) : seen.add(value)); return [...duplicate]; }
