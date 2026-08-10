import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join("creations", "boussolepro", "data", "generated", "market");
const DEFAULT_MARKET_ROME_CODES_FILE = path.join("creations", "boussolepro", "data", "local", "rome-codes-500.json");
const DEFAULT_TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const DEFAULT_TERRITORIES = "FR,REG-76,DEP-11";
const now = new Date().toISOString();

const env = process.env;
const dryRun = parseBoolean(env.DRY_RUN ?? env.MARKET_DRY_RUN ?? "true");
const requestedSources = parseList(env.SOURCE || env.MARKET_SOURCE || "api_marche_travail,bmo");
const requestedTerritories = parseList(env.MARKET_TERRITORIES || env.TERRITORY || DEFAULT_TERRITORIES)
  .map(normalizeTerritory)
  .filter(Boolean);
const useGlobalTerritoryCall = parseBoolean(env.MARKET_USE_GLOBAL_TERRITORY_CALL || "false");
const marketDebugSampleEnabled = parseBoolean(env.MARKET_DEBUG_SAMPLE || "false");
const marketRequestDelayMs = Math.max(0, Number(env.MARKET_REQUEST_DELAY_MS || 250));
const marketActivityType = env.MARKET_ACTIVITY_TYPE || "ROME";
const marketPeriodType = env.MARKET_PERIOD_TYPE || "TRIMESTRE";
const marketNomenclatureType = env.MARKET_NOMENCLATURE_TYPE || "ORIGINEOFF";
const mergeExistingPackage = parseBoolean(env.MARKET_MERGE_EXISTING || "false");
const marketDebugRequests = [];
let marketTokenObtained = false;

async function resolveMarketRomeCodes() {
  const explicitCodes = normalizeRomeCodes(parseList(env.MARKET_ROME_CODES || ""));
  if (explicitCodes.length) return { codes: explicitCodes, source: "MARKET_ROME_CODES", filePath: null };

  const filePath = env.MARKET_ROME_CODES_FILE || DEFAULT_MARKET_ROME_CODES_FILE;
  const fileSelection = await readMarketRomeCodesFile(filePath);
  if (fileSelection.codes.length) {
    return { codes: fileSelection.codes, source: "MARKET_ROME_CODES_FILE", filePath };
  }
  throw new Error(`Aucun code ROME valide dans MARKET_ROME_CODES_FILE : ${filePath}`);
}

async function readMarketRomeCodesFile(filePath = "") {
  if (!filePath) return { codes: [], declaredSize: null };
  const root = path.resolve(process.cwd());
  const resolvedPath = path.resolve(root, filePath);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`MARKET_ROME_CODES_FILE doit rester dans le dépôt : ${filePath}`);
  }

  let content;
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`Impossible de lire MARKET_ROME_CODES_FILE (${filePath}) : ${shortMessage(error.message)}`);
  }

  if (!/\.json$/i.test(filePath)) return { codes: normalizeRomeCodes(parseList(content)), declaredSize: null };
  const json = JSON.parse(content);
  const rows = Array.isArray(json) ? json : Array.isArray(json.codes) ? json.codes : [];
  const codes = normalizeRomeCodes(rows.map(item => typeof item === "string" ? item : item?.romeCode || item?.code));
  const declaredSize = numberOrNull(json?.selectionSize);
  if (declaredSize !== null && declaredSize !== codes.length) {
    throw new Error(`Liste ROME incohérente : ${filePath} déclare ${declaredSize} codes mais ${codes.length} codes valides ont été lus.`);
  }
  return { codes, declaredSize };
}

async function main() {
  const codeSelection = await resolveMarketRomeCodes();
  const marketRomeCodes = codeSelection.codes;
  if (parseBoolean(env.MARKET_RESOLVE_ONLY)) {
    console.log(JSON.stringify({
      status: "market_rome_scope_valid",
      source: codeSelection.source,
      filePath: codeSelection.filePath,
      requestedRomeCodesCount: marketRomeCodes.length,
      firstCode: marketRomeCodes[0] || null,
      lastCode: marketRomeCodes.at(-1) || null
    }, null, 2));
    return;
  }

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
    if (mergeExistingPackage) {
      const preserved = await readExistingMarketPackage();
      rowsByLevel.national.push(...preserved.national);
      rowsByLevel.regional.push(...preserved.regional);
      rowsByLevel.departmental.push(...preserved.departmental);
      bmoRows = preserved.bmoRows;
      fapRomeMappings = preserved.fapRomeMappings;
      diagnostics.push({ source: "existing_market_package", status: "merged", reason: "Les lignes déjà validées sont conservées ; les nouvelles lignes remplacent seulement les mêmes couples métier/territoire." });
    }
    if (dryRun) {
      if (!mergeExistingPackage) {
        const preserved = await readExistingOfferRows();
        rowsByLevel.national.push(...preserved.national);
        rowsByLevel.regional.push(...preserved.regional);
        rowsByLevel.departmental.push(...preserved.departmental);
      }
      diagnostics.push({
        source: "api_marche_travail",
        status: "dry_run_existing_rows_preserved",
        reason: "DRY_RUN=true : aucune API marché n’est appelée et les lignes statiques existantes sont préservées."
      });
    } else if (requestedSources.includes("api_marche_travail")) {
      const apiResult = await fetchMarketApiData(marketRomeCodes);
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
      bmoRows = mergeRows(bmoRows, bmoResult.rows, row => `${row.fapCode || row.code || ""}|${row.territoryCode || row.territory || ""}`);
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
      fapRomeMappings = mergeRows(fapRomeMappings, mappingResult.rows, row => `${row.romeCode || ""}|${row.qualificationCode || ""}|${row.fapCodeDetailed || row.fapCode || ""}`);
    }

    rowsByLevel.national = mergeRows([], rowsByLevel.national, marketRowKey);
    rowsByLevel.regional = mergeRows([], rowsByLevel.regional, marketRowKey);
    rowsByLevel.departmental = mergeRows([], rowsByLevel.departmental, marketRowKey);
    enrichRowsByLevel(rowsByLevel);
    const coverage = buildCoverage(rowsByLevel, bmoRows);
    const totalMarketRows = rowsByLevel.national.length + rowsByLevel.regional.length + rowsByLevel.departmental.length;
    const shouldFailNoMarketData = shouldFailBecauseMarketApiHasNoRows(totalMarketRows);
    const status = dryRun
      ? "not_connected_dry_run"
      : totalMarketRows > 0
        ? "completed_with_market_data"
        : shouldFailNoMarketData
          ? "failed_no_market_data"
          : "completed_without_market_rows";

    await writeOutputs({ rowsByLevel, bmoRows, fapRomeMappings, diagnostics, coverage, status, marketRomeCodes });
    logMarketSummary({ rowsByLevel, marketRomeCodes, status });

    if (shouldFailNoMarketData) {
      await writeJson("sync-error.json", {
        schemaVersion: "1.0.0",
        generatedAt: now,
        status: "error",
        message: "Aucune ligne marché exploitable par code ROME n’a été récupérée.",
        hint: "Vérifier FT_MARKET_SCOPE, FT_MARKET_API_URL, MARKET_TERRITORIES, le format de réponse API et les droits France Travail.",
        diagnostics
      });
      const error = new Error("Génération marché bloquée : 0 donnée exploitable par code ROME.");
      Object.defineProperty(error, "marketErrorAlreadyReported", { value: true });
      throw error;
    }

    if (!dryRun && totalMarketRows === 0 && requestedSources.includes("api_marche_travail")) {
      console.log("Aucune donnée marché exploitable récupérée. Le workflow continue avec diagnostic.");
    }
  } catch (error) {
    if (!dryRun && !error.marketErrorAlreadyReported) {
      enrichRowsByLevel(rowsByLevel);
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
        status: "failed",
        marketRomeCodes
      });
      await writeJson("sync-error.json", {
        schemaVersion: "1.0.0",
        generatedAt: now,
        status: "error",
        message: shortMessage(error.message),
        diagnostics: existingDiagnostics
      });
      await writeDebugMarketSample(marketRomeCodes);
    }
    throw error;
  }
}

async function fetchMarketApiData(marketRomeCodes) {
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
  marketTokenObtained = true;
  for (const territory of requestedTerritories) {
    if (useGlobalTerritoryCall) {
      const globalResult = await fetchGlobalTerritoryMarketRows(endpoint, token, territory);
      rowsByLevel[territory.outputKey].push(...globalResult.rows);
      diagnostics.push(globalResult.diagnostic);
      if (globalResult.rows.length) continue;
    }
    if (marketRomeCodes.length) {
      const byCodeResult = await fetchMarketRowsByRomeCodes(endpoint, token, territory, marketRomeCodes);
      rowsByLevel[territory.outputKey].push(...byCodeResult.rows);
      diagnostics.push(byCodeResult.diagnostic);
    } else {
      diagnostics.push({
        source: "api_marche_travail",
        territory: territory.id,
        status: "no_rome_codes_to_request",
        method: "POST",
        reason: "Aucun code ROME disponible pour interroger stat-offres par activité."
      });
    }
  }
  dedupeRowsByRome(rowsByLevel.national);
  dedupeRowsByRome(rowsByLevel.regional);
  dedupeRowsByRome(rowsByLevel.departmental);
  return { diagnostics, rowsByLevel };
}

async function fetchGlobalTerritoryMarketRows(endpoint, token, territory) {
  const url = buildMarketUrl(endpoint, territory);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.access_token || token.token || token}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      return {
        rows: [],
        diagnostic: {
          source: "api_marche_travail",
          territory: territory.id,
          status: "http_error",
          method: "GET",
          httpStatus: response.status,
          message: shortMessage(await safeResponseText(response)),
          endpoint: withoutSensitiveQuery(url),
          note: "Appel global territoire activé explicitement par MARKET_USE_GLOBAL_TERRITORY_CALL=true."
        }
      };
    }
    const json = await response.json();
    const candidateRows = marketApiCandidateRows(json);
    const rows = normalizeMarketRows(candidateRows, territory);
    return {
      rows,
      diagnostic: {
        source: "api_marche_travail",
        territory: territory.id,
        status: rows.length ? "ok_global_territory" : "no_exploitable_rome_rows_global_territory",
        method: "GET",
        rawRowsCount: candidateRows.length,
        normalizedRowsCount: rows.length,
        endpoint: withoutSensitiveQuery(url),
        responseTopLevelKeys: isObject(json) ? Object.keys(json).slice(0, 30) : [],
        note: "Appel global territoire activé explicitement par MARKET_USE_GLOBAL_TERRITORY_CALL=true."
      }
    };
  } catch (error) {
    return {
      rows: [],
      diagnostic: {
        source: "api_marche_travail",
        territory: territory.id,
        status: "fetch_error",
        method: "GET",
        message: shortMessage(error.message),
        endpoint: withoutSensitiveQuery(url)
      }
    };
  }
}

async function fetchMarketRowsByRomeCodes(endpoint, token, territory, marketRomeCodes) {
  const rows = [];
  const failedCodes = [];
  let firstSampleKeys = [];

  for (const romeCode of marketRomeCodes) {
    const payload = buildMarketPayload(territory, romeCode);
    try {
      const response = await postMarketStatOffres(endpoint, token, payload);
      if (!response.ok) {
        const responseText = await safeResponseText(response);
        captureMarketDebugSample({ territory, romeCode, payload, response, responseText });
        failedCodes.push({
          romeCode,
          status: response.status,
          method: "POST",
          message: shortMessage(responseText),
          payload: sanitizeDebugPayload(payload),
          endpoint: withoutSensitiveQuery(endpoint)
        });
      } else {
        const json = await response.json();
        const candidateRows = marketApiCandidateRows(json);
        captureMarketDebugSample({ territory, romeCode, payload, response, json });
        const normalizedRows = normalizeMarketRows(candidateRows, territory, romeCode);
        rows.push(...normalizedRows);
        if (!firstSampleKeys.length && candidateRows[0] && typeof candidateRows[0] === "object") {
          firstSampleKeys = Object.keys(candidateRows[0]).slice(0, 30);
        }
        if (!normalizedRows.length) {
          failedCodes.push({
            romeCode,
            status: "no_exploitable_rome_rows",
            method: "POST",
            payload: sanitizeDebugPayload(payload),
            responseTopLevelKeys: isObject(json) ? Object.keys(json).slice(0, 30) : [],
            sampleKeys: candidateRows[0] && typeof candidateRows[0] === "object" ? Object.keys(candidateRows[0]).slice(0, 30) : [],
            endpoint: withoutSensitiveQuery(endpoint)
          });
        }
      }
    } catch (error) {
      failedCodes.push({
        romeCode,
        status: "fetch_error",
        method: "POST",
        payload: sanitizeDebugPayload(payload),
        message: shortMessage(error.message),
        endpoint: withoutSensitiveQuery(endpoint)
      });
    }
    if (marketRequestDelayMs) await sleep(marketRequestDelayMs);
  }

  dedupeRowsByRome(rows);
  return {
    rows,
    diagnostic: {
      source: "api_marche_travail",
      territory: territory.id,
      status: rows.length ? "ok_by_rome_code" : "no_exploitable_rome_rows_by_rome_code",
      mode: "by_rome_code_post_json",
      method: "POST",
      activityType: marketActivityType,
      periodType: marketPeriodType,
      nomenclatureType: marketNomenclatureType,
      requestedCodesCount: marketRomeCodes.length,
      normalizedRowsCount: rows.length,
      failedCodesCount: failedCodes.length,
      failedCodesSample: failedCodes.slice(0, 12),
      sampleKeys: firstSampleKeys,
      note: rows.length
        ? "Des lignes ont été récupérées via des POST JSON par code ROME."
        : "Le POST JSON par code ROME n’a pas produit de ligne exploitable. Vérifier le payload, MARKET_PERIOD_TYPE, MARKET_NOMENCLATURE_TYPE et le format exact de réponse de l’API."
    }
  };
}

function buildMarketPayload(territory, romeCode) {
  return {
    codeTypeTerritoire: territory.codeTypeTerritoire,
    codeTerritoire: territory.codeTerritoire,
    codeTypeActivite: marketActivityType,
    codeActivite: romeCode,
    codeTypePeriode: marketPeriodType,
    codeTypeNomenclature: marketNomenclatureType
  };
}

async function postMarketStatOffres(endpoint, token, payload) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token || token.token || token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
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
        status: "detected_not_parsed_xlsx",
        sourceLevel: "not_connected",
        confidence: 0,
        usedInMarketScore: false,
        fileType: "xlsx",
        reason: "La source BMO fournie est un fichier XLSX. Elle est détectée mais non parsée dans cette version ; aucun score marché ne l’utilise.",
        futureStep: "Prévoir en v0.6.1 ou v0.6.2 un parseur XLSX validé, ou une conversion BMO en CSV propre avec rapport qualité."
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

function normalizeMarketRows(rows, territory, fallbackRomeCode = "") {
  return rows.map(row => normalizeMarketRow(row, territory, fallbackRomeCode)).filter(Boolean);
}

function normalizeMarketRow(row, territory, fallbackRomeCode = "") {
  if (!row || typeof row !== "object") return null;
  const periodRow = normalizeMarketPeriodResponse(row, territory, fallbackRomeCode);
  if (periodRow) return periodRow;
  const romeCode = extractRomeCode(row) || fallbackRomeCode;
  if (!romeCode) return null;
  const extracted = extractMarketMeasuresFromApiResponse(row);
  const offers12m = firstNumber(row, [
    "offers12m", "offres12m", "offres_12m", "nombreOffres12Mois", "nombreOffres",
    "nbOffres", "nb_offres", "offres", "valeur", "value", "count"
  ]) ?? extracted.offers12m;
  const demanders = firstNumber(row, ["demanders", "demandeurs", "nbDemandeurs", "nombreDemandeurs"]) ?? extracted.demanders;
  const hires12m = firstNumber(row, ["hires12m", "embauches12m", "embauches", "nbEmbauches"]) ?? extracted.hires12m;
  const newDemanders12m = firstNumber(row, ["newDemanders12m", "nouveauxDemandeurs12m", "nouveauxDemandeurs"]) ?? extracted.newDemanders12m;
  const tensionLevel = "unknown";
  const recruitmentSignal = "unknown";
  const recruitmentDifficulty = "unknown";
  const hasMarketMeasure = [offers12m, demanders, newDemanders12m, hires12m].some(Number.isFinite);
  if (!hasMarketMeasure) return null;
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
    newDemanders12m,
    offers12m,
    hires12m,
    tensionLevel,
    recruitmentSignal,
    recruitmentDifficulty,
    salarySignal: firstSignal(row, ["salarySignal", "niveauSalaire"]) || "unknown",
    marketDataKind: "offers_volume",
    marketInterpretationLabel: "Volume d’offres observé",
    absoluteOfferSignal: absoluteOfferSignalFromVolume(offers12m),
    territorialOfferSignal: "unknown",
    territoryRank: null,
    territoryPercentile: null,
    offers12mRankInTerritory: null,
    marketFreshness: "unknown",
    confidence: territory.sourceLevel === "departmental" ? 0.82 : territory.sourceLevel === "regional" ? 0.72 : 0.55,
    rawFieldHints: Object.keys(row).slice(0, 24),
    rawMeasureHints: extracted.rawMeasureHints.slice(0, 12)
  };
}

function normalizeMarketPeriodResponse(row, territory, fallbackRomeCode = "") {
  const periods = Array.isArray(row.listeValeursParPeriode) ? row.listeValeursParPeriode.filter(isObject) : [];
  if (!periods.length) return null;
  const latestPeriodCode = latestPeriodCodeFromRows(periods);
  const latestRows = periods.filter(item => item.codePeriode === latestPeriodCode);
  const latestRow = latestRows[0] || periods[0] || {};
  const peRow = latestRows.find(item => item.codeNomenclature === "PE-CUMUL12MOIS") ||
    periods.find(item => item.codeNomenclature === "PE-CUMUL12MOIS") || {};
  const allRow = latestRows.find(item => item.codeNomenclature === "TOFF-CUMUL12MOIS") ||
    periods.find(item => item.codeNomenclature === "TOFF-CUMUL12MOIS") || {};
  const offersFranceTravail12m = numberOrNull(peRow.valeurPrincipaleNombre);
  const offersAll12m = numberOrNull(allRow.valeurPrincipaleNombre);
  const offers12m = Number.isFinite(offersAll12m) ? offersAll12m : offersFranceTravail12m;
  const hasMarketMeasure = Number.isFinite(offers12m) || Number.isFinite(offersFranceTravail12m) || Number.isFinite(offersAll12m);
  if (!hasMarketMeasure) return null;
  const romeCode = latestRow.codeActivite || peRow.codeActivite || allRow.codeActivite || fallbackRomeCode;
  if (!romeCode) return null;
  return {
    romeCode,
    title: latestRow.libActivite || peRow.libActivite || allRow.libActivite || null,
    sourceLevel: territory.sourceLevel,
    sourceName: "api_marche_travail",
    sourceUpdatedAt: row.datMaj || latestRow.datMaj || peRow.datMaj || allRow.datMaj || now,
    territoryId: territory.id,
    territoryLabel: latestRow.libTerritoire || peRow.libTerritoire || allRow.libTerritoire || territory.label,
    codeTypeTerritoire: latestRow.codeTypeTerritoire || territory.codeTypeTerritoire,
    codeTerritoire: latestRow.codeTerritoire || territory.codeTerritoire,
    latestPeriodCode,
    latestPeriodLabel: latestRow.libPeriode || peRow.libPeriode || allRow.libPeriode || null,
    offersFranceTravail12m,
    offersAll12m,
    offers12m,
    demanders: null,
    newDemanders12m: null,
    hires12m: null,
    tensionLevel: "unknown",
    recruitmentSignal: "unknown",
    recruitmentDifficulty: "unknown",
    salarySignal: "unknown",
    marketDataKind: "offers_volume",
    marketInterpretationLabel: "Volume d’offres observé",
    absoluteOfferSignal: absoluteOfferSignalFromVolume(offers12m),
    territorialOfferSignal: "unknown",
    territoryRank: null,
    territoryPercentile: null,
    offers12mRankInTerritory: null,
    marketFreshness: "unknown",
    confidence: territory.sourceLevel === "departmental" ? 0.82 : territory.sourceLevel === "regional" ? 0.72 : 0.55,
    rawFieldHints: Object.keys(row).slice(0, 24),
    rawMeasureHints: periods.map(item => ({
      codeNomenclature: item.codeNomenclature || null,
      codePeriode: item.codePeriode || null,
      valeurPrincipaleNombre: numberOrNull(item.valeurPrincipaleNombre)
    })).slice(0, 24)
  };
}

function marketApiCandidateRows(json) {
  if (isObject(json) && Array.isArray(json.listeValeursParPeriode)) return [json];
  const rawRows = extractRows(json);
  return rawRows.length ? rawRows : (isObject(json) ? [json] : []);
}

function latestPeriodCodeFromRows(rows = []) {
  return rows
    .map(item => item.codePeriode)
    .filter(Boolean)
    .sort((a, b) => periodRank(b) - periodRank(a))[0] || null;
}

function periodRank(value) {
  const text = String(value || "").toUpperCase();
  const quarter = text.match(/^(\d{4})T([1-4])$/);
  if (quarter) return Number(quarter[1]) * 10 + Number(quarter[2]);
  const month = text.match(/^(\d{4})[-_]?([0-1]?\d)$/);
  if (month) return Number(month[1]) * 100 + Number(month[2]);
  const year = text.match(/^(\d{4})$/);
  if (year) return Number(year[1]) * 10;
  return Number(text.replace(/\D/g, "")) || 0;
}

function extractMarketMeasuresFromApiResponse(json) {
  const measures = {
    offers12m: null,
    demanders: null,
    hires12m: null,
    newDemanders12m: null,
    rawMeasureHints: []
  };
  const candidates = [];
  walk(json, (value, key) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") candidates.push(item);
      }
    } else if (isObject(value) && hasAnyLooseNumber(value)) {
      candidates.push(value);
    } else if (Number.isFinite(numberOrNull(value)) && key && isPotentialMeasureKey(key)) {
      candidates.push({ code: key, libelle: key, valeur: value });
    }
  });

  for (const item of candidates) {
    const code = firstString(item, ["code", "codeValeur", "codeIndicateur", "codeStatistique", "type", "cle", "key"]);
    const label = firstString(item, ["libelle", "label", "nom", "description", "name"]);
    const value = firstNumber(item, ["valeur", "value", "nombre", "nb", "count", "total"]);
    if (!Number.isFinite(value)) continue;
    const hint = normalizeText(`${code || ""} ${label || ""}`);
    measures.rawMeasureHints.push({ code, label, value });

    if (["toff", "offre", "offres"].some(itemHint => hint.includes(itemHint))) {
      measures.offers12m = Math.max(measures.offers12m || 0, value);
    } else if (["nouveau", "nouveaux", "entree", "inscription"].some(itemHint => hint.includes(itemHint)) && hint.includes("demande")) {
      measures.newDemanders12m = Math.max(measures.newDemanders12m || 0, value);
    } else if (["demandeur", "demandeurs", "defm"].some(itemHint => hint.includes(itemHint))) {
      measures.demanders = Math.max(measures.demanders || 0, value);
    } else if (["embauche", "embauches", "declaration", "dpae"].some(itemHint => hint.includes(itemHint))) {
      measures.hires12m = Math.max(measures.hires12m || 0, value);
    }
  }

  if (measures.offers12m === null && measures.rawMeasureHints.length) {
    measures.offers12m = Math.max(...measures.rawMeasureHints.map(item => item.value).filter(Number.isFinite));
  }
  return measures;
}

function isPotentialMeasureKey(key) {
  const normalized = normalizeText(key);
  return ["valeur", "value", "nombre", "nb", "count", "total", "offre", "demandeur", "embauche", "dpae", "defm"].some(part => normalized.includes(part));
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
    sourceLevel: "not_connected",
    confidence: 0,
    usedInMarketScore: false
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

function enrichRowsByLevel(rowsByLevel) {
  for (const [sourceLevel, rows] of Object.entries(rowsByLevel || {})) {
    enrichTerritoryRows(toArray(rows), sourceLevel);
  }
}

function enrichTerritoryRows(rows, fallbackSourceLevel = "unknown") {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const latestPeriod = latestPeriodCodeFromMarketRows(rows);
  const rankedRows = rows
    .filter(row => Number.isFinite(row.offers12m))
    .sort((a, b) => Number(b.offers12m) - Number(a.offers12m) || String(a.romeCode).localeCompare(String(b.romeCode), "fr"));
  const totalRanked = rankedRows.length;
  const rankByCode = new Map();
  rankedRows.forEach((row, index) => {
    const rank = index + 1;
    const percentile = totalRanked ? Math.round(((totalRanked - rank + 1) / totalRanked) * 100) : null;
    rankByCode.set(row.romeCode, {
      rank,
      percentile,
      territorialOfferSignal: territorialOfferSignalFromRank(row.offers12m, percentile)
    });
  });

  rows.forEach(row => {
    const rank = rankByCode.get(row.romeCode) || {};
    row.sourceLevel = row.sourceLevel || fallbackSourceLevel;
    row.sourceName = row.sourceName || "api_marche_travail";
    row.marketDataKind = "offers_volume";
    row.marketInterpretationLabel = "Volume d’offres observé";
    row.absoluteOfferSignal = absoluteOfferSignalFromVolume(row.offers12m);
    row.territorialOfferSignal = rank.territorialOfferSignal || "unknown";
    row.territoryRank = rank.rank ?? null;
    row.offers12mRankInTerritory = rank.rank ?? null;
    row.territoryPercentile = rank.percentile ?? null;
    row.marketFreshness = marketFreshnessFromPeriod(row.latestPeriodCode, latestPeriod);
  });
  return rows;
}

function latestPeriodCodeFromMarketRows(rows = []) {
  return rows
    .map(row => row.latestPeriodCode)
    .filter(Boolean)
    .sort((a, b) => periodRank(b) - periodRank(a))[0] || null;
}

function absoluteOfferSignalFromVolume(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value === 0) return "zero";
  if (value < 100) return "low";
  if (value < 1000) return "medium";
  return "high";
}

function territorialOfferSignalFromRank(value, percentile) {
  if (!Number.isFinite(value) || percentile === null || percentile === undefined) return "unknown";
  if (value === 0) return "zero_local";
  if (percentile >= 90) return "top_local";
  if (percentile >= 75) return "strong_local";
  if (percentile >= 35) return "medium_local";
  return "weak_local";
}

function marketFreshnessFromPeriod(periodCode, latestPeriodCode) {
  const rank = periodComparableRank(periodCode);
  const latestRank = periodComparableRank(latestPeriodCode);
  if (!rank || !latestRank) return "unknown";
  const diff = latestRank - rank;
  if (diff <= 0) return "current";
  if (diff <= 3) return "recent";
  if (diff <= 7) return "stale";
  return "very_stale";
}

function periodComparableRank(value) {
  const text = String(value || "").toUpperCase();
  const quarter = text.match(/^(\d{4})T([1-4])$/);
  if (quarter) return Number(quarter[1]) * 4 + Number(quarter[2]);
  const month = text.match(/^(\d{4})[-_]?([0-1]?\d)$/);
  if (month) return Number(month[1]) * 12 + Number(month[2]);
  const year = text.match(/^(\d{4})$/);
  if (year) return Number(year[1]) * 4;
  return Number(text.replace(/\D/g, "")) || 0;
}

async function writeOutputs({ rowsByLevel, bmoRows, fapRomeMappings, diagnostics, coverage, status, marketRomeCodes = [] }) {
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: now,
    generator: "scripts/generate-market-data.mjs",
    status,
    requestedSources,
    requestedTerritories: requestedTerritories.map(territory => territory.id),
    requestedRomeCodesCount: marketRomeCodes.length,
    marketApi: {
      prioritySource: "api_marche_travail",
      endpointConfigured: Boolean(env.FT_MARKET_API_URL),
      scopeConfigured: Boolean(env.FT_MARKET_SCOPE),
      method: "POST",
      bodyFormat: "json",
      byRomePostEnabled: true,
      globalTerritoryCallEnabled: useGlobalTerritoryCall,
      activityType: marketActivityType,
      periodType: marketPeriodType,
      nomenclatureType: marketNomenclatureType,
      failOnEmpty: parseBoolean(env.MARKET_FAIL_ON_EMPTY || "false"),
      debugSampleEnabled: marketDebugSampleEnabled,
      requestDelayMs: marketRequestDelayMs
    },
    sourceStatus: diagnostics,
    bmo: buildBmoSummary(diagnostics, bmoRows),
    coverage,
    marketCoverage: pickMarketCoverage(coverage),
    marketSignalDistribution: coverage.marketSignalDistribution,
    territorialSignalDistribution: coverage.territorialSignalDistribution,
    officialMarketConnected: coverage.officialMarketConnected,
    apiMethod: "POST",
    sourceName: "api_marche_travail",
    bmoUsedInMarketScore: false,
    fapRomeUsedInMarketScore: false,
    activeOffersDisplayed: false,
    warnings: buildWarnings(status, diagnostics)
  };
  const outputFiles = [
    "territories.json",
    "market-national.rome.json",
    "market-occitanie.rome.json",
    "market-aude.rome.json",
    "bmo-fap2021.json",
    "fap-rome-mappings.json",
    "market-quality-report.json",
    "market-import-manifest.json"
  ];
  if (marketDebugSampleEnabled) outputFiles.push("debug-market-sample.json");
  const manifest = {
    schemaVersion: "1.0.0",
    datasetName: "Boussole Pro - couche marché phase 1",
    datasetVersion: `market-v2-phase1-staging-${now.slice(0, 10)}`,
    generatedAt: now,
    status,
    outputPath: "creations/boussolepro/data/generated/market/",
    files: outputFiles,
    sourcePolicy: {
      noActiveOffers: true,
      noBrowserToken: true,
      noSecretsWritten: true,
      officialStatsConnected: status === "completed_with_market_data",
      marketApiRequiredForOfficialStats: requestedSources.includes("api_marche_travail"),
      marketApiMethod: "POST",
      marketApiPayloadUsesCodeActivite: true,
      bmoUsedInMarketScore: false,
      bmoRequiresValidatedParser: true,
      fapRomeMappingsRequireConfidence: true,
      fapRomeUsedInMarketScore: false,
      activeOffersDisplayed: false,
      marketDataKind: "offers_volume",
      marketInterpretationLabel: "Volume d’offres observé",
      offerVolumeIsNotTension: true,
      weakOrAmbiguousMappingCannotInfluenceRanking: true
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
  await writeDebugMarketSample(marketRomeCodes);
}

function buildCoverage(rowsByLevel, bmoRows) {
  const nationalCodes = unique(rowsByLevel.national.map(row => row.romeCode));
  const regionalCodes = unique(rowsByLevel.regional.map(row => row.romeCode));
  const departmentalCodes = unique(rowsByLevel.departmental.map(row => row.romeCode));
  const anyCodes = unique([...nationalCodes, ...regionalCodes, ...departmentalCodes]);
  const staleCodes = unique([
    ...rowsByLevel.national,
    ...rowsByLevel.regional,
    ...rowsByLevel.departmental
  ].filter(row => ["stale", "very_stale"].includes(row.marketFreshness)).map(row => row.romeCode));
  return {
    officialMarketConnected: anyCodes.length > 0,
    apiMethod: "POST",
    sourceName: "api_marche_travail",
    marketDataKind: "offers_volume",
    marketInterpretationLabel: "Volume d’offres observé",
    jobsWithAnyMarket: anyCodes.length,
    jobsWithOfficialMarket: anyCodes.length,
    jobsWithNationalMarket: nationalCodes.length,
    jobsWithRegionalMarket: regionalCodes.length,
    jobsWithDepartmentalMarket: departmentalCodes.length,
    jobsWithZeroNationalOffers: unique(rowsByLevel.national.filter(row => row.offers12m === 0).map(row => row.romeCode)).length,
    jobsWithZeroRegionalOffers: unique(rowsByLevel.regional.filter(row => row.offers12m === 0).map(row => row.romeCode)).length,
    jobsWithZeroDepartmentalOffers: unique(rowsByLevel.departmental.filter(row => row.offers12m === 0).map(row => row.romeCode)).length,
    jobsWithStaleMarketData: staleCodes.length,
    bmoFapFamilies: unique(bmoRows.map(row => row.fapCode)).length,
    jobsWithBmo: null,
    jobsWithBmoStatus: "not_derived_before_fap_rome_enrichment",
    jobsWithoutMarket: null,
    bmoUsedInMarketScore: false,
    fapRomeUsedInMarketScore: false,
    activeOffersDisplayed: false,
    marketSignalDistribution: {
      national: signalDistribution(rowsByLevel.national, "absoluteOfferSignal", ["zero", "low", "medium", "high", "unknown"]),
      regional: signalDistribution(rowsByLevel.regional, "absoluteOfferSignal", ["zero", "low", "medium", "high", "unknown"]),
      departmental: signalDistribution(rowsByLevel.departmental, "absoluteOfferSignal", ["zero", "low", "medium", "high", "unknown"])
    },
    territorialSignalDistribution: {
      national: signalDistribution(rowsByLevel.national, "territorialOfferSignal", ["zero_local", "weak_local", "medium_local", "strong_local", "top_local", "unknown"]),
      regional: signalDistribution(rowsByLevel.regional, "territorialOfferSignal", ["zero_local", "weak_local", "medium_local", "strong_local", "top_local", "unknown"]),
      departmental: signalDistribution(rowsByLevel.departmental, "territorialOfferSignal", ["zero_local", "weak_local", "medium_local", "strong_local", "top_local", "unknown"])
    }
  };
}

function pickMarketCoverage(coverage = {}) {
  return {
    jobsWithNationalMarket: coverage.jobsWithNationalMarket || 0,
    jobsWithRegionalMarket: coverage.jobsWithRegionalMarket || 0,
    jobsWithDepartmentalMarket: coverage.jobsWithDepartmentalMarket || 0,
    jobsWithAnyMarket: coverage.jobsWithAnyMarket || 0,
    jobsWithZeroDepartmentalOffers: coverage.jobsWithZeroDepartmentalOffers || 0,
    jobsWithZeroRegionalOffers: coverage.jobsWithZeroRegionalOffers || 0,
    jobsWithZeroNationalOffers: coverage.jobsWithZeroNationalOffers || 0,
    jobsWithStaleMarketData: coverage.jobsWithStaleMarketData || 0
  };
}

function signalDistribution(rows, key, labels) {
  const distribution = Object.fromEntries(labels.map(label => [label, 0]));
  rows.forEach(row => {
    const signal = labels.includes(row[key]) ? row[key] : "unknown";
    distribution[signal] += 1;
  });
  return distribution;
}

function buildBmoSummary(diagnostics, bmoRows) {
  const diagnostic = diagnostics.find(item => item.source === "bmo") || {};
  const isXlsx = diagnostic.status === "detected_not_parsed_xlsx";
  return {
    sourceDetected: Boolean(env.BMO_DATA_URL),
    status: diagnostic.status || "not_requested",
    sourceLevel: isXlsx ? "not_connected" : diagnostic.sourceLevel || (bmoRows.length ? "external_unmapped" : "not_connected"),
    confidence: isXlsx ? 0 : bmoRows.length ? 0.45 : 0,
    fileType: isXlsx ? "xlsx" : inferFileType(env.BMO_DATA_URL),
    rowsCount: bmoRows.length,
    usedInMarketScore: false,
    parsed: bmoRows.length > 0,
    note: isXlsx
      ? "BMO est détecté mais non parsé : le fichier XLSX n’est pas transformé en données de matching dans cette version."
      : "BMO n’est pas utilisé dans le score marché tant que l’import et les correspondances FAP/ROME ne sont pas validés.",
    futureStep: "v0.6.1/v0.6.2 : ajouter un parseur XLSX validé ou convertir BMO en CSV propre, puis produire un rapport qualité avant toute utilisation."
  };
}

function captureMarketDebugSample({ territory, romeCode, payload, response, json = null, responseText = "" }) {
  if (!marketDebugSampleEnabled || marketDebugRequests.length >= 8) return;
  marketDebugRequests.push({
    territory: territory.id,
    romeCode,
    payload: sanitizeDebugPayload(payload),
    httpStatus: response.status,
    ok: response.ok,
    responseTopLevelKeys: isObject(json) ? Object.keys(json).slice(0, 30) : [],
    responseSample: json ? sanitizeDebugPayload(limitDebugValue(json)) : undefined,
    responseTextSample: responseText ? shortMessage(responseText) : undefined
  });
}

async function writeDebugMarketSample(marketRomeCodes) {
  if (!marketDebugSampleEnabled) return;
  await writeJson("debug-market-sample.json", {
    schemaVersion: "1.0.0",
    generatedAt: now,
    endpoint: withoutSensitiveQuery(env.FT_MARKET_API_URL || "https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1/indicateur/stat-offres"),
    method: "POST",
    tokenObtained: marketTokenObtained,
    requestedTerritories: requestedTerritories.map(territory => territory.id),
    requestedRomeCodesSample: marketRomeCodes.slice(0, 20),
    activityType: marketActivityType,
    periodType: marketPeriodType,
    nomenclatureType: marketNomenclatureType,
    firstRequests: sanitizeDebugPayload(marketDebugRequests)
  });
}

function logMarketSummary({ rowsByLevel, marketRomeCodes, status }) {
  console.log("Marché FT — résumé");
  console.log(`- DRY_RUN: ${dryRun}`);
  console.log(`- endpoint configuré: ${env.FT_MARKET_API_URL ? "oui" : "non"}`);
  console.log("- méthode: POST");
  console.log(`- token obtenu: ${marketTokenObtained ? "oui" : "non"}`);
  console.log(`- territoires: ${requestedTerritories.map(territory => territory.id).join(", ") || "aucun"}`);
  console.log(`- codes ROME testés: ${marketRomeCodes.length}`);
  console.log(`- lignes marché: national=${rowsByLevel.national.length}, regional=${rowsByLevel.regional.length}, departmental=${rowsByLevel.departmental.length}`);
  console.log(`- statut: ${status}`);
  console.log(`- diagnostics écrits dans: ${path.join(OUTPUT_DIR, "market-quality-report.json")}`);
  if (marketDebugSampleEnabled) console.log(`- debug écrit dans: ${path.join(OUTPUT_DIR, "debug-market-sample.json")}`);
}

function sanitizeDebugPayload(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 8).map(item => sanitizeDebugPayload(item, depth + 1));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (isSensitiveKey(key)) return [key, "[redacted]"];
      return [key, sanitizeDebugPayload(child, depth + 1)];
    }));
  }
  if (typeof value === "string") {
    if (/bearer\s+[a-z0-9._-]+/i.test(value)) return "[redacted]";
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  return value;
}

function limitDebugValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 4).map(item => limitDebugValue(item, depth + 1));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, child]) => [key, limitDebugValue(child, depth + 1)]));
  }
  return value;
}

function isSensitiveKey(key) {
  return /token|secret|client_id|clientSecret|client_secret|authorization|bearer/i.test(String(key || ""));
}

function buildWarnings(status, diagnostics) {
  const warnings = [];
  warnings.push("Les données marché actuelles représentent des volumes d’offres observés, pas une tension métier complète.");
  if (status === "not_connected_dry_run") warnings.push("Aucune statistique officielle marché n’est générée par ce dry-run.");
  if (status === "failed_no_market_data" || status === "failed") warnings.push("Aucune ligne marché exploitable par code ROME n’a été récupérée.");
  if (status === "completed_without_market_rows") warnings.push("Aucune ligne marché officielle n’a été générée, mais aucune source bloquante n’était exploitable dans cette configuration.");
  if (diagnostics.some(item => item.status === "detected_not_parsed_xlsx")) warnings.push("La source BMO XLSX est détectée mais non parsée ; elle n’est pas utilisée dans le score marché.");
  if (diagnostics.some(item => item.status === "no_direct_rome_mapping_found")) warnings.push("La source FAP fournie ne contient pas de correspondance ROME directe détectée.");
  return warnings;
}

function shouldFailBecauseMarketApiHasNoRows(totalMarketRows) {
  const failOnEmpty = parseBoolean(env.MARKET_FAIL_ON_EMPTY || "false");
  return failOnEmpty && !dryRun && requestedSources.includes("api_marche_travail") && totalMarketRows === 0;
}

async function readExistingOfferRows() {
  const files = {
    national: "market-national.rome.json",
    regional: "market-occitanie.rome.json",
    departmental: "market-aude.rome.json"
  };
  const output = { national: [], regional: [], departmental: [] };
  for (const [level, fileName] of Object.entries(files)) {
    try {
      const rows = JSON.parse(await readFile(path.join(OUTPUT_DIR, fileName), "utf8"));
      output[level] = Array.isArray(rows) ? rows : [];
    } catch {
      output[level] = [];
    }
  }
  return output;
}

async function readExistingMarketPackage() {
  const offers = await readExistingOfferRows();
  const [bmoRows, fapRomeMappings] = await Promise.all([
    readExistingJson("bmo-fap2021.json"),
    readExistingJson("fap-rome-mappings.json")
  ]);
  return { ...offers, bmoRows, fapRomeMappings };
}

async function readExistingJson(fileName) {
  try {
    const rows = JSON.parse(await readFile(path.join(OUTPUT_DIR, fileName), "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function marketRowKey(row = {}) {
  return `${row.romeCode || row.code || ""}|${row.territoryCode || row.codeTerritoire || row.territoryId || ""}`;
}

function mergeRows(existing = [], incoming = [], keyOf = row => row.id) {
  const merged = new Map();
  [...existing, ...incoming].forEach(row => {
    const key = keyOf(row);
    if (key && !/^\|?$/.test(key)) merged.set(key, row);
  });
  return [...merged.values()];
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
  if (value >= 100) return "medium";
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

function hasAnyLooseNumber(row) {
  let found = false;
  walk(row, value => {
    if (!found && Number.isFinite(numberOrNull(value))) found = true;
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

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRomeCodes(values) {
  return unique(values.map(value => {
    const match = String(value || "").toUpperCase().match(/\b[A-Z][0-9]{4}\b/);
    return match ? match[0] : "";
  }));
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

function inferFileType(url) {
  if (!url) return "not_configured";
  const cleanUrl = String(url).split("?")[0].toLowerCase();
  const extension = cleanUrl.match(/\.([a-z0-9]+)$/);
  return extension ? extension[1] : "unknown";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withoutSensitiveQuery(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (isSensitiveKey(key) || /client/i.test(key)) {
      parsed.searchParams.set(key, "[redacted]");
    }
  }
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
