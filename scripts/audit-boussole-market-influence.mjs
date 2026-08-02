import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadBoussoleEngine, loadGeneratedBundle } from "./validate-boussole-v073.mjs";

const ROOT = process.cwd();
const CURRENT_HTML = path.join(ROOT, "creations", "boussolepro", "boussole-pro.html");
const BASELINE_HTML = process.env.BOUSSOLE_BASELINE_HTML;
const OUTPUT_PATH = process.env.MARKET_INFLUENCE_REPORT || path.join(ROOT, "tmp", "monde-pro", "boussole-market-influence-audit.json");

if (!BASELINE_HTML) throw new Error("BOUSSOLE_BASELINE_HTML doit pointer vers l'application v0.7.6 de reference.");

const [currentHtml, baselineHtml, generated] = await Promise.all([
  readFile(CURRENT_HTML, "utf8"),
  readFile(BASELINE_HTML, "utf8"),
  loadGeneratedBundle()
]);
const current = prepareEngine(loadBoussoleEngine(currentHtml), generated);
const baseline = prepareEngine(loadBoussoleEngine(baselineHtml), generated);
const fixtures = current.DIAGNOSTIC_TEST_PROFILES_V052;

const baselineRun = runProfiles(baseline, fixtures);
const currentRun = runProfiles(current, fixtures);
const comparisons = compareRuns(baselineRun.rows, currentRun.rows);
const synthesisStartedAt = performance.now();
current.App.state.marketSynthesisCache = new Map();
for (const job of current.App.state.dataset.jobs) current.getJobMarketSynthesis(job, current.App.state.dataset, { territory: "DEP-11" });
const synthesis500Ms = performance.now() - synthesisStartedAt;

const report = {
  schemaVersion: "1.0.0",
  reportKind: "boussole_market_influence_before_after",
  generatedAt: new Date().toISOString(),
  protocol: "same_node_process_same_rome500_and_market_package_12_integrated_profiles",
  baseline: { appVersion: "v0.7.6-alpha", durationMs: baselineRun.durationMs },
  current: { appVersion: "v0.7.7-alpha", buildId: "20260802-market-phase1-01", durationMs: currentRun.durationMs },
  performance: {
    baseline12ProfilesMs: baselineRun.durationMs,
    current12ProfilesMs: currentRun.durationMs,
    deltaMs: currentRun.durationMs - baselineRun.durationMs,
    deltaPercent: baselineRun.durationMs ? Number((((currentRun.durationMs - baselineRun.durationMs) / baselineRun.durationMs) * 100).toFixed(1)) : null,
    marketSynthesis500Ms: Number(synthesis500Ms.toFixed(1)),
    note: "Mesure locale Node contrôlée ; elle ne remplace pas l'instantané utilisateur dans un navigateur réel."
  },
  scoreStability: {
    personalFitDifferences: comparisons.personalFitDifferences.length,
    feasibilityDifferences: comparisons.feasibilityDifferences.length,
    personalFitSamples: comparisons.personalFitDifferences.slice(0, 20),
    feasibilitySamples: comparisons.feasibilityDifferences.slice(0, 20)
  },
  rankingInfluence: {
    profilesWithTop10Changes: comparisons.profileChanges.filter(item => item.changedPositions > 0).length,
    totalChangedTop10Positions: comparisons.profileChanges.reduce((sum, item) => sum + item.changedPositions, 0),
    profiles: comparisons.profileChanges
  },
  marketEffect: comparisons.marketEffect,
  verdict: comparisons.personalFitDifferences.length || comparisons.feasibilityDifferences.length ? "failed_personal_or_feasibility_regression" : "passed_with_explained_ranking_changes"
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ verdict: report.verdict, performance: report.performance, scoreStability: report.scoreStability, rankingInfluence: { profilesWithTop10Changes: report.rankingInfluence.profilesWithTop10Changes, totalChangedTop10Positions: report.rankingInfluence.totalChangedTop10Positions } }, null, 2));
if (report.verdict.startsWith("failed")) process.exitCode = 1;

function prepareEngine(app, bundle) {
  app.App.state.dataset = app.mergeGeneratedDatasetIntoApp(bundle, { replace: true });
  app.markDatasetAsOfficialRome(app.App.state.dataset, bundle.manifest);
  return app;
}

function runProfiles(app, tests) {
  const startedAt = performance.now();
  const rows = tests.map(test => {
    const profile = app.normalizeProfile({
      ...app.createEmptyProfile(),
      ...(test.profile || test),
      profileName: test.title || test.profile?.profileName || "Profil test",
      hasRequestedResults: true,
      completedBoussole: true
    });
    Object.entries(test.profile?.constraintSeverities || test.constraintSeverities || {}).forEach(([value, severity]) => app.setConstraintSeverity(profile, value, severity));
    const results = app.calculateAllMatches(profile, app.App.state.dataset, { skipAudit: true });
    return { id: test.id, results };
  });
  return { rows, durationMs: Number((performance.now() - startedAt).toFixed(1)) };
}

function compareRuns(beforeRows, afterRows) {
  const personalFitDifferences = [];
  const feasibilityDifferences = [];
  const profileChanges = [];
  const marketEffects = [];
  for (const afterRow of afterRows) {
    const beforeRow = beforeRows.find(row => row.id === afterRow.id);
    const beforeByJob = new Map(beforeRow.results.completeList.map(result => [result.jobId, result]));
    for (const after of afterRow.results.completeList) {
      const before = beforeByJob.get(after.jobId);
      if (!before) continue;
      if (before.personalFitScore !== after.personalFitScore) personalFitDifferences.push({ profileId: afterRow.id, jobId: after.jobId, before: before.personalFitScore, after: after.personalFitScore });
      if (before.feasibilityScore !== after.feasibilityScore) feasibilityDifferences.push({ profileId: afterRow.id, jobId: after.jobId, before: before.feasibilityScore, after: after.feasibilityScore });
      marketEffects.push(after.marketInfluence?.effectPoints || 0);
    }
    const beforeTop = beforeRow.results.completeList.filter(item => item.status !== "excluded_for_now").slice(0, 10).map(item => item.jobId);
    const afterTop = afterRow.results.completeList.filter(item => item.status !== "excluded_for_now").slice(0, 10).map(item => item.jobId);
    const changes = afterTop.map((jobId, index) => ({ jobId, beforeRank: beforeTop.indexOf(jobId) + 1 || null, afterRank: index + 1 })).filter(item => item.beforeRank !== item.afterRank);
    profileChanges.push({ profileId: afterRow.id, changedPositions: changes.length, beforeTop10: beforeTop, afterTop10: afterTop, changes });
  }
  return {
    personalFitDifferences,
    feasibilityDifferences,
    profileChanges,
    marketEffect: {
      minimumPoints: Math.min(...marketEffects),
      maximumPoints: Math.max(...marketEffects),
      nonZeroResults: marketEffects.filter(value => value !== 0).length,
      totalResults: marketEffects.length
    }
  };
}
