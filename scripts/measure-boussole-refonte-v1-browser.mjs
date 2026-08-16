import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/refonte-interface-v1");
const CAPTURE_DIR = path.join(REPORT_DIR, "captures");
const REPORT_PATH = path.join(REPORT_DIR, "browser-accessibility-performance-report.json");
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const html = await readFile(HTML_PATH);

await mkdir(CAPTURE_DIR, { recursive: true });
const server = await startServer(ROOT);
const debugPort = 9800 + Math.floor(Math.random() * 120);
const chromium = spawn(CHROMIUM, [
  "--headless", "--no-sandbox", "--disable-gpu", "--password-store=basic", "--allow-file-access-from-files",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/boussole-refonte-v1-${process.pid}`, "about:blank"
], { stdio: "ignore" });

const failures = [];
const consoleErrors = [];
const runtimeErrors = [];
const networkErrors = [];
const assertions = [];
const assert = (name, condition, details = null) => {
  assertions.push({ name, status: condition ? "passed" : "failed", details });
  if (!condition) failures.push(name);
};

try {
  const target = await waitForPageTarget(debugPort);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Network.enable"), cdp.send("Log.enable")]);
  cdp.on("Runtime.exceptionThrown", params => runtimeErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "runtime_exception"));
  cdp.on("Runtime.consoleAPICalled", params => {
    if (params.type === "error") consoleErrors.push(params.args?.map(arg => arg.value || arg.description).join(" ") || "console_error");
  });
  cdp.on("Network.loadingFailed", params => {
    if (!params.canceled) networkErrors.push({ url: params.requestId, errorText: params.errorText, type: params.type });
  });

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const httpUrl = `http://127.0.0.1:${server.address().port}/creations/boussolepro/boussole-pro.html`;
  await navigate(cdp, httpUrl);
  await waitForApi(cdp);
  await evaluate(cdp, "localStorage.clear()");
  await navigate(cdp, httpUrl);
  await waitForApi(cdp);

  const initial = await evaluate(cdp, `(() => ({
    state: window.__BOUSSOLE_REFONTE_TEST_API__.getState(),
    mainText: document.querySelector("main")?.innerText || "",
    jobs: window.__BOUSSOLE_REFONTE_BUILD__.jobsCount,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }))()`);
  assert("desktop_initial_profile_absent", initial.state.profileExists === false, initial.state);
  assert("embedded_100_jobs", initial.jobs === 100, initial.jobs);
  assert("desktop_no_horizontal_overflow", initial.overflow <= 1, initial.overflow);
  assert("home_state_visible", initial.mainText.includes("Boussole absente") && initial.mainText.includes("100 métiers réels embarqués"));
  await capture(cdp, "01-accueil-bureau.png");

  const noProfileSearch = await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.search("G1202")`);
  assert("exploration_without_profile", noProfileSearch.includes("G1202"), noProfileSearch);

  const importPolicy = await evaluate(cdp, `(() => {
    const legacy = {
      profileName: "Profil ancien",
      ageRange: "36_45",
      diplomaLevel: 5,
      trainingOpenness: "short",
      trainingFamilies: ["animation", "famille-invisible"],
      interests: ["creer", "interet-invisible"],
      values: ["service", "valeur-invisible"],
      preferredWorkStyles: ["creative", "style-invisible"],
      preferredEnvironments: ["quiet", "cadre-invisible"],
      customSkills: ["Animation d'atelier"],
      skills: ["skill-hidden-sentinel"],
      skillSignals: [{ id: "hidden-signal" }],
      needForMeaning: "high",
      contextPreferences: { hidden: "important" },
      criterionWeights: { skills: 99, training: 0, constraints: 0, values: 0, context: 0, market: 1 },
      futureHiddenField: { sentinel: true },
      jobExperiences: [{ id: "legacy-exp", jobId: "rome-G1202", romeCode: "G1202", title: "Animateur / Animatrice d'atelier artistique ou ludique", durationYears: 3, isCurrent: false, recency: "old", masteryLevel: "expert", enjoymentLevel: "love", wantsToContinue: "yes" }]
    };
    const profile = window.__BOUSSOLE_REFONTE_TEST_API__.importProfileData(legacy);
    const state = window.__BOUSSOLE_REFONTE_TEST_API__.getState();
    return { profile, state };
  })()`);
  assert("legacy_visible_fields_imported", importPolicy.profile.profileName === "Profil ancien" && importPolicy.profile.interests.includes("creer") && importPolicy.profile.customSkills.includes("Animation d'atelier"), importPolicy.profile);
  assert("legacy_hidden_fields_ignored", importPolicy.profile.skills.length === 0 && importPolicy.profile.skillSignals.length === 0 && importPolicy.profile.needForMeaning === "not_specified" && !importPolicy.profile.futureHiddenField && !importPolicy.profile.interests.includes("interet-invisible") && importPolicy.profile.jobExperiences[0]?.masteryLevel === "autonomous" && importPolicy.profile.jobExperiences[0]?.enjoymentLevel === "neutral" && importPolicy.profile.jobExperiences[0]?.wantsToContinue === "maybe", importPolicy.profile);
  assert("legacy_snapshot_separate_from_active_profile", importPolicy.state.importedSnapshot === true, importPolicy.state);

  const clearedProfile = await evaluate(cdp, `(() => {
    localStorage.setItem("boussole_pro_profile_v1", JSON.stringify({ app: "boussole-pro-profile", data: { profileName: "Profil classique rémanent", skills: ["skill-must-not-return"], interests: ["proteger"] } }));
    window.confirm = () => true;
    RefonteApp.clearLocalData();
    return { state: window.__BOUSSOLE_REFONTE_TEST_API__.getState(), stored: JSON.parse(localStorage.getItem("luuma_boussole_pro_refonte_v1") || "null") };
  })()`);
  assert("clear_removes_active_and_imported_profile", clearedProfile.state.profileExists === false && clearedProfile.state.importedSnapshot === false && clearedProfile.stored?.profile === null && clearedProfile.stored?.importedSnapshot === null, clearedProfile);
  assert("clear_records_legacy_import_dismissal", clearedProfile.state.legacyImportDismissed === true && clearedProfile.stored?.legacyImportDismissed === true, clearedProfile);
  await navigate(cdp, httpUrl);
  await waitForApi(cdp);
  const afterReload = await evaluate(cdp, `(() => ({ state: window.__BOUSSOLE_REFONTE_TEST_API__.getState(), profile: window.__BOUSSOLE_REFONTE_TEST_API__.getProfile() }))()`);
  assert("cleared_profile_not_reimported_from_classic", afterReload.state.profileExists === false && afterReload.state.importedSnapshot === false && afterReload.profile.skills.length === 0, afterReload);
  const newProfile = await evaluate(cdp, `(() => ({ profile: window.__BOUSSOLE_REFONTE_TEST_API__.startNewProfile(), state: window.__BOUSSOLE_REFONTE_TEST_API__.getState() }))()`);
  assert("new_profile_starts_without_legacy_data", newProfile.state.profileExists === true && newProfile.state.importedSnapshot === false && newProfile.profile.skills.length === 0 && newProfile.profile.skillSignals.length === 0 && newProfile.profile.needForMeaning === "not_specified", newProfile);

  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.loadDemoProfile()`);
  await waitForSelector(cdp, ".top-list li");
  const calculation = await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.calculate()`);
  const resultUi = await evaluate(cdp, `(() => ({
    topCount: document.querySelectorAll(".top-list li").length,
    tabs: document.querySelectorAll('[role="tab"]').length,
    cards: document.querySelectorAll(".job-card").length,
    top: window.__BOUSSOLE_REFONTE_TEST_API__.calculate().top5,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    unnamedButtons: [...document.querySelectorAll("button")].filter(button => !(button.innerText.trim() || button.getAttribute("aria-label") || button.getAttribute("title"))).length,
    duplicateIds: [...document.querySelectorAll("[id]")].map(node => node.id).filter((id, index, all) => all.indexOf(id) !== index)
  }))()`);
  assert("top5_rendered", resultUi.topCount === 5 && resultUi.top.length === 5, resultUi.top);
  assert("seven_result_families", resultUi.tabs === 7, resultUi.tabs);
  assert("result_cards_rendered", resultUi.cards > 0, resultUi.cards);
  assert("results_no_horizontal_overflow", resultUi.overflow <= 1, resultUi.overflow);
  assert("buttons_have_accessible_names", resultUi.unnamedButtons === 0, resultUi.unnamedButtons);
  assert("no_duplicate_ids", resultUi.duplicateIds.length === 0, resultUi.duplicateIds);
  await capture(cdp, "03-resultats-bureau.png");

  const dialogOpen = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(".top-list button");
    trigger.focus(); trigger.click();
    const dialog = document.getElementById("jobDialog");
    return { open: dialog.open, focusInside: dialog.contains(document.activeElement), title: document.getElementById("jobDialogTitle")?.textContent, triggerText: trigger.textContent.trim() };
  })()`);
  assert("job_dialog_fullscreen_open", dialogOpen.open && dialogOpen.title, dialogOpen);
  assert("dialog_initial_focus", dialogOpen.focusInside, dialogOpen);
  await capture(cdp, "07-fiche-metier-bureau.png");
  const focusRestored = await evaluate(cdp, `new Promise(resolve => { document.getElementById("jobDialog").close(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.activeElement?.matches(".top-list button") || false))); })`, true);
  assert("dialog_focus_restored", focusRestored === true, focusRestored);

  const modeInvariant = await evaluate(cdp, `(() => {
    const before = window.__BOUSSOLE_REFONTE_TEST_API__.calculate().top5;
    window.__BOUSSOLE_REFONTE_TEST_API__.setMode("companion");
    const companion = window.__BOUSSOLE_REFONTE_TEST_API__.calculate().top5;
    window.__BOUSSOLE_REFONTE_TEST_API__.setMode("debug");
    const after = window.__BOUSSOLE_REFONTE_TEST_API__.calculate().top5;
    return { before, companion, after, same: JSON.stringify(before) === JSON.stringify(companion) && JSON.stringify(before) === JSON.stringify(after) };
  })()`);
  assert("mode_does_not_change_results", modeInvariant.same, modeInvariant);

  const theme = await evaluate(cdp, `(() => { RefonteApp.setTheme("dark"); const dark=document.body.dataset.theme==="dark"; RefonteApp.setTheme("light"); return { dark, restored: document.body.dataset.theme==="light" }; })()`);
  assert("day_night_theme", theme.dark && theme.restored, theme);

  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("boussole")`);
  await waitForSelector(cdp, ".stepper");
  const focusInput = await evaluate(cdp, `(() => { const input=document.getElementById("profileName"); input.focus(); input.value="Test focus"; input.dispatchEvent(new Event("input",{bubbles:true})); return document.activeElement===input; })()`);
  assert("profile_input_keeps_focus", focusInput === true, focusInput);
  await capture(cdp, "02-ma-boussole-bureau.png");
  const experienceInputs = await evaluate(cdp, `(() => {
    RefonteApp.state.profile.jobExperiences=[{id:"focus-test",jobId:"rome-G1202",romeCode:"G1202",title:"Animateur / Animatrice d'atelier artistique ou ludique",durationYears:2,isCurrent:false,recency:"not_specified",masteryLevel:"autonomous",enjoymentLevel:"like",wantsToContinue:"maybe",source:"browser_test"}];
    RefonteApp.state.step=3; RefonteApp.render();
    const years=document.querySelector('[data-job-experience="durationYears"]'); years.focus(); years.value="4"; years.dispatchEvent(new Event("change",{bubbles:true}));
    const focusKept=document.activeElement===years && RefonteApp.state.profile.jobExperiences[0].durationYears===4;
    const current=document.querySelector('[data-job-experience="isCurrent"]'); current.checked=true; current.dispatchEvent(new Event("change",{bubbles:true})); current.checked=false; current.dispatchEvent(new Event("change",{bubbles:true}));
    return { focusKept, currentUnchecked: RefonteApp.state.profile.jobExperiences[0].isCurrent===false && current.checked===false };
  })()`);
  assert("experience_years_keep_focus", experienceInputs.focusKept, experienceInputs);
  assert("current_job_can_be_unchecked", experienceInputs.currentUnchecked, experienceInputs);

  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("exploration")`);
  await waitForSelector(cdp, ".direction-grid");
  const exploration = await evaluate(cdp, `(() => ({ directions: document.querySelectorAll(".direction-button").length, rows: document.querySelectorAll(".compact-row").length, queryResult: window.__BOUSSOLE_REFONTE_TEST_API__.search("animateur") }))()`);
  assert("exploration_17_directions", exploration.directions === 17, exploration.directions);
  assert("exploration_paginated_rows", exploration.rows > 0 && exploration.rows <= 12, exploration.rows);
  assert("search_title_or_appellation", exploration.queryResult.length > 0, exploration.queryResult);
  await capture(cdp, "04-exploration-bureau.png");

  await evaluate(cdp, `(() => { RefonteApp.toggleFavorite("rome-G1202"); RefonteApp.toggleFavorite("rome-K1203"); RefonteApp.toggleCompare("rome-G1202"); RefonteApp.toggleCompare("rome-K1203"); window.__BOUSSOLE_REFONTE_TEST_API__.navigate("liste"); })()`);
  await waitForSelector(cdp, "main");
  const listState = await evaluate(cdp, `(() => ({ ...window.__BOUSSOLE_REFONTE_TEST_API__.getState(), comparisonVisible: Boolean(document.querySelector(".compare-table")), storageSaved: Boolean(localStorage.getItem("luuma_boussole_pro_refonte_v1")) }))()`);
  assert("favorites_persist_in_state", listState.favorites.length >= 1, listState.favorites);
  assert("compare_two_jobs", listState.comparisonVisible === true, listState);
  assert("local_storage_saved", listState.storageSaved === true, listState.storageSaved);
  await capture(cdp, "05-ma-liste-bureau.png");

  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("menu")`);
  await capture(cdp, "06-menu-bureau.png");

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("resultats")`);
  await waitForSelector(cdp, ".top-list");
  const mobile = await evaluate(cdp, `(() => ({ overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth, mobileNav: getComputedStyle(document.getElementById("mobileNav")).display, buttonsTooSmall: [...document.querySelectorAll("button")].filter(button => { const r=button.getBoundingClientRect(); return r.width>0 && r.height>0 && (r.width<24 || r.height<24); }).length }))()`);
  assert("mobile_no_horizontal_overflow", mobile.overflow <= 1, mobile.overflow);
  assert("mobile_navigation_visible", mobile.mobileNav !== "none", mobile.mobileNav);
  assert("minimum_target_size", mobile.buttonsTooSmall === 0, mobile.buttonsTooSmall);
  await capture(cdp, "08-resultats-mobile.png");
  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("exploration")`);
  await capture(cdp, "09-exploration-mobile.png");

  const a11y = await evaluate(cdp, `(() => ({
    landmarks: { main: document.querySelectorAll("main").length, nav: document.querySelectorAll("nav").length },
    inputsWithoutLabel: [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(input => !(input.labels?.length || input.getAttribute("aria-label") || input.getAttribute("aria-labelledby"))).length,
    svgInformativeWithoutText: [...document.querySelectorAll('svg[role="img"]')].filter(svg => !svg.querySelector("title") && !svg.getAttribute("aria-label")).length,
    reducedMotionQuerySupported: matchMedia("(prefers-reduced-motion: reduce)").media.includes("prefers-reduced-motion")
  }))()`);
  assert("semantic_landmarks", a11y.landmarks.main === 1 && a11y.landmarks.nav >= 1, a11y.landmarks);
  assert("form_controls_labeled", a11y.inputsWithoutLabel === 0, a11y.inputsWithoutLabel);
  assert("informative_svg_has_text", a11y.svgInformativeWithoutText === 0, a11y.svgInformativeWithoutText);
  assert("reduced_motion_supported", a11y.reducedMotionQuerySupported === true);

  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await navigate(cdp, pathToFileURL(HTML_PATH).href);
  await waitForApi(cdp, 240);
  const offline = await evaluate(cdp, `(() => ({ build: window.__BOUSSOLE_REFONTE_TEST_API__.build(), state: window.__BOUSSOLE_REFONTE_TEST_API__.getState(), text: document.querySelector("main")?.innerText || "" }))()`);
  assert("file_offline_boot", offline.build.jobsCount === 100 && offline.text.length > 50, offline);
  await capture(cdp, "10-hors-ligne-file-mobile.png");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  const report = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_refonte_v1_browser_accessibility_performance",
    generatedAt: new Date().toISOString(),
    status: failures.length || runtimeErrors.length || consoleErrors.length ? "failed" : "passed",
    html: { path: path.relative(ROOT, HTML_PATH), bytes: html.length, sha256: sha256(html) },
    browser: { chromium: CHROMIUM, desktop: "1440x1000", mobile: "390x844", httpUrl, offlineUrl: pathToFileURL(HTML_PATH).href },
    performance: { calculationMs: calculation.calculationMs, navigation: await evaluate(cdp, `(() => { const n=performance.getEntriesByType("navigation")[0]; return n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) } : null; })()`) },
    scenarios: { initial, resultUi, dialogOpen, modeInvariant, exploration, mobile, a11y, offline: { jobs: offline.build.jobsCount, profileExists: offline.state.profileExists } },
    captures: (await listCaptureNames()).map(name => path.relative(ROOT, path.join(CAPTURE_DIR, name))),
    assertions,
    errors: { console: consoleErrors, runtime: runtimeErrors, network: networkErrors },
    failures: [...failures, ...runtimeErrors.map(() => "runtime_error"), ...consoleErrors.map(() => "console_error")]
  };
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures: report.failures, captures: report.captures.length, report: path.relative(ROOT, REPORT_PATH) }, null, 2));
  cdp.close();
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  chromium.kill("SIGTERM");
  await closeServer(server);
}

async function capture(cdp, name) {
  await evaluate(cdp, `document.getElementById("toast")?.classList.remove("visible")`);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(CAPTURE_DIR, name), Buffer.from(result.data, "base64"));
}

async function listCaptureNames() {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(CAPTURE_DIR)).filter(name => name.endsWith(".png")).sort();
}

async function startServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname === "/" ? "/creations/boussolepro/boussole-pro.html" : pathname}`);
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
async function navigate(cdp, url) { const loaded = cdp.once("Page.loadEventFired"); await cdp.send("Page.navigate", { url }); await loaded; }
async function evaluate(cdp, expression, awaitPromise = false) { const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result?.value; }
async function waitForApi(cdp, attempts = 700) { for (let attempt = 0; attempt < attempts; attempt += 1) { try { if (await evaluate(cdp, "Boolean(window.__BOUSSOLE_REFONTE_TEST_API__)") ) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } const state = await evaluate(cdp, `(() => ({ readyState: document.readyState, title: document.title, main: document.querySelector("main")?.innerText?.slice(0, 300) || "" }))()`); throw new Error(`API de test de la refonte indisponible : ${JSON.stringify(state)}`); }
async function waitForSelector(cdp, selector, attempts = 100) { for (let attempt = 0; attempt < attempts; attempt += 1) { if (await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return; await new Promise(resolve => setTimeout(resolve, 80)); } throw new Error(`Selecteur absent : ${selector}`); }
async function waitForPageTarget(port) { for (let attempt = 0; attempt < 100; attempt += 1) { try { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()); const page = pages.find(item => item.type === "page"); if (page) return page; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error("Chromium CDP indisponible."); }

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const onceListeners = new Map();
  const persistent = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) { const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result || {}); return; }
    (persistent.get(message.method) || []).forEach(listener => listener(message.params || {}));
    const queue = onceListeners.get(message.method) || [];
    onceListeners.set(message.method, []);
    queue.forEach(resolve => resolve(message.params || {}));
  });
  return {
    send(method, params = {}) { const requestId = ++id; socket.send(JSON.stringify({ id: requestId, method, params })); return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject })); },
    once(method) { return new Promise(resolve => onceListeners.set(method, [...(onceListeners.get(method) || []), resolve])); },
    on(method, listener) { persistent.set(method, [...(persistent.get(method) || []), listener]); },
    close() { socket.close(); }
  };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
