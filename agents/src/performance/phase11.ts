import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cpus } from "node:os";
import { BuiltInArtifactMalwareScanner } from "../artifacts/malware.js";
import { runPhase7GoldenPipeline } from "../baseline-generation/pipeline.js";
import { createPhase9Api, type Phase9ApiServices } from "../backend/api.js";
import { buildVectorArchitecturalPdfFixture } from "../design-intake/fixtures.js";
import { inspectPdfDocument } from "../design-intake/pdf-inspection.js";
import { evaluateOperationalForecast } from "../forecasting/operational-forecast-evaluation.js";
import {
  A5_PLANNING_EVALUATION_SCENARIOS,
  buildA5SimulationRequest,
  evaluateA5Planning,
  generateA5DailyPlan,
} from "../planning/index.js";
import {
  buildBuildWatchOperationalSimulation,
  operationalSimulationCounts,
} from "../simulation/index.js";

export type Phase11PerformanceCase = {
  id:
    | "api-p95"
    | "planning-50"
    | "pdf-20-pages"
    | "quantity-baseline"
    | "dashboard-payload"
    | "nightly-batch"
    | "artifact-25mb-scan";
  targetP95Ms: number;
  measuredP95Ms: number;
  sampleCount: number;
  passed: boolean;
  evidence: string;
};

export type Phase11PerformanceReport = {
  schemaVersion: 1;
  suite: "BUILDWATCH_V22_PHASE11_PERFORMANCE";
  generatedAt: string;
  environment: {
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
    logicalCpuCount: number;
  };
  passed: boolean;
  cases: Phase11PerformanceCase[];
};

export const phase11PerformanceTargets = {
  apiP95Ms: 250,
  planning50P95Ms: 500,
  pdf20PagesP95Ms: 5_000,
  quantityBaselineP95Ms: 1_000,
  dashboardPayloadP95Ms: 500,
  nightlyBatchP95Ms: 30_000,
  artifact25MbScanP95Ms: 3_000,
} as const;

export function percentile95(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot calculate p95 without samples");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function measure(
  operation: () => void | Promise<void>,
  options: { samples: number; warmups?: number },
): Promise<{ p95Ms: number; durationsMs: number[] }> {
  for (let index = 0; index < (options.warmups ?? 1); index += 1) {
    await operation();
  }
  const durationsMs: number[] = [];
  for (let index = 0; index < options.samples; index += 1) {
    const startedAt = performance.now();
    await operation();
    durationsMs.push(performance.now() - startedAt);
  }
  return { p95Ms: percentile95(durationsMs), durationsMs };
}

function resultCase(
  id: Phase11PerformanceCase["id"],
  targetP95Ms: number,
  measurement: { p95Ms: number; durationsMs: number[] },
  evidence: string,
): Phase11PerformanceCase {
  const measuredP95Ms = Number(measurement.p95Ms.toFixed(3));
  return {
    id,
    targetP95Ms,
    measuredP95Ms,
    sampleCount: measurement.durationsMs.length,
    passed: measuredP95Ms <= targetP95Ms,
    evidence,
  };
}

async function benchmarkApi(): Promise<Phase11PerformanceCase> {
  const app = createPhase9Api({} as Phase9ApiServices, {
    nodeEnv: "test",
    apiRateLimitMaxRequests: 10_000,
  });
  const server = createServer(app);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/health/live`;
    const measurement = await measure(
      async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API benchmark returned ${response.status}`);
        await response.arrayBuffer();
      },
      { samples: 40, warmups: 5 },
    );
    return resultCase(
      "api-p95",
      phase11PerformanceTargets.apiP95Ms,
      measurement,
      "40 local HTTP requests through the production Express middleware stack",
    );
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

export async function evaluatePhase11Performance(): Promise<Phase11PerformanceReport> {
  const simulation = buildBuildWatchOperationalSimulation();
  const healthyCase = simulation.answerKey.cases.find(
    (candidate) =>
      candidate.scenario === "HEALTHY_CONTROL" &&
      new Set<string>(A5_PLANNING_EVALUATION_SCENARIOS).has(candidate.scenario),
  );
  if (healthyCase === undefined) throw new Error("Healthy planning fixture is missing");
  const planningRequest = buildA5SimulationRequest(simulation, healthyCase, "AUTO");
  const template = planningRequest.operationalSnapshot.workItems.at(-1);
  if (template === undefined) throw new Error("Planning fixture has no work items");
  const clones = [49, 50].map((number) => ({
    ...template,
    workItemId: `phase11-benchmark-work-item-${number}`,
    activityId: `phase11-benchmark-activity-${number}`,
    code: `P11-${number}`,
    predecessorWorkItemIds: [],
    requiredInspectionIds: [],
    safetyRestrictions: [],
  }));
  const request50 = {
    ...planningRequest,
    requestId: "phase11-planning-50",
    idempotencyKey: "phase11-planning-50",
    operationalSnapshot: {
      ...planningRequest.operationalSnapshot,
      workItems: [...planningRequest.operationalSnapshot.workItems, ...clones],
    },
  };
  const planning = await measure(
    () => {
      const result = generateA5DailyPlan(request50);
      if (result.decisions.length !== 50) {
        throw new Error(`Planning benchmark returned ${result.decisions.length} decisions`);
      }
    },
    { samples: 10, warmups: 2 },
  );

  const pdf = buildVectorArchitecturalPdfFixture({ pages: 20 });
  const pdfParsing = await measure(
    async () => {
      const document = await inspectPdfDocument(pdf, { maxPages: 20 });
      if (document.pageCount !== 20) throw new Error("PDF benchmark lost pages");
    },
    { samples: 3, warmups: 1 },
  );

  const quantity = await measure(
    () => {
      const pipeline = runPhase7GoldenPipeline();
      if (pipeline.baselineCommand.approvedVersion.status !== "APPROVED") {
        throw new Error("Quantity/baseline benchmark did not approve the baseline");
      }
    },
    { samples: 10, warmups: 2 },
  );

  const dashboard = await measure(
    () => {
      const counts = operationalSimulationCounts(simulation);
      const payload = JSON.stringify({
        counts,
        latestPlan: simulation.agentDataset.dailyPlans.at(-1),
        latestForecast: simulation.agentDataset.rollingForecasts.at(-1),
        openVerifications: simulation.agentDataset.verificationDrafts.slice(-20),
      });
      if (Buffer.byteLength(payload) < 1_000) {
        throw new Error("Dashboard benchmark payload is unexpectedly empty");
      }
    },
    { samples: 25, warmups: 3 },
  );

  const nightly = await measure(
    () => {
      const planningEvaluation = evaluateA5Planning(simulation);
      const forecastEvaluation = evaluateOperationalForecast();
      if (!planningEvaluation.pass || !forecastEvaluation.pass) {
        throw new Error("Nightly deterministic evaluation failed correctness checks");
      }
    },
    { samples: 3, warmups: 1 },
  );

  const artifactBody = Buffer.alloc(25 * 1024 * 1024, 0x41);
  const artifactSha256 = createHash("sha256").update(artifactBody).digest("hex");
  const scanner = new BuiltInArtifactMalwareScanner();
  const artifact = await measure(
    async () => {
      const result = await scanner.scan({
        data: artifactBody,
        sha256: artifactSha256,
        mediaType: "application/octet-stream",
        fileName: "phase11-max-size.bin",
      });
      if (result.status !== "CLEAN") throw new Error("Max-size artifact scan failed");
    },
    { samples: 5, warmups: 1 },
  );

  const cases = [
    await benchmarkApi(),
    resultCase(
      "planning-50",
      phase11PerformanceTargets.planning50P95Ms,
      planning,
      "50 deterministic A5 work-item decisions",
    ),
    resultCase(
      "pdf-20-pages",
      phase11PerformanceTargets.pdf20PagesP95Ms,
      pdfParsing,
      "20-page vector architectural PDF parsed with eval disabled",
    ),
    resultCase(
      "quantity-baseline",
      phase11PerformanceTargets.quantityBaselineP95Ms,
      quantity,
      "Quantity → material/cost → schedule → approved baseline pipeline",
    ),
    resultCase(
      "dashboard-payload",
      phase11PerformanceTargets.dashboardPayloadP95Ms,
      dashboard,
      "Canonical latest plan/forecast/verification dashboard payload assembly",
    ),
    resultCase(
      "nightly-batch",
      phase11PerformanceTargets.nightlyBatchP95Ms,
      nightly,
      "A5 planning and rolling-forecast correctness evaluation batch",
    ),
    resultCase(
      "artifact-25mb-scan",
      phase11PerformanceTargets.artifact25MbScanP95Ms,
      artifact,
      "Configured 25 MB artifact limit scanned and checksum-verified",
    ),
  ];
  return {
    schemaVersion: 1,
    suite: "BUILDWATCH_V22_PHASE11_PERFORMANCE",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
    },
    passed: cases.every((currentCase) => currentCase.passed),
    cases,
  };
}

export function renderPhase11PerformanceMarkdown(report: Phase11PerformanceReport): string {
  return [
    "# BuildWatch v2.2 Phase 11 Performance",
    "",
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Generated: ${report.generatedAt}`,
    `- Runtime: ${report.environment.node} / ${report.environment.platform} ${report.environment.architecture}`,
    "",
    "| Case | p95 ms | Target ms | Samples | Result |",
    "|---|---:|---:|---:|---|",
    ...report.cases.map(
      (currentCase) =>
        `| ${currentCase.id} | ${currentCase.measuredP95Ms} | ${currentCase.targetP95Ms} | ${currentCase.sampleCount} | ${currentCase.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
    "Machine-local results are a technical regression gate. The full release also requires a deployed load test under the production topology.",
    "",
  ].join("\n");
}
