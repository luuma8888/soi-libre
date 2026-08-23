import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { adaptCompactRuntime, sha256, validateCompactRuntime } from "./boussole-runtime-compact.mjs";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations/boussolepro");
const RUNTIME_DIR = path.join(APP_DIR, "data/generated/boussole-runtime");
const REPORT_PATH = path.join(ROOT, "tmp/monde-pro/boussole-runtime-v1/boussole-runtime-validation-report.json");
const EXPECTED_FILES = [
  "boussole-runtime-manifest.json",
  "boussole-core.json",
  "boussole-competences.json",
  "boussole-marche.json"
].sort();

const failures = [];
const assert = (id, condition, detail = null) => {
  if (!condition) failures.push({ id, detail });
};

const actualFiles = (await readdir(RUNTIME_DIR)).filter(name => !name.startsWith(".")).sort();
assert("exact_four_public_runtime_files", JSON.stringify(actualFiles) === JSON.stringify(EXPECTED_FILES), actualFiles);

const manifest = await readJson(path.join(RUNTIME_DIR, "boussole-runtime-manifest.json"));
const texts = {};
const runtime = {};
for (const [key, descriptor] of Object.entries(manifest.files || {})) {
  const filePath = path.join(RUNTIME_DIR, descriptor.path || "");
  const text = await readFile(filePath, "utf8");
  texts[key] = text;
  runtime[key] = JSON.parse(text);
  assert(`sha256:${key}`, sha256(text) === descriptor.sha256, { expected: descriptor.sha256, received: sha256(text) });
  assert(`bytes:${key}`, Buffer.byteLength(text) === descriptor.bytes, { expected: descriptor.bytes, received: Buffer.byteLength(text) });
}

const structural = validateCompactRuntime(runtime);
assert("compact_structure", structural.failures.length === 0, structural.failures);
assert("manifest_identity", [runtime.core, runtime.competences, runtime.marche].every(item =>
  item.schemaVersion === manifest.schemaVersion && item.datasetVersion === manifest.datasetVersion && item.generatedAt === manifest.generatedAt
));
assert("manifest_runtime_fingerprint", sha256(Object.values(manifest.files).map(file => file.sha256).join("|")) === manifest.runtimeFingerprintSha256);

const adapted = adaptCompactRuntime(runtime, manifest);
assert("adapted_jobs_1000", adapted.jobs.length === 1000);
assert("adapted_skills", adapted.skillsEngine.length === manifest.counts.skills);
assert("adapted_knowledge", adapted.knowledge.length === manifest.counts.knowledge);
assert("all_knowledge_labels_human", adapted.knowledge.every(item => item.label && item.label !== item.id));
assert("job_search", ["animateur", "documentaliste", "K2111", "M1805"].every(query => searchJobs(adapted.jobs, query).length > 0));
assert("skill_search", ["animer", "écouter"].every(query => searchSkills(adapted.skillsEngine, query).length > 0));

const marketRows = runtime.marche.jobs.flatMap(job => Object.entries(job.territories).map(([territoryId, value]) => ({ jobId: job.jobId, territoryId, ...value })));
const marketExamples = {
  available: marketRows.find(row => row.availability === "available") || null,
  unavailable: marketRows.find(row => row.availability === "unavailable") || null,
  zero: marketRows.find(row => row.offersCount === 0) || null,
  absent: marketRows.find(row => row.offersCount === null) || null,
  sharedFamily: marketRows.find(row => row.sharedFamily) || null,
  imputed: marketRows.find(row => row.tensionImputed) || null
};
assert("market_available", Boolean(marketExamples.available));
assert("market_unavailable", Boolean(marketExamples.unavailable));
assert("market_zero_distinct_from_absent", Boolean(marketExamples.zero) && Boolean(marketExamples.absent));
assert("market_shared_family_warning_signal", Boolean(marketExamples.sharedFamily));
assert("market_imputed_signal", Boolean(marketExamples.imputed));

const [onlineHtml, offlineHtml] = await Promise.all([
  readFile(path.join(APP_DIR, "boussole-pro.html"), "utf8"),
  readFile(path.join(APP_DIR, "boussole-pro-offline.html"), "utf8")
]);
const onlinePayload = parsePayload(onlineHtml);
const offlinePayload = parsePayload(offlineHtml);
assert("online_shell_has_no_dataset", !("dataset" in onlinePayload) && onlinePayload.embeddedRuntime === null);
assert("online_runtime_provider", onlineHtml.includes("/* RUNTIME_PROVIDER_START */") && onlinePayload.runtimeBasePath === "data/generated/boussole-runtime/");
assert("offline_embeds_exact_runtime", ["core", "competences", "marche"].every(key =>
  sha256(JSON.stringify(offlinePayload.embeddedRuntime?.[key])) === manifest.files[key].sha256
));
assert("offline_manifest_exact", JSON.stringify(offlinePayload.embeddedRuntime?.manifest) === JSON.stringify(manifest));
assert("same_shell_outside_payload", stripPayload(onlineHtml) === stripPayload(offlineHtml));
assert("no_rome100_runtime_fallback", !/emergency_rome100|fallbackDataset|activateFallback/.test(stripPayload(onlineHtml)));

const rawBytes = Object.values(texts).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
const gzipBytes = Object.values(texts).reduce((sum, text) => sum + gzipSync(text, { level: 9 }).byteLength, 0);
assert("raw_safety_limit", rawBytes <= 12_000_000, rawBytes);
assert("gzip_safety_limit", gzipBytes <= 2_000_000, gzipBytes);

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_runtime_compact_v1_validation",
  generatedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "passed",
  datasetVersion: manifest.datasetVersion,
  assertions: 25,
  failures,
  counts: structural.counts,
  sizes: { rawBytes, gzipBytes, rawTargetMet: rawBytes <= 10_000_000, gzipTargetMet: gzipBytes <= 1_500_000 },
  marketExamples: Object.fromEntries(Object.entries(marketExamples).map(([key, value]) => [key, value ? { jobId: value.jobId, territoryId: value.territoryId } : null])),
  distributions: { onlineBytes: Buffer.byteLength(onlineHtml), offlineBytes: Buffer.byteLength(offlineHtml) }
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) throw new Error(`Validation du runtime compact échouée : ${failures.map(item => item.id).join(", ")}`);

function parsePayload(html) {
  const match = html.match(/\/\* REFONTE_DATA_START \*\/([\s\S]*?)\/\* REFONTE_DATA_END \*\//);
  if (!match) throw new Error("Bloc REFONTE_DATA absent.");
  return JSON.parse(match[1]);
}

function stripPayload(html) {
  return html.replace(/\/\* REFONTE_DATA_START \*\/[\s\S]*?\/\* REFONTE_DATA_END \*\//, "/* REFONTE_DATA_START *//* REFONTE_DATA_END */");
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function searchJobs(jobs, query) {
  const needle = normalize(query);
  return jobs.filter(job => normalize(`${job.romeCode} ${job.title} ${(job.appellations || []).join(" ")}`).includes(needle));
}

function searchSkills(skills, query) {
  const needle = normalize(query);
  return skills.filter(skill => normalize(`${skill.id} ${skill.label}`).includes(needle));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
