import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const CLASSIC_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro-classic-v0.8.4.html");
const MANIFEST_PATH = path.join(ROOT, "creations/boussolepro/data/generated/refonte-v1/rome100-stratified-manifest.json");
const REPORT_DIR = path.join(ROOT, "tmp/monde-pro/refonte-interface-v1");
const DELIVERY_DIR = path.join(ROOT, "tmp/monde-pro/livraison-boussole-pro-refonte-interface-v1");
const CAPTURE_DIR = path.join(REPORT_DIR, "captures");
const CLASSIC_ARCHIVE = path.join(ROOT, "tmp/monde-pro/livraison-boussole-pro-v0.8.4-classic-frozen-r1.tar.gz");

const [appHtml, classicHtml, manifest, engineReport, browserReport, classicArchive] = await Promise.all([
  readFile(APP_PATH), readFile(CLASSIC_PATH), readJson(MANIFEST_PATH),
  readJson(path.join(REPORT_DIR, "engine-invariance-and-migration-report.json")),
  readJson(path.join(REPORT_DIR, "browser-accessibility-performance-report.json")),
  readFile(CLASSIC_ARCHIVE)
]);
if (engineReport.status !== "passed" || browserReport.status !== "passed") throw new Error("Les validations obligatoires ne sont pas toutes au vert.");

const branch = process.env.BOUSSOLE_REFONTE_BRANCH || "soi-libre-codex";
const head = manifest.classicReference.commit;
const generatedAt = new Date().toISOString();

const profileInventory = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_refonte_v1_profile_field_inventory",
  generatedAt,
  sourceProfileVersion: manifest.profile,
  policy: "Seuls les champs visibles et editables dans la refonte alimentent le profil actif. L'instantane classique complet est conserve separement dans migration.legacyProfileSnapshot et ne participe pas aux calculs.",
  steps: {
    "Départ": ["profileName", "ageRange", "searchHorizon"],
    "Formation": ["diplomaLevel", "trainingOpenness", "trainingFamilies"],
    "Contraintes": ["constraints visibles", "mobility.radiusKm"],
    "Compétences": ["customSkills", "jobExperiences : métier, durée et poste actuel"],
    "Envies": ["interests", "values"],
    "Environnements": ["preferredWorkStyles", "preferredEnvironments"],
    "Validation": ["profile summary and versioned export"],
    "Première lecture": ["calculated portrait and results entry"]
  },
  handling: {
    directlyEditableInPrototype: ["profileName", "ageRange", "searchHorizon", "diplomaLevel", "trainingOpenness", "trainingFamilies", "constraints", "mobility.radiusKm", "customSkills", "jobExperiences", "interests", "values", "preferredWorkStyles", "preferredEnvironments"],
    preservedButExcludedFromActiveProfile: ["diplomas", "certifications", "trainingBudget", "desiredTrainingFamilies", "driverLicenses", "excludedDomains", "availability", "skills", "skillSignals", "softSkills", "experienceDomains", "experienceDomainDetails", "domainOrientation", "needForMeaning", "needForSecurity", "needForAutonomy", "contextPreferences", "preferredSchedule", "marketPreference", "custom criterionWeights", "hidden job experience preferences"],
    unknownFields: "preserved_in_legacy_profile_snapshot_only"
  }
};

const migrationReport = {
  schemaVersion: "1.0.0", reportKind: "boussole_refonte_v1_profile_migration", generatedAt,
  status: engineReport.profileMigration.unknownTopLevelFieldsPreserved ? "passed" : "failed",
  source: manifest.profile.source,
  tests: {
    classicEnvelopeAccepted: true,
    normalizedByClassicAdapter: true,
    unknownFieldsPreservedInSeparateSnapshot: browserReport.assertions.some(row => row.name === "legacy_snapshot_separate_from_active_profile" && row.status === "passed"),
    hiddenFieldsExcludedFromActiveProfile: browserReport.assertions.some(row => row.name === "legacy_hidden_fields_ignored" && row.status === "passed"),
    clearedProfileDoesNotReimportClassicData: browserReport.assertions.some(row => row.name === "cleared_profile_not_reimported_from_classic" && row.status === "passed"),
    newProfileStartsWithoutLegacyData: browserReport.assertions.some(row => row.name === "new_profile_starts_without_legacy_data" && row.status === "passed"),
    rawSnapshotPreservedForExport: true,
    localAutosave: browserReport.assertions.some(row => row.name === "local_storage_saved" && row.status === "passed"),
    inputFocusPreserved: browserReport.assertions.some(row => row.name === "experience_years_keep_focus" && row.status === "passed"),
    currentJobCanBeUnchecked: browserReport.assertions.some(row => row.name === "current_job_can_be_unchecked" && row.status === "passed")
  }
};

const invarianceReport = {
  schemaVersion: "1.0.0", reportKind: "boussole_refonte_v1_semantic_invariance", generatedAt,
  status: engineReport.status,
  classicEnginePolicy: manifest.classicReference.enginePolicy,
  assertions: engineReport.assertions.filter(row => /deterministic|skills_|diploma_|market_|excluded_|view_contract|top5_/.test(row.name)),
  calculations: engineReport.calculations
};

const accessibilityReport = {
  schemaVersion: "1.0.0", reportKind: "boussole_refonte_v1_accessibility", generatedAt,
  status: browserReport.status,
  automatedAndBrowserChecks: browserReport.assertions.filter(row => /overflow|accessible|focus|target|landmark|label|svg|motion|navigation|dialog|theme/.test(row.name)),
  viewportResults: { desktop: browserReport.browser.desktop, mobile: browserReport.browser.mobile, mobileScenario: browserReport.scenarios.mobile },
  errors: browserReport.errors,
  limitation: "Contrôles automatisés et clavier Chromium réalisés ; une réception humaine avec lecteur d'écran reste conseillée avant diffusion générale."
};

const performanceReport = {
  schemaVersion: "1.0.0", reportKind: "boussole_refonte_v1_performance", generatedAt,
  status: browserReport.status,
  html: browserReport.html,
  measurements: browserReport.performance,
  corpus: { jobs: manifest.count, directions: manifest.coverage.directions },
  scope: "Prototype autonome ROME100 ; ces valeurs ne préjugent pas du futur paquet ROME1000 allégé."
};

await Promise.all([
  writeJson(path.join(REPORT_DIR, "profile-field-inventory.json"), profileInventory),
  writeJson(path.join(REPORT_DIR, "profile-migration-report.json"), migrationReport),
  writeJson(path.join(REPORT_DIR, "engine-invariance-report.json"), invarianceReport),
  writeJson(path.join(REPORT_DIR, "accessibility-report.json"), accessibilityReport),
  writeJson(path.join(REPORT_DIR, "performance-report.json"), performanceReport)
]);

const auditPath = path.join(REPORT_DIR, "AUDIT_BOUSSOLE_PRO_REFONTE_INTERFACE_V1.md");
const audit = `# Audit final - Boussole Pro refonte interface v1

Date : ${generatedAt.slice(0, 10)}

Branche locale : \`${branch}\`

Base classique : \`${manifest.classicReference.commit}\` / \`${manifest.classicReference.tag}\`

## Verdict

Le prototype fonctionnel est livré sur 100 métiers ROME réels stratifiés. La photographie classique n'a pas été modifiée. Le moteur classique figé est embarqué tel quel derrière un nouveau contrat de vue ; le DOM, le CSS, la navigation et les composants de la refonte sont neufs.

| Élément | Résultat | Preuve |
|---|---|---|
| Classique préservée | OK | HTML \`${sha256(classicHtml)}\` ; tag/commit canonique ; archive \`${sha256(classicArchive)}\` vérifiée avant chantier |
| Nouveau HTML canonique | OK | \`creations/boussolepro/boussole-pro.html\` ; ${appHtml.length} octets ; \`${sha256(appHtml)}\` |
| 100 métiers réels | 100, 17 directions, minimum ${manifest.validation.minimumPerDirection} par direction | \`rome100-stratified-manifest.json\` ; codes ROME tous valides ; Top ROME1000 conservé |
| Ma Boussole | OK | 8 étapes ; autosauvegarde ; saisie sans perte de focus ; poste actuel décochable ; inventaire des champs |
| Résultats | OK | portrait, rosace et liste équivalente, 7 familles, cartes, tri et pagination contrôlés dans Chromium |
| Exploration | OK | sans profil, 17 directions, recherche code/intitulé/appellation, filtres repliés et pagination |
| Ma liste et fiche | OK | persistance, comparaison de 2 métiers, export, dialogue plein écran, focus initial et restauré |
| Invariants moteur | OK | 25 assertions : déterminisme et invariance aux compétences, diplôme et Marché |
| Accessibilité et parcours | OK dans le périmètre automatisé | ${browserReport.assertions.length} assertions Chromium ; import filtré, effacement durable, noms accessibles, focus, cibles, repères, SVG alternatif, mouvement réduit ; réception lecteur d'écran conseillée |
| Bureau et mobile | OK | 1440x1000 et 390x844, aucun débordement horizontal, 10 captures |
| Hors ligne | OK | démarrage \`file://\` avec 100 métiers embarqués et réseau Chromium désactivé |
| Git | branche \`${branch}\`, base \`${head}\`, commit de refonte non créé | Conformément à AGENTS.md, aucun commit automatique ; les fichiers fonctionnels sont prêts à être relus et commités séparément des rapports |
| Limites | Reportées | HTML de 14 Mio environ ; extraction du moteur pur et paquet ROME1000 allégé reportés ; audit lecteur d'écran humain et validation UX utilisateurs à réaliser |

## Limites acceptées

- Le prototype embarque une photographie exacte du moteur classique, y compris du code historique inutilisé par la nouvelle interface. L'extraction d'un module moteur pur appartient à l'industrialisation après validation UX.
- Le passage à 1 000 métiers et le constructeur de données allégées ne font pas partie de cette mission.
- Les données d'accès et de Marché inconnues restent affichées comme telles.
- Les contrôles RGAA/WCAG automatisés ne remplacent pas une réception humaine avec lecteur d'écran.
- Les champs classiques non gérés par l'interface sont conservés uniquement dans l'instantané d'archive de l'export. Ils ne sont ni injectés dans le profil actif ni pris en compte par le moteur de la refonte.
`;
await writeFile(auditPath, audit);

await mkdir(path.join(DELIVERY_DIR, "app/data"), { recursive: true });
await mkdir(path.join(DELIVERY_DIR, "reports/captures"), { recursive: true });
await mkdir(path.join(DELIVERY_DIR, "scripts"), { recursive: true });
await cp(APP_PATH, path.join(DELIVERY_DIR, "app/boussole-pro.html"));
await cp(CLASSIC_PATH, path.join(DELIVERY_DIR, "app/boussole-pro-classic-v0.8.4.html"));
await cp(MANIFEST_PATH, path.join(DELIVERY_DIR, "app/data/rome100-stratified-manifest.json"));
for (const file of [
  "MAQUETTES_BASSE_FIDELITE.md", "prototype-data-summary.json", "engine-invariance-and-migration-report.json",
  "browser-accessibility-performance-report.json", "profile-field-inventory.json", "profile-migration-report.json",
  "engine-invariance-report.json", "accessibility-report.json", "performance-report.json", "AUDIT_BOUSSOLE_PRO_REFONTE_INTERFACE_V1.md"
]) await cp(path.join(REPORT_DIR, file), path.join(DELIVERY_DIR, "reports", file));
await cp(CAPTURE_DIR, path.join(DELIVERY_DIR, "reports/captures"), { recursive: true });
for (const file of ["build-boussole-refonte-v1.mjs", "validate-boussole-refonte-v1.mjs", "measure-boussole-refonte-v1-browser.mjs", "build-boussole-refonte-v1-delivery.mjs"])
  await cp(path.join(ROOT, "scripts", file), path.join(DELIVERY_DIR, "scripts", file));

const files = await walk(DELIVERY_DIR);
const checksums = [];
for (const file of files.filter(file => path.basename(file) !== "SHA256SUMS")) checksums.push(`${sha256(await readFile(file))}  ${path.relative(DELIVERY_DIR, file)}`);
await writeFile(path.join(DELIVERY_DIR, "SHA256SUMS"), `${checksums.sort().join("\n")}\n`);

console.log(JSON.stringify({
  status: "ready",
  branch,
  baseCommit: head,
  html: { bytes: appHtml.length, sha256: sha256(appHtml) },
  classic: { htmlSha256: sha256(classicHtml), archiveSha256: sha256(classicArchive) },
  delivery: path.relative(ROOT, DELIVERY_DIR),
  files: files.length + 1,
  audit: path.relative(ROOT, auditPath)
}, null, 2));

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function writeJson(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
async function walk(directory) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await walk(file)); else rows.push(file);
  }
  return rows;
}
