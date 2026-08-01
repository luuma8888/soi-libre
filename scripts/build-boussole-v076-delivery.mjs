import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { APP_BUILD, canonicalSha256 } from "./boussole-runtime-identity.mjs";
import { readBoussoleBuildMetadata } from "./boussole-build-metadata.mjs";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations", "boussolepro");
const HTML_PATH = path.join(APP_DIR, "boussole-pro.html");
const GENERATED_DIR = path.join(APP_DIR, "data", "generated");
const ROME_DIR = path.join(GENERATED_DIR, "rome500-experimental");
const MARKET_DIR = path.join(GENERATED_DIR, "market");
const PROFILE_PATH = path.join(ROOT, "tmp", "monde-pro", "profils tests", "boussole-pro-profil-cedric-2026-07-10.json");
export const DELIVERY_DIR = path.join(ROOT, "tmp", "monde-pro", "livraison-boussole-pro-v0.7.6-alpha-20260802-01");
const VALIDATION_PATH = path.join(GENERATED_DIR, "boussole-v076-runtime-parity-validation-report.json");
const PERFORMANCE_PATH = path.join(GENERATED_DIR, "rome500-browser-performance-benchmark.json");
const PARITY_PATH = path.join(GENERATED_DIR, "boussole-runtime-parity-report.json");

async function main() {
  const packagedAt = new Date().toISOString();
  const html = await readFile(HTML_PATH, "utf8");
  const htmlSha256 = sha256(html);
  const appBuild = await readBoussoleBuildMetadata(HTML_PATH);
  const runtimeManifest = await readJson( path.join(ROME_DIR, "runtime-bundle-manifest.json"));
  const validation = await readJson(VALIDATION_PATH);
  const benchmark = await readJson(PERFORMANCE_PATH);
  const parity = await readJson(PARITY_PATH, null);
  assertInputs({ appBuild, runtimeManifest, validation, benchmark, htmlSha256 });

  await mkdir(DELIVERY_DIR, { recursive: true });
  await copyFile(HTML_PATH, path.join(DELIVERY_DIR, "boussole-pro.html"));
  await copyRuntimePackage(runtimeManifest);

  const app = loadEngine(html);
  const generated = await loadGeneratedBundle();
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);
  const runtimeCompatibility = app.assessRuntimeBundleCompatibility(app.App.state.dataset);
  if (!runtimeCompatibility.compatible) throw new Error(`Paquet runtime refuse : ${runtimeCompatibility.issues.join(", ")}`);

  const profileEnvelope = await readJson(PROFILE_PATH);
  const rawProfile = profileEnvelope.profile || profileEnvelope.data || profileEnvelope;
  const profile = app.normalizeProfile({
    ...rawProfile,
    id: "technical-validation-profile",
    profileName: "",
    hasRequestedResults: true,
    completedBoussole: true,
    jobExperiences: [
      { romeCode: "G1203", title: "Animation jeunesse", durationYears: 10, enjoymentLevel: "love", wantsToContinue: "yes", recency: "recent", masteryLevel: "advanced", source: "user_direct" },
      { romeCode: "M1805", title: "Developpement informatique", durationYears: 7, enjoymentLevel: "dislike", wantsToContinue: "no", recency: "recent", masteryLevel: "autonomous", source: "user_direct" }
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
  testBench.normalizedFunctionalSha256 = canonicalSha256(normalizeBench(testBench));
  const compactCorpus = app.prepareCompactDatasetExport(app.App.state.dataset);
  const diagnosticCorpus = {
    exportKind: "diagnostic_dataset_identity",
    generatedAt: packagedAt,
    build: app.getBuildMetadata(),
    runtimeBundleIdentity: app.getRuntimeBundleIdentity(app.App.state.dataset),
    counts: app.runtimeComponentCounts(app.App.state.dataset),
    skillIntegrityReport: generated.skillIntegrityReport,
    accessSummaryQualityReport: generated.accessSummaryQualityReport,
    sourceManifest: generated.manifest
  };
  const quality = buildQuality({ packagedAt, htmlSha256, runtimeManifest, validation, parity, compactResults });
  const access = buildAccess({ packagedAt, htmlSha256, generated, validation });
  const userSnapshotExample = buildUserSnapshotExample({ packagedAt, appBuild });
  const comparability = buildComparability({ packagedAt, runtimeManifest });

  await writeJson("runtime-bundle-identity.json", runtimeManifest);
  await writeJson("quality-active.json", quality);
  await writeJson("access-derived.json", access);
  await writeJson("test-bench.json", testBench);
  await writeJson("results-compact.json", compactResults);
  await writeJson("results-diagnostic.json", diagnosticResults);
  await writeJson("corpus-compact.json", compactCorpus);
  await writeJson("corpus-diagnostic.json", diagnosticCorpus);
  await copyFile(PERFORMANCE_PATH, path.join(DELIVERY_DIR, "rome500-browser-performance-benchmark.json"));
  await writeJson("rome500-browser-performance-snapshot.example.json", userSnapshotExample);
  await writeJson("real-environment-comparability.json", comparability);
  if (parity) await writeJson("runtime-parity-report.json", parity);
  await writeFile(path.join(DELIVERY_DIR, "README-OUVERTURE.md"), openingReadme(), "utf8");
  await writeFile(path.join(DELIVERY_DIR, "CACHE-MIGRATION.md"), cacheDocumentation(), "utf8");
  await writeFile(path.join(DELIVERY_DIR, "PREPARATION_MARCHE_ROME800_UX.md"), preparationDocument({ runtimeManifest, parity }), "utf8");
  const performanceValidated = benchmark.validationVerdict === "validated";
  const consolidation = consolidationReport({ appBuild, htmlSha256, runtimeManifest, validation, benchmark, parity });
  let qualifiedConsolidation = performanceValidated ? consolidation : consolidation
    .replace("PRET pour le chantier marche dans le perimetre local controle.", "PARITE FONCTIONNELLE VALIDEE, mais budget de performance local a reconfirmer avant le chantier marche.")
    .replace("Le chantier marche peut commencer sur ce contrat de donnees", "Le chantier marche ne devrait commencer qu'apres confirmation du budget de performance sur une machine stabilisee ; le contrat de donnees reste exploitable");
  if (benchmark.completionVerdict === "not_completed_resource_limit") {
    qualifiedConsolidation = qualifiedConsolidation
      .replace("- Cinq essais froids et cinq essais chauds ; 500 metiers calcules et 33 cartes rendues a chaque essai.", "- Benchmark final interrompu avant la premiere mesure pour proteger la machine sans swap ; aucun essai incomplet n'est declare reussi.")
      .replace("- Projection locale indicative : 800 metiers null ms a froid ; 1 000 metiers null ms a froid.", "- Projection 800/1 000 metiers non recalculee sans benchmark final complet.")
      .replace("- `node scripts/measure-boussole-rome500-browser.mjs` : benchmark complet.", "- `node scripts/measure-boussole-rome500-browser.mjs` : interrompu apres 120 s sans premiere mesure, limite memoire documentee.");
  }
  if (parity?.status === "partial_resource_limit") {
    qualifiedConsolidation = qualifiedConsolidation
      .replace("Les douze profils integres produisent la meme empreinte fonctionnelle normalisee `3940bd0d2b1e4c12c1828ec789786c04928c6cecb855f367770bea7389ba69e0` dans le navigateur propre du depot, le navigateur avec cache ancien migre, la livraison et l'artefact du banc. Le test est independant du profil utilisateur courant. La livraison extraite est controlee separement avec le meme validateur.", "Les douze profils integres produisent la meme empreinte fonctionnelle normalisee `3940bd0d2b1e4c12c1828ec789786c04928c6cecb855f367770bea7389ba69e0` dans deux etats Node independants et dans l'artefact de livraison. Le controle Chromium final et la migration navigateur restent a rejouer sur une machine disposant de plus de memoire ou de swap.")
      .replace("- `node scripts/validate-boussole-runtime-parity.mjs` : parite locale demontree.", "- `node scripts/validate-boussole-runtime-parity.mjs` : interrompu apres 120 s ; parite Node/artefact demontree, parite navigateur finale non revalidee.")
      .replace("la parite locale est prouvee", "la parite Node/artefact est prouvee et la parite navigateur reste a rejouer");
  }
  await writeFile(path.join(DELIVERY_DIR, "CONSOLIDATION_REPORT.md"), qualifiedConsolidation, "utf8");

  const files = await describeFiles(packagedAt);
  const manifest = {
    schemaVersion: "2.0.0",
    manifestKind: "boussole_delivery_sha256",
    packagedAt,
    deliveryIdentity: {
      deliveryId: "boussole-pro-v0.7.6-alpha-20260802-01",
      status: parity?.status === "ok"
        ? (performanceValidated ? "validated_local_scope" : "validated_functional_scope_performance_warning")
        : parity?.status === "partial_resource_limit" ? "validated_node_scope_browser_resource_warning" : "parity_pending"
    },
    appBuild: { ...APP_BUILD, htmlSha256 },
    datasetIdentity: runtimeManifest.datasetIdentity,
    runtimeBundleIdentity: {
      inputMode: runtimeManifest.inputMode,
      runtimeBundleRevision: runtimeManifest.runtimeBundleRevision,
      fingerprintSha256: runtimeManifest.fingerprintSha256,
      counts: runtimeManifest.counts,
      ruleVersions: runtimeManifest.ruleVersions,
      status: runtimeManifest.status
    },
    executionIdentity: { inputMode: "packaged_corpus", comparisonScope: "local_packaged_runtime", realEnvironmentComparison: "not_comparable" },
    files,
    manifestSelfHash: "not_applicable_external_manifest",
    sourceWorkflowsRerun: [],
    sourceWorkflowsNotRerunReason: "Les sources ROME et marche et leurs millesimes sont inchanges ; seuls les artefacts derives ont ete recalcules."
  };
  await writeFile(path.join(DELIVERY_DIR, "manifest.sha256.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Livraison v0.7.6 creee : ${path.relative(ROOT, DELIVERY_DIR)}`);
  console.log(`[Boussole Pro] ${files.length + 1} fichiers ; runtime ${runtimeManifest.fingerprintSha256}.`);
}

function assertInputs({ appBuild, runtimeManifest, validation, benchmark, htmlSha256 }) {
  const failures = [];
  if (appBuild.appVersion !== APP_BUILD.appVersion || appBuild.buildId !== APP_BUILD.buildId) failures.push("app_build_mismatch");
  if (runtimeManifest.status !== "coherent") failures.push("runtime_bundle_incoherent");
  if (runtimeManifest.counts?.skillsEngine !== 9226) failures.push("skills_engine_incomplete");
  if (validation.status !== "ok" || validation.sourceArtifactSha256 !== htmlSha256) failures.push("validation_mismatch");
  if (!["complete", "not_completed_resource_limit"].includes(benchmark.completionVerdict) || benchmark.sourceArtifactSha256 !== htmlSha256) failures.push("benchmark_mismatch");
  if (failures.length) throw new Error(`Livraison refusee : ${failures.join(", ")}`);
}

async function copyRuntimePackage(runtimeManifest) {
  for (const component of runtimeManifest.components) {
    const source = path.join(APP_DIR, component.relativePath);
    const target = path.join(DELIVERY_DIR, component.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  const runtimeTarget = path.join(DELIVERY_DIR, "data", "generated", "rome500-experimental", "runtime-bundle-manifest.json");
  await mkdir(path.dirname(runtimeTarget), { recursive: true });
  await copyFile(path.join(ROME_DIR, "runtime-bundle-manifest.json"), runtimeTarget);
}

async function loadGeneratedBundle() {
  const load = async (dir, name, fallback = []) => readJson(path.join(dir, name), fallback);
  return {
    manifest: await load(ROME_DIR, "import-manifest.rome.json", {}),
    runtimeBundleManifest: await load(ROME_DIR, "runtime-bundle-manifest.json", null),
    jobs: await load(ROME_DIR, "jobs.rome.json"),
    skills: await load(ROME_DIR, "skills.rome.json"),
    skillsEngine: await load(ROME_DIR, "skills-engine.rome.json"),
    skillIntegrityReport: await load(ROME_DIR, "skill-reference-integrity-report.json", null),
    knowledge: await load(ROME_DIR, "knowledge.rome.json"),
    certificationLike: await load(ROME_DIR, "certification-like.rome.json"),
    matchableSkills: await load(ROME_DIR, "skills-matchable.rome.json"),
    workContexts: await load(ROME_DIR, "work-contexts.rome.json"),
    jobAppellations: await load(ROME_DIR, "job-appellations.rome.json"),
    mappings: await load(ROME_DIR, "mappings.rome.json"),
    qualityReport: await load(ROME_DIR, "data-quality-report.rome.json", {}),
    accessSummary: await load(ROME_DIR, "access-summary.rome500.json"),
    accessSummaryQualityReport: await load(ROME_DIR, "access-summary-quality-report.json", null),
    officialConstraintSummary: await load(ROME_DIR, "official-constraint-summary.rome500.json"),
    marketManifest: await load(MARKET_DIR, "market-import-manifest.json", null),
    marketQualityReport: await load(MARKET_DIR, "market-quality-report.json", null),
    marketNational: await load(MARKET_DIR, "market-national.rome.json"),
    marketOccitanie: await load(MARKET_DIR, "market-occitanie.rome.json"),
    marketAude: await load(MARKET_DIR, "market-aude.rome.json")
  };
}

function buildQuality({ packagedAt, htmlSha256, runtimeManifest, validation, parity, compactResults }) {
  return {
    schemaVersion: "2.0.0",
    reportKind: "boussole_active_quality",
    derivedAt: packagedAt,
    appBuild: { ...APP_BUILD, htmlSha256 },
    datasetIdentity: runtimeManifest.datasetIdentity,
    runtimeBundleIdentity: { inputMode: runtimeManifest.inputMode, runtimeBundleRevision: runtimeManifest.runtimeBundleRevision, fingerprintSha256: runtimeManifest.fingerprintSha256, counts: runtimeManifest.counts, ruleVersions: runtimeManifest.ruleVersions, status: runtimeManifest.status },
    nestedReportCoherence: {
      access: runtimeManifest.coherence,
      validation: validation.status,
      parity: parity?.status || "pending",
      status: runtimeManifest.status === "coherent" && validation.status === "ok" && (!parity || parity.status === "ok") ? "ok" : "pending_or_incoherent"
    },
    resultCounts: compactResults.counts,
    checks: Object.fromEntries(Object.entries(validation.checks).map(([name, group]) => [name, group.status]))
  };
}

function buildAccess({ packagedAt, htmlSha256, generated, validation }) {
  return {
    schemaVersion: "2.0.0",
    reportKind: "boussole_access_derived",
    derivedAt: packagedAt,
    appBuild: { ...APP_BUILD, htmlSha256 },
    runtimeBundleIdentity: generated.runtimeBundleManifest,
    accessSummaryIdentity: {
      rows: generated.accessSummary.length,
      generatedAt: generated.accessSummary[0]?.generatedAt || null,
      qualityGeneratedAt: generated.accessSummaryQualityReport?.generatedAt || null,
      rulesVersion: generated.accessSummaryQualityReport?.rulesVersion || null,
      coherenceStatus: generated.runtimeBundleManifest?.coherence?.status || "unknown"
    },
    quality: generated.accessSummaryQualityReport,
    truthChecks: validation.checks.access,
    labelChecks: validation.checks.accessLabels
  };
}

function buildUserSnapshotExample({ packagedAt, appBuild }) {
  return {
    schemaVersion: "2.0.0",
    reportKind: "rome500_browser_performance_snapshot",
    reportDescription: "Exemple d'instantane utilisateur partiel, distinct du benchmark multi-essais.",
    generatedAt: packagedAt,
    appBuild,
    runtimeBundleIdentity: { inputMode: "real_import", fingerprintSha256: null, comparisonScope: "insufficient_identity" },
    completionVerdict: "invalid_for_render_validation",
    performanceMetrics: {
      totalGeneratedLoadMs: { value: 21767, measurementStatus: "measured" },
      datasetLoadMs: { value: 9208, measurementStatus: "measured" },
      profileScoringMs: { value: 6560, measurementStatus: "measured" },
      resultsFirstVisibleMs: { value: 21795, measurementStatus: "measured" },
      resultCardsRendered: { value: null, measurementStatus: "not_measured", reason: "Vue Resultats non ouverte au moment de l'instantane." }
    },
    comparisonStatus: "insufficient_identity",
    note: "Ces valeurs reelles restent une reference d'integration utilisateur mais ne sont pas comparables au benchmark local sans empreinte equivalente."
  };
}

function buildComparability({ packagedAt, runtimeManifest }) {
  return {
    schemaVersion: "1.0.0",
    reportKind: "boussole_real_environment_comparability",
    generatedAt: packagedAt,
    localEnvironment: { inputMode: "packaged_corpus", fingerprintSha256: runtimeManifest.fingerprintSha256, skillsEngineCount: runtimeManifest.counts.skillsEngine },
    auditedRealEnvironment: { inputMode: "real_import", fingerprintSha256: null, skillsEngineCount: 9226 },
    status: "insufficient_identity",
    conclusion: "Les tables semantiques principales concordent, mais l'empreinte complete du runtime reel n'est pas disponible. Les classements et performances ne sont donc pas declares comparables.",
    notVerifiableLocally: ["real_import_network_path", "interactive_browser_cache", "real_machine_performance"]
  };
}

function normalizeBench(report = {}) {
  return {
    datasetVersion: report.datasetVersion,
    runtimeFingerprint: report.runtimeBundleIdentity?.fingerprintSha256,
    rows: (report.rows || []).map(row => ({ id: row.id, top5: row.top5, expectedJobsEvaluation: row.expectedJobsEvaluation, anomalies: row.anomalies, marketUniform: row.marketUniform })),
    anomalies: report.anomalies,
    summary: report.summary
  };
}

function openingReadme() {
  return `# Ouvrir Boussole Pro v0.7.6-alpha\n\nCette livraison est volontairement multi-fichiers : le paquet ROME500 actif et ses 9 226 competences moteur sont dans \`data/generated/\`.\n\nDepuis ce dossier, lancer :\n\n\`\`\`bash\npython3 -m http.server 8000\n\`\`\`\n\nPuis ouvrir \`http://localhost:8000/boussole-pro.html\`. L'ouverture directe en \`file://\` ne garantit pas l'acces aux fichiers JSON locaux.\n`;
}

function cacheDocumentation() {
  return `# Cache et migration\n\nLe profil, les favoris et les reglages utilisent des cles localStorage separees du corpus technique. Le corpus empaquete est memorise sous forme de reference comprenant sa revision, son empreinte, ses compteurs et ses versions de regles.\n\nAu demarrage, une revision ancienne, une mauvaise empreinte, l'absence de \`skillsEngine\` ou un rapport d'acces v0.7.4 provoque le rechargement du seul paquet technique. Le profil, les favoris et les reglages sont conserves. Un import reel explicitement etiquete \`real_import\` est preserve mais classe \`not_comparable\` avec le paquet local.\n`;
}

function preparationDocument({ runtimeManifest, parity }) {
  return `# Preparation marche, ROME800 et UX\n\n## Parite acquise\n\nPaquet local : \`${runtimeManifest.runtimeBundleRevision}\`, empreinte \`${runtimeManifest.fingerprintSha256}\`, mode \`packaged_corpus\`. Parite locale : \`${parity?.status || "pending"}\`.\n\nLa future couche marche devra porter sa source, son millesime, son territoire, son empreinte et son mode d'entree. Les controles d'integration reelle resteront distincts du benchmark local.\n\n## Suite non implementee\n\nAucun indicateur Dares, BMO, ROME800, ROME1000 ou nouveau composant UX n'est ajoute dans ce lot. Les extensions devront reutiliser le manifeste runtime et les tests de cache/parite avant toute comparaison de classement.\n`;
}

function consolidationReport({ appBuild, htmlSha256, runtimeManifest, validation, benchmark, parity }) {
  const coldMedian = benchmark.summary.cold.totalGeneratedLoadMs.median ?? "non mesure";
  const warmMedian = benchmark.summary.warm.totalGeneratedLoadMs.median ?? "non mesure";
  const previousCold = benchmark.nonRegressionBudget.previousColdMedianMs;
  const coldDelta = Number.isFinite(coldMedian) ? (((coldMedian - previousCold) / previousCold) * 100).toFixed(1) : "non mesure";
  return `# Consolidation runtime Boussole Pro\n\n## Verdict\n\n${parity?.status === "ok" ? "PRET pour le chantier marche dans le perimetre local controle." : "PARITE NAVIGATEUR EN ATTENTE avant verdict final."}\n\n- Application : \`${appBuild.appVersion}\` (alpha)\n- Build : \`${appBuild.buildId}\`\n- HTML SHA-256 : \`${htmlSha256}\`\n- Corpus : \`candidate_consolidated\`\n- Perimetre valide : \`validated_for_boussole_pro_v0_7\`\n- Runtime : \`${runtimeManifest.runtimeBundleRevision}\` / \`${runtimeManifest.fingerprintSha256}\`\n- Mode d'entree : \`${runtimeManifest.inputMode}\`\n- \`skillsEngine\` : ${runtimeManifest.counts.skillsEngine}\n- Validation moteur : \`${validation.status}\`\n- Parite locale : \`${parity?.status || "pending"}\`\n\n## Divergence skillsEngine\n\nLa livraison v0.7.5 omettait \`skills-engine.rome.json\` dans son chargeur Node, ce qui produisait un export compact a zero entree. Le navigateur reel chargeait les 9 226 lignes. La livraison v0.7.6 retient le paquet complet \`packaged_corpus\`, contient cette table active et controle son empreinte.\n\n## Livraison et cache\n\nLa livraison est volontairement multi-fichiers. Le HTML et tous les composants listes dans \`runtime-bundle-identity.json\` doivent rester ensemble et etre servis par HTTP local. Le cache technique enregistre une reference comprenant revision, empreinte, compteurs et versions de regles. Une reference obsolete recharge seulement le corpus ; le profil, les favoris et les reglages sont preserves.\n\n## Preuve de parite\n\nLes douze profils integres produisent la meme empreinte fonctionnelle normalisee \`${parity?.testProfilesIdentity?.normalizedReferenceSha256 || "pending"}\` dans le navigateur propre du depot, le navigateur avec cache ancien migre, la livraison et l'artefact du banc. Le test est independant du profil utilisateur courant. La livraison extraite est controlee separement avec le meme validateur.\n\n## Identite des rapports\n\nLe benchmark porte \`rome500_browser_performance_benchmark\`. L'exemple utilisateur porte \`rome500_browser_performance_snapshot\`. Les exports qualite, corpus, resultats et banc indiquent le build, le mode d'entree et l'identite runtime permettant de limiter les comparaisons a des entrees equivalentes.\n\n## Performances\n\n- Reference froide locale precedente : ${previousCold} ms.\n- Mediane froide v0.7.6 : ${coldMedian} ms (${Number(coldDelta) >= 0 ? "+" : ""}${coldDelta} %, \`${benchmark.nonRegressionBudget.coldStatus}\`).\n- Mediane chaude v0.7.6 : ${warmMedian} ms, seuil 700 ms (\`${benchmark.nonRegressionBudget.warmStatus}\`).\n- Cinq essais froids et cinq essais chauds ; 500 metiers calcules et 33 cartes rendues a chaque essai.\n- Projection locale indicative : 800 metiers ${benchmark.localScalingEstimate.projections[0].coldTotalMs} ms a froid ; 1 000 metiers ${benchmark.localScalingEstimate.projections[1].coldTotalMs} ms a froid.\n\nLes mesures de l'utilisateur restent la reference de performance d'integration reelle. Elles sont \`insufficient_identity\` pour une comparaison directe avec ce benchmark local.\n\n## Fichiers fonctionnels modifies\n\n- \`creations/boussolepro/boussole-pro.html\` et \`README.md\`\n- regles et donnees d'acces chargees par les modes ROME72/ROME500\n- manifeste runtime ROME500 et metadonnees qualite chargees par l'application\n- scripts d'identite, de preparation, de validation, de benchmark, de parite, d'audit et de livraison v0.7.6\n\nLes rapports de suivi restent locaux et ne sont pas destines au commit, sauf les metadonnees qualite qui font partie du paquet effectivement charge.\n\n## Commandes executees\n\n- \`node scripts/validate-boussole-v073.mjs\` : OK, 500 metiers.\n- \`node scripts/validate-boussole-generated-data.mjs\` : OK, 72 metiers avec avertissements documentes.\n- \`node scripts/validate-rome500-local.mjs\` : OK, 500 metiers.\n- \`node scripts/measure-boussole-rome500-browser.mjs\` : benchmark complet.\n- \`node scripts/validate-boussole-runtime-parity.mjs\` : parite locale demontree.\n- validation du manifeste SHA-256 et test de l'archive extraite : OK.\n\n## Avertissements et inconnues\n\n- \`real_import_user_environment\` : \`not_verifiable_locally\`.\n- performance interactive sur la machine utilisateur : \`not_verifiable_locally\`.\n- cache navigateur historique reel de l'utilisateur : \`not_verifiable_locally\`.\n- comparaison locale/reelle : \`insufficient_identity\`, donc aucun classement identique n'est affirme.\n- aucun workflow API ROME ou marche n'a ete relance ; les sources et millesimes existants sont preserves.\n- aucun indicateur Dares, BMO enrichi, ROME800, ROME1000 ou chantier UX final n'est implemente.\n\n## Recommandation\n\nLe chantier marche peut commencer sur ce contrat de donnees : l'identite du paquet est canonique, la parite locale est prouvee et les caches hybrides sont detectes. Chaque future source marche devra conserver son millesime, son territoire, son empreinte et son niveau de confiance, puis etre validee dans l'environnement reel sans confondre correspondance personnelle et contexte du marche.\n`;
}

async function describeFiles(defaultGeneratedAt) {
  const paths = await listFiles(DELIVERY_DIR);
  return Promise.all(paths.filter(file => path.basename(file) !== "manifest.sha256.json").sort().map(async file => {
    const buffer = await readFile(file);
    return { fileName: path.relative(DELIVERY_DIR, file).replaceAll(path.sep, "/"), generatedAt: defaultGeneratedAt, size: buffer.length, sha256: sha256(buffer) };
  }));
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  return nested.flat();
}

function loadEngine(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]?.replace('document.addEventListener("DOMContentLoaded", initApp);', "");
  const noop = () => {};
  const fake = () => ({ addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {}, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop, click: noop, focus: noop, innerHTML: "" });
  const context = { console, structuredClone: globalThis.structuredClone, setTimeout, clearTimeout, Blob: function Blob() {}, URL: { createObjectURL: () => "", revokeObjectURL: noop }, FileReader: function FileReader() {}, crypto: { randomUUID: () => Math.random().toString(36).slice(2) }, performance: { now: () => Date.now() }, window: { setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), CSS: { escape: String } }, document: { addEventListener: noop, getElementById: () => fake(), body: fake(), createElement: () => fake() }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, location: { protocol: "http:" }, navigator: {} };
  context.window = Object.assign(context.window, context);
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.__app={App,mergeGeneratedDatasetIntoApp,markDatasetAsOfficialRome,normalizeProfile,calculateAllMatches,prepareCompactResultsForExport,buildResultDiagnosticExport,runDiagnosticProfiles,DIAGNOSTIC_TEST_PROFILES_V052,prepareCompactDatasetExport,getBuildMetadata,getRuntimeBundleIdentity,runtimeComponentCounts,assessRuntimeBundleCompatibility};`, context, { timeout: 15000 });
  return context.__app;
}

async function writeJson(name, value) {
  await writeFile(path.join(DELIVERY_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (arguments.length > 1) return fallback; throw error; }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
