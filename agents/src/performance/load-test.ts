import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import autocannon, { type Result } from "autocannon";
import { prisma } from "../prisma.js";
import { createPhase9ProductionRuntime, resolvePhase9BackendConfig } from "../backend/index.js";

/**
 * Concurrent-load counterpart to the single-request-at-a-time
 * `evaluatePhase11Performance` "api-p95" case (src/performance/phase11.ts).
 * Boots the real production Express/Prisma runtime against the local dev
 * Postgres instance and drives it with genuine concurrent connections via
 * autocannon, instead of one request awaited after another.
 *
 * This is still a single-machine/localhost measurement -- no real network
 * latency, no managed/remote database, no multiple instances -- so it
 * upgrades NFR-05 from NOT_STARTED to PARTIAL, not to DONE. See
 * docs/local-load-test-results.md for the full caveat and results.
 */

interface EndpointCase {
  id: string;
  path: string;
  description: string;
}

const ENDPOINTS: EndpointCase[] = [
  {
    id: "health-live",
    path: "/health/live",
    description: "Liveness probe: full Express middleware stack, no DB round trip",
  },
  {
    id: "health-ready",
    path: "/health/ready",
    description: "Readiness probe: middleware stack + a real `SELECT 1` DB round trip",
  },
  {
    id: "openapi-json",
    path: "/openapi.json",
    description: "Static-ish JSON payload assembly and serialization under load",
  },
];

function summarize(result: Result) {
  return {
    requests: result.requests.total,
    durationSec: result.duration,
    throughputReqPerSec: Math.round(result.requests.average),
    latencyMs: {
      p50: result.latency.p50,
      p95: result.latency.p97_5 ?? result.latency.p99,
      p99: result.latency.p99,
      max: result.latency.max,
    },
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
  };
}

async function main(): Promise<void> {
  const connections = Number(process.env.LOADTEST_CONNECTIONS ?? "50");
  const durationSec = Number(process.env.LOADTEST_DURATION_SEC ?? "15");

  const runtime = createPhase9ProductionRuntime(
    prisma,
    resolvePhase9BackendConfig({
      NODE_ENV: "test",
      PHASE9_API_HOST: "127.0.0.1",
      PHASE9_API_PORT: "4180",
      PHASE9_PUBLIC_BASE_URL: "http://127.0.0.1:4180",
      PHASE9_JWT_SECRET: "phase11-loadtest-jwt-secret-do-not-use-in-prod-001",
      PHASE9_CURSOR_SECRET: "phase11-loadtest-cursor-secret-do-not-use-001",
      PHASE9_ARTIFACT_SIGNING_SECRET: "phase11-loadtest-artifact-secret-do-not-use-001",
      PHASE9_EMAIL_VERIFICATION_SECRET: "phase11-loadtest-email-verification-secret-do-not-use-001",
      PHASE9_ARTIFACT_ROOT: "data/artifacts",
      // A concurrent test intentionally exceeds the small dev rate limit
      // (100_000 is the schema's allowed maximum).
      PHASE11_API_RATE_LIMIT_MAX: "100000",
    }),
  );
  const server = createServer(runtime.app);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.stdout.write(
    `Load test target: ${baseUrl} (connections=${connections}, duration=${durationSec}s per endpoint)\n`,
  );

  const results: Array<EndpointCase & { result: ReturnType<typeof summarize> }> = [];
  try {
    for (const endpoint of ENDPOINTS) {
      process.stdout.write(`Running ${endpoint.id} (${endpoint.path})...\n`);
      const result = await autocannon({
        url: `${baseUrl}${endpoint.path}`,
        connections,
        duration: durationSec,
      });
      results.push({ ...endpoint, result: summarize(result) });
    }
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await prisma.$disconnect();
  }

  const report = {
    schemaVersion: 1,
    suite: "BUILDWATCH_V22_LOCAL_CONCURRENT_LOAD_TEST",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    connections,
    durationSecPerEndpoint: durationSec,
    cases: results,
  };

  const outputPath = resolve(process.cwd(), "data/evaluations/buildwatch-v22-local-load-test.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`\nReport written to ${outputPath}\n\n`);
  for (const entry of results) {
    process.stdout.write(
      `${entry.id}: ${entry.result.throughputReqPerSec} req/s, p50=${entry.result.latencyMs.p50}ms p95=${entry.result.latencyMs.p95}ms p99=${entry.result.latencyMs.p99}ms errors=${entry.result.errors} non2xx=${entry.result.non2xx}\n`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Load test failed: ${message}\n`);
  process.exitCode = 1;
});
