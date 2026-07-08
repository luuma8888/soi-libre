import { mkdir, writeFile } from "node:fs/promises";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";
import { mergeRomeDatasets } from "./normalize-rome-api.mjs";

const OUT_DIR = new URL("../creations/boussolepro/data/generated/", import.meta.url);
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
const DEFAULT_RATE_LIMIT_MS = 1100;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const requestedCodes = parseList(process.env.ROME_CODES, DEFAULT_ROME_CODES);
  const generatedAt = new Date().toISOString();
  try {
    const token = await getFranceTravailAccessToken();
    const syncResult = await fetchRomeFichesMetiers(token, requestedCodes);
    if (syncResult.fichesMetiers.length === 0) {
      const noDataError = new Error("Synchronisation ROME bloquee : 0 fiche exploitable.");
      noDataError.failedCodes = syncResult.failedCodes;
      throw noDataError;
    }
    const parts = {
      fichesMetiers: syncResult.fichesMetiers
    };
    const dataset = mergeRomeDatasets(parts);
    const syncMeta = {
      generatedAt,
      branch: process.env.GITHUB_REF_NAME || "local",
      requestedCodes,
      successfulCodes: syncResult.successfulCodes,
      failedCodes: syncResult.failedCodes,
      failures: syncResult.failedCodes
    };
    const report = buildDataQualityReport(dataset, syncMeta);
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
      generatedFiles: [
        "jobs.rome.json",
        "import-manifest.rome.json",
        "data-quality-report.rome.json",
        "skills.rome.json",
        "work-contexts.rome.json",
        "job-appellations.rome.json",
        "mappings.rome.json"
      ],
      licenseSummary: "A verifier selon les droits d'usage France Travail IO.",
      warnings: [
        dataset.jobs.length < 50 ? "official_partial_corpus_under_50_jobs" : "",
        syncResult.failedCodes.length ? "some_rome_codes_failed" : "",
        "mapping_to_verify",
        "license_to_verify"
      ].filter(Boolean)
    });
    await writeGeneratedJson("skills.rome.json", dataset.skills || []);
    await writeGeneratedJson("work-contexts.rome.json", dataset.workContexts || []);
    await writeGeneratedJson("job-appellations.rome.json", dataset.jobAppellations || []);
    await writeGeneratedJson("mappings.rome.json", dataset.mappings || []);
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

export async function getFranceTravailAccessToken() {
  const clientId = process.env.FT_CLIENT_ID;
  const clientSecret = process.env.FT_CLIENT_SECRET;
  const tokenUrl = process.env.FT_TOKEN_URL || DEFAULT_TOKEN_URL;
  if (!clientId || !clientSecret) throw new Error("FT_CLIENT_ID et FT_CLIENT_SECRET sont requis.");
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("scope", getScope());
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Echec token France Travail: ${response.status} ${body}`);
  }
  return response.json();
}

export async function fetchRomeFichesMetiers(token, codes = DEFAULT_ROME_CODES) {
  const endpointUrl = process.env.FT_ROME_FICHES_METIERS_URL || DEFAULT_FICHES_ENDPOINT;
  const accessToken = token.access_token || token.token || token;
  const fichesMetiers = [];
  const successfulCodes = [];
  const failedCodes = [];
  for (const code of codes) {
    const result = await fetchRomeFicheMetier(endpointUrl, accessToken, code);
    if (result.ok) {
      const raw = result.payload;
      fichesMetiers.push({ ...raw, code: raw.code || raw.codeRome || raw.romeCode || code, romeCode: raw.romeCode || raw.codeRome || raw.code || code });
      successfulCodes.push(code);
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
  return { fichesMetiers, successfulCodes, failedCodes };
}

async function fetchRomeFicheMetier(endpointUrl, accessToken, code) {
  const attempts = buildFicheUrlAttempts(endpointUrl, code);
  const errors = [];
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
      if (payload) return { ok: true, payload, endpoint: url };
      errors.push({ status: "invalid_structure", message: "Reponse JSON sans fiche exploitable", endpoint: url });
    } catch (error) {
      errors.push({ status: "network_or_parse_error", message: error.message, endpoint: url });
    }
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
  for (const paramName of parseList(process.env.FT_ROME_FICHE_CODE_PARAMS, ["codeRome", "code", "romeCode"])) {
    const url = new URL(endpointUrl);
    url.searchParams.set(paramName, code);
    attempts.push(url.toString());
  }
  const pathUrl = new URL(endpointUrl);
  pathUrl.pathname = `${pathUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(code)}`;
  attempts.push(pathUrl.toString());
  return [...new Set(attempts)];
}

function extractFichePayload(json, code) {
  if (!json) return null;
  if (Array.isArray(json)) return findPayloadByCode(json, code) || json[0] || null;
  for (const key of ["ficheMetier", "fiche", "resultat", "metier", "data"]) {
    if (json[key] && !Array.isArray(json[key])) return json[key];
    if (Array.isArray(json[key])) return findPayloadByCode(json[key], code) || json[key][0] || null;
  }
  for (const key of ["resultats", "results", "items", "liste"]) {
    if (Array.isArray(json[key])) return findPayloadByCode(json[key], code) || json[key][0] || null;
  }
  return json;
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
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer REDACTED")
    .slice(0, 220);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function writeGeneratedJson(name, data) {
  await writeFile(new URL(name, OUT_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

main();
