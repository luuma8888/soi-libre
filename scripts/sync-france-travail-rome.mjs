import { mkdir, writeFile } from "node:fs/promises";
import { buildDataQualityReport } from "./build-data-quality-report.mjs";
import { mergeRomeDatasets } from "./normalize-rome-api.mjs";

const OUT_DIR = new URL("../data/generated/", import.meta.url);

const FRANCE_TRAVAIL_ROME_ENDPOINTS = {
  metiers: process.env.FT_ROME_METIERS_URL || "",
  competences: process.env.FT_ROME_COMPETENCES_URL || "",
  contextes: process.env.FT_ROME_CONTEXTES_URL || "",
  fichesMetiers: process.env.FT_ROME_FICHES_METIERS_URL || ""
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  try {
    const token = await getFranceTravailAccessToken();
    const parts = {
      metiers: await fetchRomeMetiers(token),
      competences: await fetchRomeCompetences(token),
      contextes: await fetchRomeContextes(token),
      fichesMetiers: await fetchRomeFichesMetiers(token)
    };
    const dataset = mergeRomeDatasets(parts);
    const report = buildDataQualityReport(dataset);
    await writeGeneratedJson("jobs.rome.json", dataset.jobs);
    await writeGeneratedJson("skills.rome.json", dataset.skills);
    await writeGeneratedJson("work-contexts.rome.json", dataset.workContexts);
    await writeGeneratedJson("job-appellations.rome.json", dataset.jobAppellations || []);
    await writeGeneratedJson("mappings.rome.json", dataset.mappings || []);
    await writeGeneratedJson("data-quality-report.rome.json", report);
    await writeGeneratedJson("import-manifest.rome.json", {
      schemaVersion: "1.0.0",
      datasetName: dataset.datasetName,
      datasetVersion: dataset.datasetVersion,
      sourceDate: dataset.sourceDate,
      importedAt: dataset.importedAt,
      provenance: "generated_rome",
      sources: ["france_travail_rome_generated"],
      licenseSummary: "A verifier selon les droits d'usage France Travail IO.",
      warnings: ["mapping_to_verify", "license_to_verify"]
    });
  } catch (error) {
    await writeGeneratedJson("sync-error.json", {
      generatedAt: new Date().toISOString(),
      status: "error",
      message: error.message,
      hint: "Verifier les secrets GitHub, FT_TOKEN_URL, FT_SCOPE et les URLs ROME configurees."
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
  params.set("scope", process.env.FT_SCOPE || "api_rome-metiersv1 api_rome-competencesv1 api_rome-contextes-travailv1 api_rome-fiches-metiersv1");
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

export async function fetchRomeMetiers(token) {
  return fetchRomeEndpoint("metiers", token);
}

export async function fetchRomeCompetences(token) {
  return fetchRomeEndpoint("competences", token);
}

export async function fetchRomeContextes(token) {
  return fetchRomeEndpoint("contextes", token);
}

export async function fetchRomeFichesMetiers(token) {
  return fetchRomeEndpoint("fichesMetiers", token);
}

async function fetchRomeEndpoint(name, token) {
  const url = FRANCE_TRAVAIL_ROME_ENDPOINTS[name];
  if (!url) {
    console.warn(`Endpoint ${name} non configure. Fichier genere vide.`);
    return [];
  }
  const accessToken = token.access_token || token.token || token;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Echec endpoint ${name}: ${response.status} ${await response.text()}`);
  const json = await response.json();
  return Array.isArray(json) ? json : json.resultats || json.results || json.data || [];
}

export async function writeGeneratedJson(name, data) {
  await writeFile(new URL(name, OUT_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

main();
