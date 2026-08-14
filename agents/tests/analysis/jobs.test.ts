import type { Job, PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_ANALYSIS_QUEUE,
  enqueueProjectAnalysis,
  registerProjectAnalysisWorker,
  type ProjectAnalysisJobPayload,
} from "../../src/analysis/jobs.js";
import { analyzeProjectData } from "../../src/analysis/analyze.js";
import { buildProjectAnalysisFixture } from "./fixtures.js";

describe("project analysis pg-boss skeleton", () => {
  it("registers a worker and validates its payload", async () => {
    let handler: ((jobs: Job<ProjectAnalysisJobPayload>[]) => Promise<unknown>) | undefined;
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn(async (_name: string, registeredHandler: typeof handler) => {
      handler = registeredHandler;
      return "worker-analysis-1";
    });
    const boss = {
      createQueue,
      work,
    } as unknown as PgBoss;
    const expected = analyzeProjectData(buildProjectAnalysisFixture("project-atlas"));
    const runAnalysis = vi.fn().mockResolvedValue(expected);

    const workerId = await registerProjectAnalysisWorker(boss, runAnalysis);
    const payload = {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
    };
    const output = await handler!([{ data: payload } as Job<ProjectAnalysisJobPayload>]);

    expect(workerId).toBe("worker-analysis-1");
    expect(createQueue).toHaveBeenCalledWith(
      PROJECT_ANALYSIS_QUEUE,
      expect.objectContaining({ retryLimit: 3 }),
    );
    expect(runAnalysis).toHaveBeenCalledWith({
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
    });
    expect(output).toBe(expected);
  });

  it("creates the queue and enqueues one idempotent project job", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue("job-analysis-1");
    const boss = {
      createQueue,
      send,
    } as unknown as PgBoss;
    const payload = {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
    };

    const jobId = await enqueueProjectAnalysis(boss, payload);

    expect(jobId).toBe("job-analysis-1");
    expect(send).toHaveBeenCalledWith(PROJECT_ANALYSIS_QUEUE, payload, {
      singletonKey: "analyze-project/tenant-demo/project-atlas/sha256-FpTnjyKZxR9jqkPuSHCWS2s2",
    });
  });
});
