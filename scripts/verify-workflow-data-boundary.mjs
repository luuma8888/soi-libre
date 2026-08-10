import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MODE = process.argv[2] || "verify";
const SNAPSHOT_PATH = path.resolve(process.env.WORKFLOW_BOUNDARY_SNAPSHOT || "/tmp/boussole-application-boundary.json");
const REPORT_PATH = path.resolve(process.env.WORKFLOW_BOUNDARY_REPORT || "creations/boussolepro/data/generated/workflow-boundary-report.json");
const APP_SOURCE_PATHS = csv(process.env.WORKFLOW_APPLICATION_SOURCE_PATHS || "creations/boussolepro/boussole-pro.html");
const ALLOWED_PREFIXES = csv(process.env.WORKFLOW_ALLOWED_DATA_PREFIXES || "creations/boussolepro/data/generated/,creations/boussolepro/data/local/rome-codes-,creations/boussolepro/data/local/rome-universe-official.json");

async function main() {
  if (MODE === "snapshot") {
    const snapshot = { schemaVersion: "1.0.0", capturedAt: new Date().toISOString(), applicationFiles: await hashFiles(APP_SOURCE_PATHS) };
    await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`[Boussole Pro] Frontière enregistrée : ${APP_SOURCE_PATHS.length} fichier(s) applicatif(s).`);
    return;
  }
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  const current = await hashFiles(APP_SOURCE_PATHS);
  const sourceChanges = APP_SOURCE_PATHS.filter(file => snapshot.applicationFiles?.[file]?.sha256 !== current[file]?.sha256);
  const changedFiles = MODE === "verify-staged" ? await stagedFiles() : await workingTreeFiles();
  const forbiddenFiles = changedFiles.filter(file => !isAllowed(file));
  const verdict = !sourceChanges.length && !forbiddenFiles.length
    ? "application_source_unchanged_by_workflow"
    : "workflow_boundary_violation";
  const report = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_workflow_data_boundary",
    checkedAt: new Date().toISOString(),
    mode: MODE,
    verdict,
    applicationSource: { files: APP_SOURCE_PATHS, start: snapshot.applicationFiles, end: current, changedFiles: sourceChanges },
    allowlist: ALLOWED_PREFIXES,
    generatedOrStagedFiles: changedFiles,
    forbiddenFiles
  };
  if (MODE === "verify") await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ verdict, mode: MODE, changedFiles: changedFiles.length, forbiddenFiles }, null, 2));
  if (verdict !== "application_source_unchanged_by_workflow") process.exitCode = 1;
}

async function hashFiles(files) {
  return Object.fromEntries(await Promise.all(files.map(async file => {
    const bytes = await readFile(path.join(ROOT, file));
    return [file, { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
  })));
}

async function workingTreeFiles() {
  const [tracked, untracked] = await Promise.all([
    git(["diff", "--name-only", "HEAD"]),
    git(["ls-files", "--others", "--exclude-standard"])
  ]);
  return unique([...lines(tracked), ...lines(untracked)]);
}

async function stagedFiles() { return lines(await git(["diff", "--cached", "--name-only"])); }
async function git(args) { return (await execFileAsync("git", args, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 })).stdout; }
function isAllowed(file) { return ALLOWED_PREFIXES.some(prefix => prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix || file.startsWith(prefix)); }
function csv(value) { return String(value || "").split(",").map(item => item.trim()).filter(Boolean); }
function lines(value) { return String(value || "").split(/\r?\n/).map(item => item.trim()).filter(Boolean); }
function unique(values) { return [...new Set(values)].sort(); }

main().catch(error => { console.error(error); process.exit(1); });
