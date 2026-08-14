import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileRecommendationDraftStore,
  buildA2ContextMemory,
  buildProductionRecommendationDrafts,
  calculateNightlyCatchUpRuns,
  runProductionA2,
} from "../../src/phase2/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 2 A2 production observer", () => {
  it("builds grounded pending-review drafts from deterministic analysis", () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const drafts = buildProductionRecommendationDrafts(snapshot);

    expect(drafts.length).toBeGreaterThan(0);

    for (const draft of drafts) {
      expect(draft.status).toBe("PENDING_REVIEW");
      expect(draft.requiresHumanReview).toBe(true);
      expect(draft.sourceRefs.length).toBeGreaterThan(0);
      expect(draft.actions).toHaveLength(1);
      const action = draft.actions[0]!;

      if (action.estimatedImpactWorkingDays !== null) {
        expect(action.scenarioId).not.toBeNull();
        expect(action.dataSufficient).toBe(true);
      }
    }
  });

  it("assembles decisions, blocker groups, and freshness memory", () => {
    const memory = buildA2ContextMemory(buildBuildWatchSimulation().snapshot);

    expect(memory.snapshotId).toContain("snapshot-");
    expect(memory.previousRecommendationIds.length).toBeGreaterThan(0);
    expect(memory.repeatedBlockerGroups.length).toBeGreaterThan(0);
    expect(memory.dataAgeHours).toBeGreaterThanOrEqual(0);
  });

  it("keeps deterministic drafts when the model is unavailable", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await runProductionA2({
      snapshot,
      requestId: "a2-fallback-001",
      trigger: "NIGHTLY",
      narrativeGateway: {
        enrich: async () => {
          throw new Error("OpenAI unavailable");
        },
      },
    });

    expect(result.aiStatus).toBe("AI_UNAVAILABLE");
    expect(result.aiError).toContain("OpenAI unavailable");
    expect(result.drafts.length).toBeGreaterThan(0);
    expect(result.analysis.deviations.length).toBe(result.drafts.length);
  });

  it("rejects narrative numeric invention without losing drafts", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const first = buildProductionRecommendationDrafts(snapshot)[0]!;
    const result = await runProductionA2({
      snapshot,
      requestId: "a2-number-guard-001",
      narrativeGateway: {
        enrich: async () => ({
          [first.recommendationId]: {
            summary: "Шинэ таамагласан нөлөө 99 хоног.",
          },
        }),
      },
    });

    expect(result.aiStatus).toBe("AI_UNAVAILABLE");
    expect(result.aiError).toContain("numeric claims");
    expect(result.drafts.length).toBeGreaterThan(0);
  }, 10_000);

  it("persists and audits a manager decision idempotently", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-a2-store-"));
    temporaryDirectories.push(directory);
    const store = new FileRecommendationDraftStore(directory);
    const draft = buildProductionRecommendationDrafts(buildBuildWatchSimulation().snapshot)[0]!;
    const first = await store.save(draft, "2026-07-30T00:00:00.000Z");
    const second = await store.save(draft, "2026-07-30T00:05:00.000Z");
    const decided = await store.decide({
      recommendationId: draft.recommendationId,
      decision: "APPROVED",
      reviewedBy: "user-manager",
      reason: "Талбайн нөхцөлтэй тулгаж батлав.",
      reviewedAt: "2026-07-30T01:00:00.000Z",
    });

    expect(first).toEqual(second);
    expect(decided.decision).toBe("APPROVED");
    expect(decided.reviewedBy).toBe("user-manager");
    expect(await store.list()).toHaveLength(1);
  });

  it("calculates timezone-aware nightly catch-up runs", () => {
    const runs = calculateNightlyCatchUpRuns({
      lastSuccessfulAt: "2026-07-27T00:00:00.000Z",
      now: "2026-07-30T23:00:00.000Z",
      timezone: "Asia/Ulaanbaatar",
      localHour: 2,
    });

    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(runs).size).toBe(runs.length);
  });
});
