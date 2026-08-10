import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadBoussoleEngine, loadGeneratedBundle } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const EXPECTED_COUNT = Number(process.env.BOUSSOLE_EXPECTED_JOBS_COUNT || 1000);
const TARGET_SUBDIR = process.env.BOUSSOLE_ROME_SUBDIR || `rome${EXPECTED_COUNT}-candidate`;
const TARGET_DIR = path.join(ROOT, "creations", "boussolepro", "data", "generated", TARGET_SUBDIR);
const HTML_PATH = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const OUTPUT_PATH = path.resolve(process.env.BOUSSOLE_ROUNDTRIP_REPORT || path.join(TARGET_DIR, `rome${EXPECTED_COUNT}-compact-roundtrip-report.json`));

async function main() {
  const html = await readFile(HTML_PATH, "utf8");
  const app = loadBoussoleEngine(html);
  const generated = await loadGeneratedBundle(TARGET_DIR, {
    accessSummaryFile: `access-summary.rome${EXPECTED_COUNT}.json`,
    constraintSummaryFile: `official-constraint-summary.rome${EXPECTED_COUNT}.json`,
    marketEnrichmentFile: `market-fap-enrichment.rome${EXPECTED_COUNT}.json`
  });
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(generated, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, generated.manifest);
  const compact = app.prepareCompactDatasetExport(app.App.state.dataset);

  const freshApp = loadBoussoleEngine(html);
  const validation = freshApp.validateDataset(JSON.parse(JSON.stringify(compact)), "corpus");
  if (!validation.valid) throw new Error(`Réimport compact refusé : ${validation.errors.join(" ")}`);
  freshApp.App.state.dataset = freshApp.markDatasetAsRealImport(validation.normalized);
  freshApp.App.state.corpusMode = "imported";
  const jobs = freshApp.App.state.dataset.jobs || [];
  const skills = new Set((freshApp.App.state.dataset.skillsEngine || []).map(row => row.id).filter(Boolean));
  const orphanReferences = jobs.flatMap(job => [
    ...(job.mobilizedSkillIds || []),
    ...(job.matchableSkillIds || []),
    ...(job.softSkillIds || [])
  ].filter(id => id && !skills.has(id)).map(skillId => ({ romeCode: job.romeCode, skillId })));
  const g1203 = jobs.find(job => job.romeCode === "G1203");
  const g1203Aude = g1203?.marketStats?.fapEnrichment?.territories?.["DEP-11"]?.[0];
  const bench = freshApp.runDiagnosticProfiles(freshApp.DIAGNOSTIC_TEST_PROFILES_V052);
  const startupWouldReplaceImport = freshApp.shouldReloadPackagedCorpus({
    loaded: true,
    dataset: freshApp.App.state.dataset,
    corpusMode: "imported",
    descriptor: {
      runtime: {
        basePath: `data/generated/${TARGET_SUBDIR}/`,
        runtimeBundleFingerprintSha256: generated.runtimeBundleManifest?.fingerprintSha256
      }
    }
  });
  const assertions = [
    check("compact_exact_jobs", compact.jobs?.length === EXPECTED_COUNT, compact.jobs?.length),
    check("roundtrip_exact_jobs", jobs.length === EXPECTED_COUNT, jobs.length),
    check("skills_engine_present", skills.size > 0, skills.size),
    check("no_orphan_skill_references", orphanReferences.length === 0, orphanReferences.slice(0, 20)),
    check("twelve_profiles_executed", bench?.summary?.profilesCount === 12, bench?.summary),
    check("no_blocking_profile_anomaly", bench?.summary?.blockingCount === 0, bench?.summary),
    check("g1203_fap_preserved", g1203?.marketStats?.fapEnrichment?.fapMappings?.some(row => row.fapCode === "V5X81"), g1203?.marketStats?.fapEnrichment?.fapMappings),
    check("g1203_bmo_dares_preserved", g1203Aude?.bmo?.recruitmentProjects?.value === 157 && g1203Aude?.dares?.tension?.level === "very_low", g1203Aude),
    check("import_not_silently_replaced", startupWouldReplaceImport === false, startupWouldReplaceImport),
    check("import_identity_separate", freshApp.App.state.dataset.runtimeBundleIdentity?.inputMode === "real_import", freshApp.App.state.dataset.runtimeBundleIdentity)
  ];
  const failures = assertions.filter(row => !row.pass);
  const report = {
    schemaVersion: "1.0.0",
    reportKind: `rome${EXPECTED_COUNT}_compact_export_import_roundtrip`,
    generatedAt: new Date().toISOString(),
    status: failures.length ? "failed" : "passed",
    isolatedContext: "fresh_vm_context_without_local_storage_or_packaged_autoload",
    assertions,
    failuresCount: failures.length,
    privacy: "Aucun profil utilisateur réel, texte libre, secret ou jeton n'est inclus."
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, assertions: assertions.length, failures: failures.map(row => row.id) }, null, 2));
  if (failures.length) process.exitCode = 1;
}

function check(id, pass, observed) { return { id, pass: Boolean(pass), observed }; }
main().catch(error => { console.error(error); process.exit(1); });
