import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations", "boussolepro");
const HTML_PATH = path.join(APP_DIR, "boussole-pro.html");
const GENERATED_DIR = path.join(APP_DIR, "data", "generated");
const ROME500_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const MARKET_DIR = path.join(GENERATED_DIR, "market");
const PROFILE_PATH = path.join(ROOT, "tmp", "monde-pro", "profils tests", "boussole-pro-profil-cedric-2026-07-10.json");
const DELIVERY_DIR = path.join(ROOT, "tmp", "monde-pro", "livraison-boussole-pro-v0.7.5-alpha-20260801-02");
const VALIDATION_PATH = path.join(GENERATED_DIR, "boussole-v075-functional-validation-report.json");
const PERFORMANCE_PATH = path.join(GENERATED_DIR, "rome500-browser-performance-report.json");

async function main() {
  const generatedAt = new Date().toISOString();
  const html = await readFile(HTML_PATH, "utf8");
  const htmlSha256 = sha256(html);
  const build = await readBoussoleBuildMetadata(HTML_PATH);
  const validation = await readJsonRequired(VALIDATION_PATH);
  const performance = await readJsonRequired(PERFORMANCE_PATH);
  assertFinalIdentity({ build, validation, performance, htmlSha256 });

  const app = loadBoussoleEngine(html);
  const generated = await loadGeneratedBundle();
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);
  const corpusMaturity = generated.manifest.maturityStatus || generated.manifest.promotionStatus || "candidate";

  const profileEnvelope = await readJsonRequired(PROFILE_PATH);
  const rawProfile = profileEnvelope.profile || profileEnvelope.data || profileEnvelope;
  const profile = app.normalizeProfile({
    ...rawProfile,
    id: "technical-validation-profile",
    profileName: "",
    hasRequestedResults: true,
    completedBoussole: true,
    jobExperiences: [
      { romeCode: "G1203", title: "Animateur / Animatrice jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes", recency: "recent", masteryLevel: "advanced", source: "user_direct" },
      { romeCode: "M1805", title: "Etudes et developpement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no", recency: "recent", masteryLevel: "autonomous", source: "user_direct" }
    ]
  });
  app.App.state.profile = profile;
  const results = app.calculateAllMatches(profile, app.App.state.dataset);
  app.App.state.results = results;

  const compactResults = app.prepareCompactResultsForExport(results);
  const diagnosticResults = app.buildResultDiagnosticExport(results);
  diagnosticResults.profileId = "technical-validation-profile";
  diagnosticResults.profileName = "";
  const testBench = app.runDiagnosticProfiles(app.DIAGNOSTIC_TEST_PROFILES_V052);
  const compactCorpus = app.prepareCompactDatasetExport(app.App.state.dataset);
  const k2106 = generated.accessSummary.find(row => row.romeCode === "K2106") || null;
  const qualityActive = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_active_quality",
    generatedAt,
    build,
    sourceArtifactSha256: htmlSha256,
    datasetVersion: app.App.state.dataset.datasetVersion,
    corpusMaturity,
    validationStatus: validation.status,
    checks: Object.fromEntries(Object.entries(validation.checks).map(([name, group]) => [name, group.status])),
    resultCounts: compactResults.counts,
    calibrationAudit: results.calibrationAudit
  };
  const accessDerived = {
    schemaVersion: "1.0.0",
    reportKind: "boussole_access_derived",
    generatedAt,
    build,
    sourceArtifactSha256: htmlSha256,
    datasetVersion: app.App.state.dataset.datasetVersion,
    summary: generated.accessSummaryQualityReport,
    k2106,
    k2106Runtime: validation.checks?.technicalProfileScenario?.rows?.K2106 || null,
    accessTruthChecks: validation.checks?.access || null
  };

  await mkdir(DELIVERY_DIR, { recursive: true });
  await copyFile(HTML_PATH, path.join(DELIVERY_DIR, "boussole-pro.html"));
  await writeJson("quality-active.json", qualityActive);
  await writeJson("access-derived.json", accessDerived);
  await writeJson("test-bench.json", testBench);
  await writeJson("results-diagnostic.json", diagnosticResults);
  await writeJson("results-compact.json", compactResults);
  await writeJson("corpus-compact.json", compactCorpus);
  await copyFile(PERFORMANCE_PATH, path.join(DELIVERY_DIR, "rome500-browser-performance-report.json"));
  await writeFile(path.join(DELIVERY_DIR, "PREPARATION_MARCHE_ROME800_UX.md"), buildPreparationDocument(build), "utf8");
  await writeFile(path.join(DELIVERY_DIR, "CONSOLIDATION_REPORT.md"), buildConsolidationReport({ build, validation, performance, htmlSha256, qualityActive }), "utf8");

  const sourceReports = await describeSourceReports([
    path.join(ROME500_DIR, "import-manifest.rome.json"),
    path.join(ROME500_DIR, "data-quality-report.rome.json"),
    path.join(MARKET_DIR, "market-quality-report.json"),
    path.join(MARKET_DIR, "market-import-manifest.json")
  ]);
  const files = await describeDeliveryFiles(generatedAt);
  const manifest = {
    schemaVersion: "1.0.0",
    manifestKind: "boussole_delivery_sha256",
    generatedAt,
    appVersion: build.appVersion,
    buildId: build.buildId,
    buildDate: build.buildDate,
    datasetVersion: app.App.state.dataset.datasetVersion,
    corpusMaturity,
    htmlIdentity: { fileName: "boussole-pro.html", size: Buffer.byteLength(html), sha256: htmlSha256 },
    files,
    manifestSelfHash: "not_applicable_external_manifest",
    reportsDerivedFromHtml: files.filter(file => !["boussole-pro.html", "PREPARATION_MARCHE_ROME800_UX.md"].includes(file.fileName)).map(file => file.fileName),
    sourceReportsPreservedWithoutRegeneration: sourceReports,
    sourceWorkflowsRerun: [],
    sourceWorkflowsNotRerunReason: "Les sources ROME et marche, leurs millesimes et leurs regles d'import n'ont pas change."
  };
  await writeFile(path.join(DELIVERY_DIR, "manifest.sha256.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Livraison creee : ${path.relative(ROOT, DELIVERY_DIR)}`);
  console.log(`[Boussole Pro] HTML SHA-256 : ${htmlSha256}`);
  console.log(`[Boussole Pro] ${files.length + 1} fichiers livres, manifeste inclus.`);
}

function assertFinalIdentity({ build, validation, performance, htmlSha256 }) {
  const failures = [];
  if (build.appVersion !== "v0.7.5-alpha") failures.push(`version ${build.appVersion}`);
  if (build.buildId !== "20260801-functional-consolidation-02") failures.push(`build ${build.buildId}`);
  if (validation.status !== "ok") failures.push(`validation ${validation.status}`);
  if (validation.sourceArtifactSha256 !== htmlSha256) failures.push("validation HTML SHA mismatch");
  if (performance.sourceArtifactSha256 !== htmlSha256) failures.push("performance HTML SHA mismatch");
  if (performance.buildId !== build.buildId || performance.appVersion !== build.appVersion) failures.push("performance build mismatch");
  if (performance.scenario?.coldRuns !== 5 || performance.scenario?.warmRuns !== 5) failures.push("performance protocol incomplete");
  if (performance.runs?.cold?.length !== 5 || performance.runs?.warm?.length !== 5) failures.push("performance runs incomplete");
  if (failures.length) throw new Error(`Livraison refusee : ${failures.join(", ")}`);
}

async function loadGeneratedBundle() {
  return {
    manifest: await readJsonRequired(path.join(ROME500_DIR, "import-manifest.rome.json")),
    jobs: await readJsonRequired(path.join(ROME500_DIR, "jobs.rome.json")),
    skills: await readJsonRequired(path.join(ROME500_DIR, "skills.rome.json")),
    knowledge: await readJsonRequired(path.join(ROME500_DIR, "knowledge.rome.json")),
    certificationLike: await readJsonRequired(path.join(ROME500_DIR, "certification-like.rome.json")),
    matchableSkills: await readJsonRequired(path.join(ROME500_DIR, "skills-matchable.rome.json")),
    workContexts: await readJsonRequired(path.join(ROME500_DIR, "work-contexts.rome.json")),
    jobAppellations: await readJsonRequired(path.join(ROME500_DIR, "job-appellations.rome.json")),
    mappings: await readJsonRequired(path.join(ROME500_DIR, "mappings.rome.json")),
    qualityReport: await readJsonRequired(path.join(ROME500_DIR, "data-quality-report.rome.json")),
    accessSummary: await readJsonRequired(path.join(ROME500_DIR, "access-summary.rome500.json")),
    accessSummaryQualityReport: await readJsonRequired(path.join(ROME500_DIR, "access-summary-quality-report.json")),
    officialConstraintSummary: await readJsonRequired(path.join(ROME500_DIR, "official-constraint-summary.rome500.json")),
    marketManifest: await readJsonRequired(path.join(MARKET_DIR, "market-import-manifest.json")),
    marketQualityReport: await readJsonRequired(path.join(MARKET_DIR, "market-quality-report.json")),
    marketNational: await readJsonRequired(path.join(MARKET_DIR, "market-national.rome.json")),
    marketOccitanie: await readJsonRequired(path.join(MARKET_DIR, "market-occitanie.rome.json")),
    marketAude: await readJsonRequired(path.join(MARKET_DIR, "market-aude.rome.json"))
  };
}

function loadBoussoleEngine(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]?.replace('document.addEventListener("DOMContentLoaded", initApp);', "");
  if (!script) throw new Error("Script Boussole Pro introuvable.");
  const noop = () => {};
  const fakeElement = () => ({ addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {}, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop, click: noop, focus: noop, innerHTML: "" });
  const context = {
    console,
    structuredClone: globalThis.structuredClone,
    setTimeout,
    clearTimeout,
    Blob: function Blob() {},
    URL: { createObjectURL: () => "", revokeObjectURL: noop },
    FileReader: function FileReader() {},
    crypto: { randomUUID: () => Math.random().toString(36).slice(2) },
    performance: { now: () => Date.now() },
    window: { setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), CSS: { escape: value => String(value) } },
    document: { addEventListener: noop, getElementById: () => fakeElement(), body: fakeElement(), createElement: () => fakeElement() },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    location: { protocol: "http:" },
    navigator: {}
  };
  context.window = Object.assign(context.window, context);
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.__boussole = { App, mergeGeneratedDatasetIntoApp, markDatasetAsOfficialRome, normalizeProfile, calculateAllMatches, prepareCompactResultsForExport, buildResultDiagnosticExport, runDiagnosticProfiles, DIAGNOSTIC_TEST_PROFILES_V052, prepareCompactDatasetExport };`, context, { timeout: 15000 });
  return context.__boussole;
}

async function describeDeliveryFiles(defaultGeneratedAt) {
  const names = (await readdir(DELIVERY_DIR)).filter(name => name !== "manifest.sha256.json").sort();
  return Promise.all(names.map(async fileName => {
    const filePath = path.join(DELIVERY_DIR, fileName);
    const details = await stat(filePath);
    const content = await readFile(filePath);
    let artifactGeneratedAt = defaultGeneratedAt;
    if (fileName.endsWith(".json")) {
      const parsed = JSON.parse(content);
      artifactGeneratedAt = parsed.generatedAt || parsed.exportedAt || defaultGeneratedAt;
    }
    return { fileName, generatedAt: artifactGeneratedAt, size: details.size, sha256: sha256(content) };
  }));
}

async function describeSourceReports(paths) {
  return Promise.all(paths.map(async filePath => {
    const content = await readFile(filePath);
    const parsed = JSON.parse(content);
    return {
      path: path.relative(ROOT, filePath),
      sourceGeneratedAt: parsed.sourceGeneratedAt || parsed.generatedAt || parsed.sync?.generatedAt || null,
      packagedAt: new Date().toISOString(),
      packagedInBuild: "20260801-functional-consolidation-02",
      size: content.length,
      sourceArtifactSha256: sha256(content)
    };
  }));
}

function buildConsolidationReport({ build, validation, performance, htmlSha256, qualityActive }) {
  const cedric = validation.checks.technicalProfileScenario;
  const access = validation.checks.accessQuality.summary;
  const cold = performance.summary.cold;
  const warm = performance.summary.warm;
  const checkRows = Object.entries(validation.checks).map(([name, group]) => `| ${name} | ${group.status === "ok" ? "REUSSI" : "ECHEC"} |`).join("\n");
  return `# Boussole Pro - rapport de consolidation fonctionnelle\n\n## Verdict\n\n**VALIDEE pour le perimetre fonctionnel v0.7.5-alpha.** L'application reste en alpha et le corpus n'est ni stable, ni un referentiel officiel complet.\n\n## Identite\n\n- Version : \`${build.appVersion}\`\n- Build : \`${build.buildId}\`\n- Corpus : \`rome500-candidate-v0.7\`\n- Maturite : \`validated_for_boussole_pro\`\n- HTML teste SHA-256 : \`${htmlSha256}\`\n\n## Corrections et causes\n\n- Contraintes : un manque de preuve etait recompense comme une compatibilite forte. Les etats sont maintenant probants et l'inconnu reste neutre.\n- Acces : le CRPE etait encore traite comme une certification manquante et la premiere voie etait favorisee par ordre. Concours, eligibilite et exercice sont separes.\n- Secteurs : des prefixes ROME moyens provoquaient des exclusions dures. Les preuves exactes, les conflits probables et les metiers multidomaines sont maintenant distingues.\n- Rapports : le rendu de zero carte ne peut plus etre marque comme mesure reussie ; le protocole comporte cinq essais froids et cinq chauds.\n- Corpus : le nom fonctionnel devient candidat consolide, avec alias de migration de l'ancien identifiant experimental.\n\n## Criteres d'acceptation\n\n| Groupe | Resultat |\n|---|---|\n${checkRows}\n\n## Compteurs avant / apres\n\n| Indicateur | Avant | Apres |\n|---|---:|---:|\n| Contraintes a 25/25 avec incertitude | 369 | ${cedric.constraintAudit.unknownAsStrongCount} |\n| Libelles ambigus dans les signaux positifs | au moins 484 occurrences observees | ${cedric.constraintAudit.ambiguousPositiveLabelsCount} |\n| Exclusions dures sur prefixe moyen | 99 observees | ${cedric.sectorAudit.mediumPrefixHardExclusionsCount} |\n| Possible immediat avec acces obligatoire manquant | 0 | ${cedric.accessAudit.possibleNowWithMissingAccessCount} |\n| Cas de verite d'acces | 17 | ${access.truthCasesCount} |\n| Echecs des cas d'acces | 0 | ${access.truthFailuresCount} |\n| Metiers calcules | 500 | ${qualityActive.resultCounts.completeList} |\n\n## Performances\n\n| Mode | Minimum total | Mediane totale | Moyenne totale | Maximum total | p95 |\n|---|---:|---:|---:|---:|---:|\n| Froid | ${cold.totalGeneratedLoadMs.minimum} ms | ${cold.totalGeneratedLoadMs.median} ms | ${cold.totalGeneratedLoadMs.mean} ms | ${cold.totalGeneratedLoadMs.maximum} ms | ${cold.totalGeneratedLoadMs.p95} ms |\n| Chaud | ${warm.totalGeneratedLoadMs.minimum} ms | ${warm.totalGeneratedLoadMs.median} ms | ${warm.totalGeneratedLoadMs.mean} ms | ${warm.totalGeneratedLoadMs.maximum} ms | ${warm.totalGeneratedLoadMs.p95} ms |\n\nValeurs brutes froides : ${JSON.stringify(cold.totalGeneratedLoadMs.rawValues)}.\n\nValeurs brutes chaudes : ${JSON.stringify(warm.totalGeneratedLoadMs.rawValues)}.\n\nConclusion instrumentee : ${performance.summary.conclusion}\n\n## Tests executes\n\n- verification syntaxique Node des scripts modifies ;\n- \`prepare-v071-local.mjs\` sur les artefacts derives ;\n- \`validate-boussole-v073.mjs\` ;\n- \`validate-boussole-generated-data.mjs\` ;\n- \`validate-rome500-local.mjs\` ;\n- audits ROME500 et rapports derives ;\n- Chromium headless : cinq essais froids, cinq essais chauds, bureau, mobile et impression.\n\n## Inconnues restantes\n\n- ${access.unknownCount} acces restent classes inconnus ;\n- ${access.ambiguousCount} resumes d'acces restent ambigus ;\n- ${access.accessDurationUnknownCount} durees de parcours ne sont pas renseignees ;\n- quatre voies d'acces sur six ont une duree inconnue ;\n- les signaux de marche restent descriptifs et separes de la correspondance personnelle.\n\n## Provenance\n\nAucun workflow API ROME ou marche n'a ete relance : les sources, regles d'import et millesimes n'ont pas change. Les rapports sources conservent leur date et leur hash ; seuls les artefacts derives du moteur et de l'HTML final ont ete regeneres.\n\n## Fichiers modifies\n\nLe code fonctionnel concerne l'HTML autonome, les regles locales d'acces et de secteurs, les scripts de preparation, validation, audit, synchronisation locale et mesure. Les rapports derives regeneres restent identifies separement des sources.\n`;
}

function buildPreparationDocument(build) {
  return `# Preparation du chantier marche, ROME800 et ergonomie\n\nBuild de reference : \`${build.buildId}\`. Ce document est un inventaire ; aucune nouvelle source ni refonte n'est implementee dans ce lot.\n\n## Marche du travail\n\nContrat de donnees conseille : \`tension\`, \`recruitmentVolume\`, \`recruitmentDifficulty\`, \`seasonality\`, \`territorialPresence\`, \`multiYearTrend\`, \`explanatoryFactors\`, \`territory\`, \`vintage\`, \`source\`, \`romeFapMatchQuality\`, \`confidence\` et \`unknownFields\`.\n\nLes lectures combinees devront distinguer forte tension et faible volume, volume eleve et saisonnier, tension liee aux conditions de travail, ainsi que marche national favorable et presence locale faible. Les fonctions concernees seront le chargeur marche, \`calculateMarketScore\`, les exports et les composants de fiche metier.\n\n## ROME800 puis ROME1000\n\nOrdre conseille : inventaire des codes absents, echantillonnage equilibre par domaine et niveau d'acces, extraction source, controles d'integrite, enrichissement local, regression du matching, verites d'acces et sectorielles, puis performances. Les scripts a etendre sont \`sync-france-travail-rome.mjs\`, \`merge-rome500-batches.mjs\`, \`prepare-v071-local.mjs\`, les validateurs et l'audit.\n\nAucun metier ne doit etre ajoute avant definition des quotas de couverture, seuils de qualite, budget de performance et strategie de migration du corpus.\n\n## Ergonomie\n\nPrevoir des cartes metier repliees avec l'essentiel visible, des details a la demande, une separation nette des categories, et un mode technique masque par defaut. Pour le marche, employer des barometres simples avec libelles textuels : la couleur ne doit jamais porter seule l'information. Verifier bureau, mobile, clavier, impression, jour/nuit et conservation du focus.\n`;
}

async function writeJson(fileName, value) {
  await writeFile(path.join(DELIVERY_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonRequired(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
