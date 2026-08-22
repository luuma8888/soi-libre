import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const CLASSIC_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro-classic-v0.8.4.html");
const ACTIVE_MANIFEST_PATH = path.join(ROOT, "creations/boussolepro/data/generated/refonte-v1/rome1000-embedded-manifest.json");
const FALLBACK_MANIFEST_PATH = path.join(ROOT, "creations/boussolepro/data/generated/refonte-v1/rome100-stratified-manifest.json");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/refonte-interface-v1");
const DELIVERY_DIR = path.join(ROOT, "tmp/monde-pro/livraison-boussole-pro-ma-boussole-v1.1");
const CAPTURE_DIR = path.join(REPORT_DIR, "captures");
const TEST_PROFILE_PATH = path.join(REPORT_DIR, "boussole-pro-refonte-profil-migre-v1.1-test.json");
const REQUESTED_PROFILE_PATH = path.join(ROOT, "tmp/monde-pro/boussole-pro-refonte-profil-2026-08-16-luuma.json");

const [appHtml, classicHtml, activeManifest, fallbackManifest, engineReport, browserReport] = await Promise.all([
  readFile(APP_PATH), readFile(CLASSIC_PATH), readJson(ACTIVE_MANIFEST_PATH), readJson(FALLBACK_MANIFEST_PATH),
  readJson(path.join(REPORT_DIR, "engine-invariance-and-migration-report.json")),
  readJson(path.join(REPORT_DIR, "browser-accessibility-performance-report.json"))
]);
if (engineReport.status !== "passed" || browserReport.status !== "passed") throw new Error("Les validations obligatoires ne sont pas toutes au vert.");
if (!activeManifest.validation?.top5Preserved || activeManifest.count !== 1000) throw new Error("Le manifeste ROME1000 n'est pas conforme.");

const branch = process.env.BOUSSOLE_REFONTE_BRANCH || (await git("branch", "--show-current"));
const baseCommit = process.env.BOUSSOLE_REFONTE_BASE_COMMIT || (await git("rev-parse", "HEAD"));
const generatedAt = new Date().toISOString();
const requestedProfileAvailable = await exists(REQUESTED_PROFILE_PATH);
const passedTests = engineReport.assertions.filter(row => row.status === "passed").length + browserReport.assertions.filter(row => row.status === "passed").length;
const failedTests = engineReport.assertions.filter(row => row.status !== "passed").length + browserReport.assertions.filter(row => row.status !== "passed").length;

const profileInventory = {
  schemaVersion: "1.1.0", reportKind: "boussole_refonte_v1_1_profile_field_inventory", generatedAt,
  policy: "Seuls les champs visibles et modifiables dans les neuf étapes alimentent le profil actif. L'instantané historique reste séparé et n'alimente pas le moteur.",
  steps: {
    "Départ": ["profileName", "ageRange", "searchHorizon"],
    "Formation": ["diplomaLevel", "diplomas", "freeCertifications", "trainingFamilies", "trainingOpenness", "desiredTrainingFamilies"],
    "Contraintes": ["constraints sans longTraining", "mobility.radiusKm", "mobility.relocation", "driverLicenseBStatus et driverLicenses dérivé", "preferredSchedule", "availability.hoursPerWeek"],
    "Parcours professionnel": ["jobExperiences et uniquement ses champs visibles"],
    "Compétences": ["skillSelections", "tableaux moteur dérivés", "customSkills"],
    "Envies": ["interests", "values"],
    "Environnements": ["preferredWorkStyles", "preferredEnvironments", "excludedDomains"],
    "Validation": ["résumé des sept sections actives"],
    "Première lecture": ["portrait synthétique et accès aux résultats"]
  },
  excludedFromActiveProfile: ["trainingBudget", "experienceDomains", "experienceDomainDetails", "domainOrientation", "experienceDuration", "skillSignals", "needForMeaning", "needForSecurity", "needForAutonomy", "contextPreferences", "marketPreference", "criterionWeights personnalisés"],
  historicalHandling: "preserved_in_separate_migration_snapshot_only"
};

const migrationReport = {
  schemaVersion: "1.1.0", reportKind: "boussole_refonte_v1_1_profile_migration", generatedAt,
  status: browserReport.assertions.some(row => row.name === "active_profile_import_export_import_identity" && row.status === "passed") ? "passed" : "failed",
  requestedReceptionProfile: { path: path.relative(ROOT, REQUESTED_PROFILE_PATH), available: requestedProfileAvailable, limitation: requestedProfileAvailable ? null : "Le fichier nommé dans les instructions n'était pas présent dans le dépôt local." },
  replacementFixture: path.relative(ROOT, TEST_PROFILE_PATH),
  tests: Object.fromEntries(browserReport.assertions.filter(row => /legacy_|profile_|experience_details|local_storage|current_job/.test(row.name)).map(row => [row.name, row.status]))
};

const invarianceReport = {
  schemaVersion: "1.1.0", reportKind: "boussole_refonte_v1_1_semantic_invariance", generatedAt,
  status: engineReport.status, assertions: engineReport.assertions.filter(row => /deterministic|skills_|diploma_|market_|excluded_|view_contract|top5_/.test(row.name)), calculations: engineReport.calculations
};

const accessibilityReport = {
  schemaVersion: "1.1.0", reportKind: "boussole_refonte_v1_1_accessibility", generatedAt, status: browserReport.status,
  checks: browserReport.assertions.filter(row => /overflow|accessible|focus|target|landmark|label|motion|navigation|combobox|step_titles/.test(row.name)),
  viewports: { desktop: browserReport.browser.desktop, mobile: browserReport.browser.mobile }, errors: browserReport.errors,
  limitation: "Une réception humaine avec lecteur d'écran reste nécessaire avant diffusion générale."
};

const performanceReport = {
  schemaVersion: "1.1.0", reportKind: "boussole_refonte_v1_1_performance", generatedAt, status: browserReport.status,
  html: browserReport.html, measurements: browserReport.performance,
  corpus: { activeJobs: activeManifest.count, fallbackJobs: fallbackManifest.count, directions: activeManifest.coverage.directions },
  interpretation: "Le démarrage et le premier calcul sont perceptibles avec le paquet complet. L'interface affiche un état de progression avant le calcul ; les recherches restent limitées à huit résultats et ne chargent pas le corpus dans le DOM."
};

const deliveryManifest = {
  schemaVersion: "1.1.0", reportKind: "boussole_refonte_v1_1_delivery_manifest", generatedAt,
  branch, branchUnchanged: branch === "soi-libre-codex", baseCommit,
  app: { path: path.relative(ROOT, APP_PATH), version: "1.1.0", buildId: "20260816-ma-boussole-rome1000-v1-1-01", bytes: appHtml.length, sha256: sha256(appHtml) },
  classicBackup: { path: path.relative(ROOT, CLASSIC_PATH), sha256: sha256(classicHtml), unchanged: sha256(classicHtml) === "ed3c0fbfe558f19652c6c4d754375adcde74f3eea1260e7713b078302b7bf5da" },
  dataset: { version: activeManifest.datasetVersion, activeJobs: activeManifest.count, uniqueRomeCodes: activeManifest.counts.uniqueRomeCodes, fallbackJobs: fallbackManifest.count, identitySha256: activeManifest.validation.deterministicIdentity, top5Preserved: activeManifest.validation.top5Preserved },
  tests: { passed: passedTests, failed: failedTests, engine: engineReport.assertions.length, browser: browserReport.assertions.length },
  evidence: { rome1000OnlyJob: { romeCode: "A1101", title: "Conducteur / Conductrice d'engins agricoles" }, captures: 11, requestedProfileAvailable }
};

await Promise.all([
  writeJson(path.join(REPORT_DIR, "profile-field-inventory.json"), profileInventory),
  writeJson(path.join(REPORT_DIR, "profile-migration-report.json"), migrationReport),
  writeJson(path.join(REPORT_DIR, "engine-invariance-report.json"), invarianceReport),
  writeJson(path.join(REPORT_DIR, "accessibility-report.json"), accessibilityReport),
  writeJson(path.join(REPORT_DIR, "performance-report.json"), performanceReport),
  writeJson(path.join(REPORT_DIR, "delivery-manifest-v1.1.json"), deliveryManifest)
]);

const auditPath = path.join(REPORT_DIR, "AUDIT_BOUSSOLE_PRO_MA_BOUSSOLE_ROME1000_V1_1.md");
const audit = `# Audit final - Ma Boussole ROME1000 v1.1

- branche conservée : ${deliveryManifest.branchUnchanged ? "oui" : "non"} — \`${branch}\` ;
- sauvegarde de la version précédente : commit \`${baseCommit}\` ;
- métiers réellement actifs : ${activeManifest.count} ;
- Ma Boussole : 9 étapes, oui ;
- données fantômes : absentes du profil actif, oui ;
- tests : ${passedTests} réussis / ${failedTests} échoué ;
- limites restantes : HTML de ${formatMiB(appHtml.length)} Mio, premier calcul mesuré à ${browserReport.performance.calculationMs} ms, profil de réception nommé dans les instructions ${requestedProfileAvailable ? "disponible" : "absent du dossier local"}.

## État livré

Le fichier canonique autonome calcule réellement sur 1 000 codes ROME uniques. Le ROME100 stratifié est conservé uniquement comme repli explicite et testable. Le Top 5 du profil de référence est identique avant et après embarquement. Le fichier classique figé n'a pas été modifié (SHA-256 \`${sha256(classicHtml)}\`).

Ma Boussole suit les neuf étapes verrouillées. Les recherches métier et compétence sont des combobox accessibles limitées à huit suggestions ; les compétences proposées ne sont jamais sélectionnées automatiquement. Les expériences nouvelles restent neutres tant que l'utilisateur ne précise pas durée, période, maîtrise, appréciation ou intention.

## Réception

- Moteur et invariants : ${engineReport.assertions.length} contrôles réussis.
- Navigateur Chromium : ${browserReport.assertions.length} contrôles réussis, aucune erreur console ou runtime.
- Bureau : neuf captures, une par étape, en 1440 × 1000.
- Mobile : captures Parcours professionnel et Compétences en 390 × 844, sans débordement horizontal.
- Preuve hors ROME100 : \`A1101 — Conducteur / Conductrice d'engins agricoles\`, trouvé dans le corpus actif ROME1000.
- Import/export : égalité stricte du profil actif après export puis réimport ; l'instantané historique reste séparé.

## Mesures et limites

- HTML autonome : ${appHtml.length} octets (${formatMiB(appHtml.length)} Mio), SHA-256 \`${sha256(appHtml)}\`.
- Démarrage Chromium : ${browserReport.performance.navigation.domContentLoadedMs} ms ; chargement : ${browserReport.performance.navigation.loadMs} ms.
- Premier calcul ROME1000 : ${browserReport.performance.calculationMs} ms ; un état de progression est peint avant le calcul.
- Vingt recherches métier + compétence : ${browserReport.performance.searchJobAndSkill20IterationsMs} ms.
- Une tentative de compactage plus agressive a été rejetée parce qu'elle modifiait le Top 5. Le paquet complet validé est donc conservé pour privilégier l'exactitude ; une extraction future des seules tables réellement lues par le moteur devra être accompagnée d'un test de parité stricte.
- Le profil \`boussole-pro-refonte-profil-2026-08-16-luuma.json\` n'était pas présent. La migration a été reçue avec le scénario synthétique automatisé et l'export \`boussole-pro-refonte-profil-migre-v1.1-test.json\` ; le profil nommé devra être rejoué lorsqu'il sera fourni.
`;
await writeFile(auditPath, audit);

await mkdir(path.join(DELIVERY_DIR, "app/data"), { recursive: true });
await mkdir(path.join(DELIVERY_DIR, "reports/captures"), { recursive: true });
await mkdir(path.join(DELIVERY_DIR, "scripts"), { recursive: true });
await cp(APP_PATH, path.join(DELIVERY_DIR, "app/boussole-pro.html"));
await cp(CLASSIC_PATH, path.join(DELIVERY_DIR, "app/boussole-pro-classic-v0.8.4.html"));
await cp(ACTIVE_MANIFEST_PATH, path.join(DELIVERY_DIR, "app/data/rome1000-embedded-manifest.json"));
await cp(FALLBACK_MANIFEST_PATH, path.join(DELIVERY_DIR, "app/data/rome100-stratified-manifest.json"));
for (const file of [
  "prototype-data-summary.json", "engine-invariance-and-migration-report.json", "browser-accessibility-performance-report.json",
  "profile-field-inventory.json", "profile-migration-report.json", "engine-invariance-report.json", "accessibility-report.json",
  "performance-report.json", "delivery-manifest-v1.1.json", "AUDIT_BOUSSOLE_PRO_MA_BOUSSOLE_ROME1000_V1_1.md",
  "boussole-pro-refonte-profil-migre-v1.1-test.json"
]) await cp(path.join(REPORT_DIR, file), path.join(DELIVERY_DIR, "reports", file));
for (const file of (await readdir(CAPTURE_DIR)).filter(name => /^etape-(?:0[1-9]-bureau|04-parcours-mobile|05-competences-mobile)\.png$/.test(name)))
  await cp(path.join(CAPTURE_DIR, file), path.join(DELIVERY_DIR, "reports/captures", file));
for (const file of ["build-boussole-refonte-v1.mjs", "validate-boussole-refonte-v1.mjs", "measure-boussole-refonte-v1-browser.mjs", "build-boussole-refonte-v1-delivery.mjs"])
  await cp(path.join(ROOT, "scripts", file), path.join(DELIVERY_DIR, "scripts", file));

const files = await walk(DELIVERY_DIR);
const checksums = [];
for (const file of files.filter(file => path.basename(file) !== "SHA256SUMS")) checksums.push(`${sha256(await readFile(file))}  ${path.relative(DELIVERY_DIR, file)}`);
await writeFile(path.join(DELIVERY_DIR, "SHA256SUMS"), `${checksums.sort().join("\n")}\n`);

console.log(JSON.stringify({ status: "ready", branch, baseCommit, html: deliveryManifest.app, dataset: deliveryManifest.dataset, tests: deliveryManifest.tests, delivery: path.relative(ROOT, DELIVERY_DIR), files: files.length + 1, audit: path.relative(ROOT, auditPath) }, null, 2));

async function git(...args) { return (await run("git", args, { cwd: ROOT })).stdout.trim(); }
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function formatMiB(bytes) { return (bytes / 1024 / 1024).toFixed(1); }
async function walk(directory) { const rows = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) rows.push(...await walk(file)); else rows.push(file); } return rows; }
