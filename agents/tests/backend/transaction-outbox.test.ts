import {
  InMemoryPhase9Store,
  Phase9ApprovedCommandService,
  Phase9ReviewService,
  phase9Sha256,
  type Phase9AuthenticatedPrincipal,
  type Phase9Store,
  type Phase9StoreTransaction,
} from "../../src/backend/index.js";
import { buildPhase9TestFixture, phase9TestNow } from "./phase9-fixtures.js";

const managerPrincipal: Phase9AuthenticatedPrincipal = {
  userId: "user-manager-alpha",
  tenantId: "tenant-alpha",
  tenantRole: "OBSERVER",
  sessionId: "test-session",
  tokenVersion: 1,
};

function baselineCommand(rowVersion: number) {
  return {
    schemaVersion: 1 as const,
    commandType: "APPLY_APPROVED_ARTIFACT" as const,
    reviewTaskId: "review-alpha-baseline",
    targetType: "BASELINE" as const,
    targetId: "baseline-alpha-v1",
    targetVersion: 1,
    expectedRowVersion: rowVersion,
    sourceHash: "a".repeat(64),
    reason: "Approved baseline becomes the project system of record",
    payload: { baselineVersionId: "baseline-alpha-v1" },
  };
}

function registrationCommand(rowVersion: number, sourceHash: string) {
  return {
    schemaVersion: 1 as const,
    commandType: "APPLY_APPROVED_ARTIFACT" as const,
    reviewTaskId: "review-alpha-registration",
    targetType: "REGISTRATION_DRAFT" as const,
    targetId: "registration-alpha-v1",
    targetVersion: 1,
    expectedRowVersion: rowVersion,
    sourceHash,
    reason: "Reviewed A1 project update becomes canonical data",
    payload: {},
  };
}

describe("BuildWatch Phase 9 atomic review and approved command boundary", () => {
  it("approves and applies in atomic audit/outbox/idempotency transactions", async () => {
    const fixture = await buildPhase9TestFixture();
    const decision = await fixture.reviews.decide(
      managerPrincipal,
      "project-alpha-main",
      "review-alpha-baseline",
      "review-decision-001",
      {
        decision: "APPROVE",
        expectedRowVersion: 1,
        reason: "Manager verified source and baseline content",
      },
      "review-correlation",
    );
    expect(decision.status).toBe("APPROVED");
    const replayedDecision = await fixture.reviews.decide(
      managerPrincipal,
      "project-alpha-main",
      "review-alpha-baseline",
      "review-decision-001",
      {
        decision: "APPROVE",
        expectedRowVersion: 1,
        reason: "Manager verified source and baseline content",
      },
      "review-correlation",
    );
    expect(replayedDecision.status).toBe("REPLAYED");

    const result = await fixture.commands.apply(
      managerPrincipal,
      "project-alpha-main",
      "apply-baseline-001",
      baselineCommand(2),
      "apply-correlation",
    );
    expect(result.status).toBe("APPLIED");
    const replay = await fixture.commands.apply(
      managerPrincipal,
      "project-alpha-main",
      "apply-baseline-001",
      baselineCommand(2),
      "apply-correlation",
    );
    expect(replay.status).toBe("REPLAYED");

    const state = fixture.store.snapshot();
    expect(state.reviewDecisions).toHaveLength(1);
    expect(state.appliedCommands).toHaveLength(1);
    expect(state.reviewTasks.find((task) => task.id === "review-alpha-baseline")?.status).toBe(
      "APPLIED",
    );
    expect(state.outboxEvents.map((event) => event.eventType)).toEqual([
      "REVIEW_TASK_APPROVED",
      "BASELINE_APPLIED",
    ]);
    expect(state.idempotencyRecords).toHaveLength(2);
    expect(state.auditLogs.filter((audit) => audit.tenantId === "tenant-alpha")).toHaveLength(2);
  });

  it("serializes concurrent duplicate commands into one apply and one replay", async () => {
    const fixture = await buildPhase9TestFixture();
    const snapshot = fixture.store.snapshot();
    snapshot.reviewTasks = snapshot.reviewTasks.map((task) =>
      task.id === "review-alpha-baseline" ? { ...task, status: "APPROVED", rowVersion: 2 } : task,
    );
    const store = new InMemoryPhase9Store(snapshot);
    const service = new Phase9ApprovedCommandService(store, () => new Date(phase9TestNow));
    const results = await Promise.all([
      service.apply(
        managerPrincipal,
        "project-alpha-main",
        "concurrent-apply-001",
        baselineCommand(2),
        "concurrent-a",
      ),
      service.apply(
        managerPrincipal,
        "project-alpha-main",
        "concurrent-apply-001",
        baselineCommand(2),
        "concurrent-b",
      ),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["APPLIED", "REPLAYED"]);
    expect(store.snapshot().appliedCommands).toHaveLength(1);
    expect(store.snapshot().outboxEvents).toHaveLength(1);
  });

  it("applies an approved A1 registration draft through the canonical command boundary", async () => {
    const fixture = await buildPhase9TestFixture();
    const snapshot = fixture.store.snapshot();
    const sourceHash = "c".repeat(64);
    snapshot.reviewTasks.push({
      id: "review-alpha-registration",
      tenantId: "tenant-alpha",
      projectId: "project-alpha-main",
      targetType: "REGISTRATION_DRAFT",
      targetId: "registration-alpha-v1",
      targetVersion: 1,
      status: "APPROVED",
      sourceHash,
      createdByUserId: "user-engineer-alpha",
      assignedRole: "PROJECT_MANAGER",
      assignedUserId: null,
      rowVersion: 2,
    });
    snapshot.versionSnapshots.push({
      id: "registration-alpha-v1",
      tenantId: "tenant-alpha",
      projectId: "project-alpha-main",
      targetType: "REGISTRATION_DRAFT",
      versionNumber: 1,
      status: "APPROVED",
      sourceHash,
      content: { structuredData: { workItemCode: "BW-001", progressPercent: 40 } },
      createdAt: phase9TestNow.toISOString(),
    });
    const store = new InMemoryPhase9Store(snapshot);
    const commands = new Phase9ApprovedCommandService(store, () => new Date(phase9TestNow));
    const result = await commands.apply(
      managerPrincipal,
      "project-alpha-main",
      "apply-registration-001",
      registrationCommand(2, sourceHash),
      "registration-correlation",
    );
    expect(result.status).toBe("APPLIED");
    expect(result.targetType).toBe("REGISTRATION_DRAFT");
    expect(store.snapshot().outboxEvents[0]?.eventType).toBe("REGISTRATION_DRAFT_APPLIED");
  });

  it("rejects self approval and changed idempotency content", async () => {
    const fixture = await buildPhase9TestFixture();
    await expect(
      fixture.reviews.decide(
        managerPrincipal,
        "project-alpha-main",
        "review-alpha-self",
        "self-review-001",
        {
          decision: "APPROVE",
          expectedRowVersion: 1,
          reason: "Attempting to approve own report",
        },
        "self-review",
      ),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });

    await fixture.reviews.decide(
      managerPrincipal,
      "project-alpha-main",
      "review-alpha-baseline",
      "review-conflict-001",
      {
        decision: "APPROVE",
        expectedRowVersion: 1,
        reason: "First immutable decision request",
      },
      "review-conflict",
    );
    await expect(
      fixture.reviews.decide(
        managerPrincipal,
        "project-alpha-main",
        "review-alpha-baseline",
        "review-conflict-001",
        {
          decision: "REJECT",
          expectedRowVersion: 1,
          reason: "Different content under the same key",
        },
        "review-conflict",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("blocks baseline approval until every upstream version is approved", async () => {
    const fixture = await buildPhase9TestFixture();
    const snapshot = fixture.store.snapshot();
    snapshot.versionSnapshots = snapshot.versionSnapshots.map((version) =>
      version.id === "estimate-alpha-v1" ? { ...version, status: "REVIEW_REQUIRED" } : version,
    );
    const store = new InMemoryPhase9Store(snapshot);
    const reviews = new Phase9ReviewService(store, () => new Date(phase9TestNow));
    await expect(
      reviews.decide(
        managerPrincipal,
        "project-alpha-main",
        "review-alpha-baseline",
        "review-upstream-blocked",
        {
          decision: "APPROVE",
          expectedRowVersion: 1,
          reason: "Attempt before estimate approval",
        },
        "review-upstream-blocked",
      ),
    ).rejects.toMatchObject({ code: "REVIEW_NOT_APPROVED" });
  });

  it("rolls back every write when outbox insertion fails", async () => {
    const fixture = await buildPhase9TestFixture();
    const snapshot = fixture.store.snapshot();
    snapshot.reviewTasks = snapshot.reviewTasks.map((task) =>
      task.id === "review-alpha-baseline" ? { ...task, status: "APPROVED", rowVersion: 2 } : task,
    );
    const inner = new InMemoryPhase9Store(snapshot);
    const failing: Phase9Store = {
      read: (work) => inner.read(work),
      transaction: (work) =>
        inner.transaction((transaction) => {
          const proxy = new Proxy(transaction, {
            get(target, property, receiver) {
              if (property === "createOutbox") {
                return async () => {
                  throw new Error("simulated outbox failure");
                };
              }
              return Reflect.get(
                target,
                property,
                receiver,
              ) as Phase9StoreTransaction[keyof Phase9StoreTransaction];
            },
          });
          return work(proxy);
        }),
    };
    const service = new Phase9ApprovedCommandService(failing, () => new Date(phase9TestNow));
    await expect(
      service.apply(
        managerPrincipal,
        "project-alpha-main",
        "rollback-apply-001",
        baselineCommand(2),
        "rollback-correlation",
      ),
    ).rejects.toThrow("simulated outbox failure");
    const state = inner.snapshot();
    expect(state.appliedCommands).toHaveLength(0);
    expect(state.outboxEvents).toHaveLength(0);
    expect(state.idempotencyRecords).toHaveLength(0);
    expect(state.reviewTasks.find((task) => task.id === "review-alpha-baseline")?.status).toBe(
      "APPROVED",
    );
    expect(phase9Sha256(state.reviewTasks)).toBe(phase9Sha256(snapshot.reviewTasks));
  });
});
