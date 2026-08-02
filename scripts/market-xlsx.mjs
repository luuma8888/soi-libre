import { spawn, spawnSync } from "node:child_process";

const XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export function readXlsxSharedStrings(filePath) {
  const result = spawnSync("unzip", ["-p", filePath, "xl/sharedStrings.xml"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Lecture XLSX impossible (${filePath}) : ${result.stderr || "sharedStrings.xml absent"}`);
  }
  return [...result.stdout.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)]
    .map(match => [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(text => decodeXml(text[1]))
      .join(""));
}

export async function readXlsxRows(filePath, sheetPath, onRow) {
  const sharedStrings = readXlsxSharedStrings(filePath);
  const child = spawn("unzip", ["-p", filePath, sheetPath], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let rowIndex = 0;
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let end = buffer.indexOf("</row>");
    while (end >= 0) {
      const rowStart = buffer.lastIndexOf("<row", end);
      if (rowStart >= 0) {
        const rowXml = buffer.slice(rowStart, end + 6);
        onRow(parseXlsxRow(rowXml, sharedStrings), rowIndex);
        rowIndex += 1;
      }
      buffer = buffer.slice(end + 6);
      end = buffer.indexOf("</row>");
    }
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(`Lecture XLSX impossible (${sheetPath}) : ${stderr || `code ${exitCode}`}`);
  return rowIndex;
}

function parseXlsxRow(rowXml, sharedStrings) {
  const values = [];
  for (const match of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const reference = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] || "A";
    const index = columnIndex(reference);
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || "";
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
    let value = decodeXml(raw);
    if (type === "s" && value !== "") value = sharedStrings[Number(value)] ?? "";
    if (type === "inlineStr") {
      value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1])).join("");
    }
    while (values.length <= index) values.push("");
    values[index] = value;
  }
  return values;
}

function columnIndex(reference) {
  let index = 0;
  for (const char of reference) index = index * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

function decodeXml(value = "") {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export const XLSX_READER_INFO = Object.freeze({
  revision: "xlsx-stream-reader-v1",
  dependency: "system-unzip",
  xmlNamespace: XML_NS
});
