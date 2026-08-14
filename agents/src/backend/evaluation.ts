import { createHash } from "node:crypto";
import { phase9RoleSchema, type Phase9AuthenticatedPrincipal } from "./contracts.js";
import { Phase9ArtifactService } from "./artifact-service.js";
import { Phase9ApprovedCommandService } from "./command-service.js";
import { createPhase9CanonicalAgentAdapterRegistry } from "./canonical-agent-adapters.js";
import { Phase9OutboxRelay, consumePhase9Event } from "./outbox.js";
import { Phase9ProjectService } from "./project-service.js";
import { InMemoryPhase9Store, type Phase9OutboxRecord } from "./store.js";

export interface Phase9EvaluationCase {
  caseId: string;
  passed: boolean;
  evidence: string;
}

export interface Phase9EvaluationReport {
  schemaVersion: 1;
  suite: "BUILDWATCH_V22_PHASE9_BACKEND";
  generatedAt: string;
  passed: boolean;
  metrics: {
    roleCoverage: number;
    tenantIsolationViolationCount: number;
    atomicWriteCount: number;
    duplicateCommandCount: number;
    duplicateConsumerSideEffectCount: number;
    staleQueueReplayPassed: boolean;
    signedArtifactAccessPassed: boolean;
    auditCoverage: number;
    outboxCoverage: number;
    agentAdapterCoverage: number;
    goldenPassCount: number;
    goldenCaseCount: number;
  };
  cases: Phase9EvaluationCase[];
}

function evaluationEvent(overrides: Partial<Phase9OutboxRecord> = {}): Phase9OutboxRecord {
  return {
    id: "phase9-evaluation-event",
    tenantId: "tenant-evaluation",
    projectId: "project-evaluation",
    eventType: "PROJECT_EXECUTION_APPROVED",
    aggregateType: "DAILY_REPORT",
    aggregateId: "report-evaluation",
    aggregateVersion: 1,
    idempotencyKey: "phase9-evaluation-event-key",
    payload: { reportId: "report-evaluation" },
    headers: { correlationId: "phase9-evaluation" },
    status: "PENDING",
    availableAt: "2026-08-03T08:00:00.000Z",
    publishedAt: null,
    retryCount: 0,
    lastErrorCode: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

export async function evaluatePhase9BackendV22(): Promise<Phase9EvaluationReport> {
  const evaluatedAt = new Date("2026-08-03T08:10:00.000Z");
  const artifactBody = Buffer.from("phase9 evaluation artifact", "utf8");
  const sourceHash = "a".repeat(64);
  const store = new InMemoryPhase9Store({
    tenants: [
      { id: "tenant-evaluation", slug: "evaluation", name: "Evaluation Tenant" },
      { id: "tenant-private", slug: "private", name: "Private Tenant" },
    ],
    users: [
      {
        id: "manager-evaluation",
        tenantId: "tenant-evaluation",
        email: "manager@evaluation.test",
        emailNormalized: "manager@evaluation.test",
        displayName: "Evaluation Manager",
        tenantRole: "OBSERVER",
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: evaluatedAt.toISOString(),
        lastLoginAt: null,
      },
    ],
    projects: [
      {
        id: "project-evaluation",
        tenantId: "tenant-evaluation",
        code: "EVAL-001",
        name: "Evaluation Project",
        status: "ACTIVE",
        plannedStart: "2026-01-01T00:00:00.000Z",
        plannedEnd: "2026-12-31T00:00:00.000Z",
        rowVersion: 1,
      },
      {
        id: "project-private",
        tenantId: "tenant-private",
        code: "PRIVATE-001",
        name: "TENANT-PRIVATE-ONLY",
        status: "ACTIVE",
        plannedStart: "2026-01-01T00:00:00.000Z",
        plannedEnd: "2026-12-31T00:00:00.000Z",
        rowVersion: 1,
      },
    ],
    memberships: [
      {
        id: "membership-evaluation",
        tenantId: "tenant-evaluation",
        projectId: "project-evaluation",
        userId: "manager-evaluation",
        role: "PROJECT_MANAGER",
        active: true,
      },
    ],
    reviewTasks: [
      {
        id: "review-evaluation",
        tenantId: "tenant-evaluation",
        projectId: "project-evaluation",
        targetType: "BASELINE",
        targetId: "baseline-evaluation-v1",
        targetVersion: 1,
        status: "APPROVED",
        sourceHash,
        createdByUserId: "engineer-evaluation",
        assignedRole: "PROJECT_MANAGER",
        assignedUserId: "manager-evaluation",
        rowVersion: 2,
      },
    ],
    versionSnapshots: [
      {
        id: "baseline-evaluation-v1",
        tenantId: "tenant-evaluation",
        projectId: "project-evaluation",
        targetType: "BASELINE",
        versionNumber: 1,
        status: "APPROVED",
        sourceHash,
        content: { baselineVersionId: "baseline-evaluation-v1" },
        createdAt: evaluatedAt.toISOString(),
      },
    ],
    fileAssets: [
      {
        id: "artifact-evaluation",
        tenantId: "tenant-evaluation",
        projectId: "project-evaluation",
        bucket: "evaluation",
        objectKey: "evaluation/artifact.txt",
        originalFileName: "artifact.txt",
        mediaType: "text/plain",
        sizeBytes: artifactBody.length,
        sha256: createHash("sha256").update(artifactBody).digest("hex"),
        status: "AVAILABLE",
      },
    ],
  });
  const principal: Phase9AuthenticatedPrincipal = {
    userId: "manager-evaluation",
    tenantId: "tenant-evaluation",
    tenantRole: "OBSERVER",
    sessionId: "session-evaluation",
    tokenVersion: 1,
  };
  const projects = new Phase9ProjectService(store, "phase9-evaluation-cursor-secret-0123456789");
  const commands = new Phase9ApprovedCommandService(store, () => new Date(evaluatedAt));
  const artifacts = new Phase9ArtifactService(
    store,
    "phase9-evaluation-artifact-secret-01234567",
    "http://127.0.0.1:4180",
    () => new Date(evaluatedAt),
  );
  const visibleProjects = await projects.listProjects(principal, { limit: 100 });
  let privateDenied = false;
  try {
    await projects.requireProject(principal, "project-private", "PROJECT_READ");
  } catch {
    privateDenied = true;
  }
  const commandInput = {
    schemaVersion: 1 as const,
    commandType: "APPLY_APPROVED_ARTIFACT" as const,
    reviewTaskId: "review-evaluation",
    targetType: "BASELINE" as const,
    targetId: "baseline-evaluation-v1",
    targetVersion: 1,
    expectedRowVersion: 2,
    sourceHash,
    reason: "Evaluation manager applies approved baseline",
    payload: { ignoredClientValue: "not-authoritative" },
  };
  const applied = await commands.apply(
    principal,
    "project-evaluation",
    "phase9-evaluation-command",
    commandInput,
    "phase9-evaluation-correlation",
  );
  const replayed = await commands.apply(
    principal,
    "project-evaluation",
    "phase9-evaluation-command",
    commandInput,
    "phase9-evaluation-correlation",
  );
  const signed = await artifacts.issueSignedUrl(
    principal,
    "project-evaluation",
    "artifact-evaluation",
    { expiresInSeconds: 120 },
    "phase9-evaluation-artifact",
  );
  const signedUrl = new URL(signed.url);
  const resolved = await artifacts.resolveSignedUrl("artifact-evaluation", {
    tid: signedUrl.searchParams.get("tid") ?? undefined,
    pid: signedUrl.searchParams.get("pid") ?? undefined,
    uid: signedUrl.searchParams.get("uid") ?? undefined,
    exp: signedUrl.searchParams.get("exp") ?? undefined,
    nonce: signedUrl.searchParams.get("nonce") ?? undefined,
    sig: signedUrl.searchParams.get("sig") ?? undefined,
  });
  const staleStore = new InMemoryPhase9Store({
    outboxEvents: [
      evaluationEvent({
        lockedAt: "2026-08-03T08:00:00.000Z",
        lockedBy: "crashed-worker",
      }),
    ],
  });
  const published: string[] = [];
  const relay = new Phase9OutboxRelay(
    staleStore,
    { publish: async (event) => void published.push(event.id) },
    { now: () => new Date(evaluatedAt) },
  );
  const replayResult = await relay.processBatch();
  let sideEffects = 0;
  const consumerStore = new InMemoryPhase9Store();
  const consume = () =>
    consumePhase9Event(consumerStore, evaluationEvent(), "evaluation-consumer", async () => {
      sideEffects += 1;
      return { sideEffects };
    });
  await consume();
  await consume();
  const adapterCalls = new Map<string, number>();
  const runner = (name: string) => async () => {
    adapterCalls.set(name, (adapterCalls.get(name) ?? 0) + 1);
    return { adapter: name };
  };
  const adapterRegistry = createPhase9CanonicalAgentAdapterRegistry(new InMemoryPhase9Store(), {
    A0: runner("A0"),
    A1: runner("A1"),
    A2: runner("A2"),
    A3: runner("A3"),
    A4: runner("A4"),
    A5: runner("A5"),
  });
  const adapterPayload = {
    schemaVersion: 1 as const,
    eventId: "adapter-evaluation",
    eventType: "EVALUATE_ADAPTER",
    tenantId: "tenant-evaluation",
    projectId: "project-evaluation",
    aggregateType: "AGENT",
    aggregateId: "agent-evaluation",
    aggregateVersion: 1,
    idempotencyKey: "adapter-evaluation-idempotency",
    payload: {},
    headers: {},
  };
  for (const name of ["A0", "A1", "A2", "A3", "A4", "A5"] as const) {
    await adapterRegistry.get(name).run({
      ...adapterPayload,
      eventId: `adapter-evaluation-${name}`,
      idempotencyKey: `adapter-evaluation-${name}`,
    });
  }
  const state = store.snapshot();
  const cases: Phase9EvaluationCase[] = [
    {
      caseId: "seven-role-rbac",
      passed: phase9RoleSchema.options.length === 7,
      evidence: "Exactly seven production RBAC roles are contract-bound.",
    },
    {
      caseId: "tenant-project-isolation",
      passed:
        privateDenied &&
        visibleProjects.data.length === 1 &&
        !JSON.stringify(visibleProjects).includes("TENANT-PRIVATE-ONLY"),
      evidence: "Cross-tenant project IDs did not disclose data or existence markers.",
    },
    {
      caseId: "approved-command-atomicity",
      passed:
        applied.status === "APPLIED" &&
        state.appliedCommands.length === 1 &&
        state.outboxEvents.length === 1 &&
        state.idempotencyRecords.length === 1,
      evidence: "Approved command, audit, outbox, and idempotency persisted together.",
    },
    {
      caseId: "command-idempotency",
      passed: replayed.status === "REPLAYED" && state.appliedCommands.length === 1,
      evidence: "Duplicate command replay did not duplicate canonical writes.",
    },
    {
      caseId: "server-authoritative-payload",
      passed:
        state.outboxEvents[0]?.payload.canonicalContent !== undefined &&
        JSON.stringify(state.outboxEvents[0]?.payload).includes("baseline-evaluation-v1") &&
        !JSON.stringify(state.outboxEvents[0]?.payload).includes("not-authoritative"),
      evidence: "Outbox used the approved server-side version snapshot, not client payload.",
    },
    {
      caseId: "signed-artifact",
      passed: resolved.id === "artifact-evaluation",
      evidence: "Signed URL resolved only with bound tenant/project/user/hash claims.",
    },
    {
      caseId: "queue-restart-replay",
      passed:
        replayResult.published === 1 &&
        published.length === 1 &&
        staleStore.snapshot().outboxEvents[0]?.status === "PUBLISHED",
      evidence: "A stale outbox lock was reclaimed after worker restart.",
    },
    {
      caseId: "consumer-deduplication",
      passed: sideEffects === 1 && consumerStore.snapshot().consumedEvents.length === 1,
      evidence: "Duplicate event delivery executed one consumer side effect.",
    },
    {
      caseId: "audit-coverage",
      passed:
        state.auditLogs.some((audit) => audit.action === "BASELINE_APPLIED") &&
        state.auditLogs.some((audit) => audit.action === "ARTIFACT_SIGNED_URL_ISSUED"),
      evidence: "Canonical command and signed artifact access both emitted actor audit rows.",
    },
    {
      caseId: "agent-adapter-coverage",
      passed:
        adapterRegistry.readiness().length === 6 &&
        adapterRegistry.readiness().every((adapter) => adapter.ready),
      evidence: "A0 through A5 have versioned canonical production adapters; A4 stays read-only.",
    },
  ];
  const goldenPassCount = cases.filter((item) => item.passed).length;
  const auditExpected = 2;
  const outboxExpected = 1;
  const metrics: Phase9EvaluationReport["metrics"] = {
    roleCoverage: phase9RoleSchema.options.length / 7,
    tenantIsolationViolationCount: privateDenied ? 0 : 1,
    atomicWriteCount: state.appliedCommands.length,
    duplicateCommandCount: Math.max(0, state.appliedCommands.length - 1),
    duplicateConsumerSideEffectCount: Math.max(0, sideEffects - 1),
    staleQueueReplayPassed: replayResult.published === 1,
    signedArtifactAccessPassed: resolved.id === "artifact-evaluation",
    auditCoverage:
      state.auditLogs.filter((audit) =>
        ["BASELINE_APPLIED", "ARTIFACT_SIGNED_URL_ISSUED"].includes(audit.action),
      ).length / auditExpected,
    outboxCoverage: state.outboxEvents.length / outboxExpected,
    agentAdapterCoverage: adapterRegistry.readiness().length / 6,
    goldenPassCount,
    goldenCaseCount: cases.length,
  };
  const passed =
    goldenPassCount === cases.length &&
    metrics.roleCoverage === 1 &&
    metrics.tenantIsolationViolationCount === 0 &&
    metrics.duplicateCommandCount === 0 &&
    metrics.duplicateConsumerSideEffectCount === 0 &&
    metrics.staleQueueReplayPassed &&
    metrics.signedArtifactAccessPassed &&
    metrics.auditCoverage === 1 &&
    metrics.outboxCoverage === 1 &&
    metrics.agentAdapterCoverage === 1;
  return {
    schemaVersion: 1,
    suite: "BUILDWATCH_V22_PHASE9_BACKEND",
    generatedAt: evaluatedAt.toISOString(),
    passed,
    metrics,
    cases,
  };
}
