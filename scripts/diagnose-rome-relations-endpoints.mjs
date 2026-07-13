import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = new URL("../creations/boussolepro/data/generated/debug/", import.meta.url);
const DEFAULT_TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const DEFAULT_SCOPE = "nomenclatureRome api_rome-fiches-metiersv1";
const DEFAULT_CODES = ["A1203", "K1303", "M1607", "M1805"];

const ENDPOINTS = [
  {
    alias: "rome_fiches_metiers",
    url: process.env.FT_ROME_FICHES_METIERS_URL || "https://api.francetravail.io/partenaire/rome-fiches-metiers/v1/fiches-rome/fiche-metier/{CODE_ROME}"
  },
  {
    alias: "rome_metiers",
    url: process.env.FT_ROME_METIERS_URL || ""
  },
  {
    alias: "rome_contextes_travail",
    url: process.env.FT_ROME_CONTEXTES_URL || ""
  }
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const codes = parseList(process.env.ROME_RELATIONS_DIAGNOSTIC_CODES, DEFAULT_CODES);
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    branch: process.env.GITHUB_REF_NAME || "local",
    codes,
    endpoints: []
  };
  try {
    const token = await getAccessToken();
    for (const endpoint of ENDPOINTS) {
      if (!endpoint.url) {
        report.endpoints.push({ endpointAlias: endpoint.alias, status: "not_configured", diagnostics: [] });
        continue;
      }
      const diagnostics = [];
      for (const code of codes) {
        diagnostics.push(await inspectEndpoint(endpoint, code, token));
        await sleep(Number(process.env.FT_RATE_LIMIT_MS || 1100));
      }
      report.endpoints.push({ endpointAlias: endpoint.alias, status: "tested", diagnostics });
    }
  } catch (error) {
    report.status = "error";
    report.message = redact(error.message);
  }
  await writeFile(new URL("rome-relations-endpoint-diagnostic.json", OUT_DIR), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.status === "error") throw new Error(report.message);
}

async function inspectEndpoint(endpoint, romeCode, token) {
  const url = buildUrl(endpoint.url, romeCode);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
    const body = await safeJson(response);
    return {
      endpointAlias: endpoint.alias,
      romeCode,
      status: response.status,
      rootKeys: body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).slice(0, 80) : [],
      detectedRelations: detectRelations(body),
      endpointTemplate: endpoint.url
    };
  } catch (error) {
    return {
      endpointAlias: endpoint.alias,
      romeCode,
      status: "network_or_parse_error",
      message: redact(error.message),
      rootKeys: [],
      detectedRelations: emptyRelations(),
      endpointTemplate: endpoint.url
    };
  }
}

function detectRelations(body) {
  const relations = emptyRelations();
  inspectKeys(body, (path, value) => {
    const key = normalize(path);
    const sample = summarizeValue(path, value);
    if (key.includes("appellation")) relations.appellations.push(sample);
    if (key.includes("description") || key.includes("definition") || key.includes("resume")) relations.description.push(sample);
    if (key.includes("activite")) relations.activities.push(sample);
    if (key.includes("contextetravail") || key.includes("conditionexercice") || key.includes("environnementtravail")) relations.workContexts.push(sample);
    if (key.includes("conditionacces") || key.includes("acces")) relations.accessConditions.push(sample);
    if (key.includes("certification") || key.includes("habilitation")) relations.certifications.push(sample);
    if (key.includes("mobilite") || key.includes("metierproche") || key.includes("proche")) relations.relatedJobs.push(sample);
  });
  Object.keys(relations).forEach(key => {
    relations[key] = uniqueBy(relations[key], item => item.path).slice(0, 12);
  });
  return relations;
}

function emptyRelations() {
  return {
    appellations: [],
    description: [],
    activities: [],
    workContexts: [],
    accessConditions: [],
    certifications: [],
    relatedJobs: []
  };
}

function inspectKeys(value, visitor, path = "$", depth = 0) {
  if (value === undefined || value === null || depth > 7) return;
  visitor(path, value);
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.slice(0, 3).forEach((item, index) => inspectKeys(item, visitor, `${path}[${index}]`, depth + 1));
    return;
  }
  Object.entries(value).forEach(([key, child]) => inspectKeys(child, visitor, `${path}.${key}`, depth + 1));
}

function summarizeValue(path, value) {
  return {
    path,
    type: Array.isArray(value) ? "array" : typeof value,
    sampleKeys: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).slice(0, 12) : [],
    sample: typeof value === "string" || typeof value === "number" ? String(value).slice(0, 140) : null
  };
}

async function getAccessToken() {
  const clientId = process.env.FT_CLIENT_ID;
  const clientSecret = process.env.FT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("FT_CLIENT_ID et FT_CLIENT_SECRET sont requis pour le diagnostic.");
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("scope", process.env.FT_SCOPE || process.env.FT_ROME_SCOPE || DEFAULT_SCOPE);
  const response = await fetch(process.env.FT_TOKEN_URL || DEFAULT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) throw new Error(`Echec token: ${response.status} ${redact(await response.text())}`);
  const token = await response.json();
  return token.access_token;
}

function buildUrl(template, code) {
  if (template.includes("{CODE_ROME}") || template.includes("{code}") || template.includes("{romeCode}")) {
    return template
      .replaceAll("{CODE_ROME}", encodeURIComponent(code))
      .replaceAll("{code}", encodeURIComponent(code))
      .replaceAll("{romeCode}", encodeURIComponent(code));
  }
  const url = new URL(template);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(code)}`;
  return url.toString();
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: text.slice(0, 500) };
  }
}

function parseList(value, fallback) {
  const items = String(value || "").split(/[,\s]+/).map(item => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = typeof key === "function" ? key(item) : item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function redact(value) {
  return String(value || "")
    .replace(/access_token[^,\s]*/gi, "access_token_REDACTED")
    .replace(/client_secret[^,\s]*/gi, "client_secret_REDACTED")
    .replace(/client_id[^,\s]*/gi, "client_id_REDACTED")
    .replace(/authorization[^,\s]*/gi, "authorization_REDACTED")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer REDACTED")
    .slice(0, 260);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
