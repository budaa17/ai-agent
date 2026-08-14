import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production proxy re-resolves the API after container replacement", async () => {
  const configuration = await readFile(new URL("../nginx.conf", import.meta.url), "utf8");

  assert.match(configuration, /resolver\s+127\.0\.0\.11\b/u);
  assert.match(configuration, /set\s+\$api_upstream\s+http:\/\/api:4180;/u);
  assert.match(configuration, /rewrite\s+\^\/api\/\(\.\*\)\$\s+\/\$1\s+break;/u);
  assert.match(configuration, /proxy_pass\s+\$api_upstream;/u);
  assert.doesNotMatch(configuration, /proxy_pass\s+http:\/\/api:4180\//u);
});

test("production responses advertise the HTTPS-only browser policy", async () => {
  const configuration = await readFile(new URL("../nginx.conf", import.meta.url), "utf8");

  assert.match(
    configuration,
    /add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"\s+always;/u,
  );
});
