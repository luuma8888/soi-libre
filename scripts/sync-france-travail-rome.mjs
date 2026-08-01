import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildRome500AuditArtifacts } from "./audit-rome-500-generated.mjs";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";
import { mergeRomeDatasets } from "./normalize-rome-api.mjs";

const BASE_OUT_DIR = new URL("../creations/boussolepro/data/generated/", import.meta.url);
const OUT_DIR = buildOutputDirUrl();
const DEBUG_DIR = new URL("debug/", OUT_DIR);
const DEFAULT_SCOPE = "nomenclatureRome api_rome-fiches-metiersv1";
const DEFAULT_TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const DEFAULT_FICHES_ENDPOINT = "https://api.francetravail.io/partenaire/rome-fiches-metiers/v1/fiches-rome/fiche-metier/{CODE_ROME}";
const DEFAULT_ROME_CODES = [
  "A1203", "A1414", "A1501", "A1503", "D1102", "D1214", "D1401", "D1507",
  "E1103", "E1104", "E1205", "F1602", "F1703", "F1106", "G1202", "G1602",
  "G1803", "G1703", "H1210", "H1502", "H2102", "H2206", "H2903", "I1304",
  "I1604", "J1301", "J1303", "J1501", "J1506", "K1103", "K1204", "K1302",
  "K1303", "K1401", "K1801", "K2111", "K2106", "K2503", "M1203", "M1403",
  "M1501", "M1601", "M1607", "M1609", "M1805", "M1808", "M1810", "N1103",
  "N1301", "N4101", "N4105", "N4201", "N4303", "A1202", "A1204", "A1401",
  "A1405", "D1202", "D1505", "E1307", "F1201", "F1302", "G1501", "G1601",
  "H1206", "H2502", "J1304", "K2204", "M1704", "M1801", "N1202", "N2203"
];
const DEFAULT_METIERS_DIAGNOSTIC_CODES = ["A1203", "K1303", "M1607", "M1805"];
const DEFAULT_RATE_LIMIT_MS = 1100;
const ROME72_REFERENCE_VERSION = "rome72-reference-v0.6.4";
const ROME500_EXPERIMENTAL_VERSION = "rome500-candidate-v0.7";

function buildOutputDirUrl() {
  const explicitSubdir = sanitizeRelativeDir(process.env.ROME_OUTPUT_SUBDIR || "");
  const codesFile = process.env.ROME_CODES_FILE || "";
  const automaticSubdir = !explicitSubdir && /500/.test(codesFile) ? "rome500-experimental" : "";
  const subdir = explicitSubdir || automaticSubdir;
  return subdir ? new URL(`${subdir.replace(/\/$/, "")}/`, BASE_OUT_DIR) : BASE_OUT_DIR;
}

function sanitizeRelativeDir(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map(part => part.trim())
    .filter(part => part && part !== "." && part !== "..")
    .join("/");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(DEBUG_DIR, { recursive: true });
  let codeSelection = { codes: DEFAULT_ROME_CODES, source: "DEFAULT_ROME_CODES" };
  let requestedCodes = DEFAULT_ROME_CODES;
  let outputPlan = buildOutputPlan(codeSelection);
  const generatedAt = new Date().toISOString();
  try {
    codeSelection = await resolveRequestedCodes();
    requestedCodes = codeSelection.codes;
    outputPlan = buildOutputPlan(codeSelection);
    await mkdir(new URL(outputPlan.basePath, OUT_DIR), { recursive: true });
    if (!requestedCodes.length) throw new Error("Aucun code ROME à synchroniser pour cette sélection ou ce lot.");
    const token = await getFranceTravailAccessToken();
    if (isEndpointDiagnosticEnabled()) {
      await writeFicheEndpointDiagnostic(token, {
        generatedAt,
        branch: process.env.GITHUB_REF_NAME || "local",
        endpointUrl: process.env.FT_ROME_FICHES_METIERS_URL || DEFAULT_FICHES_ENDPOINT,
        codes: parseList(process.env.ROME_DIAGNOSTIC_CODES, requestedCodes.slice(0, 3))
      });
      if (isEndpointDiagnosticOnly()) {
        console.log("[Boussole Pro] Diagnostic endpoint ROME termine sans regenerer le corpus.");
        return;
      }
    }
    const syncResult = await fetchRomeFichesMetiers(token, requestedCodes);
    if (syncResult.fichesMetiers.length === 0) {
      const noDataError = new Error("Synchronisation ROME bloquee : 0 fiche exploitable.");
      noDataError.failedCodes = syncResult.failedCodes;
      throw noDataError;
    }
    const optionalReferentials = await fetchOptionalRomeReferentials(token, requestedCodes);
    const syncMeta = {
      generatedAt,
      branch: process.env.GITHUB_REF_NAME || "local",
      requestedCodes,
      successfulCodes: syncResult.successfulCodes,
      failedCodes: syncResult.failedCodes,
      failures: syncResult.failedCodes,
      optionalReferentials: optionalReferentials.diagnostics,
      codeSelection,
      datasetVersion: outputPlan.datasetVersion,
      outputMode: outputPlan.mode
    };
    if (optionalReferentials.referentials?.metiers?.length) {
      await writeRomeMetiersRecordSamples(optionalReferentials.referentials.metiers, syncMeta);
    }
    if (optionalReferentials.referentials?.metiersDetails?.length) {
      await writeRomeMetiersRecordSamples(optionalReferentials.referentials.metiersDetails, syncMeta, {
        filename: "rome-metiers-detail-samples.json",
        source: "rome_metiers_detail_api",
        endpoint: optionalReferentials.diagnostics.find(item => item.name === "metiers_details")?.endpoint,
        usedForDataset: true,
        note: "Diagnostic structurel des enregistrements detailles ROME Metiers recuperes par code. Ces champs peuvent enrichir jobs.rome.json seulement quand les chemins sont presents et stables."
      });
    }
    const parts = {
      fichesMetiers: syncResult.fichesMetiers,
      ...optionalReferentials.parts
    };
    const dataset = mergeRomeDatasets(parts);
    dataset.datasetVersion = outputPlan.datasetVersion;
    dataset.datasetName = outputPlan.datasetName;
    const report = buildDataQualityReport(dataset, syncMeta);
    logSyncSummary(dataset, report, syncMeta);
    if (isRawDebugEnabled()) await writeRawStructureReport(syncResult.rawSamples, syncMeta);
    await writeGeneratedJson(outputPlan.files.jobs, dataset.jobs);
    await writeGeneratedJson(outputPlan.files.dataQuality, report);
    await writeGeneratedJson(outputPlan.files.manifest, {
      schemaVersion: "1.0.0",
      datasetName: dataset.datasetName,
      datasetVersion: dataset.datasetVersion,
      sourceDate: dataset.sourceDate,
      importedAt: dataset.importedAt,
      provenance: "generated_rome",
      sources: ["france_travail_rome_generated"],
      requestedScope: getScope(),
      requestedRomeCodes: requestedCodes,
      requestedCodesCount: requestedCodes.length,
      successfulCodesCount: syncResult.successfulCodes.length,
      failedCodesCount: syncResult.failedCodes.length,
      successfulCodes: syncResult.successfulCodes,
      failedCodes: syncResult.failedCodes,
      completionRate: Number((syncResult.successfulCodes.length / requestedCodes.length).toFixed(2)),
      branch: syncMeta.branch,
      codeSelection,
      outputMode: outputPlan.mode,
      optionalReferentials: optionalReferentials.diagnostics,
      generatedFiles: [
        outputPlan.files.jobs,
        outputPlan.files.manifest,
        outputPlan.files.dataQuality,
        ...(outputPlan.mode === "rome500_batch" ? [outputPlan.files.batchReport] : []),
        "rome-raw-skills.json",
        "skills.rome.json",
        "knowledge.rome.json",
        "certification-like.rome.json",
        "skills-matchable.rome.json",
        "work-contexts.rome.json",
        "job-appellations.rome.json",
        "mappings.rome.json",
        "formations.onisep.json",
        "certifications.certifinfo.json",
        "mappings-rome-formations.json",
        "mappings-rome-certifications.json",
        "rome-corpus-quality-report.json",
        "rome-corpus-performance-report.json",
        "rome-corpus-audit.md",
        "rome-500-quality-report.json",
        "rome-500-performance-report.json",
        "rome-500-audit.md",
        ...(optionalReferentials.referentials?.metiers?.length ? ["debug/rome-metiers-record-samples.json"] : []),
        ...(optionalReferentials.referentials?.metiersDetails?.length ? ["debug/rome-metiers-detail-samples.json"] : []),
        ...(isEndpointDiagnosticEnabled() ? ["debug/fiche-endpoint-diagnostic.json"] : []),
        ...(isRawDebugEnabled() ? ["debug/raw-structure-report.json"] : [])
      ],
      licenseSummary: "A verifier selon les droits d'usage France Travail IO.",
      warnings: [
        dataset.jobs.length < 50 ? "official_partial_corpus_under_50_jobs" : "",
        syncResult.failedCodes.length ? "some_rome_codes_failed" : "",
        ...optionalReferentials.diagnostics.filter(item => item.status !== "ok").map(item => `${item.name}_${item.status}`),
        "mapping_to_verify",
        "license_to_verify"
      ].filter(Boolean)
    });
    await writeGeneratedJson("rome-raw-skills.json", dataset.rawSkills || [], { pretty: false });
    await writeGeneratedJson("skills.rome.json", dataset.skills || []);
    await writeGeneratedJson("knowledge.rome.json", dataset.knowledge || []);
    await writeGeneratedJson("certification-like.rome.json", dataset.certificationLike || []);
    await writeGeneratedJson("skills-matchable.rome.json", dataset.matchableSkills || []);
    await writeGeneratedJson("work-contexts.rome.json", dataset.workContexts || []);
    await writeGeneratedJson(outputPlan.files.appellations, dataset.jobAppellations || []);
    await writeGeneratedJson(outputPlan.files.mappings, dataset.mappings || []);
    await writeGeneratedJson("formations.onisep.json", []);
    await writeGeneratedJson("certifications.certifinfo.json", []);
    await writeGeneratedJson("mappings-rome-formations.json", []);
    await writeGeneratedJson("mappings-rome-certifications.json", []);
    if (outputPlan.mode === "rome500_batch") {
      await writeGeneratedJson(outputPlan.files.batchReport, buildRome500BatchReport(dataset, report, syncMeta, outputPlan));
      console.log(`[Boussole Pro] Lot ROME500 ${outputPlan.batchLabel}: ${dataset.jobs.length}/${requestedCodes.length} metiers ecrits dans ${outputPlan.basePath}`);
    } else {
      const audit = await buildRome500AuditArtifacts();
      await writeGeneratedJson("rome72-reference-manifest.json", buildRome72ReferenceManifest(dataset, report, audit.quality));
      console.log(`[Boussole Pro] Audit corpus ROME: score matching ${Math.round((audit.quality?.matchingReadiness?.score || 0) * 100)}%, coquilles ${audit.quality?.shellJobs?.count || 0}/${audit.quality?.jobsTotal || 0}`);
    }
  } catch (error) {
    await writeGeneratedJson(outputPlan?.files?.syncError || "sync-error.json", {
      generatedAt,
      status: "error",
      message: error.message,
      requestedScope: getScope(),
      requestedCodes,
      failedCodes: error.failedCodes || [],
      hint: "Verifier les secrets GitHub, FT_TOKEN_URL, FT_SCOPE et FT_ROME_FICHES_METIERS_URL."
    });
    throw error;
  }
}

export async function getFranceTravailAccessToken(scope = getScope()) {
  const clientId = process.env.FT_CLIENT_ID;
  const clientSecret = process.env.FT_CLIENT_SECRET;
  const tokenUrl = process.env.FT_TOKEN_URL || DEFAULT_TOKEN_URL;
  if (!clientId || !clientSecret) throw new Error("FT_CLIENT_ID et FT_CLIENT_SECRET sont requis.");
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("scope", scope);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Echec token France Travail: ${response.status} ${shortMessage(body)}`);
  }
  return response.json();
}

export async function fetchRomeFichesMetiers(token, codes = DEFAULT_ROME_CODES) {
  const endpointUrl = process.env.FT_ROME_FICHES_METIERS_URL || DEFAULT_FICHES_ENDPOINT;
  const accessToken = token.access_token || token.token || token;
  const debugCodes = new Set(parseList(process.env.ROME_DEBUG_CODES, ["M1607", "M1805", "K1303", "A1203"]));
  const fichesMetiers = [];
  const successfulCodes = [];
  const failedCodes = [];
  const rawSamples = {};
  for (const code of codes) {
    const result = await fetchRomeFicheMetier(endpointUrl, accessToken, code);
    if (result.ok) {
      const raw = result.payload;
      fichesMetiers.push({ ...raw, code: raw.code || raw.codeRome || raw.romeCode || code, romeCode: raw.romeCode || raw.codeRome || raw.code || code });
      successfulCodes.push(code);
      if (debugCodes.has(code)) rawSamples[code] = raw;
    } else {
      failedCodes.push({
        code,
        status: result.status || "unknown",
        message: shortMessage(result.message || "Fiche ROME non exploitable."),
        endpoint: result.endpoint || endpointUrl
      });
    }
    await sleep(Number(process.env.FT_RATE_LIMIT_MS || DEFAULT_RATE_LIMIT_MS));
  }
  return { fichesMetiers, successfulCodes, failedCodes, rawSamples };
}

async function fetchRomeFicheMetier(endpointUrl, accessToken, code) {
  const attempts = buildFicheUrlAttempts(endpointUrl, code);
  const errors = [];
  const successfulPayloads = [];
  for (const url of attempts) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        errors.push({ status: response.status, message: await safeResponseText(response), endpoint: url });
        continue;
      }
      const json = await response.json();
      const payload = extractFichePayload(json, code);
      if (payload) {
        const richness = analyzeFichePayload(payload);
        successfulPayloads.push({ payload, endpoint: url, richness });
        if (richness.isDetailed) return { ok: true, payload, endpoint: url, richness };
        continue;
      }
      errors.push({ status: "invalid_structure", message: "Reponse JSON sans fiche exploitable", endpoint: url });
    } catch (error) {
      errors.push({ status: "network_or_parse_error", message: error.message, endpoint: url });
    }
  }
  if (successfulPayloads.length) {
    const best = successfulPayloads.sort((a, b) => b.richness.score - a.richness.score)[0];
    return { ok: true, payload: best.payload, endpoint: best.endpoint, richness: best.richness };
  }
  const last = errors[errors.length - 1] || {};
  return { ok: false, status: last.status || "unknown", message: last.message || `Aucune fiche ROME exploitable pour ${code}.`, endpoint: last.endpoint || attempts[0] };
}

function buildFicheUrlAttempts(endpointUrl, code) {
  if (endpointUrl.includes("{code}") || endpointUrl.includes("{CODE_ROME}") || endpointUrl.includes("{romeCode}") || endpointUrl.includes("{codeRome}")) {
    return [
      endpointUrl
        .replaceAll("{code}", encodeURIComponent(code))
        .replaceAll("{CODE_ROME}", encodeURIComponent(code))
        .replaceAll("{romeCode}", encodeURIComponent(code))
        .replaceAll("{codeRome}", encodeURIComponent(code))
    ];
  }
  const attempts = [];
  const pathUrl = new URL(endpointUrl);
  pathUrl.pathname = `${pathUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(code)}`;
  attempts.push(pathUrl.toString());
  for (const paramName of parseList(process.env.FT_ROME_FICHE_CODE_PARAMS, ["codeRome", "code", "romeCode"])) {
    const url = new URL(endpointUrl);
    url.searchParams.set(paramName, code);
    attempts.push(url.toString());
  }
  for (const paramName of ["codeMetier", "codeROME", "code_rome"]) {
    const url = new URL(endpointUrl);
    url.searchParams.set(paramName, code);
    attempts.push(url.toString());
  }
  return [...new Set(attempts)];
}

function extractFichePayload(json, code) {
  if (!json) return null;
  if (Array.isArray(json)) return findPayloadByCode(json, code) || json[0] || null;
  if (looksLikeFicheMetier(json)) return json;
  for (const key of ["ficheMetier", "fiche", "resultat", "metier", "data"]) {
    if (json[key] && !Array.isArray(json[key])) return json[key];
    if (Array.isArray(json[key])) return findPayloadByCode(json[key], code) || json[key][0] || null;
  }
  for (const key of ["resultats", "results", "items", "liste"]) {
    if (Array.isArray(json[key])) return findPayloadByCode(json[key], code) || json[key][0] || null;
  }
  return json;
}

function looksLikeFicheMetier(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.metier && (value.code || value.groupesCompetencesMobilisees || value.groupesSavoirs || value.obsolete !== undefined)) return true;
  return Boolean(value.groupesCompetencesMobilisees || value.groupesSavoirs || value.groupesCompetences || value.competencesMobilisees);
}

function analyzeFichePayload(payload = {}) {
  const candidates = {
    competences: findCandidatePaths(payload, ["groupescompetencesmobilisees", "competence", "savoirfaire", "savoir-faire"]),
    savoirs: findCandidatePaths(payload, ["groupessavoirs", "savoirs", "connaissance"]),
    appellations: findCandidatePaths(payload, ["appellation"]),
    contextesTravail: findCandidatePaths(payload, ["contextestravail", "contextetravail", "conditionexercice", "environnementtravail"]),
    conditionsAcces: findCandidatePaths(payload, ["conditionacces", "accesemploimetier", "accesmetier"]),
    mobilites: findCandidatePaths(payload, ["mobilite", "metierproche", "prochemetier"])
  };
  const rootKeys = Object.keys(payload || {}).filter(key => !isSensitiveKey(key)).sort();
  const nonEmptyGroups = Object.values(candidates).filter(rows => rows.length).length;
  const hasKnownRichRoot = rootKeys.some(key => [
    "groupesCompetencesMobilisees",
    "groupesSavoirs",
    "groupesCompetences",
    "competencesMobilisees",
    "appellations",
    "contextesTravail"
  ].includes(key));
  const availableRichFields = Object.entries(candidates)
    .filter(([, rows]) => rows.length)
    .map(([field]) => field);
  const expectedCompleteFields = ["appellations", "contextesTravail", "conditionsAcces", "mobilites"];
  const missingCompleteFields = expectedCompleteFields.filter(field => !availableRichFields.includes(field));
  const score = nonEmptyGroups + (hasKnownRichRoot ? 2 : 0) + Math.max(0, rootKeys.length - 2) * 0.25;
  return {
    rootKeys,
    score: Number(score.toFixed(2)),
    isDetailed: score >= 2,
    isCompleteFiche: missingCompleteFields.length === 0,
    detailLevel: missingCompleteFields.length ? "skills_and_knowledge_only" : "complete_job_fields_candidate",
    availableRichFields,
    missingCompleteFields,
    isShell: score < 1 && rootKeys.every(key => ["code", "metier", "libelle"].includes(key)),
    candidates: Object.fromEntries(Object.entries(candidates).map(([key, rows]) => [key, rows.slice(0, 8)]))
  };
}

async function writeFicheEndpointDiagnostic(token, options = {}) {
  await mkdir(DEBUG_DIR, { recursive: true });
  const accessToken = token.access_token || token.token || token;
  const endpointUrl = options.endpointUrl || process.env.FT_ROME_FICHES_METIERS_URL || DEFAULT_FICHES_ENDPOINT;
  const codes = options.codes?.length ? options.codes : ["M1607", "G1202", "A1203"];
  const results = [];
  for (const code of codes) {
    const attempts = [];
    for (const endpoint of buildFicheUrlAttempts(endpointUrl, code)) {
      const row = {
        code,
        endpoint: redactEndpoint(endpoint),
        status: "not_called",
        ok: false,
        payloadShape: null,
        richness: null,
        message: ""
      };
      try {
        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });
        row.status = response.status;
        if (!response.ok) {
          row.message = await safeResponseText(response);
        } else {
          const json = await response.json();
          const payload = extractFichePayload(json, code);
          row.ok = Boolean(payload);
          row.payloadShape = describePayloadShape(payload || json);
          row.richness = payload ? analyzeFichePayload(payload) : null;
          row.message = payload ? (row.richness?.isDetailed ? "detail_sufficient" : "payload_too_poor") : "no_payload";
        }
      } catch (error) {
        row.status = "network_or_parse_error";
        row.message = shortMessage(error.message);
      }
      attempts.push(row);
      await sleep(Number(process.env.FT_RATE_LIMIT_MS || DEFAULT_RATE_LIMIT_MS));
    }
    results.push({
      code,
      bestEndpoint: attempts
        .filter(item => item.ok)
        .sort((a, b) => (b.richness?.score || 0) - (a.richness?.score || 0))[0]?.endpoint || null,
      bestScore: attempts
        .filter(item => item.ok)
        .sort((a, b) => (b.richness?.score || 0) - (a.richness?.score || 0))[0]?.richness?.score || 0,
      attempts
    });
  }
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: options.generatedAt || new Date().toISOString(),
    branch: options.branch || process.env.GITHUB_REF_NAME || "local",
    source: "rome_fiche_endpoint_diagnostic",
    requestedEndpoint: redactEndpoint(endpointUrl),
    testedCodes: codes,
    note: "Rapport sans token ni Authorization. Il compare les variantes d'appel pour trouver celle qui renvoie une FicheMetier enrichie.",
    expectedRichFields: ["groupesCompetencesMobilisees", "groupesSavoirs", "appellations", "contextesTravail", "conditionsAcces"],
    results,
    recommendation: buildEndpointDiagnosticRecommendation(results)
  };
  await writeFile(new URL("fiche-endpoint-diagnostic.json", DEBUG_DIR), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Diagnostic endpoint ROME: ${results.length} code(s), meilleur score ${Math.max(0, ...results.map(item => item.bestScore || 0))}.`);
}

function describePayloadShape(payload = {}) {
  if (!payload || typeof payload !== "object") return { type: typeof payload };
  return {
    type: Array.isArray(payload) ? "array" : "object",
    rootKeys: Object.keys(payload).filter(key => !isSensitiveKey(key)).sort(),
    sampleChildKeys: Object.fromEntries(Object.entries(payload)
      .filter(([, value]) => value && typeof value === "object")
      .slice(0, 10)
      .map(([key, value]) => [key, Array.isArray(value) ? { type: "array", length: value.length } : Object.keys(value).filter(childKey => !isSensitiveKey(childKey)).slice(0, 12)]))
  };
}

function buildEndpointDiagnosticRecommendation(results = []) {
  const best = results
    .flatMap(item => item.attempts || [])
    .filter(item => item.ok)
    .sort((a, b) => (b.richness?.score || 0) - (a.richness?.score || 0))[0];
  if (!best) return "Aucune variante n'a renvoye de payload exploitable. Verifier le scope, l'URL ou les droits API.";
  if (best.richness?.isCompleteFiche) return `Utiliser la variante ${best.endpoint}, qui expose des champs metier riches candidats.`;
  if (best.richness?.isDetailed) {
    const available = toArray(best.richness.availableRichFields).join(", ") || "competences/savoirs";
    const missing = toArray(best.richness.missingCompleteFields).join(", ") || "aucun";
    return `Utiliser la variante ${best.endpoint} pour les champs disponibles (${available}). Elle ne suffit pas pour une fiche complete : champs encore absents (${missing}).`;
  }
  return "Toutes les variantes repondent avec un payload trop pauvre. Chercher une autre route de l'API Fiches metiers ou une API Metiers/Competences de liaison.";
}

async function fetchOptionalRomeReferentials(mainToken, requestedCodes = []) {
  const diagnostics = [];
  const parts = {};
  const referentials = {};
  const configs = [
    { name: "metiers", envUrl: "FT_ROME_METIERS_URL", envScope: "FT_SCOPE_METIERS", partKey: null },
    { name: "competences", envUrl: "FT_ROME_COMPETENCES_URL", envScope: "FT_SCOPE_COMPETENCES", partKey: "competences" },
    { name: "contextes", envUrl: "FT_ROME_CONTEXTES_URL", envScope: "FT_SCOPE_CONTEXTES", partKey: "contextes" }
  ];
  for (const config of configs) {
    const endpoint = process.env[config.envUrl];
    if (!endpoint) {
      diagnostics.push({ name: config.name, status: "not_configured", message: `${config.envUrl} absent : referentiel optionnel ignore.` });
      continue;
    }
    const scope = process.env[config.envScope] || getScope();
    try {
      const token = scope === getScope() ? mainToken : await getFranceTravailAccessToken(scope);
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token.access_token || token.token || token}`,
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        diagnostics.push({ name: config.name, status: response.status, message: await safeResponseText(response), endpoint });
        continue;
      }
      const json = await response.json();
      const rows = extractArrayFromApiResponse(json);
      if (config.name === "metiers") {
        referentials.metiers = rows;
        const details = await fetchRomeMetiersDetails(endpoint, token, requestedCodes);
        if (details.records.length) {
          parts.metiers = details.records;
          referentials.metiersDetails = details.records;
        }
        diagnostics.push({
          name: "metiers_details",
          status: details.records.length ? "ok" : "no_data",
          count: details.records.length,
          usedForDataset: Boolean(details.records.length),
          endpoint: `${endpoint.replace(/\/$/, "")}/{CODE_ROME}`,
          failedCodesCount: details.failedCodes.length,
          failedCodes: details.failedCodes.slice(0, 20)
        });
      }
      if (config.partKey) parts[config.partKey] = rows;
      diagnostics.push({ name: config.name, status: "ok", count: rows.length, usedForDataset: Boolean(config.partKey), endpoint, scope: scope ? "configured" : "default" });
    } catch (error) {
      diagnostics.push({ name: config.name, status: "error", message: shortMessage(error.message), endpoint });
    }
    await sleep(Number(process.env.FT_RATE_LIMIT_MS || DEFAULT_RATE_LIMIT_MS));
  }
  return { parts, diagnostics, referentials };
}

async function fetchRomeMetiersDetails(endpointUrl, token, codes = []) {
  const accessToken = token.access_token || token.token || token;
  const records = [];
  const failedCodes = [];
  for (const code of codes) {
    const result = await fetchRomeFicheMetier(endpointUrl, accessToken, code);
    if (result.ok && hasMetiersDetailPayload(result.payload)) {
      const raw = result.payload || {};
      records.push({ ...raw, code: raw.code || raw.codeRome || raw.romeCode || code, romeCode: raw.romeCode || raw.codeRome || raw.code || code });
    } else {
      failedCodes.push({
        code,
        status: result.status || "unknown",
        message: shortMessage(result.message || (result.ok ? "Detail ROME Metiers limite a code/libelle." : "Detail ROME Metiers non exploitable.")),
        endpoint: result.endpoint || endpointUrl
      });
    }
    await sleep(Number(process.env.FT_RATE_LIMIT_MS || DEFAULT_RATE_LIMIT_MS));
  }
  return { records, failedCodes };
}

function hasMetiersDetailPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Boolean(
    payload.definition ||
    payload.accesEmploi ||
    toArray(payload.appellations).length ||
    toArray(payload.contextesTravail).length ||
    toArray(payload.competencesMobilisees).length
  );
}

function extractArrayFromApiResponse(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const key of ["items", "resultats", "results", "data", "liste", "metiers", "competences", "contextes", "referentiels"]) {
    if (Array.isArray(json[key])) return json[key];
  }
  for (const value of Object.values(json)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

async function writeRomeMetiersRecordSamples(records = [], syncMeta = {}, options = {}) {
  await mkdir(DEBUG_DIR, { recursive: true });
  const codes = parseList(process.env.ROME_METIERS_DIAGNOSTIC_CODES, DEFAULT_METIERS_DIAGNOSTIC_CODES);
  const recordsByCode = new Map();
  toArray(records).forEach(record => {
    const code = extractRomeCodeFromRecord(record);
    if (code && !recordsByCode.has(code)) recordsByCode.set(code, record);
  });
  const samples = Object.fromEntries(codes.map(code => {
    const record = recordsByCode.get(code);
    return [code, buildRomeMetiersRecordSample(code, record)];
  }));
  const fieldAvailability = buildMetiersFieldAvailability(samples);
  const baseConclusion = buildMetiersDiagnosticConclusion(fieldAvailability);
  const conclusion = {
    ...baseConclusion,
    usedForDataset: options.usedForDataset ?? baseConclusion.usedForDataset
  };
  const endpoint = options.endpoint || getMetiersDiagnosticEndpoint(syncMeta);
  const unavailableFieldReport = buildMetiersUnavailableFieldReport({ fieldAvailability, samples, endpoint });
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: syncMeta.generatedAt || new Date().toISOString(),
    branch: syncMeta.branch || process.env.GITHUB_REF_NAME || "local",
    source: options.source || "rome_metiers_api",
    endpoint,
    totalRecords: records.length,
    diagnosticCodes: codes,
    note: options.note || "Diagnostic structurel uniquement. Le référentiel ROME Métiers n'est pas utilisé pour enrichir jobs.rome.json tant qu'il ne contient que code/libelle ou tant que les chemins riches ne sont pas validés.",
    fieldAvailability,
    conclusion,
    unavailableFieldReport,
    samples
  };
  await writeFile(new URL(options.filename || "rome-metiers-record-samples.json", DEBUG_DIR), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Diagnostic API Metiers: ${records.length} enregistrement(s), ${codes.filter(code => samples[code]?.found).length}/${codes.length} code(s) trouves.`);
}

function buildRomeMetiersRecordSample(code, record) {
  if (!record) {
    return {
      found: false,
      rootKeys: [],
      recursivePaths: [],
      detectedFields: emptyMetiersDetectedFields(),
      sanitizedSample: null
    };
  }
  const detectedFields = {
    code: findCandidatePaths(record, ["code", "coderome", "codemetier"]),
    title: findCandidatePaths(record, ["libelle", "intitule", "nom", "titre"]),
    description: findCandidatePaths(record, ["definition", "description", "descriptif", "resume", "finalite"]),
    appellations: findCandidatePaths(record, ["appellation"]),
    characteristics: findCandidatePaths(record, ["caracteristique", "conditionexercice", "situationtravail"]),
    skillRefs: findCandidatePaths(record, ["competence", "savoirfaire", "savoir-faire"]),
    softSkillRefs: findCandidatePaths(record, ["savoiretre", "savoir-etre", "softskill"]),
    knowledgeRefs: findCandidatePaths(record, ["savoir", "connaissance", "knowledge"]),
    contextRefs: findCandidatePaths(record, ["contextestravail", "contextetravail", "contexte-travail", "conditionexercice", "environnementtravail", "situationtravail"]),
    accessConditions: findCandidatePaths(record, ["conditionacces", "accesemploi", "accesemploimetier", "accesmetier", "prerequis", "pre-requis"]),
    certificationRefs: findCandidatePaths(record, ["certification", "habilitation", "reglementation"]),
    relatedRomeCodes: findCandidatePaths(record, ["mobilite", "metierproche", "prochemetier"]),
    regulatoryTags: findCandidatePaths(record, ["reglement", "obligatoire", "autorisation"])
  };
  return {
    found: true,
    rootKeys: Object.keys(record || {}).filter(key => !isSensitiveKey(key)).sort(),
    recursivePaths: collectRecursivePaths(record).slice(0, 240),
    detectedFields,
    sanitizedSample: sanitizeDiagnosticSample(record)
  };
}

function emptyMetiersDetectedFields() {
  return {
    code: [],
    title: [],
    description: [],
    appellations: [],
    characteristics: [],
    skillRefs: [],
    softSkillRefs: [],
    knowledgeRefs: [],
    contextRefs: [],
    accessConditions: [],
    certificationRefs: [],
    relatedRomeCodes: [],
    regulatoryTags: []
  };
}

function buildMetiersFieldAvailability(samples = {}) {
  const foundSamples = Object.values(samples).filter(sample => sample?.found);
  const fields = Object.keys(emptyMetiersDetectedFields());
  return Object.fromEntries(fields.map(field => {
    const samplesWithField = foundSamples.filter(sample => toArray(sample.detectedFields?.[field]).length).length;
    return [field, {
      samplesWithField,
      samplesTotal: foundSamples.length,
      status: samplesWithField ? "available_in_sample" : "not_available_in_sample"
    }];
  }));
}

function buildMetiersDiagnosticConclusion(fieldAvailability = {}) {
  const richFields = [
    "description",
    "appellations",
    "characteristics",
    "skillRefs",
    "softSkillRefs",
    "knowledgeRefs",
    "contextRefs",
    "accessConditions",
    "certificationRefs",
    "relatedRomeCodes",
    "regulatoryTags"
  ];
  const availableRichFields = richFields.filter(field => fieldAvailability[field]?.samplesWithField > 0);
  const missingRichFields = richFields.filter(field => !availableRichFields.includes(field));
  return {
    status: availableRichFields.length ? "rich_fields_detected" : "shell_only_code_libelle",
    usedForDataset: false,
    normalizationAllowed: ["code", "title", ...availableRichFields],
    missingRichFields,
    message: availableRichFields.length
      ? "Des champs riches semblent presents dans certains echantillons : valider les chemins avant d'enrichir jobs.rome.json."
      : "Les echantillons ROME Metiers contiennent seulement code/libelle. Cette route ne doit pas etre utilisee pour inventer descriptions, appellations, contextes, conditions d'acces ou certifications.",
    nextAction: availableRichFields.length
      ? "Analyser les chemins detectes puis brancher uniquement les champs confirmes."
      : "Identifier une route de detail ou de liaison officielle pour appellations, contextes, conditions d'acces et mobilites."
  };
}

function getMetiersDiagnosticEndpoint(syncMeta = {}) {
  const diagnostic = toArray(syncMeta.optionalReferentials).find(item => item?.name === "metiers");
  return diagnostic?.endpoint || process.env.FT_ROME_METIERS_URL || "endpoint_metiers_non_renseigne";
}

function buildMetiersUnavailableFieldReport({ fieldAvailability = {}, samples = {}, endpoint = "" } = {}) {
  const actualRootKeys = unique(Object.values(samples)
    .filter(sample => sample?.found)
    .flatMap(sample => sample.rootKeys || []));
  const actualStructures = Object.fromEntries(Object.entries(samples).map(([code, sample]) => [code, {
    found: Boolean(sample?.found),
    rootKeys: sample?.rootKeys || [],
    recursivePathCount: toArray(sample?.recursivePaths).length
  }]));
  const expected = {
    description: ["definition", "description", "descriptif", "resume", "finalite"],
    appellations: ["appellations", "appellationsMetier", "libelles", "intitules"],
    characteristics: ["caracteristiques", "conditionsExercice", "situationsTravail"],
    skillRefs: ["competences", "savoirFaire", "groupesCompetences"],
    softSkillRefs: ["savoirEtre", "savoirEtreProfessionnels"],
    knowledgeRefs: ["savoirs", "connaissances", "groupesSavoirs"],
    contextRefs: ["contextesTravail", "conditionsExerciceActivite", "environnementsTravail"],
    accessConditions: ["conditionsAcces", "accesEmploi", "accesEmploiMetier", "prerequis"],
    certificationRefs: ["certifications", "habilitations", "reglementation"],
    relatedRomeCodes: ["mobilites", "metiersProches", "prochesMetiers"],
    regulatoryTags: ["reglementation", "obligatoire", "autorisation"]
  };
  return Object.entries(expected).map(([field, expectedPaths]) => {
    const availability = fieldAvailability[field] || {};
    const detectedPaths = unique(Object.values(samples).flatMap(sample => toArray(sample?.detectedFields?.[field]).map(item => item.path || item)));
    return {
      field,
      endpointTested: endpoint,
      expectedPathHints: expectedPaths,
      detectedPaths,
      actualRootKeys,
      actualStructures,
      status: availability.samplesWithField > 0 ? "candidate_path_detected" : "not_available_in_sample",
      reason: availability.samplesWithField > 0
        ? "Chemin candidat detecte : a valider avant normalisation."
        : "Les echantillons de cette route exposent uniquement la structure disponible, actuellement code/libelle pour les codes testes. La donnee ne peut pas etre reliee sans route de detail ou relation officielle."
    };
  });
}

function collectRecursivePaths(source) {
  const paths = [];
  const seen = new Set();
  const visit = (value, path = "$", depth = 0) => {
    if (value === undefined || value === null || depth > 7 || paths.length >= 500) return;
    if (isSensitiveKey(path)) return;
    paths.push({
      path,
      type: Array.isArray(value) ? "array" : typeof value,
      arrayLength: Array.isArray(value) ? value.length : undefined,
      childKeys: value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).filter(key => !isSensitiveKey(key)).slice(0, 20)
        : undefined
    });
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 6).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .forEach(([key, child]) => visit(child, `${path}.${key}`, depth + 1));
  };
  visit(source);
  return paths;
}

function sanitizeDiagnosticSample(value, depth = 5) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return shortMessage(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth <= 0) {
    if (Array.isArray(value)) return { type: "array", length: value.length };
    if (typeof value === "object") return { type: "object", keys: Object.keys(value).filter(key => !isSensitiveKey(key)).slice(0, 20) };
    return null;
  }
  if (Array.isArray(value)) return value.slice(0, 8).map(item => sanitizeDiagnosticSample(item, depth - 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .slice(0, 80)
      .map(([key, child]) => [key, sanitizeDiagnosticSample(child, depth - 1)]));
  }
  return null;
}

function extractRomeCodeFromRecord(record = {}) {
  if (!record) return "";
  if (typeof record === "string" || typeof record === "number") {
    const match = String(record).toUpperCase().match(/[A-Z][0-9]{4}/);
    return match ? match[0] : "";
  }
  const direct = [
    record.code,
    record.codeRome,
    record.romeCode,
    record.codeROME,
    record.codeMetier,
    record.metier?.code,
    record.metier?.codeRome,
    record.id
  ].find(Boolean);
  const match = String(direct || "").toUpperCase().match(/[A-Z][0-9]{4}/);
  if (match) return match[0];
  const text = JSON.stringify(sanitizeDiagnosticSample(record, 2));
  const deepMatch = text.toUpperCase().match(/[A-Z][0-9]{4}/);
  return deepMatch ? deepMatch[0] : "";
}

async function writeRawStructureReport(rawSamples = {}, syncMeta = {}) {
  await mkdir(DEBUG_DIR, { recursive: true });
  const report = buildRawStructureReport(rawSamples, syncMeta);
  await writeFile(new URL("raw-structure-report.json", DEBUG_DIR), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function buildRawStructureReport(rawSamples = {}, syncMeta = {}) {
  const categories = {
    title: ["title", "titre", "libelle", "intitule", "nom"],
    description: ["description", "resume", "definition", "presentation"],
    competences: ["competence", "savoirfaire", "savoir-faire"],
    savoirs: ["savoirs", "connaissance", "knowledge"],
    savoirEtre: ["savoiretre", "savoir-etre", "softskill"],
    appellations: ["appellation"],
    contextesTravail: ["contextestravail", "contextetravail", "contexte-travail", "conditionexercice", "environnementtravail"],
    conditionsAcces: ["conditionacces", "accesemploi", "accesemploimetier", "accesmetier"],
    certifications: ["certification", "habilitation"],
    mobilites: ["mobilite", "metierproche", "prochemetier"]
  };
  const samples = Object.fromEntries(Object.entries(rawSamples).map(([code, raw]) => [
    code,
    {
      rootKeys: Object.keys(raw || {}).filter(key => !isSensitiveKey(key)).sort(),
      candidates: Object.fromEntries(Object.entries(categories).map(([category, hints]) => [
        category,
        findCandidatePaths(raw, hints)
      ]))
    }
  ]));
  return {
    schemaVersion: "1.0.0",
    generatedAt: syncMeta.generatedAt || new Date().toISOString(),
    branch: syncMeta.branch || process.env.GITHUB_REF_NAME || "local",
    requestedDebugCodes: Object.keys(rawSamples),
    note: "Rapport structurel sans corps brut complet et sans jeton. Les chemins indiquent uniquement les zones candidates a verifier pour la normalisation.",
    fields: {
      title: "Voir samples[CODE].candidates.title",
      description: "Voir samples[CODE].candidates.description",
      appellations: "Voir samples[CODE].candidates.appellations",
      competences: "Voir samples[CODE].candidates.competences",
      contextesTravail: "Voir samples[CODE].candidates.contextesTravail",
      conditionsAcces: "Voir samples[CODE].candidates.conditionsAcces",
      mobilites: "Voir samples[CODE].candidates.mobilites"
    },
    samples
  };
}

function findCandidatePaths(source, hints = []) {
  const normalizedHints = hints.map(normalizeKey).filter(Boolean);
  const matches = [];
  const seen = new Set();
  const visit = (value, path = "$", key = "", depth = 0) => {
    if (value === undefined || value === null || depth > 8 || matches.length >= 60) return;
    if (isSensitiveKey(key) || isSensitiveKey(path)) return;
    const normalizedKey = normalizeKey(key);
    if (normalizedHints.some(hint => normalizedKey.includes(hint))) {
      matches.push(describeCandidate(path, key, value));
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 8).forEach((item, index) => visit(item, `${path}[${index}]`, key, depth + 1));
      return;
    }
    Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, `${path}.${childKey}`, childKey, depth + 1));
  };
  visit(source);
  return matches;
}

function describeCandidate(path, key, value) {
  return {
    path,
    key,
    type: Array.isArray(value) ? "array" : typeof value,
    arrayLength: Array.isArray(value) ? value.length : undefined,
    childKeys: value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).filter(childKey => !isSensitiveKey(childKey)).slice(0, 20)
      : undefined
  };
}

function isSensitiveKey(value = "") {
  return /(access.?token|authorization|bearer|client.?id|client.?secret|secret|password|api.?key)/i.test(String(value));
}

function normalizeKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findPayloadByCode(items, code) {
  return items.find(item => [item?.code, item?.codeRome, item?.romeCode, item?.id].includes(code));
}

function getScope() {
  return process.env.FT_SCOPE || DEFAULT_SCOPE;
}

async function resolveRequestedCodes() {
  const explicitCodes = parseList(process.env.ROME_CODES, []);
  const filePath = process.env.ROME_CODES_FILE;
  const fileCodes = explicitCodes.length ? [] : await readRomeCodesFile(filePath);
  const sourceCodes = explicitCodes.length ? explicitCodes : fileCodes.length ? fileCodes : DEFAULT_ROME_CODES;
  const batchSize = Math.max(0, Number(process.env.ROME_BATCH_SIZE || 0));
  const batchIndex = Math.max(0, Number(process.env.ROME_BATCH_INDEX || 0));
  const uniqueCodes = unique(sourceCodes.map(code => String(code).trim().toUpperCase()).filter(Boolean));
  if (batchSize > 0 && batchIndex > 0) {
    const start = (batchIndex - 1) * batchSize;
    const end = start + batchSize;
    return {
      codes: uniqueCodes.slice(start, end),
      allCodesCount: uniqueCodes.length,
      source: explicitCodes.length ? "ROME_CODES" : fileCodes.length ? "ROME_CODES_FILE" : "DEFAULT_ROME_CODES",
      filePath: filePath || null,
      batchIndex,
      batchSize,
      batchStart: start + 1,
      batchEnd: Math.min(end, uniqueCodes.length)
    };
  }
  return {
    codes: uniqueCodes,
    allCodesCount: uniqueCodes.length,
    source: explicitCodes.length ? "ROME_CODES" : fileCodes.length ? "ROME_CODES_FILE" : "DEFAULT_ROME_CODES",
    filePath: filePath || null,
    batchIndex: null,
    batchSize: null,
    batchStart: 1,
    batchEnd: uniqueCodes.length
  };
}

async function readRomeCodesFile(filePath = "") {
  if (!filePath) return [];
  const safePath = sanitizeRelativeDir(filePath);
  if (!safePath) return [];
  const content = await readFile(new URL(`../${safePath}`, import.meta.url), "utf8");
  if (/\.json$/i.test(safePath)) {
    const json = JSON.parse(content);
    if (Array.isArray(json)) return json.map(item => typeof item === "string" ? item : item.romeCode || item.code).filter(Boolean);
    if (Array.isArray(json.codes)) return json.codes.map(item => typeof item === "string" ? item : item.romeCode || item.code).filter(Boolean);
  }
  return parseList(content, []);
}

function buildOutputPlan(codeSelection = {}) {
  const batchIndex = Number(codeSelection.batchIndex || 0);
  const experimental = Boolean(batchIndex) || /500/.test(codeSelection.filePath || "") || process.env.ROME_DATASET_MODE === "rome500";
  const batchLabel = batchIndex ? String(batchIndex).padStart(2, "0") : "";
  if (experimental && batchLabel) {
    return {
      mode: "rome500_batch",
      datasetName: "Boussole Pro — corpus ROME 500 candidat consolidé",
      datasetVersion: `${process.env.ROME_DATASET_VERSION || ROME500_EXPERIMENTAL_VERSION}-batch-${batchLabel}`,
      batchLabel,
      basePath: "batches/",
      files: {
        jobs: `batches/jobs.batch-${batchLabel}.json`,
        mappings: `batches/mappings.batch-${batchLabel}.json`,
        appellations: `batches/appellations.batch-${batchLabel}.json`,
        dataQuality: `batches/data-quality.batch-${batchLabel}.json`,
        batchReport: `batches/report.batch-${batchLabel}.json`,
        manifest: `batches/import-manifest.batch-${batchLabel}.json`,
        syncError: `batches/sync-error.batch-${batchLabel}.json`
      }
    };
  }
  return {
    mode: experimental ? "rome500_full_experimental" : "rome72_reference",
    datasetName: experimental ? "Boussole Pro — corpus ROME 500 candidat consolidé" : "Boussole Pro - corpus ROME 72 de référence",
    datasetVersion: process.env.ROME_DATASET_VERSION || (experimental ? ROME500_EXPERIMENTAL_VERSION : ROME72_REFERENCE_VERSION),
    batchLabel,
    basePath: "",
    files: {
      jobs: "jobs.rome.json",
      mappings: "mappings.rome.json",
      appellations: "job-appellations.rome.json",
      dataQuality: "data-quality-report.rome.json",
      batchReport: "data-quality-report.rome.json",
      manifest: "import-manifest.rome.json",
      syncError: "sync-error.json"
    }
  };
}

function parseList(value, fallback = []) {
  if (!value) return fallback;
  const parsed = String(value).split(/[,\n;\s]+/).map(item => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function unique(items = []) {
  return [...new Set(toArray(items).filter(Boolean))];
}

function isRawDebugEnabled() {
  return String(process.env.ROME_RAW_DEBUG || "false").toLowerCase() === "true";
}

function isEndpointDiagnosticEnabled() {
  return String(process.env.ROME_ENDPOINT_DIAGNOSTIC || "false").toLowerCase() === "true";
}

function isEndpointDiagnosticOnly() {
  return String(process.env.ROME_ENDPOINT_DIAGNOSTIC_ONLY || "false").toLowerCase() === "true";
}

function redactEndpoint(value = "") {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.toString();
  } catch {
    return shortMessage(value);
  }
}

function logSyncSummary(dataset = {}, report = {}, syncMeta = {}) {
  const summary = report.summary || {};
  const coverage = report.coverage || {};
  const mappings = dataset.mappings || [];
  const nonEmptySkillMappings = mappings.filter(item => item.skillIds?.length).length;
  const nonEmptyContextMappings = mappings.filter(item => item.contextIds?.length).length;
  console.log(`[Boussole Pro] Branche: ${syncMeta.branch || "local"}`);
  console.log(`[Boussole Pro] Metiers recuperes: ${dataset.jobs?.length || 0}/${syncMeta.requestedCodes?.length || 0}`);
  console.log(`[Boussole Pro] Competences brutes: ${summary.rawSkills || 0}`);
  console.log(`[Boussole Pro] Competences filtrees: ${summary.filteredSkills || summary.skills || 0}`);
  console.log(`[Boussole Pro] Competences matchables profil: ${summary.matchableSkills || 0}`);
  console.log(`[Boussole Pro] Contextes globaux: ${summary.workContexts || 0}`);
  console.log(`[Boussole Pro] Mappings avec skillIds: ${nonEmptySkillMappings}/${mappings.length}`);
  console.log(`[Boussole Pro] Mappings avec contextIds: ${nonEmptyContextMappings}/${mappings.length}`);
  console.log(`[Boussole Pro] Metiers avec competences liees: ${coverage.linkedJobsWithSkillsCount || 0}`);
  console.log(`[Boussole Pro] Metiers avec contextes lies: ${coverage.linkedJobsWithContextsCount || 0}`);
  (syncMeta.optionalReferentials || []).forEach(item => {
    console.log(`[Boussole Pro] API optionnelle ${item.name}: ${item.status}${item.count !== undefined ? ` (${item.count})` : ""}`);
  });
}

function buildRome72ReferenceManifest(dataset = {}, report = {}, auditQuality = {}) {
  const warnings = toArray(report.warnings);
  const blocking = warnings.filter(item => item.severity === "blocking" || item.severity === "critical").length;
  const warningCount = warnings.filter(item => item.severity === "warning").length;
  const infoCount = warnings.filter(item => item.severity === "info").length;
  return {
    schemaVersion: "1.0.0",
    datasetVersion: ROME72_REFERENCE_VERSION,
    generatedAt: new Date().toISOString(),
    jobsCount: toArray(dataset.jobs).length,
    dataReadiness: auditQuality.readiness?.dataReadiness || "enriched_usable",
    engineReadiness: "validated_on_8_profiles",
    performanceReadiness: auditQuality.readiness?.performanceReadiness || "needs_compaction",
    overallReadiness: auditQuality.readiness?.overallReadiness || "usable_for_validation",
    knownExceptions: toArray(dataset.jobs)
      .filter(job => toArray(job.dataQuality?.warnings).includes("official_detail_unavailable"))
      .map(job => job.romeCode)
      .filter(Boolean),
    benchmarkAnomalies: {
      blocking,
      warning: warningCount,
      info: infoCount
    },
    files: [
      "jobs.rome.json",
      "mappings.rome.json",
      "job-appellations.rome.json",
      "skills.rome.json",
      "skills-matchable.rome.json",
      "knowledge.rome.json",
      "work-contexts.rome.json",
      "rome-corpus-quality-report.json",
      "matching-regression-report.json"
    ]
  };
}

function buildRome500BatchReport(dataset = {}, report = {}, syncMeta = {}, outputPlan = {}) {
  return {
    schemaVersion: "1.0.0",
    datasetVersion: outputPlan.datasetVersion,
    generatedAt: new Date().toISOString(),
    mode: "rome500_batch",
    batchLabel: outputPlan.batchLabel,
    codeSelection: syncMeta.codeSelection,
    requestedCodesCount: toArray(syncMeta.requestedCodes).length,
    successfulCodesCount: toArray(syncMeta.successfulCodes).length,
    failedCodesCount: toArray(syncMeta.failedCodes).length,
    successfulCodes: syncMeta.successfulCodes || [],
    failedCodes: syncMeta.failedCodes || [],
    jobsCount: toArray(dataset.jobs).length,
    jobsWithDescriptionCount: toArray(dataset.jobs).filter(job => job.description).length,
    jobsWithAppellationsCount: toArray(dataset.jobs).filter(job => toArray(job.appellations).length).length,
    jobsWithContextsCount: toArray(dataset.jobs).filter(job => toArray(job.workContexts).length).length,
    jobsWithAccessConditionsCount: toArray(dataset.jobs).filter(job => job.accessConditions?.text).length,
    jobsWithSkillsCount: toArray(dataset.jobs).filter(job => toArray(job.requiredSkills).length || toArray(job.optionalSkills).length || toArray(job.softSkills).length).length,
    jobsWithKnowledgeCount: toArray(dataset.jobs).filter(job => toArray(job.knowledge).length).length,
    jobsWithPrimarySectorCount: toArray(dataset.jobs).filter(job => job.primarySectorId).length,
    partialApiExceptions: toArray(dataset.jobs).filter(job => toArray(job.dataQuality?.warnings).includes("official_detail_unavailable")).map(job => job.romeCode),
    emptyShellJobs: toArray(dataset.jobs).filter(job => !job.description && !toArray(job.requiredSkills).length).map(job => ({ romeCode: job.romeCode, title: job.title })),
    qualityReport: {
      status: report.status,
      completionRate: report.completionRate,
      completeness: report.completeness,
      coverage: report.coverage,
      warnings: toArray(report.warnings).slice(0, 20)
    }
  };
}

async function safeResponseText(response) {
  try {
    return shortMessage(await response.text());
  } catch (error) {
    return "Erreur HTTP sans corps lisible.";
  }
}

function shortMessage(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/access_token[^,\s]*/gi, "access_token_REDACTED")
    .replace(/client_secret[^,\s]*/gi, "client_secret_REDACTED")
    .replace(/client_id[^,\s]*/gi, "client_id_REDACTED")
    .replace(/authorization[^,\s]*/gi, "authorization_REDACTED")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer REDACTED")
    .slice(0, 220);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function writeGeneratedJson(name, data, options = {}) {
  const pretty = options.pretty !== false;
  if (String(name).includes("/")) {
    const parent = String(name).split("/").slice(0, -1).join("/");
    if (parent) await mkdir(new URL(`${parent}/`, OUT_DIR), { recursive: true });
  }
  await writeFile(new URL(name, OUT_DIR), `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`, "utf8");
}

main();
