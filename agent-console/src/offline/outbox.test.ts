import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  uploadArtifact: vi.fn(),
  submitDailyReport: vi.fn(),
  sha256Hex: vi.fn(async () => "a".repeat(64)),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    sha256Hex: apiMocks.sha256Hex,
    buildWatchApi: {
      ...actual.buildWatchApi,
      uploadArtifact: apiMocks.uploadArtifact,
      submitDailyReport: apiMocks.submitDailyReport,
    },
  };
});

import { BuildWatchApiError } from "../api/client";
import {
  clearBuildWatchDatabaseForTests,
  getDailyDraft,
  getLocalPhoto,
  listOutboxEntries,
} from "./database";
import {
  addPhotoToDraft,
  persistDraft,
  queueDailyReport,
  retryOutboxEntry,
  syncOutbox,
} from "./outbox";

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

function reportRequest() {
  return {
    reportDate: "2026-08-03",
    timezone: "Asia/Ulaanbaatar",
    narrative: "Offline no-data-loss test",
    weather: null,
    sourceDraftId: null,
    progress: [
      {
        workItemId: "work-item-1",
        planItemId: null,
        quantity: "12.50",
        unit: "м3",
        progressPercent: 45,
        sourceRefs: [],
      },
    ],
    attendance: [
      {
        crewId: null,
        trade: "Өрлөг",
        workerCount: 6,
        hoursPerWorker: 8,
        laborRateMnt: null,
        sourceRefs: [],
      },
    ],
  };
}

describe("BuildWatch IndexedDB outbox", () => {
  beforeEach(async () => {
    await clearBuildWatchDatabaseForTests();
    apiMocks.uploadArtifact.mockReset();
    apiMocks.submitDailyReport.mockReset();
    apiMocks.sha256Hex.mockClear();
    setOnline(true);
  });

  it("offline үед draft болон зураг алдалгүй хадгалаад online болоход зураг→тайлан дарааллаар sync хийнэ", async () => {
    setOnline(false);
    const photo = await addPhotoToDraft({
      projectId: "project-1",
      file: new File(["image-bytes"], "progress.png", { type: "image/png" }),
      capturedAt: "2026-08-03T10:00:00.000Z",
    });
    const draft = await persistDraft({
      projectId: "project-1",
      request: reportRequest(),
      photoIds: [photo.id],
    });
    const queued = await queueDailyReport(draft);
    await syncOutbox();

    expect((await getDailyDraft(draft.id))?.status).toBe("QUEUED");
    expect((await getLocalPhoto(photo.id))?.bytes.byteLength).toBeGreaterThan(0);
    expect((await listOutboxEntries())[0]?.status).toBe("PENDING");
    expect(apiMocks.uploadArtifact).not.toHaveBeenCalled();

    apiMocks.uploadArtifact.mockResolvedValue({ artifactId: "asset-1" });
    apiMocks.submitDailyReport.mockResolvedValue({ status: "REVIEW_REQUIRED" });
    setOnline(true);
    await syncOutbox();

    expect(apiMocks.uploadArtifact).toHaveBeenCalledTimes(1);
    expect(apiMocks.submitDailyReport).toHaveBeenCalledTimes(1);
    expect(apiMocks.uploadArtifact.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.submitDailyReport.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(apiMocks.submitDailyReport.mock.calls[0]?.[1].photos).toEqual([
      expect.objectContaining({ fileAssetId: "asset-1" }),
    ]);
    expect((await listOutboxEntries())[0]?.status).toBe("SENT");
    expect((await getDailyDraft(draft.id))?.status).toBe("SUBMITTED");
    expect((await getLocalPhoto(photo.id))?.uploadedArtifactId).toBe("asset-1");
    expect(queued.id).toMatch(/^daily-report-/);
  });

  it("409 conflict-ийг нуухгүй бөгөөд шинэ idempotency key-ээр хүний retry хийдэг", async () => {
    const draft = await persistDraft({
      projectId: "project-1",
      request: reportRequest(),
      photoIds: [],
    });
    const queued = await queueDailyReport(draft);
    apiMocks.submitDailyReport.mockRejectedValueOnce(
      new BuildWatchApiError({
        message: "Version conflict",
        code: "OPTIMISTIC_LOCK_CONFLICT",
        status: 409,
      }),
    );
    await syncOutbox();
    expect((await listOutboxEntries())[0]).toEqual(
      expect.objectContaining({ status: "CONFLICT", lastError: "Version conflict" }),
    );

    apiMocks.submitDailyReport.mockResolvedValueOnce({ status: "REVIEW_REQUIRED" });
    await retryOutboxEntry(queued.id, true);
    const entries = await listOutboxEntries();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.status === "SENT")).toBe(true);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });
});
