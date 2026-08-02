export const MARKET_SCHEMA_REVISION = "market-contract-v2.0.0-phase1";
export const MARKET_INTERPRETATION_REVISION = "market-interpretation-v1";
export const MARKET_SCORE_POLICY_REVISION = "market-ranking-policy-v1";

export const MARKET_DIMENSIONS = Object.freeze([
  "offerVolume",
  "recruitmentProjects",
  "recruitmentDifficulty",
  "seasonality",
  "tension",
  "territorialPresence",
  "trend"
]);

export function migrateOfferVolumeRow(raw = {}) {
  const { observedOfferVolume, territorialPresence, semanticMigration, ...sourceRow } = raw;
  const offers12m = numberOrNull(raw.offers12m);
  const absoluteOfferSignal = normalizeOfferSignal(raw.absoluteOfferSignal, offers12m);
  const territorialOfferSignal = normalizeTerritorialSignal(raw.territorialOfferSignal, offers12m);
  const legacyConfusion = [raw.tensionLevel, raw.recruitmentSignal, raw.recruitmentDifficulty]
    .some(value => ["low", "medium", "high"].includes(value));
  const legacyFieldsPresent = ["tensionLevel", "recruitmentSignal", "recruitmentDifficulty"]
    .some(key => Object.prototype.hasOwnProperty.call(raw, key));
  return {
    ...sourceRow,
    schemaVersion: "2.0.0",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    marketDataKind: "offers_volume",
    marketInterpretationLabel: "Volume d'offres observe",
    tensionLevel: "unknown",
    recruitmentSignal: "unknown",
    recruitmentDifficulty: "unknown",
    absoluteOfferSignal,
    territorialOfferSignal,
    observedOfferVolumeStatus: offers12m === null ? "unknown" : offers12m === 0 ? "zero" : "available",
    observedOfferVolumeUnit: "offers_12_months",
    territorialPresenceStatus: territorialOfferSignal === "unknown" ? "unknown" : offers12m === 0 ? "zero" : "available",
    territorialPresenceMethod: "rank_within_same_territory_and_period_v1",
    semanticMigrationStatus: legacyFieldsPresent ? "legacy_offer_fields_cleared" : "already_unambiguous",
    semanticMigrationWarnings: legacyFieldsPresent ? ["legacy_tension_or_recruitment_fields_forced_to_unknown"] : [],
    semanticMigrationDetectedFalseSignal: legacyConfusion
  };
}

export function aggregateBmoRows(rows = [], metadata = {}) {
  const groups = new Map();
  for (const raw of rows) {
    const fapCode = String(raw.fapCode || "").trim();
    if (!fapCode) continue;
    const key = [raw.territoryId, fapCode].join("|");
    const group = groups.get(key) || {
      schemaVersion: "2.0.0",
      marketContractRevision: MARKET_SCHEMA_REVISION,
      sourceName: "france_travail_bmo",
      sourceVintage: String(metadata.sourceVintage || raw.year || ""),
      sourcePublishedAt: metadata.sourcePublishedAt || null,
      normalizedAt: metadata.normalizedAt || null,
      territoryId: raw.territoryId,
      territoryLabel: raw.territoryLabel,
      territoryLevel: raw.territoryLevel,
      fapCode,
      fapLabel: raw.fapLabel || null,
      recruitmentProjects: 0,
      difficultProjectsKnown: 0,
      seasonalProjectsKnown: 0,
      difficultSuppressedRows: 0,
      seasonalSuppressedRows: 0,
      sourceRows: 0
    };
    group.recruitmentProjects += numberOrNull(raw.recruitmentProjects) || 0;
    addBmoMeasure(group, raw.difficultProjects, "difficultProjectsKnown", "difficultSuppressedRows");
    addBmoMeasure(group, raw.seasonalProjects, "seasonalProjectsKnown", "seasonalSuppressedRows");
    group.sourceRows += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(finalizeBmoGroup).sort(compareTerritoryAndCode);
}

export function normalizeDaresTensionRow(raw = {}, metadata = {}) {
  const value = numberOrNull(raw.tensionIndex);
  const imputedValue = numberOrNull(raw.imputedTensionIndex);
  const discrete = integerOrNull(raw.tensionClass);
  const directAvailable = value !== null && discrete !== null;
  const imputedOnly = !directAvailable && imputedValue !== null;
  return {
    schemaVersion: "2.0.0",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    sourceName: "dares_france_travail_tension",
    sourceVintage: String(metadata.sourceVintage || raw.year || ""),
    sourcePublishedAt: metadata.sourcePublishedAt || null,
    normalizedAt: metadata.normalizedAt || null,
    territoryId: raw.territoryId,
    territoryLabel: raw.territoryLabel,
    territoryLevel: raw.territoryLevel,
    fapCode: raw.fapCode,
    fapLabel: raw.fapLabel,
    tension: marketDimension({
      status: directAvailable ? "available" : imputedOnly ? "imputed_not_ranking_eligible" : "unknown",
      value: directAvailable ? value : imputedValue,
      unit: "standardized_tension_index",
      level: directAvailable ? daresTensionLevel(discrete) : "unknown",
      sourceName: "dares_france_travail_tension",
      sourcePublishedAt: metadata.sourcePublishedAt || null,
      sourceVintage: String(metadata.sourceVintage || raw.year || ""),
      territoryId: raw.territoryId,
      territoryLabel: raw.territoryLabel,
      confidence: directAvailable ? 0.95 : imputedOnly ? 0.55 : 0,
      method: directAvailable ? "official_published_fap2021" : imputedOnly ? "official_imputed_insufficient_volume" : "not_available",
      mapping: { method: "unmapped", confidence: 0, rankingEligible: false },
      details: {
        publishedDiscreteClass: discrete,
        imputed: imputedOnly,
        sufficientVolume: Boolean(raw.sufficientVolume)
      }
    }),
    factors: normalizeDaresFactors(raw, directAvailable)
  };
}

export function buildMarketSynthesis(input = {}) {
  const dimensions = {
    offerVolume: normalizeDimension(input.offerVolume),
    recruitmentProjects: normalizeDimension(input.recruitmentProjects),
    recruitmentDifficulty: normalizeDimension(input.recruitmentDifficulty),
    seasonality: normalizeDimension(input.seasonality),
    tension: normalizeDimension(input.tension),
    territorialPresence: normalizeDimension(input.territorialPresence),
    trend: normalizeDimension(input.trend)
  };
  const interpretation = interpretMarketDimensions({
    ...dimensions,
    nationalOfferVolume: normalizeDimension(input.nationalOfferVolume),
    territoryLabel: input.territoryLabel || dimensions.offerVolume.territoryLabel || "le territoire selectionne"
  });
  const unknownDimensions = MARKET_DIMENSIONS.filter(key => !dimensionKnown(dimensions[key]));
  const sources = [...new Set(Object.values(dimensions).map(item => item.sourceName).filter(Boolean))];
  const mappingQuality = lowestMappingQuality(Object.values(dimensions));
  return {
    schemaVersion: "2.0.0",
    marketContractRevision: MARKET_SCHEMA_REVISION,
    dimensions,
    sourceCoverage: { present: MARKET_DIMENSIONS.length - unknownDimensions.length, total: MARKET_DIMENSIONS.length, sources },
    mappingQuality,
    freshness: worstFreshness(Object.values(dimensions)),
    interpretation,
    unknownDimensions,
    rankingEligible: Object.values(dimensions).some(item => item.mapping?.rankingEligible && dimensionKnown(item))
  };
}

export function interpretMarketDimensions(input = {}) {
  const tension = input.tension || {};
  const volume = input.offerVolume || {};
  const difficulty = input.recruitmentDifficulty || {};
  const seasonality = input.seasonality || {};
  const national = input.nationalOfferVolume || {};
  const territory = input.territoryLabel || "le territoire selectionne";
  if (isHigh(tension) && isLow(volume)) {
    return interpretation("high_tension_low_volume", "Les recrutements sont difficiles a satisfaire, mais ils restent peu nombreux dans le territoire selectionne.");
  }
  if (isHigh(volume) && isHigh(seasonality)) {
    return interpretation("high_volume_high_seasonality", "Les recrutements sont nombreux, mais une grande part est saisonniere.");
  }
  if (isHigh(difficulty)) {
    return interpretation("high_difficulty_unknown_causes", "Les employeurs declarent des difficultes de recrutement. Les donnees disponibles ne permettent pas d'en attribuer automatiquement la cause aux conditions de travail.");
  }
  if (isHigh(national) && (isLow(volume) || volume.status === "zero")) {
    return interpretation("active_national_low_local", `Le metier est bien present en France, mais peu represente dans ${territory} ; la mobilite elargirait les possibilites.`);
  }
  if (isHigh(volume) && ["moderate", "medium", "unknown", ""].includes(tension.level || "unknown")) {
    return interpretation("high_local_volume_no_high_tension", "Le volume local est important, sans preuve d'une tension forte.");
  }
  const known = [volume, input.recruitmentProjects || {}, difficulty, seasonality, tension, input.territorialPresence || {}].filter(dimensionKnown);
  if (known.length) {
    const present = [];
    if (dimensionKnown(volume)) present.push("le volume d'offres");
    if (dimensionKnown(input.recruitmentProjects || {})) present.push("les projets BMO");
    if (dimensionKnown(difficulty)) present.push("la difficulte BMO");
    if (dimensionKnown(seasonality)) present.push("la saisonnalite");
    if (dimensionKnown(tension)) present.push("la tension Dares");
    return interpretation("partial_data", `Donnees partielles : ${present.join(", ")} ${present.length > 1 ? "sont connus" : "est connu"} ; les autres dimensions ne sont pas disponibles.`);
  }
  return interpretation("no_robust_data", "Donnees marche insuffisantes pour ce metier et ce territoire.");
}

export function calculateMarketRankingInfluence(input = {}) {
  const requestedWeight = clamp(Number(input.requestedWeight || 0), 0, 100);
  const explicitGoal = ["quickEmployment", "localTension", "quick_employment", "local_tension", "secure_recruitment"].includes(input.goal);
  const reliable = Boolean(input.rankingEligible) && Number(input.reliability || 0) >= 0.5 && input.marketScore !== null && input.marketScore !== undefined;
  const effectiveWeight = reliable ? Math.min(requestedWeight, explicitGoal ? 15 : 8) : 0;
  const personalShare = input.feasibilityPriority ? 0.67 : 0.75;
  const baseScore = Number(input.personalFitScore || 0) * personalShare + Number(input.feasibilityScore || 0) * (1 - personalShare);
  const selectionScore = baseScore * (1 - effectiveWeight / 100) + Number(input.marketScore ?? 50) * (effectiveWeight / 100);
  return {
    policyRevision: MARKET_SCORE_POLICY_REVISION,
    requestedWeight,
    effectiveWeight,
    limited: effectiveWeight < requestedWeight,
    rankingEligible: reliable,
    scoreWithoutMarket: Math.round(clamp(baseScore, 0, 100)),
    selectionScore: Math.round(clamp(selectionScore, 0, 100)),
    effectPoints: Math.round(clamp(selectionScore, 0, 100)) - Math.round(clamp(baseScore, 0, 100)),
    reason: reliable ? (effectiveWeight ? "limited_explicit_market_context" : "zero_weight_requested") : "market_unknown_or_not_ranking_eligible"
  };
}

export function marketDimension(raw = {}) {
  return {
    status: raw.status || "unknown",
    value: raw.value ?? null,
    unit: raw.unit || null,
    level: raw.level || "unknown",
    sourceName: raw.sourceName || null,
    sourcePublishedAt: raw.sourcePublishedAt || null,
    sourceUpdatedAt: raw.sourceUpdatedAt || null,
    sourceVintage: raw.sourceVintage || null,
    territoryId: raw.territoryId || null,
    territoryLabel: raw.territoryLabel || null,
    confidence: clamp(Number(raw.confidence || 0), 0, 1),
    method: raw.method || "not_available",
    mapping: raw.mapping || { method: "not_required", confidence: 1, rankingEligible: true },
    freshness: raw.freshness || "unknown",
    details: raw.details || {}
  };
}

function finalizeBmoGroup(group) {
  const difficultyKnown = group.difficultSuppressedRows === 0;
  const seasonalityKnown = group.seasonalSuppressedRows === 0;
  return {
    ...group,
    recruitmentProjectsDimension: marketDimension({
      status: group.recruitmentProjects === 0 ? "zero" : "available",
      value: group.recruitmentProjects,
      unit: "recruitment_projects",
      level: "unclassified",
      sourceName: group.sourceName,
      sourcePublishedAt: group.sourcePublishedAt,
      sourceVintage: group.sourceVintage,
      territoryId: group.territoryId,
      territoryLabel: group.territoryLabel,
      confidence: 0.95,
      method: "official_bmo_aggregated_from_employment_basins",
      mapping: { method: "unmapped", confidence: 0, rankingEligible: false }
    }),
    recruitmentDifficulty: marketDimension({
      status: difficultyKnown ? "available" : "suppressed_partial",
      value: difficultyKnown ? rate(group.difficultProjectsKnown, group.recruitmentProjects) : null,
      unit: "percent_of_recruitment_projects",
      level: difficultyKnown ? rateLevel(rate(group.difficultProjectsKnown, group.recruitmentProjects)) : "unknown",
      sourceName: group.sourceName,
      sourcePublishedAt: group.sourcePublishedAt,
      sourceVintage: group.sourceVintage,
      territoryId: group.territoryId,
      territoryLabel: group.territoryLabel,
      confidence: difficultyKnown ? 0.95 : 0.4,
      method: difficultyKnown ? "official_bmo_ratio" : "suppressed_source_cells_not_treated_as_zero",
      mapping: { method: "unmapped", confidence: 0, rankingEligible: false },
      details: { knownProjects: group.difficultProjectsKnown, suppressedRows: group.difficultSuppressedRows }
    }),
    seasonality: marketDimension({
      status: seasonalityKnown ? "available" : "suppressed_partial",
      value: seasonalityKnown ? rate(group.seasonalProjectsKnown, group.recruitmentProjects) : null,
      unit: "percent_of_recruitment_projects",
      level: seasonalityKnown ? rateLevel(rate(group.seasonalProjectsKnown, group.recruitmentProjects)) : "unknown",
      sourceName: group.sourceName,
      sourcePublishedAt: group.sourcePublishedAt,
      sourceVintage: group.sourceVintage,
      territoryId: group.territoryId,
      territoryLabel: group.territoryLabel,
      confidence: seasonalityKnown ? 0.95 : 0.4,
      method: seasonalityKnown ? "official_bmo_ratio" : "suppressed_source_cells_not_treated_as_zero",
      mapping: { method: "unmapped", confidence: 0, rankingEligible: false },
      details: { knownProjects: group.seasonalProjectsKnown, suppressedRows: group.seasonalSuppressedRows }
    })
  };
}

function addBmoMeasure(group, value, target, suppressedTarget) {
  if (value === "suppressed") group[suppressedTarget] += 1;
  else {
    const numeric = numberOrNull(value);
    if (numeric !== null) group[target] += numeric;
  }
}

function normalizeDaresFactors(raw, directAvailable) {
  const fields = {
    hiringIntensity: raw.hiringIntensity,
    trainingEmploymentLink: raw.trainingEmploymentLink,
    availableWorkforceShortage: raw.availableWorkforceShortage,
    employmentNonDurability: raw.employmentNonDurability,
    demandingWorkingConditions: raw.demandingWorkingConditions,
    geographicMismatch: raw.geographicMismatch,
    salaryUnattractiveness: raw.salaryUnattractiveness
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, marketDimension({
    status: directAvailable && numberOrNull(value) !== null ? "available" : "unknown",
    value: directAvailable ? numberOrNull(value) : null,
    unit: "standardized_factor_index",
    level: "unclassified",
    sourceName: "dares_france_travail_tension",
    confidence: directAvailable ? 0.9 : 0,
    method: directAvailable ? "official_published_factor" : "not_available",
    mapping: { method: "unmapped", confidence: 0, rankingEligible: false }
  })]));
}

function normalizeDimension(raw) {
  return raw && typeof raw === "object" ? marketDimension(raw) : marketDimension();
}

function interpretation(caseId, text) {
  return { revision: MARKET_INTERPRETATION_REVISION, caseId, text };
}

function dimensionKnown(item = {}) {
  return ["available", "zero"].includes(item.status) && (item.value !== null || item.level !== "unknown");
}

function isHigh(item = {}) {
  return ["high", "very_high", "top_local", "strong_local"].includes(item.level);
}

function isLow(item = {}) {
  return item.status === "zero" || ["zero", "low", "very_low", "zero_local", "weak_local"].includes(item.level);
}

function daresTensionLevel(value) {
  return ({ 1: "very_low", 2: "low", 3: "moderate", 4: "high", 5: "very_high" })[value] || "unknown";
}

function rateLevel(value) {
  if (value === null) return "unknown";
  if (value >= 60) return "high";
  if (value >= 30) return "moderate";
  return "low";
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : null;
}

function normalizeOfferSignal(value, offers12m) {
  if (["zero", "low", "medium", "high", "unknown"].includes(value)) return value;
  if (offers12m === null) return "unknown";
  if (offers12m === 0) return "zero";
  return "unknown";
}

function normalizeTerritorialSignal(value, offers12m) {
  if (["zero_local", "weak_local", "medium_local", "strong_local", "top_local", "unknown"].includes(value)) return value;
  return offers12m === 0 ? "zero_local" : "unknown";
}

function territoryIdFromRow(row) {
  if (row.sourceLevel === "departmental") return `DEP-${row.codeTerritoire || "11"}`;
  if (row.sourceLevel === "regional") return `REG-${row.codeTerritoire || "76"}`;
  return "FR";
}

function lowestMappingQuality(dimensions) {
  const mappings = dimensions.map(item => item.mapping).filter(Boolean);
  if (!mappings.length) return { method: "unmapped", confidence: 0, rankingEligible: false };
  return mappings.reduce((lowest, item) => Number(item.confidence || 0) < Number(lowest.confidence || 0) ? item : lowest, mappings[0]);
}

function worstFreshness(dimensions) {
  const order = ["unknown", "current", "recent", "stale", "very_stale"];
  return dimensions.reduce((worst, item) => order.indexOf(item.freshness) > order.indexOf(worst) ? item.freshness : worst, "unknown");
}

function compareTerritoryAndCode(a, b) {
  return String(a.territoryId).localeCompare(String(b.territoryId), "fr") || String(a.fapCode).localeCompare(String(b.fapCode), "fr");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "n.d." || value === "*") return null;
  const numeric = Number(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function integerOrNull(value) {
  const numeric = numberOrNull(value);
  return numeric === null ? null : Math.round(numeric);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
