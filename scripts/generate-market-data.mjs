import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join("creations", "boussolepro", "data", "generated", "market");
const DEFAULT_TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const DEFAULT_TERRITORIES = "FR,REG-76,DEP-11";
const now = new Date().toISOString();

const env = process.env;
const dryRun = parseBoolean(env.DRY_RUN ?? env.MARKET_DRY_RUN ?? "true");
const requestedSources = parseList(env.SOURCE || env.MARKET_SOURCE || "api_marche_travail,bmo");
const requestedTerritories = parseList(env.MARKET_TERRITORIES || env.TERRITORY || DEFAULT_TERRITORIES)
  .map(normalizeTerritory)
  .filter(Boolean);

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const diagnostics = [];
  const rowsByLevel = {
    national: [],
    regional: [],
    departmental: []
  };
  let bmoRows = [];
  let fapRomeMappings = [];

  try {
    if (dryRun) {
      diagnostics.push({
        source: "api_marche_travail",
        status: "dry_run",
        reason: "DRY_RUN=true : aucune API marché n’est appelée."
      });
    } else if (requestedSources.includes("api_marche_travail")) {
      const apiResult = await fetchMarketApiData();
      diagnostics.push(...apiResult.diagnostics);
      rowsByLevel.national.push(...apiResult.rowsByLevel.national);
      rowsByLevel.regional.push(...apiResult.rowsByLevel.regional);
      rowsByLevel.departmental.push(...apiResult.rowsByLevel.departmental);
    }

    if (dryRun && requestedSources.includes("bmo")) {
      diagnostics.push({
        source: "bmo",
        status: "dry_run",
        reason: "DRY_RUN=true : la source BMO n’est pas appelée."
      });
    } else if (requestedSources.includes("bmo")) {
      const bmoResult = await fetchBmoData();
      diagnostics.push(...bmoResult.diagnostics);
      bmoRows = bmoResult.rows;
    }

    if (dryRun && env.FAP_ROME_MAPPING_URL) {
      diagnostics.push({
        source: "fap_rome_mapping",
        status: "dry_run",
        reason: "DRY_RUN=true : la source FAP/ROME n’est pas appelée."
      });
    } else if (env.FAP_ROME_MAPPING_URL) {
      const mappingResult = await fetchFapRomeMappings();
      diagnostics.push(...mappingResult.diagnostics);
      fapRomeMappings = mappingResult.rows;
    }

    const coverage = buildCoverage(rowsByLevel, bmoRows);
    const totalMarketRows = rowsByLevel.national.length + rowsByLevel.regional.length + rowsByLevel.departmental.length;
    const status = dryRun
      ? "not_connected_dry_run"
      : totalMarketRows > 0
        ? "completed_with_market_data"
        : "failed_no_market_data";

    await writeOutputs({ rowsByLevel, bmoRows, fapRomeMappings, diagnostics, coverage, status });

    if (!dryRun && totalMarketRows === 0) {
      await writeJson("sync-error.json", {
        schemaVersion: "1.0.0",
        generatedAt: now,
        status: "error",
        message: "Aucune ligne marché exploitable par code ROME n’a été récupérée.",
        hint: "Vérifier FT_MARKET_SCOPE, FT_MARKET_API_URL, MARKET_TERRITORIES, le format de réponse API et les droits France Travail.",
        diagnostics
      });
      throw new Error("Génération marché bloquée : 0 donnée exploitable par code ROME.");
    }

    console.log(`Market data written to ${OUTPUT_DIR}`);
    console.log(`Market rows: national=${rowsByLevel.national.length}, regional=${rowsByLevel.regional.length}, departmental=${rowsByLevel.departmental.length}`);
  } catch (error) {
    if (!dryRun) {
      const existingDiagnostics = diagnostics.length ? diagnostics : [{
        source: "generator",
        status: "error",
        message: shortMessage(error.message)
      }];
      await writeOutputs({
        rowsByLevel,
        bmoRows,
        fapRomeMappings,
        diagnostics: existingDiagnostics,
        coverage: buildCoverage(rowsByLevel, bmoRows),
        status: "failed"
      });
      await writeJson("sync-error.json", {
        schemaVersion: "1.0.0",
        generatedAt: now,
        status: "error",
        message: shortMessage(error.message),
        diagnostics: existingDiagnostics
      });
    }
    throw error;
  }
}

async function fetchMarketApiData() {
  const diagnostics = [];
  const rowsByLevel = { national: [], regional: [], departmental: [] };
  const endpoint = env.FT_MARKET_API_URL;
  const scope = env.FT_MARKET_SCOPE;
  if (!endpoint) {
    diagnostics.push({ source: "api_marche_travail", status: "not_configured", reason: "FT_MARKET_API_URL absent." });
    return { diagnostics, rowsByLevel };
  }
  if (!scope) {
    diagnostics.push({ source: "api_marche_travail", status: "not_configured", reason: "FT_MARKET_SCOPE absent." });
    return { diagnostics, rowsByLevel };
  }
  const token = await getFranceTravailAccessToken(scope, env.FT_MARKET_TOKEN_URL || env.FT_TOKEN_URL || DEFAULT_TOKEN_URL);
  for (const territory of requestedTerritories) {
    const url = buildMarketUrl(endpoint, territory);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token.access_token || token.token || token}`,
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        diagnostics.push({
          source: "api_marche_travail",
          territory: territory.id,
          status: "http_error",
          httpStatus: response.status,
          message: shortMessage(await safeResponseText(response)),
          endpoint: withoutSensitiveQuery(url)
        });
        continue;
      }
      const json = await response.json();
      const rawRows = extractRows(json);
      const normalizedRows = normalizeMarketRows(rawRows, territory);
      rowsByLevel[territory.outputKey].push(...normalizedRows);
      diagnostics.push({
        source: "api_marche_travail",
        territory: territory.id,
        status: normalizedRows.length ? "ok" : "no_exploitable_rome_rows",
        rawRowsCount: rawRows.length,
        normalizedRowsCount: normalizedRows.length,
        endpoint: withoutSensitiveQuery(url),
        sampleKeys: rawRows[0] && typeof rawRows[0] === "object" ? Object.keys(rawRows[0]).slice(0, 30) : []
      });
    } catch (error) {
      diagnostics.push({
        source: "api_marche_travail",
        territory: territory.id,
        status: "fetch_error",
        message: shortMessage(error.message),
        endpoint: withoutSensitiveQuery(url)
      });
    }
  }
  dedupeRowsByRome(rowsByLevel.national);
  dedupeRowsByRome(rowsByLevel.regional);
  dedupeRowsByRome(rowsByLevel.departmental);
  return { diagnostics, rowsByLevel };
}

async function fetchBmoData() {
  const url = env.BMO_DATA_URL;
  if (!url) {
    return {
      rows: [],
      diagnostics: [{ source: "bmo", status: "not_configured", reason: "BMO_DATA_URL absent." }]
    };
  }
  if (/\.xlsx($|\?)/i.test(url)) {
    return {
      rows: [],
      diagnostics: [{
        source: "bmo",
        status: "not_parsed_xlsx_no_dependency",
        reason: "La source BMO fournie est un fichier XLSX. Le projet ne doit pas ajouter de dépendance externe ; fournir un CSV/JSON exploitable ou ajouter un parseur dédié validé."
      }]
    };
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { rows: [], diagnostics: [{ source: "bmo", status: "http_error", httpStatus: response.status, message: shortMessage(await safeResponseText(response)) }] };
    }
    const text = await response.text();
    const rows = parseDelimitedRows(text).map(normalizeBmoRow).filter(Boolean);
    return { rows, diagnostics: [{ source: "bmo", status: rows.length ? "ok" : "no_exploitable_rows", rowsCount: rows.length }] };
  } catch (error) {
    return { rows: [], diagnostics: [{ source: "bmo", status: "fetch_error", message: shortMessage(error.message) }] };
  }
}

async function fetchFapRomeMappings() {
  const url = env.FAP_ROME_MAPPING_URL;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { rows: [], diagnostics: [{ source: "fap_rome_mapping", status: "http_error", httpStatus: response.status, message: shortMessage(await safeResponseText(response)) }] };
    }
    const text = await response.text();
    const parsedRows = parseDelimitedRows(text);
    const rows = parsedRows.map(normalizeFapRomeMapping).filter(Boolean);
    return {
      rows,
      diagnostics: [{
        source: "fap_rome_mapping",
        status: rows.length ? "ok" : "no_direct_rome_mapping_found",
        rawRowsCount: parsedRows.length,
        rowsCount: rows.length,
        note: rows.length ? "Mappings FAP/ROME détectés." : "La source semble décrire la nomenclature FAP2021, mais aucun code ROME direct n’a été détecté."
      }]
    };
  } catch (error) {
    return { rows: [], diagnostics: [{ source: "fap_rome_mapping", status: "fetch_error", message: shortMessage(error.message) }] };
  }
}

async function getFranceTravailAccessToken(scope, tokenUrl) {
  const clientId = env.FT_CLIENT_ID;
  const clientSecret = env.FT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("FT_CLIENT_ID et FT_CLIENT_SECRET sont requis pour MARKET_DRY_RUN=false.");
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
    throw new Error(`Échec token marché France Travail: ${response.status} ${shortMessage(await response.text())}`);
  }
  return response.json();
}

function buildMarketUrl(endpoint, territory) {
  const url = new URL(endpoint);
  url.searchParams.set("codeTypeTerritoire", territory.codeTypeTerritoire);
  url.searchParams.set("codeTerritoire", territory.codeTerritoire);
  for (const [key, value] of new URLSearchParams(env.MARKET_EXTRA_QUERY || "")) {
    if (key && value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function normalizeMarketRows(rows, territory) {
  return rows.map(row => normalizeMarketRow(row, territory)).filter(Boolean);
}

function normalizeMarketRow(row, territory) {
  if (!row || typeof row !== "object") return null;
  const romeCode = extractRomeCode(row);
  if (!romeCode) return null;
  const offers12m = firstNumber(row, [
    "offers12m", "offres12m", "offres_12m", "nombreOffres12Mois", "nombreOffres",
    "nbOffres", "nb_offres", "offres", "valeur", "value", "count"
  ]);
  const demanders = firstNumber(row, ["demanders", "demandeurs", "nbDemandeurs", "nombreDemandeurs"]);
  const hires12m = firstNumber(row, ["hires12m", "embauches12m", "embauches", "nbEmbauches"]);
  const signal = signalFromVolume(offers12m);
  return {
    romeCode,
    title: firstString(row, ["libelleRome", "libelle_rome", "labelRome", "metier", "libelleMetier", "label"]) || null,
    sourceLevel: territory.sourceLevel,
    sourceName: "api_marche_travail",
    sourceUpdatedAt: now,
    territoryId: territory.id,
    territoryLabel: territory.label,
    codeTypeTerritoire: territory.codeTypeTerritoire,
    codeTerritoire: territory.codeTerritoire,
    demanders,
    newDemanders12m: firstNumber(row, ["newDemanders12m", "nouveauxDemandeurs12m", "nouveauxDemandeurs"]),
    offers12m,
    hires12m,
    tensionLevel: firstSignal(row, ["tensionLevel", "niveauTension", "tension"]) || signal,
    recruitmentSignal: firstSignal(row, ["recruitmentSignal", "niveauRecrutement"]) || signal,
    recruitmentDifficulty: firstSignal(row, ["recruitmentDifficulty", "difficulteRecrutement"]) || "unknown",
    salarySignal: firstSignal(row, ["salarySignal", "niveauSalaire"]) || "unknown",
    confidence: territory.sourceLevel === "departmental" ? 0.82 : territory.sourceLevel === "regional" ? 0.72 : 0.55,
    rawFieldHints: Object.keys(row).slice(0, 24)
  };
}

function normalizeBmoRow(row) {
  const fapCode = firstString(row, ["fapCode", "codeFap", "FAP", "Code FAP", "code_fap"]);
  if (!fapCode) return null;
  return {
    year: firstNumber(row, ["year", "annee", "Année"]) || 2026,
    fapCode,
    fapLabel: firstString(row, ["fapLabel", "libelleFap", "Libellé FAP", "metier"]) || null,
    recruitmentProjects: firstNumber(row, ["recruitmentProjects", "projetsRecrutement", "Projets de recrutement"]),
    difficultRecruitmentRate: firstNumber(row, ["difficultRecruitmentRate", "partDifficiles", "Difficultés à recruter"]),
    seasonalRate: firstNumber(row, ["seasonalRate", "partSaisonniers", "Emplois saisonniers"]),
    territoryLevel: "unknown",
    mappingConfidence: 0,
    confidence: 0.45
  };
}

function normalizeFapRomeMapping(row) {
  const fapCode = firstString(row, ["fapCode", "codeFap", "FAP", "Code FAP", "code_fap"]);
  const romeCode = extractRomeCode(row);
  if (!fapCode || !romeCode) return null;
  return {
    fapCode,
    fapLabel: firstString(row, ["fapLabel", "libelleFap", "Libellé FAP", "metier"]) || null,
    romeCode,
    mappingConfidence: firstNumber(row, ["mappingConfidence", "confiance"]) || 0.55,
    source: "fap_rome_mapping_url"
  };
}

async function writeOutputs({ rowsByLevel, bmoRows, fapRomeMappings, diagnostics, coverage, status }) {
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: now,
    generator: "scripts/generate-market-data.mjs",
    status,
    requestedSources,
    requestedTerritories: requestedTerritories.map(territory => territory.id),
    sourceStatus: diagnostics,
    coverage,
    warnings: buildWarnings(status, diagnostics)
  };
  const manifest = {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - couche marché v0.6",
    datasetVersion: `market-v0.6-${now.slice(0, 10)}`,
    generatedAt: now,
    status,
    outputPath: "creations/boussolepro/data/generated/market/",
    files: [
      "territories.json",
      "market-national.rome.json",
      "market-occitanie.rome.json",
      "market-aude.rome.json",
      "bmo-fap2021.json",
      "fap-rome-mappings.json",
      "market-quality-report.json",
      "market-import-manifest.json"
    ],
    sourcePolicy: {
      noActiveOffers: true,
      noBrowserToken: true,
      noSecretsWritten: true,
      officialStatsConnected: status === "completed_with_market_data",
      fapRomeMappingsRequireConfidence: true
    }
  };
  await writeJson("territories.json", territoryRows());
  await writeJson("market-national.rome.json", rowsByLevel.national);
  await writeJson("market-occitanie.rome.json", rowsByLevel.regional);
  await writeJson("market-aude.rome.json", rowsByLevel.departmental);
  await writeJson("bmo-fap2021.json", bmoRows);
  await writeJson("fap-rome-mappings.json", fapRomeMappings);
  await writeJson("market-quality-report.json", report);
  await writeJson("market-import-manifest.json", manifest);
}

function buildCoverage(rowsByLevel, bmoRows) {
  return {
    jobsWithNationalMarket: unique(rowsByLevel.national.map(row => row.romeCode)).length,
    jobsWithRegionalMarket: unique(rowsByLevel.regional.map(row => row.romeCode)).length,
    jobsWithDepartmentalMarket: unique(rowsByLevel.departmental.map(row => row.romeCode)).length,
    jobsWithBmo: unique(bmoRows.map(row => row.fapCode)).length,
    jobsWithoutMarket: null
  };
}

function buildWarnings(status, diagnostics) {
  const warnings = [];
  if (status === "not_connected_dry_run") warnings.push("Aucune statistique officielle marché n’est générée par ce dry-run.");
  if (status === "failed_no_market_data" || status === "failed") warnings.push("Aucune ligne marché exploitable par code ROME n’a été récupérée.");
  if (diagnostics.some(item => item.status === "not_parsed_xlsx_no_dependency")) warnings.push("La source BMO XLSX n’est pas parsée sans dépendance externe.");
  if (diagnostics.some(item => item.status === "no_direct_rome_mapping_found")) warnings.push("La source FAP fournie ne contient pas de correspondance ROME directe détectée.");
  return warnings;
}

function territoryRows() {
  return [
    { id: "FR", type: "country", code: "FR", label: "France entière", codeTypeTerritoire: "NAT", codeTerritoire: "FR", sourceLevel: "national", outputKey: "national" },
    { id: "REG-76", type: "region", code: "76", label: "Occitanie", codeTypeTerritoire: "REG", codeTerritoire: "76", country: "FR", sourceLevel: "regional", outputKey: "regional" },
    { id: "DEP-11", type: "department", code: "11", label: "Aude", codeTypeTerritoire: "DEP", codeTerritoire: "11", country: "FR", regionCode: "76", regionName: "Occitanie", sourceLevel: "departmental", outputKey: "departmental" }
  ];
}

function normalizeTerritory(input) {
  const value = String(input || "").trim().toUpperCase();
  if (!value || ["FRANCE", "NAT", "NAT-FR", "FR"].includes(value)) return territoryRows()[0];
  if (["OCCITANIE", "REG76", "REG-76", "76"].includes(value)) return territoryRows()[1];
  if (["AUDE", "DEP11", "DEP-11", "11"].includes(value)) return territoryRows()[2];
  const match = value.match(/^(NAT|REG|DEP)[-_]?(.+)$/);
  if (!match) return null;
  const [, type, code] = match;
  const sourceLevel = type === "NAT" ? "national" : type === "REG" ? "regional" : "departmental";
  return {
    id: type === "NAT" ? "FR" : `${type}-${code}`,
    type: type === "NAT" ? "country" : type === "REG" ? "region" : "department",
    code,
    label: `${type}-${code}`,
    codeTypeTerritoire: type,
    codeTerritoire: code,
    sourceLevel,
    outputKey: sourceLevel
  };
}

function extractRows(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json.filter(isObject);
  for (const key of ["resultats", "results", "items", "data", "liste", "indicateurs", "valeurs"]) {
    if (Array.isArray(json[key])) return json[key].filter(isObject);
  }
  const arrays = [];
  walk(json, value => {
    if (Array.isArray(value) && value.some(isObject)) arrays.push(value.filter(isObject));
  });
  if (arrays.length) return arrays.sort((a, b) => b.length - a.length)[0];
  return isObject(json) ? [json] : [];
}

function extractRomeCode(row) {
  const values = [];
  walk(row, value => {
    if (typeof value === "string") values.push(value);
  });
  for (const value of values) {
    const match = value.toUpperCase().match(/\b[A-Z][0-9]{4}\b/);
    if (match) return match[0];
  }
  return "";
}

function firstNumber(row, keys) {
  for (const key of keys) {
    const value = getLoose(row, key);
    const numeric = numberOrNull(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function firstString(row, keys) {
  for (const key of keys) {
    const value = getLoose(row, key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstSignal(row, keys) {
  const value = firstString(row, keys);
  if (!value) return "";
  const normalized = normalizeText(value);
  if (["fort", "forte", "high", "eleve", "élevé", "tres eleve", "très élevé"].some(item => normalized.includes(normalizeText(item)))) return "high";
  if (["moyen", "moyenne", "medium", "modere", "modéré"].some(item => normalized.includes(normalizeText(item)))) return "medium";
  if (["faible", "low"].some(item => normalized.includes(normalizeText(item)))) return "low";
  return "unknown";
}

function signalFromVolume(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 1000) return "high";
  if (value >= 150) return "medium";
  return "low";
}

function getLoose(row, wantedKey) {
  const wanted = normalizeText(wantedKey);
  let found;
  walk(row, (value, key) => {
    if (found !== undefined || !key) return;
    if (normalizeText(key) === wanted) found = value;
  });
  return found;
}

function dedupeRowsByRome(rows) {
  const byCode = new Map();
  for (const row of rows) byCode.set(row.romeCode, row);
  rows.splice(0, rows.length, ...byCode.values());
}

function parseDelimitedRows(text) {
  const delimiter = text.includes(";") ? ";" : ",";
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitDelimitedLine(lines[0], delimiter);
  return lines.slice(1).map(line => {
    const cells = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

function walk(value, visitor, key = "") {
  visitor(value, key);
  if (Array.isArray(value)) value.forEach(item => walk(item, visitor, key));
  else if (isObject(value)) Object.entries(value).forEach(([childKey, child]) => walk(child, visitor, childKey));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function parseBoolean(value) {
  return ["1", "true", "yes", "oui"].includes(String(value || "").toLowerCase());
}

function parseList(value) {
  return String(value || "").split(/[,\n;]/).map(item => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function withoutSensitiveQuery(url) {
  const parsed = new URL(url);
  return parsed.toString();
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function shortMessage(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 400);
}

async function writeJson(filename, value) {
  await writeFile(path.join(OUTPUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
