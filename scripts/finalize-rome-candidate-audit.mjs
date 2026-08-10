import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_SIZE = Number(process.env.ROME_AUDIT_TARGET_SIZE || 1000);
const FILE_PREFIX = process.env.ROME_AUDIT_FILE_PREFIX || `rome-codes-${TARGET_SIZE}`;
const TARGET_SUBDIR = process.env.ROME_AUDIT_TARGET_SUBDIR || `rome${TARGET_SIZE}-candidate`;
const LOCAL_DIR = path.join(ROOT, "creations", "boussolepro", "data", "local");
const TARGET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", TARGET_SUBDIR);

async function main() {
  const [audit, additions, jobs] = await Promise.all([
    readJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-audit.json`)),
    readJson(path.join(LOCAL_DIR, `${FILE_PREFIX}-additions.json`)),
    readJson(path.join(TARGET_DIR, "jobs.rome.json"))
  ]);
  const jobsByCode = new Map(jobs.map(job => [job.romeCode, job]));
  const replacementsByNewCode = new Map((audit.replacements || []).map(row => [row.replacementCode, row.failedCode]));
  const finalized = additions.codes.map(row => {
    const job = jobsByCode.get(row.romeCode);
    return {
      ...row,
      title: job?.title || row.title,
      apiRetrievalStatus: job ? "retrieved_official_valid" : "missing_after_merge",
      replacementTrace: row.replacementTrace || (replacementsByNewCode.has(row.romeCode) ? { replaces: replacementsByNewCode.get(row.romeCode) } : null),
      finalStatus: job ? "included_in_candidate_corpus" : "excluded_missing_official_fiche"
    };
  });
  const missing = finalized.filter(row => row.finalStatus !== "included_in_candidate_corpus");
  const nextAudit = {
    ...audit,
    finalizedAt: new Date().toISOString(),
    finalCorpusVersion: process.env.ROME_AUDIT_CORPUS_VERSION || `rome${TARGET_SIZE}-candidate-v0.1`,
    finalCodesCount: jobs.length,
    uniqueFinalCodesCount: new Set(jobs.map(job => job.romeCode)).size,
    additions: finalized,
    retrievalSummary: {
      expectedAdditions: finalized.length,
      retrievedOfficialValid: finalized.length - missing.length,
      missingAfterMerge: missing.length,
      replacements: (audit.replacements || []).length
    },
    status: jobs.length === TARGET_SIZE && !missing.length ? "complete" : "incomplete"
  };
  await writeFile(path.join(LOCAL_DIR, `${FILE_PREFIX}-audit.json`), `${JSON.stringify(nextAudit, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Audit ROME${TARGET_SIZE} finalisé : ${finalized.length - missing.length}/${finalized.length} ajouts officiels inclus.`);
  if (nextAudit.status !== "complete") process.exitCode = 1;
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
main().catch(error => { console.error(error); process.exit(1); });
