import { mkdir, writeFile } from "node:fs/promises";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";
import { mergeRomeDatasets } from "./normalize-rome-api.mjs";

const OUT_DIR = new URL("../data/generated/", import.meta.url);
const DEFAULT_SCOPE = "nomenclatureRome api_rome-fiches-metiersv1";
const DEFAULT_TEST_CODES = ["M1607", "M1805", "K1303", "A1203"];
const DEFAULT_RATE_LIMIT_MS = 1100;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const testCodes = parseList(process.env.FT_ROME_TEST_CODES, DEFAULT_TEST_CODES);
  try {
    const token = await getFranceTravailAccessToken();
    const parts = {
      fichesMetiers: await fetchRomeFichesMetiers(token, testCodes)
    };
    const dataset = mergeRomeDatasets(parts);
    const report = buildDataQualityReport(dataset);
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
      requestedRomeCodes: testCodes,
      generatedFiles: [
        "jobs.rome.json",
        "import-manifest.rome.json",
        "data-quality-report.rome.json"
      ],
      licenseSummary: "A verifier selon les droits d'usage France Travail IO.",
      warnings: ["fiches_test_only", "mapping_to_verify", "license_to_verify"]
    });
    await writeGeneratedJson("skills.rome.json", []);
    await writeGeneratedJson("work-contexts.rome.json", []);
    await writeGeneratedJson("job-appellations.rome.json", []);
    await writeGeneratedJson("mappings.rome.json", []);
  } catch (error) {
    await writeGeneratedJson("sync-error.json", {
      generatedAt: new Date().toISOString(),
      status: "error",
      message: error.message,
      requestedScope: getScope(),
      requestedRomeCodes: testCodes,
      hint: "Verifier les secrets GitHub, FT_TOKEN_URL, FT_SCOPE et FT_ROME_FICHES_METIERS_URL."
    });
    throw error;
  }
}

export async function getFranceTravailAccessToken() {
  const clientId = process.env.FT_CLIENT_ID;
  const clientSecret = process.env.FT_CLIENT_SECRET;
  const tokenUrl = process.env.FT_TOKEN_URL;
  if (!clientId || !clientSecret) throw new Error("FT_CLIENT_ID et FT_CLIENT_SECRET sont requis.");
  if (!tokenUrl) throw new Error("FT_TOKEN_URL est requis. Verifier l'URL exacte dans France Travail IO.");
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

export async function fetchRomeFichesMetiers(token, codes = DEFAULT_TEST_CODES) {
  const endpointUrl = process.env.FT_ROME_FICHES_METIERS_URL;
  if (!endpointUrl) throw new Error("FT_ROME_FICHES_METIERS_URL est requis pour recuperer les fiches ROME.");
  const accessToken = token.access_token || token.token || token;
  const fetched = [];
  for (const code of codes) {
    const raw = await fetchRomeFicheMetier(endpointUrl, accessToken, code);
    fetched.push({ ...raw, code: raw.code || raw.codeRome || raw.romeCode || code, romeCode: raw.romeCode || raw.codeRome || raw.code || code });
    await sleep(Number(process.env.FT_RATE_LIMIT_MS || DEFAULT_RATE_LIMIT_MS));
  }
  return fetched;
}

async function fetchRomeFicheMetier(endpointUrl, accessToken, code) {
  const attempts = buildFicheUrlAttempts(endpointUrl, code);
  const errors = [];
  for (const url of attempts) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      errors.push(`${response.status} ${await response.text()}`);
      continue;
    }
    const json = await response.json();
    const payload = extractFichePayload(json, code);
    if (payload) return payload;
    errors.push("reponse JSON sans fiche exploitable");
  }
  throw new Error(`Aucune fiche ROME exploitable pour ${code}. Essais: ${errors.join(" | ")}`);
}

function buildFicheUrlAttempts(endpointUrl, code) {
  if (endpointUrl.includes("{code}") || endpointUrl.includes("{romeCode}") || endpointUrl.includes("{codeRome}")) {
    return [
      endpointUrl
        .replaceAll("{code}", encodeURIComponent(code))
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
  const parsed = String(value).split(/[,\n ]+/).map(item => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function writeGeneratedJson(name, data) {
  await writeFile(new URL(name, OUT_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

main();
