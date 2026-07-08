import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SCANNED_EXTENSIONS = /\.(html|js|mjs|json|md|yml|yaml|css)$/i;
const SKIP_DIRS = new Set([".git", "node_modules", ".cache", ".next", "dist", "build"]);
const ALLOWED_PLACEHOLDERS = [
  "FT_CLIENT_SECRET",
  "client_secret",
  "access_token",
  "Bearer REDACTED",
  "access_token_REDACTED"
];
const SECRET_PATTERNS = [
  { id: "bearer-token", pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { id: "access-token-value", pattern: /access_token["']?\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']/i },
  { id: "client-secret-value", pattern: /(client_secret|FT_CLIENT_SECRET)["']?\s*[:=]\s*["'][^"']{8,}["']/i },
  { id: "env-secret-assignment", pattern: /FT_CLIENT_SECRET\s*=\s*\S{8,}/i }
];

async function main() {
  const files = (await listFiles(process.cwd())).filter(file => SCANNED_EXTENSIONS.test(file));
  const hits = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (isAllowedPlaceholder(line)) return;
      SECRET_PATTERNS.forEach(rule => {
        if (rule.pattern.test(line)) hits.push(`${file}:${index + 1}:${rule.id}`);
      });
    });
  }
  if (hits.length) {
    console.error("Secrets potentiels detectes. Les valeurs ne sont pas affichees :");
    hits.slice(0, 50).forEach(hit => console.error(hit));
    process.exit(1);
  }
  console.log(`Scan anti-secrets OK : ${files.length} fichier(s) verifies.`);
}

async function listFiles(dir, root = process.cwd()) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && ![".github", ".env.example"].includes(entry.name)) {
      if (entry.isDirectory()) continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...await listFiles(join(dir, entry.name), root));
    } else {
      files.push(join(dir, entry.name).replace(`${root}/`, ""));
    }
  }
  return files;
}

function isAllowedPlaceholder(line) {
  const trimmed = line.trim();
  if (trimmed === "FT_CLIENT_SECRET=") return true;
  return ALLOWED_PLACEHOLDERS.some(value => trimmed.includes(value)) &&
    !/(Bearer\s+[A-Za-z0-9._~+/=-]{20,}|["'][A-Za-z0-9._~+/=-]{20,}["'])/.test(trimmed);
}

main();
