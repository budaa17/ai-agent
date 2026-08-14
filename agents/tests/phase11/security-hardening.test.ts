import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Phase11FixedWindowRateLimiter,
  phase11TelemetryTag,
  phase11TokenMatches,
  renderPhase11PrometheusMetrics,
} from "../../src/backend/index.js";

describe("BuildWatch Phase 11 API security primitives", () => {
  it("gives the non-root Chromium user bounded writable state", async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const compose = await readFile(join(repositoryRoot, "docker-compose.production.yml"), "utf8");

    expect(compose).toContain("/home/node/.cache:size=256m,mode=0700,uid=1000,gid=1000");
    expect(compose).toContain("/home/node/.config:size=64m,mode=0700,uid=1000,gid=1000");
  });

  it("keeps browser and PostgreSQL client packages outside source-dependent layers", async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const dockerfile = await readFile(join(repositoryRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM runtime-system AS runtime-browser-system");
    expect(dockerfile).toContain("FROM runtime-browser-system AS runtime-base");
    expect(dockerfile).toContain("FROM runtime-system AS operations-system");
    expect(dockerfile).toContain("FROM operations-system AS operations");
    expect(dockerfile).toContain("COPY --from=runtime-core --chown=node:node /app /app");
    expect(dockerfile).not.toContain("FROM runtime-core AS operations");
  });

  it("rate-limits by fixed window and resets deterministically", () => {
    let now = 1_000;
    const limiter = new Phase11FixedWindowRateLimiter({
      windowMs: 1_000,
      maxRequests: 2,
      now: () => now,
    });

    expect(limiter.consume("client")).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("client")).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("client")).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });

    now = 2_001;
    expect(limiter.consume("client")).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("compares monitoring tokens without exposing plaintext", () => {
    const expected = "m".repeat(64);
    expect(phase11TokenMatches(expected, expected)).toBe(true);
    expect(phase11TokenMatches("wrong", expected)).toBe(false);
    expect(phase11TokenMatches(undefined, expected)).toBe(false);
    expect(phase11TelemetryTag("tenant-secret-value")).toMatch(/^[a-f0-9]{16}$/u);
    expect(phase11TelemetryTag("tenant-secret-value")).not.toContain("tenant-secret-value");
  });

  it("renders bounded Prometheus names and numeric values", () => {
    const output = renderPhase11PrometheusMetrics(
      {
        counters: { "http.requests": 3 },
        observations: {
          "http.duration-ms": { count: 2, average: 12.5, max: 20 },
        },
      },
      { "outbox.pending": 4 },
    );

    expect(output).toContain("buildwatch_http_requests 3");
    expect(output).toContain("buildwatch_http_duration_ms_count 2");
    expect(output).toContain("buildwatch_outbox_pending 4");
    expect(output.endsWith("\n")).toBe(true);
  });
});
