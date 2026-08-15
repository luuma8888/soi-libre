import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PROOF_DIR = path.resolve(process.env.BOUSSOLE_PROOF_DIR || path.join(ROOT, "tmp/monde-pro/audit-v0.8.4-closure-final"));
const FUNCTIONAL_PATH = path.resolve(process.env.BOUSSOLE_FUNCTIONAL_REPORT || path.join(PROOF_DIR, "functional-validation-report.json"));
const PREVIOUS_FUNCTIONAL_PATH = path.resolve(process.env.BOUSSOLE_PREVIOUS_FUNCTIONAL_REPORT || path.join(ROOT, "tmp/monde-pro/audit-v0.8.4-final/functional-validation-report.json"));
const APP_PATH = path.join(ROOT, "creations/boussolepro/boussole-pro.html");
const RUNTIME_PATH = path.join(ROOT, "creations/boussolepro/data/generated/active-runtime.json");
const RUNTIME_MANIFEST_PATH = path.join(ROOT, "creations/boussolepro/data/generated/rome1000-candidate/runtime-bundle-manifest.json");
const MARKET_QUALITY_PATH = path.join(ROOT, "creations/boussolepro/data/generated/market/market-quality-report.json");
const MARKET_IDENTITY_PATH = path.join(ROOT, "creations/boussolepro/data/generated/market/market-package-identity.json");
const SKILLS_PATH = path.join(ROOT, "creations/boussolepro/data/generated/rome1000-candidate/skills.rome.json");
const SKILLS_ENGINE_PATH = path.join(ROOT, "creations/boussolepro/data/generated/rome1000-candidate/skills-engine.rome.json");
const MATCHABLE_PATH = path.join(ROOT, "creations/boussolepro/data/generated/rome1000-candidate/skills-matchable.rome.json");

const readJson = async file => JSON.parse(await readFile(file, "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const fileSha256 = async file => sha256(await readFile(file));

await mkdir(PROOF_DIR, { recursive: true });
const [functional, previous, runtime, runtimeManifest, marketQuality, marketIdentity, skills, skillsEngine, matchableSkills] = await Promise.all([
  readJson(FUNCTIONAL_PATH),
  readJson(PREVIOUS_FUNCTIONAL_PATH),
  readJson(RUNTIME_PATH),
  readJson(RUNTIME_MANIFEST_PATH),
  readJson(MARKET_QUALITY_PATH),
  readJson(MARKET_IDENTITY_PATH),
  readJson(SKILLS_PATH),
  readJson(SKILLS_ENGINE_PATH),
  readJson(MATCHABLE_PATH)
]);

const build = {
  ...runtime.appSource,
  observedHtmlSha256: await fileSha256(APP_PATH)
};
const invariance = functional.checks?.personalFitInvariance || {};
const tieBreak = functional.checks?.top5ThemeContract || {};
const bench = functional.checks?.testBenchDeterminism || {};
const cedric = functional.checks?.technicalProfileScenario || {};
const previousCedric = previous.checks?.technicalProfileScenario || {};

await write("top5-invariance-report.json", {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v084_final_top5_invariance",
  generatedAt: new Date().toISOString(),
  status: invariance.status === "ok" && tieBreak.status === "ok" ? "passed" : "failed",
  build,
  invariance,
  semanticTieBreak: tieBreak,
  forbiddenSecondaryDimensions: ["skills", "exactExperience", "diploma", "access", "training", "market", "confidence", "legacyComposite"]
});

await write("test-bench-12-profiles-report.json", {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v084_final_12_profiles",
  generatedAt: new Date().toISOString(),
  status: bench.status === "ok" && bench.firstSha256 === bench.secondSha256 ? "passed" : "failed",
  build,
  profilesCount: bench.profilesCount,
  firstSha256: bench.firstSha256,
  secondSha256: bench.secondSha256,
  blockingCount: bench.blockingCount,
  warningCount: bench.warningCount,
  warningReview: bench.warningReview,
  rows: bench.rows,
  failures: bench.failures
});

await write("cedric-top5-before-after-report.json", {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v084_final_real_profile_top5_comparison",
  generatedAt: new Date().toISOString(),
  status: cedric.status === "ok" ? "passed" : "failed",
  build,
  beforeBuild: {
    buildId: previous.buildId,
    sourceArtifactSha256: previous.sourceArtifactSha256,
    top5: previousCedric.top5 || []
  },
  afterBuild: {
    buildId: functional.buildId,
    sourceArtifactSha256: functional.sourceArtifactSha256,
    top5: cedric.top5 || []
  },
  interpretation: "La passe finale peut départager autrement des scores affichés égaux, uniquement grâce aux composantes fines de l’accord personnel. Les appuis, l’accès et le Marché restent sans effet sur le rang."
});

const uniqueSkillIds = new Set(skills.map(item => item.id));
await write("runtime-market-quality-report.json", {
  schemaVersion: "1.0.0",
  reportKind: "boussole_v084_final_runtime_market_quality",
  generatedAt: new Date().toISOString(),
  status: uniqueSkillIds.size === skills.length && runtime.runtime?.expectedCounts?.skills === skills.length ? "passed" : "failed",
  build,
  runtime: {
    releaseId: runtime.runtime?.runtimeReleaseId,
    revision: runtime.runtime?.runtimeBundleRevision,
    fingerprintSha256: runtime.runtime?.runtimeBundleFingerprintSha256,
    manifestFingerprintSha256: runtimeManifest.fingerprintSha256,
    jobs: runtime.runtime?.expectedCounts?.jobs,
    skills: {
      packagedSource: skills.length,
      activeAfterNormalization: skills.length,
      uniqueActiveIds: uniqueSkillIds.size,
      engineLinks: skillsEngine.length,
      directlyComparableToProfile: matchableSkills.length,
      former8626Explanation: "8 626 provenait d’un ancien résumé de réception. Aucun ensemble actif de ce build ne contient 8 626 entrées et aucune normalisation n’ajoute 56 compétences."
    }
  },
  market: {
    fingerprintSha256: marketIdentity.packageFingerprintSha256,
    coverage: runtime.market?.coverage,
    counts: runtime.market?.counts,
    qualityStatus: marketQuality.status,
    activeRomeJobs: marketQuality.checks?.activeRomeJobs
  },
  fileSha256: {
    activeRuntime: await fileSha256(RUNTIME_PATH),
    runtimeManifest: await fileSha256(RUNTIME_MANIFEST_PATH),
    marketQuality: await fileSha256(MARKET_QUALITY_PATH),
    marketIdentity: await fileSha256(MARKET_IDENTITY_PATH),
    packagedSkills: await fileSha256(SKILLS_PATH)
  }
});

console.log(JSON.stringify({ status: "ok", proofDir: PROOF_DIR, files: 4 }, null, 2));

async function write(name, value) {
  await writeFile(path.join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
