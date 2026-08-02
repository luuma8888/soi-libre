import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "creations", "boussolepro");
const ROME_DIR = path.join(APP_DIR, "data", "generated", "rome500-experimental");
const MARKET_DIR = path.join(APP_DIR, "data", "generated", "market");
const TRACKING_DIR = path.join(ROOT, "tmp", "monde-pro");
export const DELIVERY_DIR = path.join(TRACKING_DIR, "livraison-boussole-pro-v0.7.7-alpha-20260802-market-phase1-01");

const paths = {
  html: path.join(APP_DIR, "boussole-pro.html"),
  runtime: path.join(ROME_DIR, "runtime-bundle-manifest.json"),
  marketIdentity: path.join(MARKET_DIR, "market-package-identity.json"),
  marketQuality: path.join(MARKET_DIR, "market-quality-report.json"),
  validation: path.join(APP_DIR, "data", "generated", "boussole-v077-market-phase1-validation-report.json"),
  truth: path.join(TRACKING_DIR, "boussole-market-phase1-truth-report.json"),
  influence: path.join(TRACKING_DIR, "boussole-market-influence-audit.json"),
  browserBenchmark: path.join(APP_DIR, "data", "generated", "rome500-browser-performance-benchmark.json")
};

const [runtime, marketIdentity, marketQuality, validation, truth, influence] = await Promise.all([
  readJson(paths.runtime), readJson(paths.marketIdentity), readJson(paths.marketQuality), readJson(paths.validation), readJson(paths.truth), readJson(paths.influence)
]);
assertReady({ runtime, marketIdentity, marketQuality, validation, truth, influence });

await mkdir(DELIVERY_DIR, { recursive: true });
await copyFile(paths.html, path.join(DELIVERY_DIR, "boussole-pro.html"));
for (const component of runtime.components) await copyRelativeComponent(component.relativePath);
await copyFile(paths.runtime, path.join(DELIVERY_DIR, "runtime-bundle-identity.json"));
await copyFile(paths.runtime, path.join(DELIVERY_DIR, "data", "generated", "rome500-experimental", "runtime-bundle-manifest.json"));
for (const component of marketIdentity.components) await copyMarketFile(component.fileName);
for (const fileName of ["market-package-identity.json", "market-quality-report.json", "market-import-manifest.json"]) await copyMarketFile(fileName);

await copyFile(paths.validation, path.join(DELIVERY_DIR, "test-bench-and-runtime-validation.json"));
await copyFile(paths.truth, path.join(DELIVERY_DIR, "market-truth-cases-report.json"));
await copyFile(paths.influence, path.join(DELIVERY_DIR, "market-influence-and-performance-audit.json"));
await copyFile(paths.browserBenchmark, path.join(DELIVERY_DIR, "rome500-browser-performance-benchmark.json"));
await copyFile(path.join(ROME_DIR, "data-quality-report.rome.json"), path.join(DELIVERY_DIR, "quality-runtime-rome500.json"));
await writeJson("quality-market-summary.json", marketQuality);
await writeJson("rome500-browser-performance-snapshot.example.json", userSnapshotExample(runtime, marketIdentity));
await writeFile(path.join(DELIVERY_DIR, "README-OUVERTURE.md"), openingGuide(), "utf8");
await writeFile(path.join(DELIVERY_DIR, "CONSOLIDATION_REPORT.md"), consolidation({ runtime, marketIdentity, marketQuality, validation, truth, influence }), "utf8");
await writeFile(path.join(DELIVERY_DIR, "PREPARATION_PHASE_SUIVANTE.md"), nextPhase(), "utf8");

const files = await describeFiles();
const manifest = {
  schemaVersion: "2.1.0",
  manifestKind: "boussole_delivery_sha256",
  packagedAt: new Date().toISOString(),
  deliveryIdentity: { deliveryId: "boussole-pro-v0.7.7-alpha-20260802-market-phase1-01", status: "validated_local_scope_with_known_fap_rome_gap" },
  appBuild: { appVersion: "v0.7.7-alpha", buildId: "20260802-market-phase1-01", buildDate: "2026-08-02", htmlSha256: await shaFile(paths.html) },
  runtimeBundleIdentity: { runtimeBundleRevision: runtime.runtimeBundleRevision, fingerprintSha256: runtime.fingerprintSha256, counts: runtime.counts, status: runtime.status },
  marketLayerIdentity: marketIdentity,
  executionIdentity: { inputMode: "packaged_corpus", comparisonScope: "local_packaged_runtime", realEnvironmentComparison: "not_comparable" },
  sourceWorkflowsRerun: [],
  sourceWorkflowsPrepared: ["generate-market-data"],
  files
};
await writeFile(path.join(DELIVERY_DIR, "manifest.sha256.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`[Boussole Pro] Livraison créée : ${path.relative(ROOT, DELIVERY_DIR)} (${files.length + 1} fichiers).`);

function assertReady(inputs) {
  const failures = [];
  if (inputs.runtime.status !== "coherent") failures.push("runtime_incoherent");
  if (inputs.runtime.appBuild?.buildId !== "20260802-market-phase1-01") failures.push("runtime_build_mismatch");
  if (inputs.marketIdentity.packageFingerprintSha256 !== inputs.runtime.marketLayerIdentity?.packageFingerprintSha256) failures.push("market_identity_mismatch");
  if (inputs.marketQuality.status !== "completed_with_known_source_gap") failures.push("market_quality_not_ready");
  if (inputs.validation.status !== "ok") failures.push("validation_failed");
  if (inputs.truth.verdict !== "passed") failures.push("truth_cases_failed");
  if (!String(inputs.influence.verdict).startsWith("passed")) failures.push("influence_audit_failed");
  if (failures.length) throw new Error(`Livraison refusée : ${failures.join(", ")}`);
}

async function copyRelativeComponent(relativePath) {
  const source = path.join(APP_DIR, relativePath);
  const target = path.join(DELIVERY_DIR, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyMarketFile(fileName) {
  const source = path.join(MARKET_DIR, fileName);
  const target = path.join(DELIVERY_DIR, "data", "generated", "market", fileName);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function describeFiles() {
  const rows = [];
  for (const filePath of await walk(DELIVERY_DIR)) {
    if (path.basename(filePath) === "manifest.sha256.json") continue;
    const info = await stat(filePath);
    rows.push({ relativePath: path.relative(DELIVERY_DIR, filePath).replaceAll(path.sep, "/"), size: info.size, sha256: await shaFile(filePath) });
  }
  return rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walk(directory) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await walk(fullPath));
    else rows.push(fullPath);
  }
  return rows;
}

function openingGuide() {
  return `# Ouvrir Boussole Pro v0.7.7-alpha\n\nCette livraison est multi-fichiers et fonctionne sans CDN ni API externe au démarrage. Depuis ce dossier :\n\n\`\`\`bash\npython3 -m http.server 8000\n\`\`\`\n\nOuvrir ensuite \`http://localhost:8000/boussole-pro.html\`. Vérifier dans la barre d’état : \`v0.7.7-alpha\` et \`20260802-market-phase1-01\`. L’ouverture directe en \`file://\` peut empêcher le chargement des JSON locaux.\n`;
}

function consolidation({ runtime, marketIdentity, marketQuality, validation, truth, influence }) {
  return `# Consolidation Boussole Pro — marché phase 1\n\n## Verdict\n\nPhase 1 fonctionnelle dans le périmètre local contrôlé, en version intermédiaire \`v0.7.7-alpha\`. La liaison officielle FAP 2021 vers ROME 4 reste absente et n’est pas simulée.\n\n## Socle conservé\n\n- Corpus ROME500 candidat consolidé, 500 métiers et ${runtime.counts.skillsEngine} compétences moteur.\n- Profil, favoris, réglages, import/export, thème, impression et cache runtime séparé.\n- Runtime \`${runtime.runtimeBundleRevision}\`, empreinte \`${runtime.fingerprintSha256}\`.\n\n## Vérité des indicateurs\n\n- ${marketIdentity.counts.offerNational} lignes France, ${marketIdentity.counts.offerRegional} Occitanie et ${marketIdentity.counts.offerDepartmental} Aude décrivent uniquement le volume d’offres et la présence territoriale.\n- ${marketIdentity.counts.bmoFapRows} lignes BMO 2026 et ${marketIdentity.counts.daresTensionFapRows} lignes Dares 2024 sont normalisées au niveau FAP 2021.\n- Tension, difficulté et saisonnalité restent \`unknown\` sur les fiches ROME tant qu’un rapprochement contrôlé manque.\n- Correspondances FAP–ROME admissibles au classement : ${marketIdentity.counts.fapRomeRankingEligible}. Correspondances absentes : ${marketIdentity.mappingCoverage.absent}.\n\n## Scores et tests\n\n- Cas-vérités : ${truth.counts.fixtures}/${truth.counts.fixtures}, échec ${truth.counts.failures}.\n- Banc intégré : ${validation.checks.testBenchDeterminism.profilesCount} profils, statut \`${validation.status}\`.\n- Différences d’adéquation personnelle : ${influence.scoreStability.personalFitDifferences}. Différences de faisabilité : ${influence.scoreStability.feasibilityDifferences}.\n- Le poids marché demandé, effectif et l’effet en points sont exposés dans les exports.\n- Changements de positions Top 10 : ${influence.rankingInfluence.totalChangedTop10Positions} sur ${influence.rankingInfluence.profilesWithTop10Changes} profils, dus à la suppression de la pondération implicite historique.\n\n## Performance locale\n\n- Douze profils avant : ${influence.performance.baseline12ProfilesMs} ms.\n- Douze profils après : ${influence.performance.current12ProfilesMs} ms, soit ${influence.performance.deltaPercent >= 0 ? "+" : ""}${influence.performance.deltaPercent} %.\n- Construction de 500 synthèses marché : ${influence.performance.marketSynthesis500Ms} ms.\n\nLa performance réelle de l’environnement utilisateur reste à mesurer après déploiement.\n\n## Sources et workflow\n\nLes sources officielles BMO 2026, Dares 2024 et FAP 2021 ont été téléchargées et exécutées localement. Aucun workflow GitHub ni workflow ROME n’a été relancé pendant cette mission. Le workflow marché est prêt pour une régénération réelle reproductible.\n\n## Limite principale\n\n${marketQuality.knownLimits.join(" ")} La prochaine entrée requise est une table officielle ou validée FAP 2021 vers ROME 4 avec cardinalités et références.\n`;
}

function nextPhase() {
  return `# Préparation de la phase suivante\n\n1. Valider l’affichage marché et les nouveaux rangs dans l’environnement réel.\n2. Obtenir ou valider une table FAP 2021 vers ROME 4, sans correspondance arbitraire.\n3. Activer progressivement BMO et Dares sur les fiches seulement pour les rapprochements admissibles.\n4. Rejouer les cas-vérités, les douze profils et le benchmark navigateur.\n5. Reporter ROME800/1000, les tendances historiques et la refonte UX complète à leurs chantiers dédiés.\n`;
}

function userSnapshotExample(runtime, marketIdentity) {
  return {
    schemaVersion: "2.1.0",
    reportKind: "rome500_browser_performance_snapshot",
    reportDescription: "Exemple de structure, pas une mesure réelle de l'utilisateur.",
    generatedAt: new Date().toISOString(),
    appBuild: { appVersion: "v0.7.7-alpha", buildId: "20260802-market-phase1-01" },
    runtimeBundleIdentity: { inputMode: "real_import", expectedPackagedFingerprint: runtime.fingerprintSha256, comparisonScope: "insufficient_identity" },
    marketLayerIdentity: marketIdentity,
    completionVerdict: "example_not_measured",
    performanceMetrics: {}
  };
}

async function writeJson(fileName, value) {
  await writeFile(path.join(DELIVERY_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function shaFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
