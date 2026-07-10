import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_SOURCE = resolve(ROOT, "tmp/monde-pro/PROMPT_CODEX_BOUSSOLE_PRO_V0_4_CORPUS_LOCAL_200_METIERS.md");
const OUT_DIR = resolve(ROOT, "creations/boussolepro/data/curated");
const HTML_PATH = resolve(ROOT, "creations/boussolepro/boussole-pro.html");
const DATASET_PATH = resolve(OUT_DIR, "clairmetier-curated-v0.4.json");
const REPORT_PATH = resolve(OUT_DIR, "curated-quality-report.v0.4.json");
const START_MARKER = "/* CURATED_CORPUS_V04_START */";
const END_MARKER = "/* CURATED_CORPUS_V04_END */";
const CURATED_SOURCE = "curated_estimated";
const CURATED_PROVENANCE = "curated_clairmetier_ai_logic";
const CURATED_LICENSE = "internal_curated_estimation_non_official";
const CURATED_WARNING = "Le corpus local enrichi est une boussole provisoire : il améliore la pertinence pratique sans prétendre remplacer les référentiels officiels.";

const DIPLOMA_LEVELS = [
  [0, "Non renseigne ou sans diplome", ["Aucun diplome declare"]],
  [3, "CAP / BEP", ["CAP", "BEP"]],
  [4, "Bac", ["Baccalaureat", "BP"]],
  [5, "Bac +2", ["BTS", "DUT", "DEUST"]],
  [6, "Bac +3 / +4", ["Licence", "BUT", "Maitrise"]],
  [7, "Bac +5", ["Master", "Diplome d'ingenieur"]],
  [8, "Doctorat", ["Doctorat", "HDR"]]
];

async function main() {
  const sourcePath = resolve(process.argv[2] || process.env.CURATED_SOURCE_PROMPT || DEFAULT_SOURCE);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source TSV introuvable: ${sourcePath}`);
  }
  const markdown = await readFile(sourcePath, "utf8");
  const blocks = extractTsvBlocks(markdown);
  const skills = parseRequiredBlock(blocks, "id\tlabel\ttype\tcategory\taliases").map(normalizeSkillSeed);
  const workContexts = parseRequiredBlock(blocks, "id\tlabel\tcategory\tconstraintTags").map(normalizeContextSeed);
  const certifications = parseRequiredBlock(blocks, "id\ttitle\ttype\tlevel\tfamilies").map(normalizeCertificationSeed);
  const jobSeeds = parseRequiredBlock(blocks, "id\ttitle\tdomain\tfamily\trome\treq\topt\tctx\tphysical\tptags\tschedule\tmobility\tpublic\tautonomy\tremote\tlevel\treqCerts\trecCerts\tinterests\tvalues\tmarket\thardWarnings\tnotes");
  const skillById = new Map(skills.map(skill => [skill.id, skill]));
  const jobs = jobSeeds.map(row => normalizeCuratedJobSeed(row, skillById));
  attachRelatedJobs(jobs);
  const jobAppellations = buildAppellations(jobs);
  const marketIndicators = buildMarketIndicators(jobs);
  const mappings = buildMappings(jobs);
  const dataset = {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - corpus local enrichi estimatif v0.4",
    datasetVersion: "v0.4.alpha-curated",
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.66,
    license: CURATED_LICENSE,
    officialStatus: "not_official_to_verify",
    intention: CURATED_WARNING,
    sources: [buildSource()],
    manifest: buildManifest(jobs),
    jobs,
    jobAppellations,
    skills,
    matchableSkills: skills,
    workContexts,
    certifications,
    trainings: [],
    diplomaLevels: DIPLOMA_LEVELS.map(normalizeDiplomaLevel),
    marketIndicators,
    mappings
  };
  const report = buildCuratedQualityReport(dataset);
  dataset.qualityReport = report;
  assertQuality(report);
  await mkdir(OUT_DIR, { recursive: true });
  await writeJson(DATASET_PATH, dataset);
  await writeJson(REPORT_PATH, report);
  await updateHtmlEmbedding(dataset);
  console.log(JSON.stringify({
    dataset: relative(DATASET_PATH),
    report: relative(REPORT_PATH),
    jobs: jobs.length,
    skills: skills.length,
    contexts: workContexts.length,
    mappings: mappings.length,
    warnings: report.warnings.length
  }, null, 2));
}

function normalizeCuratedJobSeed(row, skillById = new Map()) {
  const requiredSkills = splitList(row.req);
  const optionalSkills = splitList(row.opt).filter(skill => !requiredSkills.includes(skill));
  const softSkills = unique([...requiredSkills, ...optionalSkills].filter(skillId => skillById.get(skillId)?.type === "savoir-etre"));
  const workContexts = splitList(row.ctx);
  const physicalTags = splitList(row.ptags);
  const [nightWork = "unknown", weekendWork = "unknown", irregularHours = "unknown"] = String(row.schedule || "").split("/");
  const mobilityParts = String(row.mobility || "").split("/");
  const travelFrequency = normalizeTravelFrequency(mobilityParts[0]);
  const driverLicenseRequired = mobilityParts.some(part => /permisB=yes/i.test(part));
  const marketScore = clampNumber(row.market, 0.35, 0, 1);
  const confidence = estimateConfidence(row);
  const description = `${row.title} : piste estimative du domaine ${row.domain}. Donnees locales a verifier avec des sources officielles ou des professionnels du terrain.`;
  const accessText = buildAccessText(row, driverLicenseRequired);
  const fieldSources = Object.fromEntries([
    "id", "romeCode", "title", "domain", "family", "description", "requiredSkills", "optionalSkills", "softSkills",
    "workContexts", "physical", "schedule", "mobility", "publicContactLevel", "autonomyLevel", "remoteCompatibility",
    "recommendedDiplomaLevel", "requiredCertifications", "recommendedCertifications", "interestTags", "valueTags",
    "market", "exclusionHints", "evidenceNotes"
  ].map(field => [field, field === "romeCode" && !row.rome ? "unknown" : CURATED_SOURCE]));
  return {
    id: row.id,
    schemaVersion: "1.0.0",
    romeCode: row.rome || null,
    title: row.title,
    domain: row.domain,
    family: row.family,
    appellations: buildAppellationLabels(row.title),
    description,
    activities: [],
    accessConditions: { text: accessText, source: CURATED_SOURCE, confidence: 0.45 },
    requiredSkills,
    optionalSkills,
    softSkills,
    knowledge: [],
    workContexts,
    physical: [row.physical || "unknown", physicalTags],
    schedule: [nightWork || "unknown", weekendWork || "unknown", irregularHours || "unknown"],
    mobility: [travelFrequency, driverLicenseRequired],
    constraints: {
      source: CURATED_SOURCE,
      confidence: 0.58,
      physical: { level: row.physical || "unknown", tags: physicalTags, source: CURATED_SOURCE, confidence: 0.58 },
      schedule: { nightWork, weekendWork, irregularHours, source: CURATED_SOURCE, confidence: 0.58 },
      mobility: { travelFrequency, driverLicenseRequired, driverLicenseTypes: driverLicenseRequired ? ["B"] : [], source: CURATED_SOURCE, confidence: 0.58 }
    },
    physicalConstraints: { level: row.physical || "unknown", tags: physicalTags, source: CURATED_SOURCE, confidence: 0.58 },
    scheduleConstraints: { nightWork, weekendWork, irregularHours, source: CURATED_SOURCE, confidence: 0.58 },
    mobilityConstraints: { travelFrequency, driverLicenseRequired, driverLicenseTypes: driverLicenseRequired ? ["B"] : [], source: CURATED_SOURCE, confidence: 0.58 },
    publicContactLevel: row.public || "unknown",
    autonomyLevel: row.autonomy || "unknown",
    remoteCompatibility: row.remote || "unknown",
    requiredDiplomaLevel: null,
    recommendedDiplomaLevel: numberOrNull(row.level),
    requiredCertifications: splitList(row.reqCerts),
    recommendedCertifications: splitList(row.recCerts),
    relatedJobs: [],
    transitionTags: unique([slug(row.family), slug(row.domain), ...splitList(row.interests)]).filter(Boolean).slice(0, 8),
    interestTags: splitList(row.interests),
    valueTags: splitList(row.values),
    market: { value: marketScore, tensionScore: marketScore, source: CURATED_SOURCE, confidence: 0.35, note: "Indication estimative, non officielle." },
    marketScoreSeed: marketScore,
    marketIndicators: [`market-${row.id}`],
    sourceRefs: ["clairmetier_curated_v0_4"],
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence,
    license: CURATED_LICENSE,
    officialStatus: "not_official_to_verify",
    fieldSources,
    dataQuality: {
      status: "curated_estimated",
      missingFields: [],
      warnings: ["non_official_estimate", "to_verify_with_official_sources"],
      completenessScore: 0.75,
      confidence
    },
    missingFields: [],
    exclusionHints: splitList(row.hardWarnings),
    evidenceNotes: [row.notes || "Estimation locale ClairMetier a verifier."],
    curatedNotes: row.notes || "",
    mappingStatus: "curated_estimated"
  };
}

function buildCuratedQualityReport(dataset) {
  const jobs = dataset.jobs || [];
  const warnings = [];
  const blocking = [];
  jobs.forEach(job => {
    if (!job.id) blocking.push(`Metier sans id: ${job.title || "sans titre"}`);
    if (!job.title) blocking.push(`Metier sans titre: ${job.id || "sans id"}`);
    if (!job.requiredSkills?.length) blocking.push(`${job.id} sans competence requise`);
    if (!job.workContexts?.length) blocking.push(`${job.id} sans contexte`);
    if (!job.interestTags?.length) blocking.push(`${job.id} sans tag d'interet`);
    if (!job.valueTags?.length) blocking.push(`${job.id} sans tag de valeur`);
  });
  if (jobs.length < 180) blocking.push(`Corpus trop court: ${jobs.length} metiers`);
  const domainCoverage = countBy(jobs, "domain");
  const familyCoverage = countBy(jobs, "family");
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    datasetVersion: dataset.datasetVersion,
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    officialStatus: "not_official_to_verify",
    jobsCount: jobs.length,
    skillsCount: dataset.skills.length,
    contextsCount: dataset.workContexts.length,
    jobsWithoutRequiredSkills: jobs.filter(job => !job.requiredSkills?.length).map(job => job.id),
    jobsWithoutContexts: jobs.filter(job => !job.workContexts?.length).map(job => job.id),
    jobsWithoutInterestTags: jobs.filter(job => !job.interestTags?.length).map(job => job.id),
    jobsWithoutValueTags: jobs.filter(job => !job.valueTags?.length).map(job => job.id),
    jobsWithoutConstraints: jobs.filter(job => !job.physicalConstraints || !job.scheduleConstraints || !job.mobilityConstraints).map(job => job.id),
    jobsWithLongTraining: jobs.filter(job => Number(job.recommendedDiplomaLevel || 0) >= 5).length,
    jobsWithPublicContactHigh: jobs.filter(job => job.publicContactLevel === "high").length,
    jobsWithRemoteHigh: jobs.filter(job => job.remoteCompatibility === "high").length,
    jobsWithPhysicalHigh: jobs.filter(job => job.physicalConstraints?.level === "high").length,
    jobsRequiringDriverLicense: jobs.filter(job => job.mobilityConstraints?.driverLicenseRequired).length,
    domainCoverage,
    familyCoverage,
    warnings,
    blocking,
    recommendations: [
      "Verifier les metiers prioritaires avec ROME, RNCP, Onisep ou terrain professionnel des que possible.",
      "Conserver la mention non officielle dans l'interface et les exports.",
      "Ne pas utiliser les scores marche comme tension reelle du marche."
    ],
    summary: {
      jobs: jobs.length,
      skills: dataset.skills.length,
      filteredSkills: dataset.skills.length,
      linkedSkills: new Set(jobs.flatMap(job => [...job.requiredSkills, ...job.optionalSkills, ...job.softSkills])).size,
      matchableSkills: dataset.matchableSkills.length,
      workContexts: dataset.workContexts.length,
      linkedContexts: new Set(jobs.flatMap(job => job.workContexts)).size,
      linkedAppellations: dataset.jobAppellations.length,
      trainings: 0,
      certifications: dataset.certifications.length,
      mappings: dataset.mappings.length,
      marketIndicators: dataset.marketIndicators.length
    },
    coverage: {
      jobsWithSkills: ratio(jobs.filter(job => job.requiredSkills.length).length, jobs.length),
      jobsWithContexts: ratio(jobs.filter(job => job.workContexts.length).length, jobs.length),
      jobsWithTraining: 0,
      jobsWithMarketData: ratio(jobs.filter(job => job.marketIndicators.length).length, jobs.length)
    },
    issues: blocking.map(message => ({ severity: "blocking", message })),
    status: blocking.length ? "blocked" : "completed_with_warnings"
  };
  report.warnings.push({
    severity: "warning",
    type: "curated_estimated_non_official",
    message: "Corpus local enrichi estimatif : utile pour orienter, non officiel et a verifier."
  });
  return report;
}

function assertQuality(report) {
  if (report.blocking.length) {
    throw new Error(`Rapport qualite bloque: ${report.blocking.slice(0, 8).join(" | ")}`);
  }
}

function extractTsvBlocks(markdown) {
  return [...markdown.matchAll(/```tsv\n([\s\S]*?)```/g)].map(match => match[1].trim());
}

function parseRequiredBlock(blocks, header) {
  const block = blocks.find(item => item.startsWith(header));
  if (!block) throw new Error(`Bloc TSV introuvable: ${header}`);
  return parseTsv(block);
}

function parseTsv(block) {
  const lines = block.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split("\t");
  return lines.map(line => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function normalizeSkillSeed(row) {
  return {
    id: row.id,
    schemaVersion: "1.0.0",
    label: row.label,
    type: row.type,
    category: row.category,
    aliases: splitList(row.aliases),
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.68,
    matchableCandidate: true,
    matchingUse: "curated_profile_and_job_matching",
    matchingScope: "local_curated"
  };
}

function normalizeContextSeed(row) {
  return {
    id: row.id,
    schemaVersion: "1.0.0",
    label: row.label,
    category: row.category,
    constraintTags: splitList(row.constraintTags),
    description: `Contexte local estimatif : ${row.label}.`,
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.64
  };
}

function normalizeCertificationSeed(row) {
  return {
    id: row.id,
    schemaVersion: "1.0.0",
    certificationType: row.type,
    title: row.title,
    level: numberOrNull(row.level),
    families: splitList(row.families),
    status: "curated_estimated_to_verify",
    targetJobIds: [],
    targetRomeCodes: [],
    vaePossible: row.type === "diploma",
    issuer: "A verifier",
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: ["license", "short"].includes(row.type) ? 0.45 : 0.4
  };
}

function normalizeDiplomaLevel(row) {
  return {
    id: `diploma-level-${row[0]}`,
    schemaVersion: "1.0.0",
    level: row[0],
    label: row[1],
    examples: row[2],
    description: "Repere local simplifie.",
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.55
  };
}

function buildSource() {
  return {
    id: "clairmetier_curated_v0_4",
    schemaVersion: "1.0.0",
    name: "Corpus local enrichi estimatif ClairMetier v0.4",
    producer: "Boussole Pro / ClairMetier",
    url: null,
    license: CURATED_LICENSE,
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    format: "JSON",
    accessMode: "embedded-offline-and-local-json",
    provenance: CURATED_PROVENANCE,
    confidence: 0.66,
    redistribution: "internal_curated_estimation",
    notes: CURATED_WARNING
  };
}

function buildManifest(jobs) {
  return {
    schemaVersion: "1.0.0",
    id: "manifest-clairmetier-curated-v0-4",
    datasetName: "Boussole Pro - corpus local enrichi estimatif v0.4",
    datasetVersion: "v0.4.alpha-curated",
    sourceDate: new Date().toISOString().slice(0, 10),
    importedAt: new Date().toISOString(),
    provenance: CURATED_PROVENANCE,
    source: CURATED_SOURCE,
    confidence: 0.66,
    sources: ["clairmetier_curated_v0_4"],
    licenseSummary: CURATED_LICENSE,
    jobsCount: jobs.length,
    warnings: ["non_official_estimate", "to_verify_with_official_sources", "api_rome_paused"]
  };
}

function buildAppellations(jobs) {
  return jobs.flatMap(job => job.appellations.map((label, index) => ({
    id: `app-${job.id}-${index + 1}`,
    schemaVersion: "1.0.0",
    jobId: job.id,
    romeCode: job.romeCode,
    label,
    normalizedLabel: normalizeText(label),
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.58
  })));
}

function buildMarketIndicators(jobs) {
  return jobs.map(job => ({
    id: `market-${job.id}`,
    schemaVersion: "1.0.0",
    jobId: job.id,
    romeCode: job.romeCode,
    territory: "FR-estimatif",
    tensionScore: job.marketScoreSeed,
    offerVolume: job.marketScoreSeed >= 0.65 ? "medium_high_estimated" : job.marketScoreSeed >= 0.5 ? "medium_estimated" : "low_estimated",
    salaryMedian: null,
    trend: "unknown",
    warnings: ["curated_estimated_non_official", "not_market_truth"],
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.35
  }));
}

function buildMappings(jobs) {
  return jobs.map(job => ({
    id: `mapping-${job.id}`,
    schemaVersion: "1.0.0",
    mappingType: "curated_job_links",
    jobId: job.id,
    romeCode: job.romeCode,
    skillIds: unique([...job.requiredSkills, ...job.optionalSkills, ...job.softSkills]),
    contextIds: job.workContexts,
    certificationIds: unique([...job.requiredCertifications, ...job.recommendedCertifications]),
    appellationIds: job.appellations.map((_, index) => `app-${job.id}-${index + 1}`),
    relatedJobIds: job.relatedJobs,
    source: CURATED_SOURCE,
    provenance: CURATED_PROVENANCE,
    confidence: 0.62
  }));
}

function attachRelatedJobs(jobs) {
  jobs.forEach(job => {
    job.relatedJobs = jobs
      .filter(candidate => candidate.id !== job.id)
      .map(candidate => ({ id: candidate.id, score: similarity(job, candidate) }))
      .filter(item => item.score >= 0.42)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.id);
  });
}

function similarity(a, b) {
  return (
    (a.family === b.family ? 0.28 : 0) +
    (a.domain === b.domain ? 0.12 : 0) +
    jaccard([...a.requiredSkills, ...a.optionalSkills], [...b.requiredSkills, ...b.optionalSkills]) * 0.25 +
    jaccard(a.workContexts, b.workContexts) * 0.16 +
    jaccard(a.interestTags, b.interestTags) * 0.11 +
    jaccard(a.valueTags, b.valueTags) * 0.08
  );
}

function jaccard(a = [], b = []) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let inter = 0;
  left.forEach(item => {
    if (right.has(item)) inter += 1;
  });
  return inter / union.size;
}

function buildAppellationLabels(title) {
  const labels = [title];
  if (title.includes("/")) title.split("/").map(item => item.trim()).filter(Boolean).forEach(item => labels.push(item));
  return unique(labels).slice(0, 4);
}

function buildAccessText(row, driverLicenseRequired) {
  const notes = [];
  if (row.level) notes.push(`niveau conseille ${row.level}`);
  if (row.reqCerts) notes.push(`certification a verifier: ${row.reqCerts}`);
  if (row.recCerts) notes.push(`certification recommandee a verifier: ${row.recCerts}`);
  if (driverLicenseRequired) notes.push("permis B signale comme utile ou requis selon postes");
  return notes.length ? `Estimation locale: ${notes.join("; ")}.` : "Acces estime ouvert selon profil et terrain, a verifier localement.";
}

function estimateConfidence(row) {
  let value = 0.55;
  if (row.rome) value += 0.04;
  if (row.req && row.opt) value += 0.03;
  if (row.ctx) value += 0.03;
  if (row.hardWarnings) value += 0.02;
  if (row.notes) value += 0.02;
  return Number(Math.min(value, 0.72).toFixed(2));
}

async function updateHtmlEmbedding(dataset) {
  if (!existsSync(HTML_PATH)) return;
  const html = await readFile(HTML_PATH, "utf8");
  if (!html.includes(START_MARKER) || !html.includes(END_MARKER)) return;
  const before = html.slice(0, html.indexOf(START_MARKER) + START_MARKER.length);
  const after = html.slice(html.indexOf(END_MARKER));
  const payload = `\nconst CURATED_CORPUS_V04 = ${JSON.stringify(dataset)};\n`;
  await writeFile(HTML_PATH, before + payload + after, "utf8");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeTravelFrequency(value) {
  const text = String(value || "").trim();
  if (["low", "medium", "high", "unknown"].includes(text)) return text;
  return "unknown";
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row[field] || "non renseigne";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function ratio(count, total) {
  return total ? Number((count / total).toFixed(2)) : 0;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function relative(path) {
  return path.replace(`${ROOT}/`, "");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
