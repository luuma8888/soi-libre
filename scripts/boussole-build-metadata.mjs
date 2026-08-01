import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const BOUSSOLE_HTML_PATH = path.join("creations", "boussolepro", "boussole-pro.html");

export async function readBoussoleBuildMetadata(htmlPath = BOUSSOLE_HTML_PATH) {
  const html = await readFile(htmlPath, "utf8");
  const readString = key => html.match(new RegExp(`${key}:\\s*["']([^"']+)["']`))?.[1] || null;
  const metadata = {
    appVersion: readString("appVersion"),
    buildId: readString("buildId"),
    buildDate: readString("buildDate"),
    datasetVersion: readString("defaultDatasetVersion"),
    sourceArtifactSha256: createHash("sha256").update(html).digest("hex")
  };
  if (!metadata.appVersion || !metadata.buildId || !metadata.buildDate) {
    throw new Error(`Marqueur BUILD_INFO incomplet dans ${htmlPath}.`);
  }
  return metadata;
}

export function attachBuildMetadata(report = {}, metadata = {}) {
  return {
    ...report,
    appVersion: metadata.appVersion,
    buildId: metadata.buildId,
    buildDate: metadata.buildDate,
    datasetVersion: report.datasetVersion || metadata.datasetVersion,
    sourceArtifactSha256: metadata.sourceArtifactSha256
  };
}
