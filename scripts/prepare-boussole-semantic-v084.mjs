import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readXlsxRows } from "./market-xlsx.mjs";
import {
  ACCESS_OVERRIDES,
  CAREER_DIRECTIONS,
  CAREER_DIRECTION_OVERRIDES,
  PROFESSIONAL_DOMAIN_DIRECTIONS,
  SECONDARY_DIRECTIONS,
  SEMANTIC_CONTRACT_REVISION
} from "./boussole-semantic-v084-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(ROOT, "creations/boussolepro/data/local");
const sourcePath = path.resolve(process.argv[2] || path.join(ROOT, "tmp/monde-pro/sources/rome-arborescence-principale-juin-2026.xlsx"));

async function writeJson(fileName, value) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

async function extractOfficialDomains(filePath) {
  const rows = [];
  await readXlsxRows(filePath, "xl/worksheets/sheet2.xml", cells => rows.push(cells));
  const grandDomains = [];
  const professionalDomains = [];
  for (const row of rows) {
    const letter = String(row[0] || "").trim();
    const digits = String(row[1] || "").trim();
    const jobDigits = String(row[2] || "").trim();
    const label = String(row[3] || "").trim();
    if (!/^[A-N]$/.test(letter) || !label) continue;
    if (!digits && !jobDigits) grandDomains.push({ code: letter, label });
    else if (/^\d{2}$/.test(digits) && !jobDigits) professionalDomains.push({ code: `${letter}${digits}`, grandDomainCode: letter, label });
  }
  if (grandDomains.length !== 14 || professionalDomains.length !== 110) {
    throw new Error(`Arborescence officielle inattendue: ${grandDomains.length} grands domaines, ${professionalDomains.length} domaines professionnels.`);
  }
  const source = await readFile(filePath);
  const sourceStat = await stat(filePath);
  return {
    schemaVersion: "1.0.0",
    referenceVersion: "rome-professional-domain-labels-2026-06",
    source: {
      producer: "France Travail",
      title: "Les arborescences du ROME - Arborescence principale",
      publishedVintage: "2026-06",
      retrievedAt: "2026-08-11",
      url: "https://www.data.gouv.fr/api/1/datasets/r/88342be1-06b8-4ab6-8ce9-83e117d21346",
      license: "Licence Ouverte / Open Licence",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      sourceSizeBytes: sourceStat.size
    },
    grandDomains,
    professionalDomains
  };
}

const officialDomains = await extractOfficialDomains(sourcePath);
await writeJson("career-directions.v1.json", {
  schemaVersion: "1.0.0", referenceVersion: SEMANTIC_CONTRACT_REVISION, directions: CAREER_DIRECTIONS
});
await writeJson("rome-professional-domain-directions.v1.json", {
  schemaVersion: "1.0.0", referenceVersion: SEMANTIC_CONTRACT_REVISION,
  classificationPolicy: ["rome_code_override", "rome_professional_domain", "unclassified"],
  mappings: Object.entries(PROFESSIONAL_DOMAIN_DIRECTIONS).sort(([a], [b]) => a.localeCompare(b)).map(([romeProfessionalDomainCode, primaryDirection]) => ({ romeProfessionalDomainCode, primaryDirection }))
});
await writeJson("rome-career-direction-overrides.v1.json", {
  schemaVersion: "1.0.0", referenceVersion: SEMANTIC_CONTRACT_REVISION,
  overrides: Object.entries(CAREER_DIRECTION_OVERRIDES).map(([romeCode, primaryDirection]) => ({ romeCode, primaryDirection, secondaryDirections: SECONDARY_DIRECTIONS[romeCode] || [] })),
  secondaryDirections: Object.entries(SECONDARY_DIRECTIONS).map(([romeCode, directions]) => ({ romeCode, directions }))
});
await writeJson("rome-professional-domain-labels.2026-06.json", officialDomains);
await writeJson("access-semantic-overrides.v084.json", {
  schemaVersion: "1.0.0", referenceVersion: SEMANTIC_CONTRACT_REVISION,
  policy: "Les contradictions et obligations réglementaires non résolues ne peuvent jamais produire un accès direct.",
  overrides: Object.entries(ACCESS_OVERRIDES).map(([romeCode, override]) => ({ romeCode, ...override }))
});

console.log(JSON.stringify({ status: "ok", outputDir, directions: CAREER_DIRECTIONS.length, professionalDomains: officialDomains.professionalDomains.length, overrides: Object.keys(CAREER_DIRECTION_OVERRIDES).length }, null, 2));
