export const RIASEC_LETTERS = "RIASEC";
const USER_WEIGHTS = [0.5, 0.3, 0.2];
const OCCUPATION_WEIGHTS = [1, 0.8, 0.6, 0.35, 0.15, 0];

export function normalizeRiasecRanking(value) {
  const ranking = Array.isArray(value) ? value.map(letter => String(letter).trim().toUpperCase()) : [];
  return ranking.length === 3 && new Set(ranking).size === 3 && ranking.every(letter => letter.length === 1 && RIASEC_LETTERS.includes(letter)) ? ranking : null;
}

export function calculateRiasecAlignment(userRanking, occupationFullRanking) {
  const user = normalizeRiasecRanking(userRanking);
  if (!user || !Array.isArray(occupationFullRanking) || occupationFullRanking.length !== 6 || new Set(occupationFullRanking).size !== 6 || !occupationFullRanking.every(letter => RIASEC_LETTERS.includes(letter))) return "not_evaluated";
  const numerator = user.reduce((sum, letter, index) => sum + USER_WEIGHTS[index] * OCCUPATION_WEIGHTS[occupationFullRanking.indexOf(letter)], 0);
  return Number(Math.min(100, Math.max(0, 100 * numerator / 0.86)).toFixed(6));
}

export function validateRiasecReference(reference, corpusCodes = []) {
  const failures = [];
  if (reference?.schemaVersion !== "1.0.0") failures.push("schemaVersion");
  const occupations = reference?.occupations || {};
  const codes = Object.keys(occupations);
  if (codes.length !== 1000) failures.push(`occupations_count:${codes.length}`);
  for (const [code, row] of Object.entries(occupations)) {
    const full = row?.fullRanking;
    if (!/^[A-Z][0-9]{4}$/.test(code)) failures.push(`${code}:code`);
    if (!normalizeRiasecRanking(row?.top3)) failures.push(`${code}:top3`);
    if (!Array.isArray(full) || full.length !== 6 || new Set(full).size !== 6 || !full.every(letter => RIASEC_LETTERS.includes(letter))) failures.push(`${code}:fullRanking`);
    if (JSON.stringify(row?.top3) !== JSON.stringify(full?.slice(0, 3))) failures.push(`${code}:ranking_prefix`);
    if (!["high", "medium", "low"].includes(row?.confidence)) failures.push(`${code}:confidence`);
    if (!String(row?.title || "").trim() || !Array.isArray(row?.rationale) || !row.rationale.length || row.rationale.some(item => !String(item).trim())) failures.push(`${code}:editorial_content`);
  }
  const corpus = new Set(corpusCodes);
  return { status: failures.length ? "failed" : "passed", failures, count: codes.length, commonCodes: codes.filter(code => corpus.has(code)).length, orphanCodes: codes.filter(code => !corpus.has(code)), unclassifiedCodes: [...corpus].filter(code => !occupations[code]) };
}
