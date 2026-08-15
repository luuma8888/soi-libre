import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const HTML_ROUTE = "/creations/boussolepro/boussole-pro.html";
const OUTPUTS = process.env.BOUSSOLE_PERF_OUTPUT
  ? [path.resolve(process.env.BOUSSOLE_PERF_OUTPUT)]
  : [
      path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome500-browser-performance-benchmark.json"),
      path.join(ROOT, "creations", "boussolepro", "data", "generated", "rome500-experimental", "rome500-browser-performance-benchmark.json")
    ];
const PROFILE_PATH = process.env.BOUSSOLE_PERF_PROFILE_PATH
  ? path.resolve(process.env.BOUSSOLE_PERF_PROFILE_PATH)
  : path.join(ROOT, "tmp", "monde-pro", "profils tests", "boussole-pro-profil-cedric-2026-07-10.json");
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const RUNS_PER_MODE = Number(process.env.BOUSSOLE_PERF_RUNS || 5);
const EXPECTED_JOBS_COUNT = Number(process.env.BOUSSOLE_EXPECTED_JOBS_COUNT || 500);
const CDP_TIMEOUT_MS = Number(process.env.BOUSSOLE_CDP_TIMEOUT_MS || 120000);

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
  await cdp.send("Log.enable");
  const browserEvents = [];
  cdp.on("Runtime.exceptionThrown", params => browserEvents.push({ type: "exception", text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Exception navigateur" }));
  cdp.on("Log.entryAdded", params => {
    if (["error", "warning"].includes(params.entry?.level)) browserEvents.push({ type: "log", level: params.entry.level, text: params.entry.text, url: params.entry.url || null });
  });
  const browserVersion = await cdp.send("Browser.getVersion");
  const { profile, source: profileSource } = await loadPerformanceProfile(PROFILE_PATH);
  profile.hasRequestedResults = true;
  profile.completedBoussole = true;
  profile.jobExperiences = [
    { romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes", recency: "recent", masteryLevel: "advanced", source: "user_direct" },
    { romeCode: "M1805", title: "Études et développement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no", recency: "recent", masteryLevel: "autonomous", source: "user_direct" }
  ];

  const cold = [];
  const warm = [];
  for (let index = 0; index < RUNS_PER_MODE; index += 1) {
    cold.push(await runColdScenario(cdp, appUrl, profile, index + 1));
    console.log(`[Boussole Pro] Essai froid ${index + 1}/${RUNS_PER_MODE} terminé (${cold.at(-1).totalGeneratedLoadMs} ms, ${cold.at(-1).cardsRendered} cartes).`);
  }
  for (let index = 0; index < RUNS_PER_MODE; index += 1) {
    warm.push(await runWarmScenario(cdp, index + 1));
    console.log(`[Boussole Pro] Essai chaud ${index + 1}/${RUNS_PER_MODE} terminé (${warm.at(-1).totalGeneratedLoadMs} ms, ${warm.at(-1).cardsRendered} cartes).`);
  }

  const visualChecks = await runVisualChecks(cdp);
  const httpBrowserEvents = browserEvents.slice();
  const fileFallback = await runFileFallbackCheck(cdp);
  const build = await readBoussoleBuildMetadata();
  const sourceArtifactSha256 = createHash("sha256").update(await readFile(HTML_PATH)).digest("hex");
  const metrics = ["datasetLoadMs", "normalizationMs", "skillIndexBuildMs", "profileScoringMs", "resultsGroupingMs", "resultsUiRenderMs", "resultCardRenderMs", "resultsFirstVisibleMs", "resultsInteractiveMs", "compactExportMs", "totalGeneratedLoadMs", "heapUsedBytes", "cardsRendered"];
  const coldSummary = summarizeRuns(cold, metrics);
  const warmSummary = summarizeRuns(warm, metrics);
  const completionVerdict = [...cold, ...warm].every(run => run.jobsCount === EXPECTED_JOBS_COUNT && run.resultsComputed === EXPECTED_JOBS_COUNT && run.cardsRendered > 0) ? "complete" : "partial";
  const nonRegressionBudget = buildPerformanceBudget(coldSummary, warmSummary);
  const expectedHttpMisses = httpBrowserEvents.filter(isExpectedOptionalResourceMiss);
  const blockingHttpErrors = httpBrowserEvents.filter(item => !isExpectedOptionalResourceMiss(item) && (item.type === "exception" || item.level === "error"));
  const browserJourneyPassed = visualChecks.desktop.allRequiredChecksPassed && visualChecks.mobile.allRequiredChecksPassed && !blockingHttpErrors.length;
  const report = {
    schemaVersion: "2.0.0",
    reportKind: `rome${EXPECTED_JOBS_COUNT}_browser_performance_benchmark`,
    reportDescription: `Benchmark local reproductible : ${RUNS_PER_MODE} chargement(s) froid(s) complet(s) et ${RUNS_PER_MODE} recalcul(s) chaud(s) sur le meme paquet canonique.`,
    completionVerdict,
    validationVerdict: completionVerdict === "complete" && browserJourneyPassed
      ? nonRegressionBudget.coldStatus === "within_budget" && nonRegressionBudget.warmStatus === "within_budget"
        ? "validated"
        : "validated_with_documented_performance_limit"
      : completionVerdict === "complete" ? "complete_with_browser_regression" : "invalid_for_render_validation",
    generatedAt: new Date().toISOString(),
    ...build,
    sourceArtifactSha256,
    runtimeBundleIdentity: cold[0]?.runtimeBundleIdentity || null,
    scenario: {
      browser: browserVersion.product,
      userAgent: browserVersion.userAgent,
      machine: `${process.platform}-${process.arch}`,
      headless: true,
      viewport: { width: 1365, height: 900 },
      profile: "profil technique anonymise",
      profileSource,
      coldRuns: cold.length,
      warmRuns: warm.length,
      servedUrl: appUrl,
      cacheProtocol: {
        cold: "Cache HTTP Chromium vide avant chaque chargement du corpus.",
        warm: "Corpus et index deja charges en memoire ; recalcul et rendu sans navigation ni rechargement JSON.",
        localStorage: "Efface avant chaque essai froid ; non utilise pour les resultats du banc (persist=false)."
      }
    },
    runs: { cold, warm },
    summary: {
      cold: coldSummary,
      warm: warmSummary,
      previousReferenceTotalMs: 11902,
      comparisonMetric: "totalGeneratedLoadMs",
      conclusion: compareToReference(cold, warm, 11902)
    },
    nonRegressionBudget,
    localScalingEstimate: buildScalingEstimate(cold, warm),
    visualChecks,
    loadingModes: {
      localHttpOfflinePackage: { status: visualChecks.desktop.allRequiredChecksPassed && visualChecks.mobile.allRequiredChecksPassed ? "passed" : "failed", corpusJobs: visualChecks.desktop.jobsCount, internetRequired: false },
      distant: { status: "not_tested_in_local_browser_run", reason: "Le contrôle distant n'est pas requis pour valider le paquet local exact." },
      htmlFileOnly: fileFallback
    },
    browserEvents: { http: httpBrowserEvents, expectedOptionalResourceMisses: expectedHttpMisses, blockingHttpErrors },
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

async function loadPerformanceProfile(profilePath) {
  try {
    const envelope = JSON.parse(await readFile(profilePath, "utf8"));
    const profile = envelope.profile || envelope.data || envelope;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new Error("Le profil de performance local ne contient pas un objet exploitable.");
    }
    return { profile, source: "local_file" };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      source: "integrated_fallback",
      profile: {
        profileName: "Profil test - enfance et relation",
        diplomaLevel: 3,
        experienceDomains: ["animation", "petite_enfance", "social"],
        domainOrientation: { animation: "heart", petite_enfance: "heart", social: "heart" },
        skills: ["skill-animation", "skill-early-childhood", "skill-active-listening", "skill-communication"],
        semanticSkillKeys: ["group_animation", "care_relationship", "customer_support"],
        weakSkills: ["skill-data"],
        interests: ["enfants", "transmettre", "accompagner"],
        values: ["care", "meaning", "service"],
        preferredWorkStyles: ["team"],
        preferredEnvironments: ["public_contact"],
        preferredSchedule: "day",
        needForSecurity: "medium",
        needForAutonomy: "medium",
        needForMeaning: "high",
        trainingOpenness: "open_if_meaningful",
        searchHorizon: "open_exploration",
        constraintSeverities: { nightWork: "avoid", heavyLoad: "conditional", noise: "conditional" },
        criterionWeights: { skills: 25, training: 18, constraints: 22, values: 20, context: 10, market: 5 }
      }
    };
  }
}

async function runColdScenario(cdp, url, profile, run) {
  console.log(`[Boussole Pro] Essai froid ${run}/${RUNS_PER_MODE} : navigation initiale.`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Network.clearBrowserCache");
  await navigate(cdp, url);
  await waitForAppReady(cdp, "initialisation avant remise à zéro");
  await evaluate(cdp, "localStorage.clear()");
  await navigate(cdp, url);
  await waitForAppReady(cdp, "initialisation après remise à zéro");
  await evaluate(cdp, `window.__BOUSSOLE_TEST_API__.setProfile(${JSON.stringify(profile)})`);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.resetPerformanceMetrics()");
  console.log(`[Boussole Pro] Essai froid ${run}/${RUNS_PER_MODE} : chargement contrôlé du paquet actif.`);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.loadActiveCandidate()", true);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.measureCompactExport()");
  const browserReport = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.getPerformanceReport()");
  const heap = await cdp.send("Runtime.getHeapUsage");
  return buildRunRow({
    run,
    cacheMode: "cold",
    browserReport,
    heap
  });
}

async function runWarmScenario(cdp, run) {
  console.log(`[Boussole Pro] Essai chaud ${run}/${RUNS_PER_MODE} : recalcul du paquet en mémoire.`);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.resetPerformanceMetrics()");
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.recalculateActiveCandidate()", true);
  await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.measureCompactExport()");
  const browserReport = await evaluate(cdp, "window.__BOUSSOLE_TEST_API__.getPerformanceReport()");
  const heap = await cdp.send("Runtime.getHeapUsage");
  return buildRunRow({ run, cacheMode: "warm", browserReport, heap });
}

function buildRunRow({ run, cacheMode, browserReport, heap }) {
  const values = Object.fromEntries(Object.entries(browserReport.performanceMetrics || {}).map(([key, entry]) => [key, entry?.value ?? null]));
  return {
    run,
    cacheMode,
    ...values,
    heapUsedBytes: Number.isFinite(heap.usedSize) ? heap.usedSize : null,
    measurementStatus: Object.fromEntries([...Object.keys(values), "heapUsedBytes"].map(key => [key, values[key] === null && key !== "heapUsedBytes" ? "not_measured" : "measured"])),
    jobsCount: browserReport.dataset?.jobsCount || 0,
    skillsEngineCount: browserReport.dataset?.skillsEngineCount || 0,
    resultsComputed: browserReport.resultMetrics?.resultsComputed || 0,
    runtimeBundleIdentity: browserReport.runtimeBundleIdentity || null,
    cardsRendered: Number(values.resultCardsRendered) > 0 ? Number(values.resultCardsRendered) : null,
    cardsRenderReason: Number(values.resultCardsRendered) > 0 ? null : "Aucune carte résultat détectée dans la vue Résultats."
  };
}

function buildScalingEstimate(cold, warm) {
  const coldMedian = median(cold.map(run => run.totalGeneratedLoadMs).filter(Number.isFinite).sort((a, b) => a - b));
  const warmMedian = median(warm.map(run => run.totalGeneratedLoadMs).filter(Number.isFinite).sort((a, b) => a - b));
  const project = jobs => ({
    jobs,
    coldTotalMs: Math.round(coldMedian * jobs / EXPECTED_JOBS_COUNT),
    warmRecalculationMs: Math.round(warmMedian * jobs / EXPECTED_JOBS_COUNT)
  });
  return {
    method: `linear_projection_from_local_packaged_${EXPECTED_JOBS_COUNT}_job_benchmark`,
    scope: "local_indicative_only",
    warning: "Projection indicative ; elle ne remplace pas une mesure avec le corpus cible réel.",
    projections: EXPECTED_JOBS_COUNT === 500 ? [project(800), project(1000)] : [project(1000)]
  };
}

async function runVisualChecks(cdp) {
  const inspectMarker = () => evaluate(cdp, `(() => {
    const marker = document.querySelector('[data-build-marker]');
    if (!marker) return { present: false, visible: false, text: null };
    const rect = marker.getBoundingClientRect();
    const style = getComputedStyle(marker);
    return { present: true, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', text: marker.textContent.trim(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight }, fitsViewportWidth: rect.left >= 0 && rect.right <= innerWidth + 1 };
  })()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  const desktop = { ...await inspectMarker(), ...await inspectFinalJourney(cdp) };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  const mobile = { ...await inspectMarker(), ...await inspectFinalJourney(cdp) };
  const print = await cdp.send("Page.printToPDF", { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 });
  return { desktop, mobile, print: { generated: Boolean(print.data), bytesApprox: print.data ? Math.round(print.data.length * 0.75) : 0 } };
}

async function inspectFinalJourney(cdp) {
  return evaluate(cdp, `(() => {
    const visible = element => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    App.state.mainView = 'home';
    renderAll();
    const homeVisible = /Bienvenue dans Boussole Pro/.test(App.dom.resultsContainer?.textContent || '');
    App.state.mainView = 'results';
    renderAll();
    const results = App.state.results || {};
    const featuredCards = [...document.querySelectorAll('.job-card.featured')];
    const domTopOrder = featuredCards.map(card => card.dataset.jobId);
    const expectedTopOrder = (results.top5 || []).map(item => item.jobId);
    const firstResult = (results.top5 || [])[0];
    if (firstResult) openJobDialog(firstResult, 'details');
    const detailText = App.dom.jobDialogContent?.textContent || '';
    const compartmentsVisible = ['Pourquoi ce métier correspond', 'Tes appuis actuels', 'Chemin d’accès', 'Marché par territoire'].every(label => detailText.includes(label));
    App.dom.jobDialog?.close?.();
    const variantResult = (results.top5 || []).find(item => (results.variantsByJob?.[item.jobId] || []).length);
    if (variantResult) openJobDialog(variantResult, 'variants');
    const variantsOpened = !variantResult || /Variantes proches/.test(App.dom.jobDialogContent?.textContent || '');
    App.dom.jobDialog?.close?.();
    const excludedResult = (results.excluded || [])[0];
    if (excludedResult) openJobDialog(excludedResult, 'details');
    const excludedText = App.dom.jobDialogContent?.textContent || '';
    const excludedOpenedWithReason = !excludedResult || (/Pourquoi cette piste est mise à part/.test(excludedText) && (excludedResult.exclusionReasons || []).some(item => excludedText.includes(item.message || item.label || item.code)));
    App.dom.jobDialog?.close?.();
    const completeListPresent = (results.resultsViewModel?.completeList || []).length === 1000;
    const followingPathsPresent = (results.resultsViewModel?.recommendedPaths || []).length > 0 || (results.resultsViewModel?.dreamPaths || []).length > 0 || (results.resultsViewModel?.exploratoryPaths || []).length > 0;
    App.state.mainView = 'exploration';
    App.state.explorationFilters.query = 'G1203';
    renderAll();
    const codeSearchText = document.querySelector('[data-exploration-job-list]')?.textContent || '';
    const codeSearchPassed = codeSearchText.includes('G1203');
    const titleTarget = App.state.dataset.jobs.find(job => job.romeCode === 'G1203') || App.state.dataset.jobs[0];
    App.state.explorationFilters.query = titleTarget?.title || '';
    renderExplorationResultsInPlace();
    const titleSearchText = document.querySelector('[data-exploration-job-list]')?.textContent || '';
    const titleSearchPassed = Boolean(titleTarget?.title) && titleSearchText.includes(titleTarget.title);
    const explorationControl = document.querySelector('[data-exploration-filter="query"]');
    const explorationControlAccessible = visible(explorationControl);
    App.state.explorationFilters.query = '';
    App.state.mainView = 'results';
    renderAll();
    const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 2;
    const profileLoaded = Boolean(App.state.profile?.profileName);
    const jobsCount = App.state.dataset?.jobs?.length || 0;
    const allRequiredChecksPassed = [
      homeVisible,
      profileLoaded,
      jobsCount === 1000,
      featuredCards.length > 0,
      JSON.stringify(domTopOrder) === JSON.stringify(expectedTopOrder),
      compartmentsVisible,
      variantsOpened,
      excludedOpenedWithReason,
      completeListPresent,
      followingPathsPresent,
      codeSearchPassed,
      titleSearchPassed,
      explorationControlAccessible,
      !horizontalOverflow
    ].every(Boolean);
    return {
      homeVisible,
      profileLoaded,
      profileName: App.state.profile?.profileName || null,
      jobsCount,
      resultsComputed: results.completeList?.length || 0,
      top5Count: expectedTopOrder.length,
      top5Order: expectedTopOrder,
      domTopOrder,
      compartmentsVisible,
      variantsOpened,
      followingPathsPresent,
      excludedOpenedWithReason,
      completeListPresent,
      codeSearchPassed,
      titleSearchPassed,
      explorationControlAccessible,
      horizontalOverflow,
      allRequiredChecksPassed
    };
  })()`);
}

async function runFileFallbackCheck(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, pathToFileURL(HTML_PATH).href);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await evaluate(cdp, "Boolean(window.__BOUSSOLE_TEST_API__) && !document.body.hasAttribute('aria-busy')");
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return evaluate(cdp, `(() => {
    const identity = window.__BOUSSOLE_TEST_API__?.getRuntimeIdentity?.() || {};
    const jobs = identity.counts?.jobs || 0;
    return {
      status: jobs > 150 && jobs < 300 ? 'passed_historical_embedded_fallback' : 'unexpected_corpus',
      corpusJobs: jobs,
      expectedMode: 'embedded_historical_fallback_about_210_jobs',
      build: window.__BOUSSOLE_TEST_API__?.getBuildMetadata?.() || null,
      note: 'Le HTML seul ne prétend pas fournir ROME1000 ; le paquet JSON servi localement est le mode ROME1000 hors connexion.'
    };
  })()`);
}

function summarizeRuns(runs, metrics) {
  return Object.fromEntries(metrics.map(metric => {
    const rawValues = runs.map(run => run[metric]);
    const values = rawValues.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (!values.length) return [metric, { minimum: null, median: null, mean: null, maximum: null, p95: null, rawValues, measurementStatus: "not_measured" }];
    return [metric, {
      minimum: values[0],
      median: median(values),
      mean: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      maximum: values.at(-1),
      p95: percentile(values, 0.95),
      rawValues,
      measurementStatus: "measured"
    }];
  }));
}

function percentile(values, ratio) {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
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

function buildPerformanceBudget(coldSummary, warmSummary) {
  if (EXPECTED_JOBS_COUNT === 1000) {
    const maximumColdMedianMs = 60000;
    const maximumWarmMedianMs = 2500;
    return {
      basis: "v0.8.4_known_rome1000_limit_with_headless_machine_margin",
      documentedColdRangeMs: [33000, 46000],
      maximumColdMedianMs,
      maximumWarmMedianMs,
      coldStatus: coldSummary.totalGeneratedLoadMs.median <= maximumColdMedianMs ? "within_budget" : "regressed",
      warmStatus: warmSummary.totalGeneratedLoadMs.median <= maximumWarmMedianMs ? "within_budget" : "regressed",
      optimizationScope: "reported_not_addressed_in_final_freeze"
    };
  }
  const allowedScalingRatio = 1.1;
  const maximumColdMedianMs = Math.round(10366 * allowedScalingRatio);
  const maximumWarmMedianMs = Math.round(700 * allowedScalingRatio);
  return {
    basis: "rome500_historical_non_regression",
    previousColdMedianMs: 10366,
    previousWarmMedianMs: 700,
    allowedScalingRatio,
    maximumColdMedianMs,
    maximumWarmMedianMs,
    coldStatus: coldSummary.totalGeneratedLoadMs.median <= maximumColdMedianMs ? "within_budget" : "regressed",
    warmStatus: warmSummary.totalGeneratedLoadMs.median <= maximumWarmMedianMs ? "within_budget" : "regressed"
  };
}

function isExpectedOptionalResourceMiss(item = {}) {
  if (item.type !== "log" || item.level !== "error" || !/404/.test(item.text || "")) return false;
  const url = item.url || "";
  return /\/favicon\.ico(?:$|\?)/.test(url)
    || /\/rome1000-candidate\/skill-concept-impact-report\.json(?:$|\?)/.test(url)
    || /\/rome1000-candidate\/market\//.test(url);
}

async function navigate(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await withTimeout(loaded, `chargement de ${url}`);
  await evaluate(cdp, "document.readyState === 'complete'");
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await withTimeout(
    cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true }),
    `Runtime.evaluate (${expression.slice(0, 80)})`
  );
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Erreur Runtime.evaluate");
  return response.result?.value;
}

async function waitForAppReady(cdp, stage) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CDP_TIMEOUT_MS) {
    const state = await evaluate(cdp, `(() => ({
      apiReady: Boolean(window.__BOUSSOLE_TEST_API__),
      busy: document.body?.getAttribute('aria-busy') === 'true',
      readyState: document.readyState,
      jobsCount: window.App?.state?.dataset?.jobs?.length || 0
    }))()`);
    if (state?.apiReady && !state.busy && state.readyState === "complete") {
      console.log(`[Boussole Pro] ${stage} terminée (${state.jobsCount} métiers disponibles).`);
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`[Boussole Pro] Délai dépassé pendant ${stage}.`);
}

function withTimeout(promise, label, timeoutMs = CDP_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`[Boussole Pro] Délai CDP dépassé : ${label}.`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
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
  const persistentListeners = new Map();
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
    (persistentListeners.get(message.method) || []).forEach(callback => callback(message.params || {}));
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
    on(method, callback) {
      persistentListeners.set(method, [...(persistentListeners.get(method) || []), callback]);
    },
    close() {
      socket.close();
    }
  };
}
