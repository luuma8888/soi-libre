import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRomeMetiersUniverse, getFranceTravailAccessToken } from "./sync-france-travail-rome.mjs";

const DEFAULT_OUTPUT = "creations/boussolepro/data/local/rome-universe-official.json";

export async function main() {
  const endpoint = process.env.FT_ROME_METIERS_URL || "";
  const scope = process.env.FT_SCOPE_METIERS || process.env.FT_SCOPE;
  const token = await getFranceTravailAccessToken(scope);
  const rows = await fetchRomeMetiersUniverse(token, endpoint);
  const records = uniqueByCode(rows.map(normalizeUniverseRow).filter(Boolean));
  if (records.length < 800) throw new Error(`Univers ROME insuffisant : ${records.length} codes valides reçus (800 minimum).`);

  const outputPath = resolveRepositoryPath(process.env.ROME_UNIVERSE_OUTPUT || DEFAULT_OUTPUT);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    source: "france_travail_rome_metiers_api",
    sourceEndpointConfigured: Boolean(endpoint),
    fetchedAt: new Date().toISOString(),
    recordsCount: records.length,
    records
  }, null, 2)}\n`, "utf8");
  console.log(`[Boussole Pro] Univers ROME officiel : ${records.length} codes écrits dans ${path.relative(process.cwd(), outputPath)}.`);
}

export function normalizeUniverseRow(row = {}) {
  const romeCode = String(row.romeCode || row.codeRome || row.code || row.id || "").trim().toUpperCase();
  if (!/^[A-Z][0-9]{4}$/.test(romeCode)) return null;
  const title = String(row.title || row.libelle || row.intitule || row.label || row.nom || "").trim();
  return {
    romeCode,
    title: title || `Métier ROME ${romeCode}`,
    domainLetter: romeCode[0],
    familyPrefix: romeCode.slice(0, 3),
    validitySource: "france_travail_rome_metiers_api"
  };
}

function uniqueByCode(rows) {
  return [...new Map(rows.sort((a, b) => a.romeCode.localeCompare(b.romeCode)).map(row => [row.romeCode, row])).values()];
}

function resolveRepositoryPath(relativePath) {
  const root = path.resolve(process.cwd());
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Le fichier d'univers ROME doit rester dans le dépôt.");
  return resolved;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
