import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const HTML_ROUTE = "/creations/boussolepro/boussole-pro.html";
const OUTPUTS = [
  path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome500-browser-performance-report.json"),
  path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome500-experimental", "rome500-browser-performance-report.json")
];
const PROFILE_PATH = path.join(ROOT, "tmp", "monde-pro", "profils tests", "boussole-pro-profil-cedric-2026-07-10.json");
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const RUNS_PER_MODE = Number(process.env.BOUSSOLE_PERF_RUNS || 5);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(ROOT, `.${pathname === "/" ? HTML_ROUTE : pathname}`);
    if (!file.startsWith(`${ROOT}${path.sep}`)) throw new Error("Chemin refusé");
    const body = await readFile(file);
    const extension = path.extname(file);
    response.setHeader("content-type", extension === ".html" ? "text/html; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : "application/octet-stream");
    response.setHeader("cache-control", extension === ".html" ? "no-cache" : "public, max-age=3600");
    response.end(body);
  } catch (error) {
    response.statusCode = 404;
    response.end(error.message);
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const appPort = server.address().port;
const debugPort = 9300 + Math.floor(Math.random() * 400);
const appUrl = `http://127.0.0.1:${appPort}${HTML_ROUTE}`;
const chromium = spawn(CHROMIUM, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/boussole-chromium-${process.pid}`,
  "about:blank"
], { stdio: "ignore" });

try {
  const target = await waitForPageTarget(debugPort);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  const browserVersion = await cdp.send("Browser.getVersion");
  const profileEnvelope = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  const profile = profileEnvelope.profile || profileEnvelope.data || profileEnvelope;
  profile.hasRequestedResults = true;
  profile.completedBoussole = true;
  profile.jobExperiences = [
    { romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes", recency: "recent", masteryLevel: "advanced", source: "user_direct" },
    { romeCode: "M1805", title: "Études et développement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no", recency: "recent", masteryLevel: "autonomous", source: "user_direct" }
  ];

  const cold = [];
  const warm = [];
  for (let index = 0; index < RUNS_PER_MODE; index += 1) {
    cold.push(await runScenario(cdp, appUrl, profile, true, index + 1));
    console.log(`[Boussole Pro] Essai froid ${index + 1}/${RUNS_PER_MODE} terminé (${cold.at(-1).totalGeneratedLoadMs} ms, ${cold.at(-1).cardsRendered} cartes).`);
  }
  for (let index = 0; index < RUNS_PER_MODE; index += 1) {
    warm.push(await runScenario(cdp, appUrl, profile, false, index + 1));
    console.log(`[Boussole Pro] Essai chaud ${index + 1}/${RUNS_PER_MODE} terminé (${warm.at(-1).totalGeneratedLoadMs} ms, ${warm.at(-1).cardsRendered} cartes).`);
  }

  const visualChecks = await runVisualChecks(cdp);
  const build = await readBoussoleBuildMetadata();
  const metrics = ["datasetLoadMs", "normalizationMs", "profileScoringMs", "resultsGroupingMs", "resultsUiRenderMs", "resultCardRenderMs", "resultsFirstVisibleMs", "resultsInteractiveMs", "compactExportMs", "totalGeneratedLoadMs", "heapUsedBytes"];
  const report = {
    schemaVersion: "1.0.0",
    reportKind: "rome500_browser_performance_multi_run",
    generatedAt: new Date().toISOString(),
    ...build,
    scenario: {
      browser: browserVersion.product,
      userAgent: browserVersion.userAgent,
      machine: `${process.platform}-${process.arch}`,
      profile: "Cédric (contenu libre non exporté)",
      coldRuns: cold.length,
      warmRuns: warm.length,
      servedUrl: appUrl
    },
    runs: { cold, warm },
    summary: {
      cold: summarizeRuns(cold, metrics),
      warm: summarizeRuns(warm, metrics),
      previousReferenceTotalMs: 11902,
      comparisonMetric: "totalGeneratedLoadMs",
      conclusion: compareToReference(cold, warm, 11902)
    },
    visualChecks,
    measurementPolicy: "Toute phase absente est représentée par null et measurementStatus=not_measured ; aucune absence n’est codée par 0.",
    privacy: "Mesure locale. Aucun profil ni texte libre n’est écrit dans ce rapport."
  };
  for (const output of OUTPUTS) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Mesures navigateur terminées : ${cold.length} froides, ${warm.length} chaudes, build ${build.buildId}.`);
  console.log(`[Boussole Pro] Médiane totale : froid ${report.summary.cold.totalGeneratedLoadMs.median} ms, chaud ${report.summary.warm.totalGeneratedLoadMs.median} ms.`);
  cdp.close();
} finally {
  chromium.kill("SIGTERM");
  await new Promise(resolve => server.close(resolve));
}

async function runScenario(cdp, url, profile, cold, run) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  if (cold) await cdp.send("Network.clearBrowserCache");
  await navigate(cdp, url);
  await evaluate(cdp, "localStorage.clear()");
  await navigate(cdp, url);
  await evaluate(cdp, `window.__BOUSSOLE_TEST_API__.setProfile(${JSON.stringify(profile)})`);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.resetPerformanceMetrics()");
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.loadRome500()", true);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.measureCompactExport()");
  const browserReport = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.getPerformanceReport()");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const values = Object.fromEntries(Object.entries(browserReport.performanceMetrics || {}).map(([key, entry]) => [key, entry?.value ?? null]));
  return {
    run,
    cacheMode: cold ? "cold" : "warm",
    ...values,
    heapUsedBytes: Number.isFinite(heap.usedSize) ? heap.usedSize : null,
    measurementStatus: Object.fromEntries([...Object.keys(values), "heapUsedBytes"].map(key => [key, values[key] === null && key !== "heapUsedBytes" ? "not_measured" : "measured"])),
    jobsCount: browserReport.dataset?.jobsCount || 0,
    resultsComputed: browserReport.resultMetrics?.resultsComputed || 0,
    cardsRendered: values.resultCardsRendered ?? null
  };
}

async function runVisualChecks(cdp) {
  const inspect = () => evaluate(cdp, `(() => {
    const marker = document.querySelector('[data-build-marker]');
    if (!marker) return { present: false, visible: false, text: null };
    const rect = marker.getBoundingClientRect();
    const style = getComputedStyle(marker);
    return { present: true, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', text: marker.textContent.trim(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight }, fitsViewportWidth: rect.left >= 0 && rect.right <= innerWidth + 1 };
  })()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  const desktop = await inspect();
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  const mobile = await inspect();
  const print = await cdp.send("Page.printToPDF", { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 });
  return { desktop, mobile, print: { generated: Boolean(print.data), bytesApprox: print.data ? Math.round(print.data.length * 0.75) : 0 } };
}

function summarizeRuns(runs, metrics) {
  return Object.fromEntries(metrics.map(metric => {
    const values = runs.map(run => run[metric]).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (!values.length) return [metric, { median: null, worst: null, measurementStatus: "not_measured" }];
    return [metric, { median: median(values), worst: values.at(-1), measurementStatus: "measured" }];
  }));
}

function median(values) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
}

function compareToReference(cold, warm, reference) {
  const coldValues = cold.map(run => run.totalGeneratedLoadMs).filter(Number.isFinite).sort((a, b) => a - b);
  const warmValues = warm.map(run => run.totalGeneratedLoadMs).filter(Number.isFinite).sort((a, b) => a - b);
  if (!coldValues.length || !warmValues.length) return "Comparaison impossible : mesure totale incomplète.";
  const coldMedian = median(coldValues);
  const warmMedian = median(warmValues);
  return `Médiane froide ${coldMedian} ms et chaude ${warmMedian} ms, à comparer à la référence mono-essai de ${reference} ms.`;
}

async function navigate(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  await evaluate(cdp, "document.readyState === 'complete'");
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Erreur Runtime.evaluate");
  return response.result?.value;
}

async function waitForPageTarget(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === "page");
      if (page) return page;
    } catch {
      // Chromium démarre encore.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Chromium CDP indisponible.");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result || {});
      return;
    }
    const queue = listeners.get(message.method) || [];
    listeners.set(message.method, []);
    queue.forEach(resolve => resolve(message.params || {}));
  });
  return {
    send(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    once(method) {
      return new Promise(resolve => listeners.set(method, [...(listeners.get(method) || []), resolve]));
    },
    close() {
      socket.close();
    }
  };
}
