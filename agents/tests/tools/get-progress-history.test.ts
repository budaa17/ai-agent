import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { prisma } from "../../src/prisma.js";
import { ToolAccessError } from "../../src/tools/context.js";
import { getProgressHistoryCore } from "../../src/tools/progress-history.js";

beforeAll(async () => {
  // Scoped to the projects `prisma/seed.ts` owns: other projects may share the
  // tenant (for example the demo project from `seed:demo:project`).
  const seededSnapshots = await prisma.workItemSnapshot.count({
    where: {
      tenantId: { in: ["tenant-demo", "tenant-isolation"] },
      projectId: { in: ["project-atlas", "project-river", "project-private"] },
    },
  });

  if (seededSnapshots !== 11) {
    throw new Error("Seed data is outdated. Run `pnpm.cmd run seed` before the tool tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getProgressHistoryCore", () => {
  it("returns only histories inside the authorized project scope", async () => {
    const result = await getProgressHistoryCore({
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
    });

    expect(result.totalSnapshots).toBe(8);
    expect(result.histories).toHaveLength(3);
    expect(
      result.histories.every((history) => history.workItem.projectId === "project-atlas"),
    ).toBe(true);
  });

  it("exposes the nine-day stalled integration evidence", async () => {
    const result = await getProgressHistoryCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        workItemIds: ["wi-atlas-integration"],
      },
    );
    const history = result.histories[0];
    const previous = history?.snapshots.at(-2);
    const current = history?.snapshots.at(-1);

    expect(result.totalSnapshots).toBe(3);
    expect(history?.workItem.progressPercent).toBe(45);
    expect(previous?.progressPercent).toBe(45);
    expect(current?.progressPercent).toBe(45);
    expect(current?.progressDelta).toBe(0);
    expect(current?.daysSincePrevious).toBe(9);
  });

  it("distinguishes a progressing work item from a stalled one", async () => {
    const result = await getProgressHistoryCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        workItemIds: ["wi-atlas-procurement"],
      },
    );
    const current = result.histories[0]?.snapshots.at(-1);

    expect(current?.progressDelta).toBe(15);
    expect(current?.daysSincePrevious).toBe(9);
  });

  it("does not leak the snapshot stored under another tenant", async () => {
    const privateResult = await getProgressHistoryCore({
      tenantId: "tenant-isolation",
      projectIds: ["project-private"],
    });
    const spoofedResult = await getProgressHistoryCore({
      tenantId: "tenant-demo",
      projectIds: ["project-private"],
    });

    expect(privateResult.totalSnapshots).toBe(1);
    expect(privateResult.histories[0]?.workItem.id).toBe("wi-private-analysis");
    expect(spoofedResult.totalSnapshots).toBe(0);
    expect(spoofedResult.histories).toEqual([]);
  });

  it("rejects a requested project outside the authorized project list", async () => {
    await expect(
      getProgressHistoryCore(
        {
          tenantId: "tenant-demo",
          projectIds: ["project-atlas"],
        },
        {
          projectIds: ["project-private"],
        },
      ),
    ).rejects.toBeInstanceOf(ToolAccessError);
  });

  it("rejects an inverted snapshot date range", async () => {
    await expect(
      getProgressHistoryCore(
        {
          tenantId: "tenant-demo",
          projectIds: ["project-atlas"],
        },
        {
          capturedFrom: "2026-03-01T00:00:00.000Z",
          capturedTo: "2026-02-01T00:00:00.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("reports when snapshot results are truncated", async () => {
    const result = await getProgressHistoryCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        limit: 2,
      },
    );

    expect(result.totalSnapshots).toBe(8);
    expect(result.truncated).toBe(true);
    expect(result.histories.flatMap((history) => history.snapshots)).toHaveLength(2);
    expect(result.summary).toEqual({
      snapshotCount: 8,
      workItemCount: 3,
      stalledWorkItemCount: 1,
      averageLatestProgressPercent: 46.67,
    });
  });
});
