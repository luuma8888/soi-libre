import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const OFFLINE_HTML_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro-offline.html");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/boussole-v1.6.0");
const CAPTURE_DIR = path.join(REPORT_DIR, "captures");
const REPORT_PATH = path.join(REPORT_DIR, "browser-interaction-report.json");
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
    build: window.__BOUSSOLE_REFONTE_TEST_API__.build(),
    mainText: document.querySelector("main")?.innerText || "",
    runtimeStatus: document.getElementById("runtimeStatus")?.innerText || "",
    jobs: window.__BOUSSOLE_REFONTE_BUILD__.jobsCount,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }))()`);
  assert("desktop_initial_profile_absent", initial.state.profileExists === false, initial.state);
  assert("external_runtime_1000_jobs", initial.jobs === 1000 && initial.state.datasetMode === "external_runtime", initial);
  assert("desktop_no_horizontal_overflow", initial.overflow <= 1, initial.overflow);
  assert("home_state_visible", initial.mainText.includes("Boussole absente") && initial.mainText.includes("1000 métiers chargés en ligne"));
  assert("online_runtime_clearly_identified", initial.mainText.includes("ont été téléchargés") && initial.runtimeStatus.includes("Données en ligne validées"), initial);
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
      jobExperiences: [{ id: "legacy-exp", jobId: "rome-G1202", romeCode: "G1202", title: "Animateur / Animatrice d'atelier artistique ou ludique", durationYears: 3, isCurrent: false, recency: "old", masteryLevel: "expert", enjoymentLevel: "love", wantsToContinue: "yes" }, { id: "neutral-exp", jobId: "rome-A1101", romeCode: "A1101", title: "Conducteur / Conductrice d'engins agricoles" }]
    };
    const profile = window.__BOUSSOLE_REFONTE_TEST_API__.importProfileData(legacy);
    const state = window.__BOUSSOLE_REFONTE_TEST_API__.getState();
    return { profile, state };
  })()`);
  assert("legacy_visible_fields_imported", importPolicy.profile.profileName === "Profil ancien" && importPolicy.profile.interests.includes("creer") && importPolicy.profile.unresolvedCustomSkills.includes("Animation d'atelier") && importPolicy.profile.customSkills.length === 0, importPolicy.profile);
  assert("legacy_hidden_fields_ignored", importPolicy.profile.skills.length === 0 && importPolicy.profile.skillSignals.length === 0 && importPolicy.profile.needForMeaning === "not_specified" && !importPolicy.profile.futureHiddenField && !importPolicy.profile.interests.includes("interet-invisible") && !importPolicy.profile.constraints.some(item => item.value === "longTraining"), importPolicy.profile);
  assert("visible_experience_details_preserved", importPolicy.profile.jobExperiences[0]?.masteryLevel === "expert" && importPolicy.profile.jobExperiences[0]?.enjoymentLevel === "love" && importPolicy.profile.jobExperiences[0]?.wantsToContinue === "yes", importPolicy.profile.jobExperiences[0]);
  assert("missing_experience_details_stay_neutral", importPolicy.profile.jobExperiences[1]?.durationYears === null && importPolicy.profile.jobExperiences[1]?.recency === "not_specified" && importPolicy.profile.jobExperiences[1]?.masteryLevel === "not_specified" && importPolicy.profile.jobExperiences[1]?.enjoymentLevel === "not_specified" && importPolicy.profile.jobExperiences[1]?.wantsToContinue === "not_specified", importPolicy.profile.jobExperiences[1]);
  assert("legacy_snapshot_separate_from_active_profile", importPolicy.state.importedSnapshot === true, importPolicy.state);
  const roundTrip = await evaluate(cdp, `(() => { const before=window.__BOUSSOLE_REFONTE_TEST_API__.getProfile(); const envelope={ profile: before }; const after=window.__BOUSSOLE_REFONTE_TEST_API__.importProfileData(envelope.profile); return { equal: JSON.stringify(before) === JSON.stringify(after), profile: after }; })()`);
  assert("active_profile_import_export_import_identity", roundTrip.equal === true, roundTrip.equal);

  const importedPersistence = await evaluate(cdp, `(() => {
    localStorage.setItem("boussole_pro_profile_v1", JSON.stringify({ app:"boussole-pro-profile", revision:0, savedAt:new Date(Date.now()+60000).toISOString(), profile:{ profileName:"Ancien profil local", interests:["proteger"] } }));
    const skill=RefonteApp.state.skillIndex[0];
    const imported={ profileName:"Profil importé persistant", interests:["creer"], values:["service"], preferredEnvironments:["quiet"], skillSelections:[{ skillId:skill.id, label:skill.label, currentLevel:"practiced", futureWish:"develop", source:"user_direct", suggestedFromRomeCodes:[] }] };
    window.__BOUSSOLE_REFONTE_TEST_API__.importProfileData(imported);
    const stored=JSON.parse(localStorage.getItem(RefonteApp.config.storageKey));
    return { skillId:skill.id, revision:stored.revision, savedAt:stored.savedAt, storageSchemaVersion:stored.storageSchemaVersion, profileName:stored.profile?.profileName, skill:stored.profile?.skillSelections?.find(row=>row.skillId===skill.id), saveLine:document.getElementById("saveLine")?.innerText || "" };
  })()`);
  assert("import_saved_immediately_with_revision", importedPersistence.revision > 0 && importedPersistence.savedAt && importedPersistence.storageSchemaVersion === "2.0.0" && importedPersistence.profileName === "Profil importé persistant" && importedPersistence.skill?.currentLevel === "practiced" && importedPersistence.skill?.futureWish === "develop", importedPersistence);
  await navigate(cdp, httpUrl);
  await waitForApi(cdp);
  const importedAfterReload = await evaluate(cdp, `(() => { const profile=window.__BOUSSOLE_REFONTE_TEST_API__.getProfile(); const stored=JSON.parse(localStorage.getItem(RefonteApp.config.storageKey)); return { profileName:profile.profileName, skill:profile.skillSelections.find(row=>row.skillId===${JSON.stringify(importedPersistence.skillId)}), revision:stored.revision, saveLine:(()=>{ window.__BOUSSOLE_REFONTE_TEST_API__.navigate("boussole"); return document.getElementById("saveLine")?.innerText || ""; })() }; })()`);
  assert("import_survives_reload_and_beats_stale_profile", importedAfterReload.profileName === "Profil importé persistant" && importedAfterReload.skill?.currentLevel === "practiced" && importedAfterReload.skill?.futureWish === "develop" && importedAfterReload.revision === importedPersistence.revision, importedAfterReload);
  assert("local_save_confirmation_visible", importedAfterReload.saveLine.startsWith("Enregistré localement à "), importedAfterReload.saveLine);

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

  const progressVisible = await evaluate(cdp, `(() => { window.__BOUSSOLE_REFONTE_TEST_API__.loadDemoProfile(); return Boolean(document.querySelector(".loading")); })()`);
  assert("perceptible_calculation_has_progress", progressVisible === true, progressVisible);
  await waitForSelector(cdp, ".top-list li");
  const calculation = await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.calculate()`);
  const resultUi = await evaluate(cdp, `(() => ({
    topCount: document.querySelectorAll(".top-list li").length,
    tabs: document.querySelectorAll('[role="tab"]').length,
    cards: document.querySelectorAll(".job-card").length,
    top: window.__BOUSSOLE_REFONTE_TEST_API__.calculate().top5,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    unnamedButtons: [...document.querySelectorAll("button")].filter(button => !(button.textContent.trim() || button.getAttribute("aria-label") || button.getAttribute("title"))).length,
    duplicateIds: [...document.querySelectorAll("[id]")].map(node => node.id).filter((id, index, all) => all.indexOf(id) !== index)
  }))()`);
  assert("top5_rendered", resultUi.topCount === 5 && resultUi.top.length === 5, resultUi.top);
  assert("seven_result_families", resultUi.tabs === 7, resultUi.tabs);
  assert("result_cards_rendered", resultUi.cards > 0, resultUi.cards);
  assert("results_no_horizontal_overflow", resultUi.overflow <= 1, resultUi.overflow);
  assert("buttons_have_accessible_names", resultUi.unnamedButtons === 0, resultUi.unnamedButtons);
  assert("no_duplicate_ids", resultUi.duplicateIds.length === 0, resultUi.duplicateIds);
  const exportContract = await evaluate(cdp, `(async () => {
    const api=window.__BOUSSOLE_REFONTE_TEST_API__;
    const snapshot=api.buildProfileResultsSnapshot();
    const markdown=api.profileResultsSnapshotToMarkdown(snapshot);
    let rejection=""; const originalToast=RefonteApp.toast; RefonteApp.toast=message=>{rejection=message;};
    await RefonteApp.importProfile(new File([JSON.stringify(snapshot)],"resultats.json",{type:"application/json"})); RefonteApp.toast=originalToast;
    return {snapshot,markdown,rejection,bytes:new TextEncoder().encode(JSON.stringify(snapshot)).length,menuButtons:document.querySelectorAll('[data-action="export-profile-results"]').length};
  })()`, true);
  assert("results_snapshot_json_contract", exportContract.snapshot.schemaVersion === "1.0.0" && exportContract.snapshot.app === "boussole-pro" && exportContract.snapshot.exportKind === "profile_results_snapshot" && exportContract.snapshot.importable === false && exportContract.snapshot.appVersion === "1.6.0" && exportContract.snapshot.scoringVersion === "personal-fit-v2" && exportContract.snapshot.results.length === 1000 && exportContract.snapshot.results.every((row, index) => row.rank === index + 1 && row.title && /^[A-Z][0-9]{4}$/.test(row.romeCode) && Number.isFinite(row.score) && Number.isFinite(row.scoreRaw) && row.scoringVersion === "personal-fit-v2" && row.description), { results: exportContract.snapshot.results.length, bytes: exportContract.bytes });
  assert("results_snapshot_bounded_and_clean", exportContract.bytes < 2 * 1024 * 1024 && !/undefined|null|\[object Object\]/.test(exportContract.markdown), exportContract.bytes);
  assert("results_markdown_contract", exportContract.markdown.startsWith("# Résultats Boussole Pro —") && exportContract.markdown.includes("Le classement repose sur l’accord personnel. Les compétences, le chemin d’accès et le marché n’influencent pas cet ordre.") && exportContract.markdown.includes("## Profil ayant produit ces résultats") && exportContract.markdown.includes("## Classement complet des métiers") && exportContract.markdown.includes("| Rang | Métier | Code ROME | Score | Description |") && (exportContract.markdown.match(/^\| \d+ \|/gm) || []).length === 1000, null);
  assert("results_export_menu_and_import_guard", exportContract.menuButtons === 2 && exportContract.rejection.includes("Ce fichier contient un instantané de résultats et ne peut pas être importé. Pour restaurer Ma Boussole, choisissez le fichier d’export du profil."), exportContract.rejection);
  await evaluate(cdp, `document.querySelector(".results-export")?.setAttribute("open","")`);
  await capture(cdp, "export-resultats-menu-1440.png");
  const v13Results = await evaluate(cdp, `(() => {
    const vm=window.__BOUSSOLE_REFONTE_TEST_API__.getViewModel();
    const topIds=vm.topDirections.map(row=>row.representative.jobId);
    const tabs=[...document.querySelectorAll('[data-action="results-tab"]')];
    const states=tabs.map(tab=>{tab.click();return {selected:[...tabs].filter(item=>item.getAttribute('aria-selected')==='true').length,focused:document.activeElement===tab,page:RefonteApp.state.resultsPage};});
    tabs.find(tab=>tab.dataset.tab==='all').click();
    return {independent:topIds.some(id=>vm.skillsSupportedPaths.some(row=>row.jobId===id)||vm.dreamPaths.some(row=>row.jobId===id)),recommendedExcludesTop:vm.recommendedPaths.every(row=>!topIds.includes(row.jobId)),complete:vm.completeList.length===1000,states,pages:Math.ceil(vm.completeList.length/RefonteApp.config.pageSize),sorts:[...document.getElementById('resultSort').options].map(row=>row.textContent),marketCapsules:document.querySelectorAll('.market-climate-capsule').length};
  })()`);
  assert("result_families_independent", v13Results.independent && v13Results.recommendedExcludesTop && v13Results.complete, v13Results);
  assert("tabs_visual_aria_focus", v13Results.states.every(row => row.selected === 1 && row.focused && row.page === 1), v13Results.states);
  assert("all_jobs_84_pages_and_exact_sorts", v13Results.pages === 84 && v13Results.sorts.length === 5 && !v13Results.sorts.some(label => label === "Opportunités"), v13Results);
  await capture(cdp, "03-resultats-bureau.png");

  const dialogOpen = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(".top-list button");
    trigger.focus(); trigger.click();
    const dialog = document.getElementById("jobDialog");
    return { open: dialog.open, focusInside: dialog.contains(document.activeElement), title: document.getElementById("jobDialogTitle")?.textContent, triggerText: trigger.textContent.trim() };
  })()`);
  assert("job_dialog_fullscreen_open", dialogOpen.open && dialogOpen.title, dialogOpen);
  assert("dialog_initial_focus", dialogOpen.focusInside, dialogOpen);
  const jobSkillEditing = await evaluate(cdp, `(() => {
    const row=document.querySelector("#jobDialog [data-job-skill-row]"); const skillId=row?.dataset.jobSkillRow; const jobId=RefonteApp.state.currentDialogJobId;
    row?.querySelector('[data-action="edit-job-skill"]')?.click();
    const edited=document.querySelector('#jobDialog [data-job-skill-row="'+skillId+'"]');
    const current=edited?.querySelector("[data-job-skill-current]"); const future=edited?.querySelector("[data-job-skill-future]");
    if(current&&future){ current.value="practiced"; future.value="develop"; future.dispatchEvent(new Event("change",{bubbles:true})); edited.querySelector('[data-action="save-job-skill"]')?.click(); }
    const storedAfterSave=JSON.parse(localStorage.getItem(RefonteApp.config.storageKey));
    const saved=RefonteApp.state.profile.skillSelections.find(item=>item.skillId===skillId);
    document.querySelector('#jobDialog [data-job-skill-row="'+skillId+'"] [data-action="remove-job-skill"]')?.click();
    const removed=!RefonteApp.state.profile.skillSelections.some(item=>item.skillId===skillId) && Boolean(document.querySelector('#jobDialog [data-action="undo-job-skill"]'));
    document.querySelector('#jobDialog [data-action="undo-job-skill"]')?.click();
    const restored=RefonteApp.state.profile.skillSelections.find(item=>item.skillId===skillId);
    const storedAfterUndo=JSON.parse(localStorage.getItem(RefonteApp.config.storageKey));
    return {jobId,skillId,saved,removed,restored,revisionAfterSave:storedAfterSave.revision,revisionAfterUndo:storedAfterUndo.revision,storedRestored:storedAfterUndo.profile?.skillSelections?.some(item=>item.skillId===skillId),scoreText:document.querySelector("#jobDialog .badge.blue")?.innerText || ""};
  })()`);
  assert("job_detail_skill_add_edit_remove_undo", jobSkillEditing.skillId && jobSkillEditing.saved?.currentLevel === "practiced" && jobSkillEditing.saved?.futureWish === "develop" && jobSkillEditing.removed && jobSkillEditing.restored?.currentLevel === "practiced" && jobSkillEditing.storedRestored && jobSkillEditing.revisionAfterUndo > jobSkillEditing.revisionAfterSave, jobSkillEditing);
  assert("personal_fit_display_has_one_decimal", /Accord \d+[,.]\d\/100/.test(jobSkillEditing.scoreText), jobSkillEditing.scoreText);
  await capture(cdp, "07-fiche-metier-bureau.png");
  const focusRestored = await evaluate(cdp, `new Promise(resolve => { document.getElementById("jobDialog").close(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.activeElement?.matches(".top-list button") || false))); })`, true);
  assert("dialog_focus_restored", focusRestored === true, focusRestored);
  const marketAndRelations = await evaluate(cdp, `(() => {
    RefonteApp.state.resultsTab="top"; RefonteApp.renderResultsContent();
    const band=document.querySelector(".job-card .market-climate-band");
    const capsuleButtons=[...document.querySelectorAll(".job-card:first-of-type .market-climate-capsule")];
    const firstCapsule=capsuleButtons[0]; firstCapsule?.focus(); firstCapsule?.click();
    const firstPopover=document.getElementById(firstCapsule?.getAttribute("aria-controls"));
    const cardMarket={
      bands:document.querySelectorAll(".job-card .market-climate-band").length,
      capsules:capsuleButtons.length,
      bandHeight:Math.round(band?.getBoundingClientRect().height||0),
      popovers:document.querySelectorAll(".job-card:first-of-type .market-popover").length,
      labels:capsuleButtons.map(item=>item.innerText.trim()),
      accessible:capsuleButtons.every(item=>item.tagName==="BUTTON"&&item.getAttribute("aria-expanded")!==null&&document.getElementById(item.getAttribute("aria-controls"))),
      opens:firstCapsule?.getAttribute("aria-expanded")==="true",
      firstPopoverText:firstPopover?.innerText||"",
      rawOfferHidden:!/[0-9][0-9 .]* offres observées/.test(firstPopover?.innerText||"")
    };
    document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); cardMarket.closes=firstCapsule?.getAttribute("aria-expanded")==="false"&&document.activeElement===firstCapsule;
    RefonteApp.openJob("rome-K1204", document.querySelector(".top-list button"));
    const marketText = document.querySelector(".market-detail")?.innerText || "";
    const detailColumns=[...document.querySelectorAll(".dialog-body > div")];
    const agreementPanel=document.querySelector(".personal-agreement-panel");
    const agreementMatrix=document.querySelector(".agreement-matrix");
    const market = {
      title:document.querySelector(".market-detail .detail-title")?.textContent,
      detailCards:document.querySelectorAll(".market-detail .market-climate-territory").length,
      detailHeight:Math.round(document.querySelector(".market-climate-detail")?.getBoundingClientRect().height||0),
      disclosure:document.querySelectorAll(".market-detail .market-data-disclosure").length,
      dataItems:document.querySelectorAll(".market-detail .market-data-item").length,
      oldVisuals:document.querySelectorAll(".market-wind-map,.market-main-plane,.market-marker,.market-quadrant,.market-axis-x,.market-axis-y").length,
      verdicts:[...document.querySelectorAll(".market-detail .market-climate-territory-heading strong")].map(item=>item.textContent.trim()),
      french: !/Very high|High|Low/.test(marketText)
    };
    const detailLayout={
      marketLeft:document.querySelector(".market-detail")?.parentElement===detailColumns[0],
      pointsLeft:document.querySelector(".warning-detail")?.parentElement===detailColumns[0],
      agreementRight:agreementPanel?.parentElement===detailColumns[1],
      matrixDimensions:agreementMatrix?.querySelectorAll(".assessment-dimension").length||0,
      matrixBorder:parseFloat(getComputedStyle(agreementMatrix).borderTopWidth||"0"),
      panelBackground:getComputedStyle(agreementPanel).backgroundColor,
      matrixBackground:getComputedStyle(agreementMatrix).backgroundColor
    };
    document.getElementById("jobDialog").close();
    RefonteApp.state.resultsTab="top"; RefonteApp.renderResultsContent(); const relatedTrigger=document.querySelector('[data-action="open-related"]'); const sourceId=relatedTrigger?.dataset.jobId; relatedTrigger?.click();
    const before = document.getElementById("jobDialogTitle")?.textContent;
    const relatedCount = document.querySelectorAll(".related-list-item").length;
    const expectedCount = RefonteApp.detailForJob(sourceId).variants.length;
    const related = document.querySelector(".related-list .job-title-link"); related?.click();
    const after = document.getElementById("jobDialogTitle")?.textContent;
    const stack = RefonteApp.state.dialogStack.length;
    document.querySelector('[data-action="back-dialog-state"]')?.click();
    const returned = document.getElementById("jobDialogTitle")?.textContent;
    const restoredCount = document.querySelectorAll(".related-list-item").length;
    document.getElementById("jobDialog").close();
    const graphBefore = JSON.stringify(RefonteApp.jobById(sourceId)?.relatedJobIds || []);
    RefonteApp.state.profile.interests = ["animaux"];
    const graphAfter = JSON.stringify(RefonteApp.jobById(sourceId)?.relatedJobIds || []);
    const profileExists = RefonteApp.state.profileExists; RefonteApp.state.profileExists = false; const neutralCount = RefonteApp.detailForJob(sourceId).variants.length; RefonteApp.state.profileExists = profileExists;
    return { cardMarket, marketText, market, detailLayout, relation: { before, after, stack, returned, relatedCount, expectedCount, restoredCount, neutralCount, stable: graphBefore === graphAfter } };
  })()`);
  const allowedMarketVerdicts = ["Porteur", "Niche en tension", "Actif", "Limité", "Données partielles", "Indisponible"];
  assert("market_climate_card_compact_and_accessible", marketAndRelations.cardMarket.bands > 0 && marketAndRelations.cardMarket.capsules === 3 && marketAndRelations.cardMarket.bandHeight <= 44 && marketAndRelations.cardMarket.popovers === 3 && marketAndRelations.cardMarket.accessible && marketAndRelations.cardMarket.opens && marketAndRelations.cardMarket.closes && marketAndRelations.cardMarket.rawOfferHidden, marketAndRelations.cardMarket);
  assert("market_climate_detail_compact_without_old_visuals", marketAndRelations.market.title === "Climat du marché" && marketAndRelations.market.detailCards === 3 && marketAndRelations.market.detailHeight <= 120 && marketAndRelations.market.disclosure === 1 && marketAndRelations.market.dataItems === 3 && marketAndRelations.market.oldVisuals === 0 && marketAndRelations.market.verdicts.every(value => allowedMarketVerdicts.includes(value)) && marketAndRelations.market.french, marketAndRelations.market);
  assert("job_detail_columns_balanced_and_agreement_matrix_emphasized", marketAndRelations.detailLayout.marketLeft && marketAndRelations.detailLayout.pointsLeft && marketAndRelations.detailLayout.agreementRight && marketAndRelations.detailLayout.matrixDimensions === 4 && marketAndRelations.detailLayout.matrixBorder >= 2 && marketAndRelations.detailLayout.panelBackground !== marketAndRelations.detailLayout.matrixBackground, marketAndRelations.detailLayout);
  assert("related_jobs_stable_and_back_navigation", marketAndRelations.relation.before?.startsWith("Métiers proches de") && marketAndRelations.relation.after && marketAndRelations.relation.before !== marketAndRelations.relation.after && marketAndRelations.relation.stack === 1 && marketAndRelations.relation.returned === marketAndRelations.relation.before && marketAndRelations.relation.relatedCount === marketAndRelations.relation.expectedCount && marketAndRelations.relation.restoredCount === marketAndRelations.relation.expectedCount && marketAndRelations.relation.neutralCount === marketAndRelations.relation.expectedCount && marketAndRelations.relation.stable, marketAndRelations.relation);

  const marketCaptureMetrics = [];
  for (const viewport of [{ width: 1440, height: 1000, mobile: false }, { width: 375, height: 900, mobile: true }]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height });
    await evaluate(cdp, `new Promise(resolve => { RefonteApp.setTheme("light"); RefonteApp.navigate("resultats"); RefonteApp.state.resultsTab="top"; RefonteApp.renderResultsContent(); requestAnimationFrame(() => requestAnimationFrame(() => { document.querySelector(".job-card")?.scrollIntoView({block:"center"}); resolve(); })); })`, true);
    marketCaptureMetrics.push(await evaluate(cdp, `(() => ({ width:${viewport.width}, bandHeight:Math.round(document.querySelector(".job-card .market-climate-band")?.getBoundingClientRect().height||0), overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth }))()`));
    await captureElement(cdp, ".job-card", `climat-marche-carte-${viewport.width}.png`);
    await evaluate(cdp, `new Promise(resolve => { document.querySelector(".job-card .job-title-link")?.click(); requestAnimationFrame(() => requestAnimationFrame(() => { document.querySelector(".market-detail")?.scrollIntoView({block:"center"}); resolve(); })); })`, true);
    await capture(cdp, `climat-marche-fiche-${viewport.width}.png`);
    await evaluate(cdp, `document.getElementById("jobDialog").close()`);
  }
  assert("market_climate_capture_sizes", marketCaptureMetrics.length === 2 && marketCaptureMetrics.every(row => row.overflow <= 1 && row.bandHeight <= (row.width === 375 ? 72 : 44)), marketCaptureMetrics);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });

  const exclusionAndFavorites = await evaluate(cdp, `(() => {
    const readAgreement = code => { RefonteApp.openJob("rome-"+code, document.querySelector(".top-list button")); const panel=document.querySelector(".personal-agreement-panel"); const value={text:panel?.innerText||"",dimensions:panel?.querySelectorAll(".assessment-dimension").length||0}; document.getElementById("jobDialog").close(); return value; };
    const hard=readAgreement("K1202"), warning=readAgreement("K1303"), none=readAgreement("K1308");
    RefonteApp.navigate("resultats"); const card=document.querySelector('[data-action="toggle-favorite"]'); const id=card?.dataset.jobId; const before={pressed:card?.getAttribute("aria-pressed"),filled:Boolean(card?.querySelector('.favorite-icon.is-favorite'))}; card?.click(); const afterButton=document.querySelector('[data-action="toggle-favorite"][data-job-id="'+id+'"]'); const after={pressed:afterButton?.getAttribute("aria-pressed"),filled:Boolean(afterButton?.querySelector('.favorite-icon.is-favorite')),stored:RefonteApp.state.favorites.has(id)}; afterButton?.click(); const finalButton=document.querySelector('[data-action="toggle-favorite"][data-job-id="'+id+'"]'); const final={pressed:finalButton?.getAttribute("aria-pressed"),filled:Boolean(finalButton?.querySelector('.favorite-icon.is-favorite')),stored:RefonteApp.state.favorites.has(id)};
    return {hard,warning,none,favorite:{before,after,final}};
  })()`);
  assert("exclusion_explanations_in_job_details", exclusionAndFavorites.hard.text.includes("Écarté pour l'instant") && exclusionAndFavorites.hard.text.includes("Ce qui bloque") && exclusionAndFavorites.hard.text.includes("Petite enfance (0–3 ans)") && exclusionAndFavorites.hard.dimensions === 4 && exclusionAndFavorites.warning.text.includes("À vérifier selon le poste") && !exclusionAndFavorites.warning.text.includes("Écarté") && exclusionAndFavorites.warning.dimensions === 4 && !exclusionAndFavorites.none.text.includes("À vérifier selon le poste") && !exclusionAndFavorites.none.text.includes("Écarté"), exclusionAndFavorites);
  assert("favorite_shape_aria_and_storage_sync", exclusionAndFavorites.favorite.before.pressed === "false" && !exclusionAndFavorites.favorite.before.filled && exclusionAndFavorites.favorite.after.pressed === "true" && exclusionAndFavorites.favorite.after.filled && exclusionAndFavorites.favorite.after.stored && exclusionAndFavorites.favorite.final.pressed === "false" && !exclusionAndFavorites.favorite.final.filled && !exclusionAndFavorites.favorite.final.stored, exclusionAndFavorites.favorite);
  const marketMissingStates = await evaluate(cdp, `(() => ({
    partialPresence:RefonteApp.marketClimate({presencePercentile:0,tensionClass:null}),
    unavailable:RefonteApp.marketClimate({presencePercentile:null,tensionClass:null}),
    partialTension:RefonteApp.marketClimate({presencePercentile:null,tensionClass:4}),
    contradictoryFallback:RefonteApp.marketClimate({availability:"partial",presencePercentile:null,tensionClass:null}),
    porteur:RefonteApp.marketClimate({presencePercentile:60,tensionClass:4}),
    niche:RefonteApp.marketClimate({presencePercentile:59.9,tensionClass:4}),
    actif:RefonteApp.marketClimate({presencePercentile:60,tensionClass:3}),
    limite:RefonteApp.marketClimate({presencePercentile:59.9,tensionClass:3})
  }))()`);
  assert("market_climate_six_verdict_rules_and_missing_data", marketMissingStates.partialPresence.verdict === "Données partielles" && marketMissingStates.partialTension.verdict === "Données partielles" && marketMissingStates.contradictoryFallback.verdict === "Données partielles" && marketMissingStates.unavailable.verdict === "Indisponible" && marketMissingStates.porteur.verdict === "Porteur" && marketMissingStates.niche.verdict === "Niche en tension" && marketMissingStates.actif.verdict === "Actif" && marketMissingStates.limite.verdict === "Limité", marketMissingStates);

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
  const stepTitles = [];
  for (let step = 0; step < 9; step += 1) {
    const title = await evaluate(cdp, `(() => { window.__BOUSSOLE_REFONTE_TEST_API__.setStep(${step}); return document.getElementById("stepTitle")?.textContent; })()`);
    stepTitles.push(title);
    await capture(cdp, `etape-${String(step + 1).padStart(2, "0")}-bureau.png`);
  }
  assert("nine_locked_step_titles", JSON.stringify(stepTitles) === JSON.stringify(["Départ", "Formation", "Contraintes", "Parcours professionnel", "Compétences", "Envies", "Environnements", "Validation", "Première lecture"]), stepTitles);
  const qualificationContract = await evaluate(cdp, `(() => {
    const api=window.__BOUSSOLE_REFONTE_TEST_API__;
    const migrated=api.importProfileData({profileName:"Migration qualifications",diplomaLevel:5,certificationSelections:[{id:"cert-bafa",label:"BAFA"},{id:"credential-deass",label:"DEASS"},{id:"credential-agrement",label:"Agrément"},{id:"license-d",label:"Permis D"},{id:"license-b",label:"Permis B"}]});
    const before=api.calculate(); const signatureBefore=RefonteApp.state.results.completeList.map(row=>[row.romeCode,row.personalFitScoreRaw]).sort((a,b)=>a[0].localeCompare(b[0]));
    RefonteApp.addQualification("credential-de-infirmier"); const signatureAfter=(RefonteApp.ensureResults(),RefonteApp.state.results.completeList.map(row=>[row.romeCode,row.personalFitScoreRaw]).sort((a,b)=>a[0].localeCompare(b[0])));
    api.navigate("boussole"); api.setStep(1);
    const input=document.getElementById("qualificationSearch"); input.value="orthoptiste"; input.dispatchEvent(new Event("input",{bubbles:true})); const count=document.querySelectorAll("#qualificationSuggestions [role=option]").length; input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    return {migrated,search:api.searchQualifications("caces"),count,selected:RefonteApp.state.profile.certificationSelections,unresolved:RefonteApp.state.profile.unresolvedQualifications,sameRanking:JSON.stringify(signatureBefore)===JSON.stringify(signatureAfter),title:document.getElementById("stepTitle")?.textContent,heading:[...document.querySelectorAll("h3")].some(node=>node.textContent==="Qualifications spécifiques obtenues")};
  })()`);
  assert("qualification_catalog_search_and_keyboard", qualificationContract.search.length > 0 && qualificationContract.search.length <= 8 && qualificationContract.count > 0 && qualificationContract.count <= 8 && qualificationContract.selected.some(item => item.id === "credential-de-orthoptiste" && item.type === "diplome_reglemente"), qualificationContract);
  assert("qualification_migration_is_conservative", qualificationContract.migrated.driverLicenseBStatus === "yes" && qualificationContract.migrated.certificationSelections.some(item => item.id === "cert-bafa") && qualificationContract.migrated.certificationSelections.some(item => item.id === "credential-deass") && qualificationContract.unresolved.includes("Agrément") && qualificationContract.unresolved.includes("Permis D"), qualificationContract);
  assert("qualification_does_not_change_personal_scores", qualificationContract.sameRanking, null);
  assert("qualification_ui_contract", qualificationContract.title === "Formation" && qualificationContract.heading, null);
  await captureElement(cdp, ".qualification-section", "qualifications-1440.png");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: 375, screenHeight: 900 });
  await captureElement(cdp, ".qualification-section", "qualifications-375.png");
  await evaluate(cdp, `RefonteApp.navigate("resultats"); document.querySelector(".results-export")?.setAttribute("open","")`);
  await capture(cdp, "export-resultats-menu-375.png");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
  const validationText = await evaluate(cdp, `(() => { window.__BOUSSOLE_REFONTE_TEST_API__.navigate("boussole"); window.__BOUSSOLE_REFONTE_TEST_API__.setStep(7); return document.querySelector(".summary-blocks")?.innerText || ""; })()`);
  assert("validation_uses_human_labels", !/open_exploration|not_specified|under_10|preferred|petite_enfance|Niveau\s*:\s*\d/.test(validationText) && validationText.includes("Bac +2"), validationText.slice(0, 500));
  const completionState = await evaluate(cdp, `(() => { document.querySelector('[data-action="next-step"]').click(); document.querySelector('[data-view-link="resultats"]').click(); return { completed: RefonteApp.state.profile.completedBoussole, requested: RefonteApp.state.profile.hasRequestedResults }; })()`);
  assert("completion_and_results_request_persisted", completionState.completed === true && completionState.requested === true, completionState);
  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("boussole"); window.__BOUSSOLE_REFONTE_TEST_API__.setStep(0)`);
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
  const searchContracts = await evaluate(cdp, `(() => ({ jobs: window.__BOUSSOLE_REFONTE_TEST_API__.searchJobs("animateur"), rome1000Only: window.__BOUSSOLE_REFONTE_TEST_API__.searchJobs("A1101"), skills: window.__BOUSSOLE_REFONTE_TEST_API__.searchSkills("organiser") }))()`);
  assert("job_suggestions_max_8", searchContracts.jobs.length > 0 && searchContracts.jobs.length <= 8, searchContracts.jobs);
  assert("skill_suggestions_max_8", searchContracts.skills.length > 0 && searchContracts.skills.length <= 8, searchContracts.skills);
  assert("rome1000_only_job_searchable", searchContracts.rome1000Only.includes("A1101"), searchContracts.rome1000Only);
  const skillAxes = await evaluate(cdp, `(() => { const skill=RefonteApp.state.skillIndex[0]; RefonteApp.setSkillAxes(skill.id,"practiced","develop",[]); const stored=RefonteApp.state.profile.skillSelections.find(row=>row.skillId===skill.id); const engine=RefonteApp.profileForEngine(); return {stored,acquired:engine.skills.includes(skill.id),avoided:engine.avoidedSkills.includes(skill.id)}; })()`);
  assert("skill_two_axes_practiced_develop", skillAxes.stored?.currentLevel === "practiced" && skillAxes.stored?.futureWish === "develop" && skillAxes.acquired && !skillAxes.avoided, skillAxes);
  const activeDom = await evaluate(cdp, `(() => ({ datalists: document.querySelectorAll("datalist").length, experienceDefaults: window.__BOUSSOLE_REFONTE_TEST_API__.getProfile().jobExperiences[0] }))()`);
  assert("no_active_datalist", activeDom.datalists === 0, activeDom.datalists);
  const comboboxKeyboard = await evaluate(cdp, `(() => {
    window.__BOUSSOLE_REFONTE_TEST_API__.setStep(3);
    const jobInput=document.getElementById("experienceJob"); jobInput.value="animateur"; jobInput.dispatchEvent(new Event("input",{bubbles:true}));
    const jobCount=document.querySelectorAll("#jobSuggestions [role=option]").length; jobInput.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})); jobInput.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    const jobSelected=Boolean(RefonteApp.state.selectedExperienceJobId); const staleJobNoResult=Boolean(document.getElementById("jobSearchStatus"));
    window.__BOUSSOLE_REFONTE_TEST_API__.setStep(4);
    const skillInput=document.getElementById("skillSearch"); skillInput.value="organiser"; skillInput.dispatchEvent(new Event("input",{bubbles:true}));
    const skillCount=document.querySelectorAll("#skillSearchSuggestions [role=option]").length; skillInput.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})); skillInput.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    return { jobCount, jobSelected, jobQuery:RefonteApp.state.jobQuery, staleNoResult:staleJobNoResult, skillCount, skillSelected:Boolean(RefonteApp.state.selectedSkillId), skillQuery:RefonteApp.state.skillQuery };
  })()`);
  assert("combobox_keyboard_job_and_skill", comboboxKeyboard.jobSelected && comboboxKeyboard.skillSelected && comboboxKeyboard.jobQuery === "" && comboboxKeyboard.skillQuery === "" && !comboboxKeyboard.staleNoResult && comboboxKeyboard.jobCount <= 8 && comboboxKeyboard.skillCount <= 8, comboboxKeyboard);
  const domainAndDedupe = await evaluate(cdp, `(() => {
    window.__BOUSSOLE_REFONTE_TEST_API__.setStep(3); document.querySelector('[data-action="toggle-rome-domains"]').click();
    const domain=document.getElementById("romeDomain"); const option=[...domain.options].find(row => /^[A-Z][0-9]{2}$/.test(row.value)); domain.value=option?.value || ""; domain.dispatchEvent(new Event("change",{bubbles:true}));
    const domainRows=document.querySelectorAll(".domain-job").length; const before=RefonteApp.state.profile.jobExperiences.length; const existing=RefonteApp.state.dataset.jobs.find(job => job.romeCode===RefonteApp.state.profile.jobExperiences[0]?.romeCode); if(existing) RefonteApp.addExperience(existing); const after=RefonteApp.state.profile.jobExperiences.length;
    const skill=RefonteApp.state.skillIndex[0]; RefonteApp.setSkillSelection(skill.id,"known",["G1202"]); RefonteApp.setSkillSelection(skill.id,"practiced",["G1202"]); const skillCopies=RefonteApp.state.profile.skillSelections.filter(row=>row.skillId===skill.id).length;
    return { domainCode:option?.value, domainRows, experienceDeduped:before===after, skillCopies };
  })()`);
  assert("rome_three_character_domain_browser", /^[A-Z][0-9]{2}$/.test(domainAndDedupe.domainCode) && domainAndDedupe.domainRows > 0 && domainAndDedupe.domainRows <= 10, domainAndDedupe);
  assert("experience_and_skill_deduplication", domainAndDedupe.experienceDeduped && domainAndDedupe.skillCopies === 1, domainAndDedupe);
  const searchPerformance = await evaluate(cdp, `(() => { const started=performance.now(); for(let i=0;i<20;i++){ RefonteApp.searchJobs("animateur"); RefonteApp.searchSkills("organiser"); } return Math.round((performance.now()-started)*100)/100; })()`);

  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("exploration")`);
  await waitForSelector(cdp, ".direction-grid");
  const exploration = await evaluate(cdp, `(() => { const sort=document.getElementById("explorationSort"); sort.value="title_desc"; sort.dispatchEvent(new Event("change",{bubbles:true})); return { directions: document.querySelectorAll(".direction-button").length, rows: document.querySelectorAll(".compact-row").length, queryResult: window.__BOUSSOLE_REFONTE_TEST_API__.search("animateur"), intro:document.querySelector("main").innerText, diploma:Boolean(document.getElementById("explorationDiploma")), titleButtons:document.querySelectorAll(".job-title-link").length, ficheButtons:[...document.querySelectorAll(".compact-row button")].filter(button=>button.textContent.includes("Voir la fiche")).length, sorts:[...sort.options].map(row=>row.value), persisted:localStorage.getItem(RefonteApp.config.storageKey+"_exploration_sort"), page:RefonteApp.state.explorationPage }; })()`);
  assert("exploration_17_directions", exploration.directions === 17, exploration.directions);
  assert("exploration_paginated_rows", exploration.rows > 0 && exploration.rows <= 12, exploration.rows);
  assert("search_title_or_appellation", exploration.queryResult.length > 0, exploration.queryResult);
  assert("exploration_v13_controls", exploration.intro.includes("1000 métiers") && exploration.diploma && exploration.titleButtons > 0 && exploration.ficheButtons > 0, exploration);
  assert("exploration_v15_sort", exploration.sorts.join("|") === "fit_desc|title_asc|title_desc" && exploration.persisted === "title_desc" && exploration.page === 1, exploration);
  const explorationFavorite = await evaluate(cdp, `(() => { RefonteApp.state.explorationQuery=""; RefonteApp.renderExploration(); const button=document.querySelector('.compact-row [data-action="toggle-favorite"]'); const id=button?.dataset.jobId; const before={pressed:button?.getAttribute('aria-pressed'),filled:Boolean(button?.querySelector('.favorite-icon.is-favorite'))}; button?.click(); const afterButton=document.querySelector('.compact-row [data-action="toggle-favorite"][data-job-id="'+id+'"]'); const after={pressed:afterButton?.getAttribute('aria-pressed'),filled:Boolean(afterButton?.querySelector('.favorite-icon.is-favorite'))}; RefonteApp.openJob(id,afterButton); const detailButton=document.querySelector('#jobDialog [data-action="toggle-favorite"]'); const detail={pressed:detailButton?.getAttribute('aria-pressed'),filled:Boolean(detailButton?.querySelector('.favorite-icon.is-favorite'))}; detailButton?.click(); const detailAfter=document.querySelector('#jobDialog [data-action="toggle-favorite"]'); const removed={pressed:detailAfter?.getAttribute('aria-pressed'),filled:Boolean(detailAfter?.querySelector('.favorite-icon.is-favorite')),stored:RefonteApp.state.favorites.has(id)}; document.getElementById('jobDialog').close(); return {before,after,detail,removed}; })()`);
  assert("favorite_sync_exploration_and_detail", explorationFavorite.before.pressed === "false" && !explorationFavorite.before.filled && explorationFavorite.after.pressed === "true" && explorationFavorite.after.filled && explorationFavorite.detail.pressed === "true" && explorationFavorite.detail.filled && explorationFavorite.removed.pressed === "false" && !explorationFavorite.removed.filled && !explorationFavorite.removed.stored, explorationFavorite);
  await capture(cdp, "04-exploration-bureau.png");

  await evaluate(cdp, `(() => { RefonteApp.toggleFavorite("rome-G1202"); RefonteApp.toggleFavorite("rome-K1203"); RefonteApp.toggleCompare("rome-G1202"); RefonteApp.toggleCompare("rome-K1203"); window.__BOUSSOLE_REFONTE_TEST_API__.navigate("liste"); })()`);
  await waitForSelector(cdp, "main");
  const listState = await evaluate(cdp, `(() => ({ ...window.__BOUSSOLE_REFONTE_TEST_API__.getState(), comparisonVisible: Boolean(document.querySelector(".compare-table")), storageSaved: Boolean(localStorage.getItem("luuma_boussole_pro_refonte_v1")) }))()`);
  assert("favorites_persist_in_state", listState.favorites.length >= 1, listState.favorites);
  assert("compare_two_jobs", listState.comparisonVisible === true, listState);
  assert("local_storage_saved", listState.storageSaved === true, listState.storageSaved);
  const favoriteListControls = await evaluate(cdp, `(() => {
    const ids=RefonteApp.state.results.completeList.slice(0,4).map(item=>item.jobId);
    ids.forEach(id=>RefonteApp.state.favorites.add(id)); RefonteApp.state.compare.clear(); RefonteApp.renderList();
    ids.forEach(id=>document.querySelector('.favorite-row [data-action="toggle-compare"][data-job-id="'+id+'"]')?.click());
    const fourth=document.querySelector('.favorite-row [data-action="toggle-compare"][data-job-id="'+ids[3]+'"]');
    const rows=[...document.querySelectorAll('.favorite-row')]; const openButtons=[...document.querySelectorAll('.favorite-row [data-action="open-job"]')];
    return {selected:RefonteApp.state.compare.size,fourthChecked:Boolean(fourth?.checked),guide:document.getElementById('compareLimit')?.innerText||'',rowCompareTexts:rows.map(row=>row.querySelector('.compare-cell')?.innerText.trim()),openButtons:openButtons.length,allOpenButtonsExplicit:openButtons.every(button=>button.textContent.trim()==='Voir la fiche'),toast:document.getElementById('toast')?.innerText||''};
  })()`);
  assert("favorite_list_comparison_limit_and_controls", favoriteListControls.selected === 3 && favoriteListControls.fourthChecked === false && favoriteListControls.guide.includes("3/3") && favoriteListControls.rowCompareTexts.every(text => text === "") && favoriteListControls.openButtons >= 4 && favoriteListControls.allOpenButtonsExplicit && favoriteListControls.toast.includes("limitée à trois métiers"), favoriteListControls);
  await capture(cdp, "05-ma-liste-bureau.png");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: 375, screenHeight: 900 });
  const favoriteListMobile = await evaluate(cdp, `(() => ({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,rows:[...document.querySelectorAll('.favorite-row')].map(row=>({width:Math.round(row.getBoundingClientRect().width),actionsWidth:Math.round(row.querySelector('.actions')?.getBoundingClientRect().width||0)})),guide:document.getElementById('compareLimit')?.innerText||''}))()`);
  assert("favorite_list_mobile_no_overflow", favoriteListMobile.overflow <= 1 && favoriteListMobile.rows.every(row => row.width <= 347 && row.actionsWidth <= 347) && favoriteListMobile.guide.includes("3/3"), favoriteListMobile);
  await capture(cdp, "05-ma-liste-375.png");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });

  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("menu")`);
  await capture(cdp, "06-menu-bureau.png");

  const responsive = [];
  for (const themeName of ["light", "dark"]) for (const width of [320, 375, 768, 1024, 1440]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(cdp, `RefonteApp.setTheme("${themeName}")`);
    responsive.push({ width, theme: themeName, ...await evaluate(cdp, `(() => {
      const viewport = document.documentElement.clientWidth;
      return {
        overflow: document.documentElement.scrollWidth - viewport,
        root: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, rectWidth: Math.round(document.documentElement.getBoundingClientRect().width) },
        body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth, rectWidth: Math.round(document.body.getBoundingClientRect().width) },
        offenders: [...document.querySelectorAll("body *")].map(node => {
          const rect = node.getBoundingClientRect();
          return { tag: node.tagName, className: String(node.className || "").slice(0, 80), width: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right), text: (node.textContent || "").trim().slice(0, 80) };
        }).filter(row => row.right > viewport + 1 || row.left < -1).sort((a, b) => b.right - a.right).slice(0, 8),
        internalScrollers: [...document.querySelectorAll("body *")].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({ tag: node.tagName, className: String(node.className || "").slice(0, 80), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })).slice(0, 8)
      };
    })()`) });
  }
  assert("responsive_five_required_widths_two_themes", responsive.length === 10 && responsive.every(row => row.overflow <= 1), responsive);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.navigate("boussole"); window.__BOUSSOLE_REFONTE_TEST_API__.setStep(3)`);
  await capture(cdp, "etape-04-parcours-mobile.png");
  await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.setStep(4)`);
  await capture(cdp, "etape-05-competences-mobile.png");
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
  const cachedRuntime = await evaluate(cdp, `window.__BOUSSOLE_REFONTE_TEST_API__.reloadRuntime().then(() => ({ ...window.__BOUSSOLE_REFONTE_TEST_API__.getState(), runtimeStatus: RefonteApp.runtimePresentation().status }))`, true);
  assert("network_failure_uses_validated_complete_cache", cachedRuntime.jobs === 1000 && cachedRuntime.datasetMode === "validated_cache" && cachedRuntime.runtimeStatus.includes("Cache local validé"), cachedRuntime);
  await navigate(cdp, pathToFileURL(OFFLINE_HTML_PATH).href);
  await waitForApi(cdp, 240);
  const offline = await evaluate(cdp, `(() => ({ build: window.__BOUSSOLE_REFONTE_TEST_API__.build(), state: window.__BOUSSOLE_REFONTE_TEST_API__.getState(), text: document.querySelector("main")?.innerText || "", runtimeStatus: RefonteApp.runtimePresentation().status }))()`);
  assert("file_offline_boot", offline.build.jobsCount === 1000 && offline.state.datasetMode === "offline_embedded" && offline.text.includes("1000 métiers inclus dans cette édition autonome") && offline.runtimeStatus.includes("Édition autonome"), offline);
  const offlineTop = await evaluate(cdp, `(() => { window.__BOUSSOLE_REFONTE_TEST_API__.loadDemoProfile(); return window.__BOUSSOLE_REFONTE_TEST_API__.calculate().top5; })()`);
  assert("online_offline_same_demo_top5", JSON.stringify(offlineTop) === JSON.stringify(resultUi.top), { online: resultUi.top, offline: offlineTop });
  assert("online_offline_same_runtime_identity", offline.build.datasetVersion === initial.build.datasetVersion && offline.build.runtimeFingerprintSha256 === initial.build.runtimeFingerprintSha256, { online: initial.build, offline: offline.build });
  const offlineMarketClimate = await evaluate(cdp, `(() => { RefonteApp.navigate("resultats"); RefonteApp.state.resultsTab="top"; RefonteApp.renderResultsContent(); const labels=[...document.querySelectorAll(".job-card:first-of-type .market-climate-capsule")].map(item=>item.innerText.trim()); document.querySelector(".job-card .job-title-link")?.click(); const detailCards=document.querySelectorAll(".market-detail .market-climate-territory").length; const oldVisuals=document.querySelectorAll(".market-wind-map,.market-main-plane,.market-marker,.market-quadrant").length; document.getElementById("jobDialog").close(); return {labels,detailCards,oldVisuals}; })()`);
  assert("online_offline_same_market_climate", JSON.stringify(offlineMarketClimate.labels) === JSON.stringify(marketAndRelations.cardMarket.labels) && offlineMarketClimate.detailCards === 3 && offlineMarketClimate.oldVisuals === 0, { online: marketAndRelations.cardMarket.labels, offline: offlineMarketClimate });
  await capture(cdp, "10-hors-ligne-file-mobile.png");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  const report = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_v1_6_0_browser_interaction_accessibility_performance",
    generatedAt: new Date().toISOString(),
    status: failures.length || runtimeErrors.length || consoleErrors.length ? "failed" : "passed",
    html: { path: path.relative(ROOT, HTML_PATH), bytes: html.length, sha256: sha256(html) },
    browser: { chromium: CHROMIUM, desktop: "1440x1000", mobile: "375x900", httpUrl, offlineUrl: pathToFileURL(OFFLINE_HTML_PATH).href },
    performance: { calculationMs: calculation.calculationMs, searchJobAndSkill20IterationsMs: searchPerformance, navigation: await evaluate(cdp, `(() => { const n=performance.getEntriesByType("navigation")[0]; return n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) } : null; })()`) },
    scenarios: { initial, importRoundTrip: { equal: roundTrip.equal }, resultUi, exportContract: { bytes: exportContract.bytes, resultCount: exportContract.snapshot.results.length }, qualificationContract, dialogOpen, marketAndRelations, marketCaptureMetrics, modeInvariant, exploration, comboboxKeyboard, domainAndDedupe, mobile, a11y, cachedRuntime, offline: { jobs: offline.build.jobsCount, profileExists: offline.state.profileExists, datasetMode: offline.state.datasetMode, top5: offlineTop, marketClimate: offlineMarketClimate } },
    captures: (await listCaptureNames()).map(name => path.relative(ROOT, path.join(CAPTURE_DIR, name))),
    assertions,
    errors: { console: consoleErrors, runtime: runtimeErrors, network: networkErrors },
    failures: [...failures, ...runtimeErrors.map(() => "runtime_error"), ...consoleErrors.map(() => "console_error")]
  };
  await writeFile(path.join(REPORT_DIR, "boussole-pro-refonte-profil-migre-v1.2-test.json"), `${JSON.stringify({ app: "boussole-pro-refonte-profile", version: "1.2.0", exportedAt: new Date().toISOString(), source: "browser_synthetic_migration_fixture", profile: roundTrip.profile, migration: { requestedReceptionProfileAvailable: false, activeProfilePolicy: "visible_editable_fields_only" } }, null, 2)}\n`);
  await writeFile(path.join(REPORT_DIR, "exemple-resultats-profil-demo.json"), `${JSON.stringify(exportContract.snapshot, null, 2)}\n`);
  await writeFile(path.join(REPORT_DIR, "exemple-resultats-profil-demo.md"), `${exportContract.markdown}\n`);
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures: report.failures, captures: report.captures.length, report: path.relative(ROOT, REPORT_PATH) }, null, 2));
  cdp.close();
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  chromium.kill("SIGTERM");
  await closeServer(server);
}

async function capture(cdp, name) {
  await evaluate(cdp, `(() => { const toast=document.getElementById("toast"); if(toast){ toast.classList.remove("visible"); toast.style.display="none"; } })()`);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(CAPTURE_DIR, name), Buffer.from(result.data, "base64"));
}

async function captureElement(cdp, selector, name) {
  await evaluate(cdp, `(() => { const toast=document.getElementById("toast"); if(toast){ toast.classList.remove("visible"); toast.style.display="none"; } })()`);
  const box = await evaluate(cdp, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node) return null; const rect=node.getBoundingClientRect(); return {x:Math.max(0,rect.left+scrollX),y:Math.max(0,rect.top+scrollY),width:rect.width,height:rect.height}; })()`);
  if (!box) throw new Error(`Élément absent pour la capture : ${selector}`);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { ...box, scale: 1 } });
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
