import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import {
  A5DailyPlanReviewLedger,
  A5IdempotentRunStore,
  A5_DAILY_PLAN_QUEUE,
  a5DailyPlanIdempotencyKey,
  dateInTimezone,
  enqueueA5DailyPlan,
  replayA5DailyPlanDeadLetters,
  scheduleA5DailyPlanAtFive,
} from "../../src/planning/index.js";

function transition(
  id: string,
  fromStatus: string,
  toStatus: string,
  actorRole: string,
  reason: string | null = null,
) {
  return {
    schemaVersion: 1,
    transitionType: "DAILY_WORK_PLAN_STATE",
    transitionId: id,
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    dailyWorkPlanVersionId: "daily-plan-2026-02-10",
    fromStatus,
    toStatus,
    actorId: actorRole === "PROJECT_MANAGER" ? "manager-01" : "engineer-01",
    actorRole,
    reason,
    transitionedAt: "2026-02-10T05:00:00.000Z",
  };
}

describe("A5 review state machine", () => {
  it("audits correction, approval, execution, and closure", () => {
    const ledger = new A5DailyPlanReviewLedger();
    ledger.register("daily-plan-2026-02-10");
    ledger.apply(transition("t-01", "DRAFT", "REVIEW_REQUIRED", "SITE_ENGINEER"));
    const correction = ledger.apply(
      transition(
        "t-02",
        "REVIEW_REQUIRED",
        "DRAFT",
        "PROJECT_MANAGER",
        "Quantity correction requested",
      ),
      ["content.items.0.plannedQuantity"],
    );
    ledger.apply(transition("t-03", "DRAFT", "REVIEW_REQUIRED", "SITE_ENGINEER"));
    ledger.apply(
      transition(
        "t-04",
        "REVIEW_REQUIRED",
        "APPROVED",
        "PROJECT_MANAGER",
        "Approved for execution",
      ),
    );
    ledger.apply(transition("t-05", "APPROVED", "IN_PROGRESS", "SYSTEM"));
    ledger.apply(transition("t-06", "IN_PROGRESS", "CLOSED", "SITE_ENGINEER"));
    expect(correction.correctedFieldPaths).toEqual(["content.items.0.plannedQuantity"]);
    expect(correction.entryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ledger.status("daily-plan-2026-02-10")).toBe("CLOSED");
    expect(ledger.history("daily-plan-2026-02-10")).toHaveLength(6);
  });

  it("rejects invalid or out-of-order transitions", () => {
    const ledger = new A5DailyPlanReviewLedger();
    ledger.register("daily-plan-2026-02-10");
    expect(() =>
      ledger.apply(transition("invalid", "DRAFT", "APPROVED", "PROJECT_MANAGER", "Skip review")),
    ).toThrow();
  });
});

describe("A5 jobs", () => {
  function mockBoss() {
    return {
      createQueue: vi.fn(async () => undefined),
      send: vi.fn(async () => "job-01"),
      schedule: vi.fn(async () => undefined),
      redrive: vi.fn(async () => 1),
    } as unknown as PgBoss;
  }

  it("schedules exactly at 05:00 in the project timezone", async () => {
    const boss = mockBoss();
    await scheduleA5DailyPlanAtFive(boss, {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      timezone: "Asia/Ulaanbaatar",
    });
    expect(boss.schedule).toHaveBeenCalledWith(
      A5_DAILY_PLAN_QUEUE,
      "0 5 * * *",
      expect.objectContaining({ trigger: "SCHEDULED_05_00" }),
      expect.objectContaining({ tz: "Asia/Ulaanbaatar" }),
    );
  });

  it("uses one stable key per tenant, project, and date", async () => {
    const boss = mockBoss();
    await enqueueA5DailyPlan(boss, {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      planDate: "2026-02-10",
      timezone: "Asia/Ulaanbaatar",
      trigger: "MANAGER_REQUEST",
      requestId: "manager-run-01",
    });
    expect(boss.send).toHaveBeenCalledWith(A5_DAILY_PLAN_QUEUE, expect.any(Object), {
      singletonKey: a5DailyPlanIdempotencyKey("tenant-demo", "project-atlas", "2026-02-10"),
    });
  });

  it("replays the dead-letter queue", async () => {
    const boss = mockBoss();
    await replayA5DailyPlanDeadLetters(boss);
    expect(boss.redrive).toHaveBeenCalledWith(`${A5_DAILY_PLAN_QUEUE}-dead-letter`, {
      destination: A5_DAILY_PLAN_QUEUE,
    });
  });

  it("deduplicates concurrent executions", async () => {
    const store = new A5IdempotentRunStore<number>();
    const execute = vi.fn(async () => 42);
    const [first, second] = await Promise.all([
      store.run("same-date", execute),
      store.run("same-date", execute),
    ]);
    expect([first, second]).toEqual([42, 42]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolves the local planning date deterministically", () => {
    expect(dateInTimezone(new Date("2026-02-09T20:30:00.000Z"), "Asia/Ulaanbaatar")).toBe(
      "2026-02-10",
    );
  });
});
