import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");
const TARGET_SIZE = Number(process.env.ROME_RECOVERY_TARGET_SIZE || 800);
const TARGET_SUBDIR = process.env.ROME_RECOVERY_TARGET_SUBDIR || `rome${TARGET_SIZE}-candidate`;
const FILE_PREFIX = process.env.ROME_RECOVERY_FILE_PREFIX || `rome-codes-${TARGET_SIZE}`;
const CORPUS_VERSION = process.env.ROME_RECOVERY_CORPUS_VERSION || `rome${TARGET_SIZE}-candidate-v0.1`;
const BATCHES_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", TARGET_SUBDIR, "batches");
const PRIORITIES = new Set(["K1202", "K1206", "K1208", "K1210", "K1215", "K2113", "A1503"]);

async function main() {
  const [selection, additions, audit] = await Promise.all([
    readJson(path.join(LOCAL_DIR, `${FILE_PREFIX}.json`)),
    readJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-additions.json`)),
    readJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-audit.json`))
  ]);
  const reportFiles = (await readdir(BATCHES_DIR)).filter(name => /^report\.batch-0[1-3]\.json$/.test(name));
  const reports = await Promise.all(reportFiles.map(name => readJson(path.join(BATCHES_DIR, name))));
  const failedCodes = unique(reports.flatMap(report => (report.failedCodes || []).map(item => typeof item === "string" ? item : item.code)));
  const failedPriorities = failedCodes.filter(code => PRIORITIES.has(code));
  if (failedPriorities.length) throw new Error(`Un code prioritaire officiel a échoué et requiert une vérification de succession : ${failedPriorities.join(", ")}.`);
  if (failedCodes.length > (audit.reserveCandidates || []).length) throw new Error(`Réserve insuffisante : ${failedCodes.length} échecs pour ${(audit.reserveCandidates || []).length} remplaçants.`);

  const replacements = failedCodes.map((failedCode, index) => ({
    failedCode,
    replacementCode: audit.reserveCandidates[index].romeCode,
    reason: "official_candidate_api_failure_replacement",
    replacement: { ...audit.reserveCandidates[index], apiRetrievalStatus: "pending_recovery_sync", replacementTrace: { replaces: failedCode } }
  }));
  const failedSet = new Set(failedCodes);
  const replacementRows = replacements.map(item => item.replacement);
  additions.codes = [...additions.codes.filter(row => !failedSet.has(row.romeCode)), ...replacementRows].sort((a, b) => a.romeCode.localeCompare(b.romeCode));
  selection.codes = [...selection.codes.filter(row => !failedSet.has(row.romeCode)), ...replacementRows].sort((a, b) => a.romeCode.localeCompare(b.romeCode));
  audit.additions = additions.codes;
  audit.replacements = replacements.map(({ replacement, ...trace }) => trace);
  audit.requiredPriorityCodesUnavailable = unique([...(audit.requiredPriorityCodesUnavailable || []), ...failedPriorities]);
  audit.domainCounts = countByDomain(selection.codes);

  const recovery = { schemaVersion: "1.0.0", selectionSize: replacementRows.length, parentCorpusVersion: CORPUS_VERSION, purpose: "Relance ciblée des remplaçants officiels après échec de fiche", codes: replacementRows };
  await Promise.all([
    writeJson(path.join(LOCAL_DIR, `${FILE_PREFIX}.json`), selection),
    writeJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-additions.json`), additions),
    writeJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-audit.json`), audit),
    writeJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-recovery.json`), recovery)
  ]);
  process.stdout.write(`recovery_count=${replacementRows.length}\n`);
}

function countByDomain(rows) { return rows.reduce((counts, row) => ({ ...counts, [row.domainLetter || row.romeCode?.[0]]: (counts[row.domainLetter || row.romeCode?.[0]] || 0) + 1 }), {}); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
main().catch(error => { console.error(error); process.exit(1); });
