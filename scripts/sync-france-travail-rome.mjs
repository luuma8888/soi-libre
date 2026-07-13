import { mkdir, writeFile } from "node:fs/promises";
import { buildRome500AuditArtifacts } from "./audit-rome-500-generated.mjs";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";
import { mergeRomeDatasets } from "./normalize-rome-api.mjs";

const OUT_DIR = new URL("../creations/boussolepro/data/generated/", import.meta.url);
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const requestedCodes = parseList(process.env.ROME_CODES, DEFAULT_ROME_CODES);
  const generatedAt = new Date().toISOString();
  try {
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
    const optionalReferentials = await fetchOptionalRomeReferentials(token);
    const syncMeta = {
      generatedAt,
      branch: process.env.GITHUB_REF_NAME || "local",
      requestedCodes,
      successfulCodes: syncResult.successfulCodes,
      failedCodes: syncResult.failedCodes,
      failures: syncResult.failedCodes,
      optionalReferentials: optionalReferentials.diagnostics
    };
    if (optionalReferentials.referentials?.metiers?.length) {
      await writeRomeMetiersRecordSamples(optionalReferentials.referentials.metiers, syncMeta);
    }
    const parts = {
      fichesMetiers: syncResult.fichesMetiers,
      ...optionalReferentials.parts
    };
    const dataset = mergeRomeDatasets(parts);
    const report = buildDataQualityReport(dataset, syncMeta);
    logSyncSummary(dataset, report, syncMeta);
    if (isRawDebugEnabled()) await writeRawStructureReport(syncResult.rawSamples, syncMeta);
    await writeGeneratedJson("jobs.rome.json", dataset.jobs);
    await writeGeneratedJson("data-quality-report.rome.json", report);
    await writeGeneratedJson("import-manifest.rome.json", {
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
      optionalReferentials: optionalReferentials.diagnostics,
      generatedFiles: [
        "jobs.rome.json",
        "import-manifest.rome.json",
        "data-quality-report.rome.json",
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
    await writeGeneratedJson("job-appellations.rome.json", dataset.jobAppellations || []);
    await writeGeneratedJson("mappings.rome.json", dataset.mappings || []);
    await writeGeneratedJson("formations.onisep.json", []);
    await writeGeneratedJson("certifications.certifinfo.json", []);
    await writeGeneratedJson("mappings-rome-formations.json", []);
    await writeGeneratedJson("mappings-rome-certifications.json", []);
    const audit = await buildRome500AuditArtifacts();
    console.log(`[Boussole Pro] Audit corpus ROME: score matching ${Math.round((audit.quality?.matchingReadiness?.score || 0) * 100)}%, coquilles ${audit.quality?.shellJobs?.count || 0}/${audit.quality?.jobsTotal || 0}`);
  } catch (error) {
    await writeGeneratedJson("sync-error.json", {
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
    contextesTravail: findCandidatePaths(payload, ["contextetravail", "conditionexercice", "environnementtravail"]),
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
  const score = nonEmptyGroups + (hasKnownRichRoot ? 2 : 0) + Math.max(0, rootKeys.length - 2) * 0.25;
  return {
    rootKeys,
    score: Number(score.toFixed(2)),
    isDetailed: score >= 2,
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
  if (best.richness?.isDetailed) return `Utiliser la variante ${best.endpoint}, qui expose des champs enrichis.`;
  return "Toutes les variantes repondent avec un payload trop pauvre. Chercher une autre route de l'API Fiches metiers ou une API Metiers/Competences de liaison.";
}

async function fetchOptionalRomeReferentials(mainToken) {
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
      if (config.name === "metiers") referentials.metiers = rows;
      if (config.partKey) parts[config.partKey] = rows;
      diagnostics.push({ name: config.name, status: "ok", count: rows.length, usedForDataset: Boolean(config.partKey), endpoint, scope: scope ? "configured" : "default" });
    } catch (error) {
      diagnostics.push({ name: config.name, status: "error", message: shortMessage(error.message), endpoint });
    }
    await sleep(Number(process.env.FT_RATE_LIMIT_MS || DEFAULT_RATE_LIMIT_MS));
  }
  return { parts, diagnostics, referentials };
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

async function writeRomeMetiersRecordSamples(records = [], syncMeta = {}) {
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
  const conclusion = buildMetiersDiagnosticConclusion(fieldAvailability);
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: syncMeta.generatedAt || new Date().toISOString(),
    branch: syncMeta.branch || process.env.GITHUB_REF_NAME || "local",
    source: "rome_metiers_api",
    totalRecords: records.length,
    diagnosticCodes: codes,
    note: "Diagnostic structurel uniquement. Le référentiel ROME Métiers n'est pas utilisé pour enrichir jobs.rome.json tant qu'il ne contient que code/libelle ou tant que les chemins riches ne sont pas validés.",
    fieldAvailability,
    conclusion,
    samples
  };
  await writeFile(new URL("rome-metiers-record-samples.json", DEBUG_DIR), `${JSON.stringify(report, null, 2)}\n`, "utf8");
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
    contextRefs: findCandidatePaths(record, ["contextetravail", "contexte-travail", "conditionexercice", "environnementtravail", "situationtravail"]),
    accessConditions: findCandidatePaths(record, ["conditionacces", "accesemploimetier", "accesmetier", "prerequis", "pre-requis"]),
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
    contextesTravail: ["contextetravail", "contexte-travail", "conditionexercice", "environnementtravail"],
    conditionsAcces: ["conditionacces", "accesemploimetier", "accesmetier"],
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
  await writeFile(new URL(name, OUT_DIR), `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`, "utf8");
}

main();
