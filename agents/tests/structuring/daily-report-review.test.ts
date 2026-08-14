import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyApprovedDailyReportToSnapshot,
  FileDailyReportReviewStore,
  finalizeDailyReportDraft,
  preprocessProjectUpdateImage,
} from "../../src/structuring/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";
import {
  buildValidDailyReportModelOutput,
  validDailyReportSource,
} from "./daily-report-fixtures.js";
import { createPngFixture } from "./image-fixtures.js";

const temporaryDirectories: string[] = [];

async function createStoreFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-a1-review-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    store: new FileDailyReportReviewStore(directory),
  };
}

async function createStore() {
  return (await createStoreFixture()).store;
}

function buildReadyDraft(requestId = "review-request-001") {
  const snapshot = buildBuildWatchSimulation().snapshot;
  const modelOutput = buildValidDailyReportModelOutput();
  modelOutput.topLevelConfidence = [
    {
      fieldPath: "reportDate",
      score: 0.95,
      evidenceQuote: "Өнөөдөр",
      sourceImageIndex: null,
      imageRegion: null,
    },
  ];
  return finalizeDailyReportDraft({
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    requestId,
    sourceText: validDailyReportSource,
    referenceDate: "2026-03-30",
    modelOutput,
    projectSnapshot: snapshot,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("A1 file review and apply harness", () => {
  it("stores and deduplicates a checksum-addressed source image", async () => {
    const { directory, store } = await createStoreFixture();
    const data = createPngFixture();
    const image = {
      data,
      mediaType: "image/png" as const,
      fileName: "daily-report.png",
      sha256: createHash("sha256").update(data).digest("hex"),
    };
    const first = await store.saveSourceImage(image);
    const second = await store.saveSourceImage(image);
    const stored = await readFile(path.join(directory, ...first.storageKey.split("/")));

    expect(first).toEqual(second);
    expect(first.kind).toBe("SOURCE_IMAGE");
    expect(path.isAbsolute(first.storageKey)).toBe(false);
    expect(stored).toEqual(data);
  });

  it("stores normalized image provenance beside the artifact", async () => {
    const { directory, store } = await createStoreFixture();
    const data = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: "#204060",
      },
    })
      .png()
      .toBuffer();
    const image = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/png",
      fileName: "daily-report.png",
      sha256: createHash("sha256").update(data).digest("hex"),
    });
    const artifact = await store.saveSourceImage(image);
    const artifactDirectory = path.join(directory, "artifacts");
    const provenanceNames = (await readdir(artifactDirectory)).filter(
      (name) => name.startsWith(`${artifact.sha256}.`) && name.endsWith(".provenance.json"),
    );
    const provenance = JSON.parse(
      await readFile(path.join(artifactDirectory, provenanceNames[0]!), "utf8"),
    ) as unknown;

    expect(provenanceNames).toHaveLength(1);
    expect(provenance).toEqual({
      schemaVersion: 1,
      preprocessing: image.preprocessing,
    });
  });

  it("reuses an identical request without creating a second draft", async () => {
    const store = await createStore();
    const draft = buildReadyDraft();
    const first = await store.saveIntake(draft, "2026-03-30T12:00:00.000Z");
    const second = await store.saveIntake(draft, "2026-03-30T12:05:00.000Z");

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects reuse when the deterministic request has different source", async () => {
    const store = await createStore();
    const draft = buildReadyDraft();
    await store.saveIntake(draft);

    await expect(
      store.saveIntake({
        ...draft,
        rawText: `${draft.rawText} өөр`,
      }),
    ).rejects.toThrow(/different scope or source/);
  });

  it("tracks edited fields and emits command plus event on approval", async () => {
    const store = await createStore();
    const draft = buildReadyDraft();
    await store.saveIntake(draft);
    const replacement = structuredClone(draft);
    replacement.progressEntries[0]!.progressPercent = 71;
    const edited = await store.replaceDraft(draft.draftId, replacement, "2026-03-30T13:00:00.000Z");
    const approved = await store.approve(
      draft.draftId,
      "user-project-manager",
      "Талбай дээр тулгаж батлав.",
      "2026-03-31T03:00:00.000Z",
    );

    expect(
      edited.humanEditedFieldPaths.some((fieldPath) => fieldPath.includes("progressPercent")),
    ).toBe(true);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedCommand?.commandType).toBe("APPROVE_DAILY_REPORT");
    expect(approved.approvalEvent?.eventType).toBe("PROJECT_EXECUTION_APPROVED");
  });

  it("prevents approval while required clarification remains", async () => {
    const store = await createStore();
    const draft = buildReadyDraft();
    draft.clarificationQuestions.push({
      questionId: `${draft.draftId}-manual-question`,
      fieldPath: "progressEntries.0.unit",
      reason: "MISSING_REQUIRED_VALUE",
      question: "Нэгж?",
      options: [],
      requiredForApproval: true,
    });
    draft.status = "NEEDS_CORRECTION";
    await store.saveIntake(draft);

    await expect(store.approve(draft.draftId, "user-project-manager", null)).rejects.toThrow();
  });

  it("rejects a draft with audit metadata", async () => {
    const store = await createStore();
    const draft = buildReadyDraft();
    await store.saveIntake(draft);
    const rejected = await store.reject(
      draft.draftId,
      "user-project-manager",
      "Эх тайлан буруу project-т хамаарсан.",
      "2026-03-31T03:00:00.000Z",
    );

    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejection?.rejectedBy).toBe("user-project-manager");
  });

  it("applies only the approved command and remains idempotent", async () => {
    const simulation = buildBuildWatchSimulation();
    const store = await createStore();
    const draft = buildReadyDraft("apply-request-001");
    await store.saveIntake(draft);
    const approved = await store.approve(
      draft.draftId,
      "user-project-manager",
      null,
      "2026-03-31T03:00:00.000Z",
    );
    const first = applyApprovedDailyReportToSnapshot(
      simulation.snapshot,
      approved.approvedCommand!,
    );
    const second = applyApprovedDailyReportToSnapshot(first.snapshot, approved.approvedCommand!);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(
      first.snapshot.dailyReports.filter((report) => report.sourceDraftId === draft.draftId),
    ).toHaveLength(1);
  });

  it("rejects an approved command that conflicts with canonical history", async () => {
    const simulation = buildBuildWatchSimulation();
    const store = await createStore();
    const draft = buildReadyDraft("conflict-request-001");
    await store.saveIntake(draft);
    const approved = await store.approve(
      draft.draftId,
      "user-project-manager",
      null,
      "2026-03-31T03:00:00.000Z",
    );
    const conflicting = structuredClone(approved.approvedCommand!);
    conflicting.approvedDraft.reportDate = "2026-03-28";
    conflicting.approvedDraft.progressEntries[0]!.progressMode = "CUMULATIVE";
    conflicting.approvedDraft.progressEntries[0]!.quantityDone = "10";
    conflicting.approvedDraft.progressEntries[0]!.progressPercent = 60;

    expect(() => applyApprovedDailyReportToSnapshot(simulation.snapshot, conflicting)).toThrow(
      /already exists/,
    );
  });
});
