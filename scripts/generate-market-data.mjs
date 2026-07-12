import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join("creations", "boussolepro", "data", "generated", "market");
const now = new Date().toISOString();

const dryRun = String(process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const territoriesInput = process.env.TERRITORY || "occitanie,aude,france";
const sourcesInput = process.env.SOURCE || "api_marche_travail,bmo";
const territories = territoriesInput.split(",").map(item => item.trim()).filter(Boolean);
const requestedSources = sourcesInput.split(",").map(item => item.trim()).filter(Boolean);

const territoryRows = [
  { id: "FR", type: "country", code: "FR", label: "France entière", sourceLevel: "national" },
  { id: "REG-76", type: "region", code: "76", label: "Occitanie", country: "FR", sourceLevel: "regional" },
  { id: "DEP-11", type: "department", code: "11", label: "Aude", country: "FR", regionCode: "76", regionName: "Occitanie", sourceLevel: "departmental" }
];

const report = {
  schemaVersion: "1.0.0",
  generatedAt: now,
  generator: "scripts/generate-market-data.mjs",
  status: dryRun ? "not_connected_dry_run" : "not_connected",
  requestedSources,
  requestedTerritories: territories,
  sourceStatus: requestedSources.map(source => ({
    source,
    status: "not_connected",
    reason: "Endpoint, accès ou mapping non configuré dans cette version.",
    nextStep: source === "bmo"
      ? "Ajouter une source BMO/FAP2021 et une table de rapprochement FAP -> ROME avec confiance."
      : "Ajouter un connecteur GitHub Actions vers une API de statistiques marché agrégées."
  })),
  coverage: {
    jobsWithNationalMarket: 0,
    jobsWithRegionalMarket: 0,
    jobsWithDepartmentalMarket: 0,
    jobsWithBmo: 0,
    jobsWithoutMarket: null
  },
  warnings: [
    "Aucune statistique officielle marché n’est générée par ce dry-run.",
    "Boussole Pro conserve ses signaux locaux estimatifs embarqués et les signale comme tels.",
    "Ne pas utiliser ce rapport comme preuve de tension ou de volume de recrutement."
  ]
};

const manifest = {
  schemaVersion: "1.0.0",
  datasetName: "Boussole Pro - couche marché v0.6",
  datasetVersion: `market-v0.6-${now.slice(0, 10)}`,
  generatedAt: now,
  status: report.status,
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
    officialStatsConnected: false,
    fapRomeMappingsRequireConfidence: true
  }
};

await mkdir(OUTPUT_DIR, { recursive: true });

const writeJson = async (filename, value) => {
  await writeFile(path.join(OUTPUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

await writeJson("territories.json", territoryRows);
await writeJson("market-national.rome.json", []);
await writeJson("market-occitanie.rome.json", []);
await writeJson("market-aude.rome.json", []);
await writeJson("bmo-fap2021.json", []);
await writeJson("fap-rome-mappings.json", []);
await writeJson("market-quality-report.json", report);
await writeJson("market-import-manifest.json", manifest);

console.log(`Market data dry-run written to ${OUTPUT_DIR}`);
console.log(`Sources requested: ${requestedSources.join(", ") || "none"}`);
console.log(`Territories requested: ${territories.join(", ") || "none"}`);
