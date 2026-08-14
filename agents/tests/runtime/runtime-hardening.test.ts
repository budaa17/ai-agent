import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentBudgetExceededError,
  AgentCircuitOpenError,
  AgentModelTimeoutError,
  AgentOperationalMetrics,
  AgentRuntimeGuard,
  EnvironmentSecretProvider,
  FileAgentFeedbackStore,
  InMemoryUsageBudgetStore,
  PRODUCTION_SEED_ACKNOWLEDGEMENT,
  agentRunMetadataV1Schema,
  assertProductionModelPricingConfigured,
  assertProductionSeedAllowed,
  createAgentLogger,
  ensureQueueWithDeadLetter,
  evaluateAutonomyGate,
  feedbackId,
  hashAuthorizedScope,
  replayDeadLetterQueue,
  startSentryErrorReporter,
} from "../../src/runtime/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function runtimeConfig(
  overrides: Partial<ConstructorParameters<typeof AgentRuntimeGuard>[0]> = {},
) {
  return {
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
    maxRunCostMicroUsd: 100_000,
    maxTenantMonthlyCostMicroUsd: 200_000,
    inputCostMicroUsdPerMillionTokens: 1_000_000,
    outputCostMicroUsdPerMillionTokens: 2_000_000,
    timeoutMs: 1_000,
    maxRetries: 2,
    initialRetryDelayMs: 0,
    circuitFailureThreshold: 2,
    circuitCooldownMs: 60_000,
    ...overrides,
  };
}

describe("Phase 2 runtime hardening", () => {
  it("retries retryable failures within a bounded budget", async () => {
    const guard = new AgentRuntimeGuard(runtimeConfig(), new InMemoryUsageBudgetStore());
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValue({
        value: "ok",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
        },
      });
    const result = await guard.execute({
      tenantId: "tenant-demo",
      provider: "openai",
      modelId: "test-model",
      estimatedInputTokens: 100,
      requestedOutputTokens: 50,
      operation,
    });

    expect(result.value).toBe("ok");
    expect(result.retryCount).toBe(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rejects per-run and tenant-month cost overflow before calls", async () => {
    const store = new InMemoryUsageBudgetStore();
    const guard = new AgentRuntimeGuard(
      runtimeConfig({
        maxRunCostMicroUsd: 100,
      }),
      store,
    );

    await expect(
      guard.execute({
        tenantId: "tenant-demo",
        provider: "openai",
        modelId: "test-model",
        estimatedInputTokens: 1_000,
        requestedOutputTokens: 500,
        operation: async () => ({
          value: "never",
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      }),
    ).rejects.toBeInstanceOf(AgentBudgetExceededError);
  });

  it("times out abort-aware model operations", async () => {
    const guard = new AgentRuntimeGuard(
      runtimeConfig({ timeoutMs: 100, maxRetries: 0 }),
      new InMemoryUsageBudgetStore(),
    );

    await expect(
      guard.execute({
        tenantId: "tenant-demo",
        provider: "openai",
        modelId: "slow-model",
        estimatedInputTokens: 10,
        requestedOutputTokens: 10,
        operation: (signal) =>
          new Promise<{
            value: string;
            usage: { inputTokens: number; outputTokens: number };
          }>((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
            setTimeout(
              () =>
                resolve({
                  value: "late",
                  usage: { inputTokens: 1, outputTokens: 1 },
                }),
              5_000,
            );
          }),
      }),
    ).rejects.toBeInstanceOf(AgentModelTimeoutError);
  });

  it("opens a model circuit after repeated provider failures", async () => {
    const store = new InMemoryUsageBudgetStore();
    const guard = new AgentRuntimeGuard(runtimeConfig({ maxRetries: 0 }), store, {
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });
    const input = {
      tenantId: "tenant-demo",
      provider: "openai",
      modelId: "broken-model",
      estimatedInputTokens: 10,
      requestedOutputTokens: 10,
      operation: async () => {
        throw Object.assign(new Error("provider unavailable"), {
          status: 503,
        });
      },
    };

    await expect(guard.execute(input)).rejects.toThrow("provider unavailable");
    await expect(guard.execute(input)).rejects.toThrow("provider unavailable");
    await expect(guard.execute(input)).rejects.toBeInstanceOf(AgentCircuitOpenError);
    await expect(store.usedMicroUsd("tenant-demo", "2026-07")).resolves.toBe(0);
  });

  it("emits JSON logs without secrets or raw content", () => {
    const lines: string[] = [];
    const logger = createAgentLogger({
      service: "phase2-test",
      now: () => "2026-07-30T00:00:00.000Z",
      sink: (line) => lines.push(line),
    });
    logger.info("agent.started", {
      apiKey: "sk-super-secret-value",
      sourceText: "Хувийн талбайн тэмдэглэл",
      nested: {
        authorization: "Bearer abcdefghijklmnop",
      },
    });
    const line = lines[0]!;

    expect(() => JSON.parse(line)).not.toThrow();
    expect(line).not.toContain("sk-super-secret-value");
    expect(line).not.toContain("Хувийн талбайн тэмдэглэл");
    expect(line).not.toContain("abcdefghijklmnop");
    expect(line).toContain("[REDACTED_SECRET]");
    expect(line).toContain("[CONTENT_LOGGING_DISABLED]");
  });

  it("captures structured feedback and keeps autonomy default-off", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-feedback-"));
    temporaryDirectories.push(directory);
    const store = new FileAgentFeedbackStore(directory);
    const reviewedAt = "2026-07-30T00:00:00.000Z";
    const record = {
      schemaVersion: 1 as const,
      feedbackId: feedbackId({
        agentType: "A1",
        artifactId: "draft-001",
        reviewerId: "manager-001",
        reviewedAt,
      }),
      agentType: "A1" as const,
      feedbackType: "FIELD_EDIT" as const,
      tenantId: "tenant-demo",
      projectId: "project-demo",
      artifactId: "draft-001",
      fieldPath: "progressEntries.0.progressPercent",
      beforeValue: 60,
      afterValue: 55,
      reason: "Талбайн хэмжилтээр залруулав.",
      category: "GROUNDING" as const,
      reviewerId: "manager-001",
      reviewedAt,
      promptVersion: "a1-v1",
      modelVersion: "model-v1",
      toolBundleVersion: "tools-v1",
      dataSnapshotVersion: "snapshot-v1",
      regressionStatus: "CANDIDATE" as const,
    };

    expect(await store.save(record)).toEqual(record);
    expect(await store.save(record)).toEqual(record);
    expect(await store.list()).toHaveLength(1);
    expect(
      evaluateAutonomyGate({
        goldenAccuracy: 1,
        productionAccuracy: 1,
        productionObservationWeeks: 8,
        humanEditRate: 0,
        humanEditObservationWeeks: 8,
        falseAlertRate: 0,
      }),
    ).toMatchObject({
      L1_CLASSIFICATION_METRICS_ALERT_DRAFT: true,
      L2_LOW_RISK_NORMALIZATION: false,
      L3_INTERNAL_REPORT_AUTO_SEND: false,
      L4_ROUTINE_NOTIFICATION_AUTO_SEND: false,
      SCHEDULE_CONTRACT_FINANCE_EXTERNAL_ACTION: false,
    });
  });

  it("validates complete run metadata and hashes authorization scope", () => {
    const metadata = agentRunMetadataV1Schema.parse({
      schemaVersion: 1,
      runId: "run-001",
      agentType: "A4",
      tenantId: "tenant-demo",
      projectId: "project-demo",
      trigger: "REQUEST",
      requestId: "request-001",
      eventId: null,
      promptVersion: "a4-v1",
      toolBundleVersion: "production-read-v1",
      outputSchemaVersion: 1,
      provider: null,
      modelId: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimatedCostMicroUsd: 0,
        actualCostMicroUsd: 0,
      },
      latencyMs: 20,
      retryCount: 0,
      status: "COMPLETED",
      failureCategory: "NONE",
      traceId: "trace-001",
      dataSnapshotVersion: "snapshot-v1",
      outputSha256: "a".repeat(64),
      startedAt: "2026-07-30T00:00:00.000Z",
      completedAt: "2026-07-30T00:00:00.020Z",
      contentLoggingEnabled: false,
    });
    const hash = hashAuthorizedScope({
      principalId: "manager-001",
      tenantId: "tenant-demo",
      projectIds: ["project-b", "project-a"],
      permissions: ["AGENT_READ"],
    });

    expect(metadata.status).toBe("COMPLETED");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("supports optional Sentry and in-memory operational metrics", async () => {
    const reporter = startSentryErrorReporter({});
    const metrics = new AgentOperationalMetrics();
    metrics.increment("agent_run_success_total");
    metrics.observe("agent_latency_ms", 20);
    metrics.observe("agent_latency_ms", 40);

    expect(reporter.enabled).toBe(false);
    expect(await reporter.flush()).toBe(true);
    expect(metrics.snapshot()).toEqual({
      counters: { agent_run_success_total: 1 },
      observations: {
        agent_latency_ms: {
          count: 2,
          average: 30,
          max: 40,
        },
      },
    });
  });

  it("creates dead-letter queues and supports replay", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const redrive = vi.fn().mockResolvedValue(3);
    const boss = {
      createQueue,
      redrive,
    } as unknown as PgBoss;
    const deadLetter = await ensureQueueWithDeadLetter(boss, "a2-observe-project", {
      concurrency: 2,
      retryLimit: 3,
      retryDelaySeconds: 30,
      heartbeatSeconds: 60,
    });
    const replayed = await replayDeadLetterQueue(boss, "a2-observe-project");

    expect(deadLetter).toBe("a2-observe-project-dead-letter");
    expect(createQueue).toHaveBeenCalledTimes(2);
    expect(replayed).toBe(3);
    expect(redrive).toHaveBeenCalledWith("a2-observe-project-dead-letter", {
      destination: "a2-observe-project",
    });
  });

  it("allows only explicitly listed environment secrets", async () => {
    const provider = new EnvironmentSecretProvider(["OPENAI_API_KEY"], {
      OPENAI_API_KEY: "secret-value",
      OTHER_SECRET: "forbidden",
    });

    await expect(provider.get("OPENAI_API_KEY")).resolves.toBe("secret-value");
    await expect(provider.get("OTHER_SECRET")).rejects.toThrow("allow-list");
  });

  it("blocks accidental demo seeding in production", () => {
    expect(() => assertProductionSeedAllowed({ NODE_ENV: "production" })).toThrow(
      "Production seed is blocked",
    );
    expect(() =>
      assertProductionSeedAllowed({
        NODE_ENV: "production",
        ALLOW_PRODUCTION_SEED: PRODUCTION_SEED_ACKNOWLEDGEMENT,
      }),
    ).not.toThrow();
    expect(() => assertProductionSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
  });

  it("requires nonzero model pricing only in production", () => {
    expect(() =>
      assertProductionModelPricingConfigured(
        { NODE_ENV: "production" },
        runtimeConfig({
          inputCostMicroUsdPerMillionTokens: 0,
          outputCostMicroUsdPerMillionTokens: 0,
        }),
      ),
    ).toThrow("Production model pricing is required");
    expect(() =>
      assertProductionModelPricingConfigured(
        { NODE_ENV: "development" },
        runtimeConfig({
          inputCostMicroUsdPerMillionTokens: 0,
          outputCostMicroUsdPerMillionTokens: 0,
        }),
      ),
    ).not.toThrow();
  });
});
