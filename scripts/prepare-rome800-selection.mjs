import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const BASE_FILE = path.resolve(ROOT, process.env.ROME_SELECTION_BASE_FILE || "creations/boussolepro/data/local/rome-codes-500.json");
const UNIVERSE_FILE = path.resolve(ROOT, process.env.ROME_UNIVERSE_FILE || "creations/boussolepro/data/local/rome-universe-official.json");
const FAP_FILE = path.join(ROOT, "creations", "boussolepro", "data", "generated", "market", "fap-rome-mappings.json");
const OUTPUT_DIR = path.resolve(ROOT, process.env.ROME_SELECTION_OUTPUT_DIR || "creations/boussolepro/data/local");
const REQUIRED_PRIORITY_CODES = ["K1202", "K1206", "K1208", "K1210", "K1215", "K2113", "A1503"];
const TARGET_SIZE = Number(process.env.ROME_SELECTION_TARGET_SIZE || 800);
const BASE_EXPECTED_COUNT = Number(process.env.ROME_SELECTION_BASE_COUNT || 500);
const CORPUS_VERSION = process.env.ROME_SELECTION_CORPUS_VERSION || `rome${TARGET_SIZE}-candidate-v0.1`;
const OUTPUT_PREFIX = process.env.ROME_SELECTION_OUTPUT_PREFIX || `rome-codes-${TARGET_SIZE}`;
const BASE_CORPUS_LABEL = process.env.ROME_SELECTION_BASE_LABEL || `ROME${BASE_EXPECTED_COUNT}`;

const DOMAIN_LABELS = {
  A: "Agriculture, pêche, nature, espaces verts, animaux", B: "Arts et façonnage d'ouvrages d'art",
  C: "Banque, assurance, immobilier", D: "Commerce, vente et grande distribution", E: "Communication, média et multimédia",
  F: "Construction, bâtiment et travaux publics", G: "Hôtellerie-restauration, tourisme, loisirs et animation",
  H: "Industrie", I: "Installation et maintenance", J: "Santé", K: "Services à la personne et à la collectivité",
  L: "Spectacle", M: "Support à l'entreprise", N: "Transport et logistique"
};

export async function main() {
  const [base, universeDocument, fapRows] = await Promise.all([
    readJson(BASE_FILE), readJson(UNIVERSE_FILE), readJson(FAP_FILE, [])
  ]);
  const universeRows = Array.isArray(universeDocument) ? universeDocument : universeDocument.records;
  const result = buildRomeCandidateSelection({ baseRows: base.codes, universeRows, fapRows });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUTPUT_DIR, `${OUTPUT_PREFIX}.json`), result.selection),
    writeJson(path.join(OUTPUT_DIR, `${OUTPUT_PREFIX}-additions.json`), result.additions),
    writeJson(path.join(OUTPUT_DIR, `${OUTPUT_PREFIX}-audit.json`), result.audit)
  ]);
  console.log(`[Boussole Pro] Sélection ROME${TARGET_SIZE} : ${result.selection.codes.length} codes, dont ${result.additions.codes.length} ajouts officiels.`);
}

export function buildRomeCandidateSelection({ baseRows = [], universeRows = [], fapRows = [] }) {
  const base = normalizeRows(baseRows);
  const universe = normalizeRows(universeRows);
  if (base.length !== BASE_EXPECTED_COUNT) throw new Error(`Le socle canonique doit contenir exactement ${BASE_EXPECTED_COUNT} codes uniques, reçu : ${base.length}.`);
  if (universe.length < TARGET_SIZE) throw new Error(`L'univers officiel doit contenir au moins ${TARGET_SIZE} codes uniques, reçu : ${universe.length}.`);

  const baseCodes = new Set(base.map(row => row.romeCode));
  const fapCodes = new Set(fapRows.map(row => normalizeCode(row?.romeCode)).filter(Boolean));
  const available = universe.filter(row => !baseCodes.has(row.romeCode));
  if (available.length < TARGET_SIZE - base.length) throw new Error(`Seulement ${available.length} codes officiels manquants sont disponibles.`);

  const requiredAvailable = REQUIRED_PRIORITY_CODES.filter(code => available.some(row => row.romeCode === code));
  const selected = [];
  const selectedCodes = new Set();
  const selectedFamilies = new Set(base.map(row => row.familyPrefix));
  requiredAvailable.forEach(code => addCandidate(available.find(row => row.romeCode === code), "priority_expected_code"));

  const targetByDomain = calculateDomainTargets(base, universe, TARGET_SIZE);
  while (selected.length < TARGET_SIZE - base.length) {
    const currentCounts = countByDomain([...base, ...selected]);
    const remaining = available.filter(row => !selectedCodes.has(row.romeCode));
    if (!remaining.length) throw new Error(`Impossible de compléter la sélection ROME${TARGET_SIZE}.`);
    remaining.sort((left, right) => compareCandidates(left, right, { currentCounts, targetByDomain, selectedFamilies, fapCodes }));
    const candidate = remaining[0];
    const reason = currentCounts[candidate.domainLetter] < (targetByDomain[candidate.domainLetter] || 0)
      ? "domain_balance_fill"
      : !selectedFamilies.has(candidate.familyPrefix) ? "family_coverage_fill" : "deterministic_diversity_fill";
    addCandidate(candidate, reason);
  }

  function addCandidate(candidate, primaryReason) {
    if (!candidate || selectedCodes.has(candidate.romeCode)) return;
    selectedCodes.add(candidate.romeCode);
    selectedFamilies.add(candidate.familyPrefix);
    selected.push({
      ...candidate,
      domainLabel: DOMAIN_LABELS[candidate.domainLetter] || "Domaine ROME à vérifier",
      selectionReasons: unique([
        primaryReason,
        fapCodes.has(candidate.romeCode) ? "official_fap_crosswalk_available" : "official_fap_crosswalk_absent",
        isAccessibleTitle(candidate.title) ? "generalist_or_accessible_title_signal" : "occupational_diversity"
      ]),
      apiRetrievalStatus: "pending_incremental_sync",
      replacementTrace: null
    });
  }

  const additions = selected.sort((a, b) => a.romeCode.localeCompare(b.romeCode));
  const finalCounts = countByDomain([...base, ...additions]);
  const reserveCandidates = available
    .filter(row => !selectedCodes.has(row.romeCode))
    .sort((left, right) => compareCandidates(left, right, { currentCounts: finalCounts, targetByDomain, selectedFamilies, fapCodes }))
    .slice(0, 50)
    .map(row => ({ ...row, domainLabel: DOMAIN_LABELS[row.domainLetter] || "Domaine ROME à vérifier", selectionReasons: ["official_recovery_reserve"], apiRetrievalStatus: "not_requested" }));
  const combined = [...base.map(row => ({ ...row, retainedFromParentCorpus: true })), ...additions]
    .sort((a, b) => a.romeCode.localeCompare(b.romeCode));
  const missingRequired = REQUIRED_PRIORITY_CODES.filter(code => !combined.some(row => row.romeCode === code));
  const domainCounts = countByDomain(combined);
  return {
    selection: {
      schemaVersion: "1.0.0", sourceVersion: "ROME actif via API France Travail", selectionSize: TARGET_SIZE,
      corpusVersion: CORPUS_VERSION, method: `${BASE_CORPUS_LABEL} conservé + ${TARGET_SIZE - base.length} ajouts officiels déterministes équilibrés par domaines et familles ; FAP et accessibilité utilisées en critères secondaires`,
      retainedCodesCount: base.length, additionsCount: additions.length, domainQuotas: targetByDomain, codes: combined
    },
    additions: {
      schemaVersion: "1.0.0", selectionSize: additions.length, parentCorpusVersion: CORPUS_VERSION,
      purpose: `Synchronisation incrémentale des seuls codes absents du corpus ${BASE_CORPUS_LABEL}`, codes: additions
    },
    audit: {
      schemaVersion: "1.0.0", reportKind: `rome${TARGET_SIZE}_selection_audit`, generatedAt: new Date().toISOString(),
      sourceValidity: "france_travail_rome_metiers_api", baseCodesCount: base.length, officialUniverseCount: universe.length,
      additionsCount: additions.length, finalCodesCount: combined.length, uniqueFinalCodesCount: new Set(combined.map(row => row.romeCode)).size,
      requiredPriorityCodes: REQUIRED_PRIORITY_CODES, requiredPriorityCodesPresent: REQUIRED_PRIORITY_CODES.filter(code => !missingRequired.includes(code)),
      requiredPriorityCodesUnavailable: missingRequired, domainCounts, targetByDomain,
      fapCoverageOfAdditions: { present: additions.filter(row => fapCodes.has(row.romeCode)).length, absent: additions.filter(row => !fapCodes.has(row.romeCode)).length },
      additions,
      reserveCandidates,
      replacements: []
    }
  };
}

export const buildRome800Selection = buildRomeCandidateSelection;

function compareCandidates(left, right, context) {
  const score = row => {
    const deficit = Math.max(0, (context.targetByDomain[row.domainLetter] || 0) - (context.currentCounts[row.domainLetter] || 0));
    return deficit * 100 + (!context.selectedFamilies.has(row.familyPrefix) ? 30 : 0) + (isAccessibleTitle(row.title) ? 5 : 0) + (context.fapCodes.has(row.romeCode) ? 2 : 0);
  };
  return score(right) - score(left) || left.romeCode.localeCompare(right.romeCode);
}

function calculateDomainTargets(base, universe, targetSize) {
  const baseCounts = countByDomain(base);
  const universeCounts = countByDomain(universe);
  const domains = Object.keys(universeCounts).sort();
  const raw = domains.map(domain => ({
    domain,
    floor: Math.max(baseCounts[domain] || 0, Math.floor(targetSize * universeCounts[domain] / universe.length)),
    remainder: targetSize * universeCounts[domain] / universe.length % 1
  }));
  let allocated = raw.reduce((sum, item) => sum + item.floor, 0);
  raw.sort((a, b) => b.remainder - a.remainder || a.domain.localeCompare(b.domain));
  for (let index = 0; allocated < targetSize; index = (index + 1) % raw.length) { raw[index].floor += 1; allocated += 1; }
  for (let index = raw.length - 1; allocated > targetSize && index >= 0; index -= 1) {
    const minimum = baseCounts[raw[index].domain] || 0;
    if (raw[index].floor > minimum) { raw[index].floor -= 1; allocated -= 1; }
    if (index === 0 && allocated > targetSize) index = raw.length;
  }
  return Object.fromEntries(raw.sort((a, b) => a.domain.localeCompare(b.domain)).map(item => [item.domain, item.floor]));
}

function normalizeRows(rows = []) {
  const normalized = rows.map(row => {
    const romeCode = normalizeCode(typeof row === "string" ? row : row?.romeCode || row?.code);
    if (!romeCode) return null;
    return {
      ...(typeof row === "object" ? row : {}), romeCode,
      title: String(row?.title || row?.libelle || row?.label || `Métier ROME ${romeCode}`).trim(),
      domainLetter: romeCode[0], familyPrefix: romeCode.slice(0, 3), validitySource: row?.validitySource || "france_travail_rome_metiers_api"
    };
  }).filter(Boolean).sort((a, b) => a.romeCode.localeCompare(b.romeCode));
  return [...new Map(normalized.map(row => [row.romeCode, row])).values()];
}

function normalizeCode(value) { const code = String(value || "").trim().toUpperCase(); return /^[A-Z][0-9]{4}$/.test(code) ? code : ""; }
function countByDomain(rows) { return rows.reduce((counts, row) => ({ ...counts, [row.domainLetter]: (counts[row.domainLetter] || 0) + 1 }), {}); }
function isAccessibleTitle(title) { return /\b(aide|agent|assistant|employe|operateur|animateur|accompagnant)\b/i.test(normalizeText(title)); }
function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (fallback !== undefined) return fallback; throw error; } }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
