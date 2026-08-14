import { describe, expect, it } from "vitest";
import { agentEventV1Schema, agentRunEnvelopeV1Schema } from "../../src/contracts/index.js";
import { buildAgentRun } from "./fixtures.js";

describe("AgentRunEnvelopeV1", () => {
  it("accepts a completed auditable run", () => {
    const result = agentRunEnvelopeV1Schema.parse(buildAgentRun());

    expect(result.status).toBe("COMPLETED");
    expect(result.dataSnapshotId).toBe("snapshot-001");
  });

  it("requires a categorized error for failed runs", () => {
    const run = {
      ...buildAgentRun(),
      status: "FAILED" as const,
      error: null,
    };

    expect(agentRunEnvelopeV1Schema.safeParse(run).success).toBe(false);
  });
});

describe("AgentEventV1", () => {
  it("accepts an idempotent tenant-scoped event", () => {
    const result = agentEventV1Schema.parse({
      schemaVersion: 1,
      eventId: "event-001",
      eventType: "PROJECT_EXECUTION_APPROVED",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      aggregateId: "report-001",
      aggregateVersion: 1,
      occurredAt: "2026-03-31T11:00:00.000Z",
      idempotencyKey: "report-001-approved-v1",
      payload: {
        dailyReportId: "report-001",
      },
    });

    expect(result.idempotencyKey).toBe("report-001-approved-v1");
  });
});
