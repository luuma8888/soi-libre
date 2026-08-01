import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "./boussole-runtime-identity.mjs";
import { DELIVERY_DIR } from "./build-boussole-v076-delivery.mjs";

const ROOT = process.cwd();
const DELIVERY_ROOT = process.env.BOUSSOLE_DELIVERY_DIR
  ? path.resolve(process.env.BOUSSOLE_DELIVERY_DIR)
  : DELIVERY_DIR;
const REPO_HTML = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const DELIVERY_HTML = path.join(DELIVERY_ROOT, "boussole-pro.html");
const OUTPUT = path.join(ROOT, "creations", "boussolepro", "data", "generated", "boussole-runtime-parity-report.json");
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

const repoServer = await startServer(ROOT);
const deliveryServer = await startServer(DELIVERY_ROOT);
const debugPort = 9700 + Math.floor(Math.random() * 200);
const chromium = spawn(CHROMIUM, ["--headless", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/boussole-parity-${process.pid}`, "about:blank"], { stdio: "ignore" });

try {
  const target = await waitForPageTarget(debugPort);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const repoUrl = `http://127.0.0.1:${repoServer.address().port}/creations/boussolepro/boussole-pro.html`;
  const deliveryUrl = `http://127.0.0.1:${deliveryServer.address().port}/boussole-pro.html`;
  const artifactBench = JSON.parse(await readFile(path.join(DELIVERY_ROOT, "test-bench.json"), "utf8"));
  const runtimeManifest = JSON.parse(await readFile(path.join(DELIVERY_ROOT, "runtime-bundle-identity.json"), "utf8"));

  const repoClean = await runCleanScenario(cdp, repoUrl);
  const staleCache = await runStaleCacheScenario(cdp, repoUrl, runtimeManifest);
  const exactCache = await runExactCacheScenario(cdp, repoUrl);
  const deliveryClean = await runCleanScenario(cdp, deliveryUrl);
  const artifact = summarizeBench("packaged_artifact", artifactBench);
  const environments = [repoClean, staleCache.bench, deliveryClean, artifact];
  const expectedSha256 = artifact.normalizedSha256;
  const differences = environments.filter(environment => environment.normalizedSha256 !== expectedSha256).map(environment => ({ environment: environment.environment, expectedSha256, receivedSha256: environment.normalizedSha256 }));
  const identityDifferences = environments.filter(environment => environment.runtimeFingerprint !== runtimeManifest.fingerprintSha256).map(environment => ({ environment: environment.environment, expected: runtimeManifest.fingerprintSha256, received: environment.runtimeFingerprint }));
  const failures = [];
  if (differences.length) failures.push("normalized_bench_difference");
  if (identityDifferences.length) failures.push("runtime_identity_difference");
  if (!staleCache.migrationCompleted) failures.push("stale_cache_not_migrated");
  if (!staleCache.personalDataPreserved) failures.push("personal_data_not_preserved");
  if (!exactCache.compatible || exactCache.runtimeFingerprint !== runtimeManifest.fingerprintSha256) failures.push("exact_cache_not_reloaded");
  if (repoClean.profilesCount !== 12 || deliveryClean.profilesCount !== 12) failures.push("profiles_count_mismatch");

  const report = {
    schemaVersion: "2.0.0",
    reportKind: "boussole_runtime_delivery_parity",
    generatedAt: new Date().toISOString(),
    deliveryPathMode: process.env.BOUSSOLE_DELIVERY_DIR ? "extracted_archive" : "delivery_directory",
    status: failures.length ? "failed" : "ok",
    verdict: failures.length ? "local_parity_failed" : "local_parity_demonstrated",
    scope: "Same packaged_corpus, rules, integrated profiles and headless Chromium; excludes the real user import environment.",
    appBuild: repoClean.appBuild,
    datasetIdentity: runtimeManifest.datasetIdentity,
    runtimeBundleIdentity: { inputMode: runtimeManifest.inputMode, runtimeBundleRevision: runtimeManifest.runtimeBundleRevision, fingerprintSha256: runtimeManifest.fingerprintSha256, counts: runtimeManifest.counts, ruleVersions: runtimeManifest.ruleVersions },
    testProfilesIdentity: { revision: "integrated-12-v0.7.6", count: 12, normalizedReferenceSha256: expectedSha256 },
    environments,
    cacheScenarios: { staleCache, exactCache },
    differences,
    identityDifferences,
    realEnvironmentComparison: {
      status: "insufficient_identity",
      localInputMode: "packaged_corpus",
      realInputMode: "real_import",
      reason: "L'export reel annonce 9 226 lignes skillsEngine mais ne fournit pas l'empreinte canonique complete du paquet v0.7.6.",
      performanceReference: "Les mesures utilisateur restent la reference d'integration reelle."
    },
    htmlIdentity: { repoSha256: sha256(await readFile(REPO_HTML)), deliverySha256: sha256(await readFile(DELIVERY_HTML)), identical: (await readFile(REPO_HTML)).equals(await readFile(DELIVERY_HTML)) },
    failures
  };
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Parite runtime : ${report.verdict}, empreinte fonctionnelle ${expectedSha256}.`);
  cdp.close();
  if (failures.length) process.exitCode = 1;
} finally {
  chromium.kill("SIGTERM");
  await Promise.all([closeServer(repoServer), closeServer(deliveryServer)]);
}

async function runCleanScenario(cdp, url) {
  await navigate(cdp, url);
  await evaluate(cdp, "localStorage.clear()");
  await navigate(cdp, url);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.loadRome500()", true);
  const runtime = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.getRuntimeIdentity()");
  const bench = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.runIntegratedBench()");
  return { ...summarizeBench(url.includes("creations/boussolepro") ? "browser_repo_clean" : "browser_delivery_clean", bench), appBuild: runtime.build.appBuild, compatibility: runtime.compatibility.compatible, counts: runtime.counts };
}

async function runStaleCacheScenario(cdp, url, runtimeManifest) {
  await navigate(cdp, url);
  const staleIdentity = { inputMode: "packaged_corpus", runtimeBundleRevision: "rome500-runtime-v0.7.5-r0", fingerprintSha256: "0".repeat(64), sourceDatasetVersion: "rome500-candidate-v0.7", counts: { jobs: 500, skillsEngine: 0, accessSummary: 500 }, ruleVersions: { access: "v0.7.4-alpha", sectors: "v0.7.5-alpha", scoring: "v0.7.5-alpha" } };
  const seed = {
    profile: { app: "boussole-pro-profile", version: "v0.7.5-alpha", data: { id: "cache-preservation-profile", profileName: "Profil cache", notes: "sentinel-profile", hasRequestedResults: false } },
    favorites: { app: "Boussole Pro", version: "v0.7.5-alpha", data: [{ jobId: "rome-G1203", romeCode: "G1203", title: "Favori cache", note: "sentinel-favorite" }] },
    settings: { theme: "dark", corpusMode: "generated_rome_500_candidate", displayMode: "essential", sentinel: "sentinel-settings" },
    dataset: { app: "Boussole Pro", version: "v0.7.5-alpha", datasetRef: { packaged: true, inputMode: "packaged_corpus", datasetVersion: "rome500-candidate-v0.7", corpusMode: "generated_rome_500_candidate", runtimeBundleIdentity: staleIdentity } }
  };
  await evaluate(cdp, `localStorage.setItem("boussole_pro_profile_v1", ${JSON.stringify(JSON.stringify(seed.profile))});localStorage.setItem("boussole_pro_favorites_v1", ${JSON.stringify(JSON.stringify(seed.favorites))});localStorage.setItem("boussole_pro_settings_v1", ${JSON.stringify(JSON.stringify(seed.settings))});localStorage.setItem("boussole_pro_dataset_v1", ${JSON.stringify(JSON.stringify(seed.dataset))});`);
  await navigate(cdp, url);
  await waitForRuntime(cdp, runtimeManifest.fingerprintSha256);
  await waitForMigrationCompletion(cdp);
  const state = await evaluate(cdp, `(() => ({ runtime: window.__BOUSSOLE_TEST_API__.getRuntimeIdentity(), profile: JSON.parse(localStorage.getItem("boussole_pro_profile_v1") || "null"), favorites: JSON.parse(localStorage.getItem("boussole_pro_favorites_v1") || "null"), settings: JSON.parse(localStorage.getItem("boussole_pro_settings_v1") || "null") }))()`);
  const bench = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.runIntegratedBench()");
  const personalDataPreserved = state.profile?.data?.id === "cache-preservation-profile" && state.favorites?.data?.[0]?.note === "sentinel-favorite" && state.settings?.sentinel === "sentinel-settings" && state.settings?.theme === "dark";
  return {
    migrationCompleted: state.runtime?.migration?.status === "completed",
    personalDataPreserved,
    migration: state.runtime?.migration,
    bench: summarizeBench("browser_repo_stale_cache_migrated", bench)
  };
}

async function runExactCacheScenario(cdp, url) {
  await navigate(cdp, url);
  const runtime = await waitForRuntime(cdp);
  return { compatible: runtime.compatibility?.compatible, runtimeFingerprint: runtime.runtimeBundleIdentity?.fingerprintSha256, migrationStatus: runtime.migration?.status || null };
}

function summarizeBench(environment, report) {
  const normalized = normalizeBench(report);
  return { environment, inputMode: report.runtimeBundleIdentity?.inputMode || "unknown", runtimeFingerprint: report.runtimeBundleIdentity?.fingerprintSha256 || null, profilesCount: report.testProfilesCount || report.summary?.profilesCount || 0, normalizedSha256: canonicalSha256(normalized), normalizedRowsSha256: Object.fromEntries((normalized.rows || []).map(row => [row.id, canonicalSha256(row)])) };
}

function normalizeBench(report = {}) {
  return { datasetVersion: report.datasetVersion, runtimeFingerprint: report.runtimeBundleIdentity?.fingerprintSha256, rows: (report.rows || []).map(row => ({ id: row.id, top5: row.top5, expectedJobsEvaluation: row.expectedJobsEvaluation, anomalies: row.anomalies, marketUniform: row.marketUniform })), anomalies: report.anomalies, summary: report.summary };
}

async function waitForRuntime(cdp, expectedFingerprint = null) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const runtime = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__?.getRuntimeIdentity?.()");
      if (runtime?.compatibility?.compatible && (!expectedFingerprint || runtime.runtimeBundleIdentity?.fingerprintSha256 === expectedFingerprint)) return runtime;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Le paquet runtime compatible n'a pas ete charge dans le delai imparti.");
}

async function waitForMigrationCompletion(cdp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const migration = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__?.getRuntimeIdentity?.()?.migration");
      if (migration?.status === "completed") return migration;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("La migration du cache n'a pas atteint son etat final dans le delai imparti.");
}

async function startServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname === "/" ? "/boussole-pro.html" : pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Chemin refuse");
      const body = await readFile(file);
      const extension = path.extname(file);
      response.setHeader("content-type", extension === ".html" ? "text/html; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : "application/octet-stream");
      response.setHeader("cache-control", "no-store");
      response.end(body);
    } catch (error) { response.statusCode = 404; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function closeServer(server) { return new Promise(resolve => server.close(resolve)); }

async function navigate(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
}

async function waitForPageTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()); const page = pages.find(item => item.type === "page"); if (page) return page; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Chromium CDP indisponible.");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) { const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result || {}); return; }
    const queue = listeners.get(message.method) || []; listeners.set(message.method, []); queue.forEach(resolve => resolve(message.params || {}));
  });
  return { send(method, params = {}) { const requestId = ++id; socket.send(JSON.stringify({ id: requestId, method, params })); return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject })); }, once(method) { return new Promise(resolve => listeners.set(method, [...(listeners.get(method) || []), resolve])); }, close() { socket.close(); } };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
