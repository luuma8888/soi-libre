const [url, expectedBuildId] = process.argv.slice(2);

if (!url || !expectedBuildId) {
  console.error("Usage: node scripts/verify-boussole-deployment.mjs <URL_PUBLIQUE> <BUILD_ID_ATTENDU>");
  process.exit(2);
}

const checkedAt = new Date().toISOString();

try {
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: { "user-agent": "Boussole-Pro-Build-Verifier/1.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const html = await response.text();
  const receivedBuildId = html.match(/buildId:\s*["']([^"']+)["']/)?.[1] || null;
  const verdict = receivedBuildId === expectedBuildId ? "match" : receivedBuildId ? "mismatch" : "marker_missing";
  console.log(JSON.stringify({
    expected: expectedBuildId,
    received: receivedBuildId,
    requestedUrl: url,
    finalUrl: response.url,
    checkedAt,
    cacheControl: response.headers.get("cache-control"),
    etag: response.headers.get("etag"),
    verdict
  }, null, 2));
  if (verdict !== "match") process.exit(1);
} catch (error) {
  console.error(JSON.stringify({
    expected: expectedBuildId,
    received: null,
    requestedUrl: url,
    finalUrl: null,
    checkedAt,
    verdict: "request_failed",
    error: error.message
  }, null, 2));
  process.exit(1);
}
