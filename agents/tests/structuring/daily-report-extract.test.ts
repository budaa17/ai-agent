import { createHash } from "node:crypto";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createLocalAgentRuntimeGuard } from "../../src/runtime/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";
import {
  extractDailyReportDraft,
  type DailyReportImageInput,
  type DailyReportModelOutput,
} from "../../src/structuring/index.js";
import { buildValidDailyReportModelOutput } from "./daily-report-fixtures.js";
import { createPngFixture } from "./image-fixtures.js";

const usage = {
  inputTokens: {
    total: 20,
    noCache: 20,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: undefined,
  },
} satisfies LanguageModelV4GenerateResult["usage"];

const imageRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  description: "Visible daily-report area",
};

function imageInput(): DailyReportImageInput {
  const data = createPngFixture();
  const sha256 = createHash("sha256").update(data).digest("hex");

  return {
    image: {
      data,
      mediaType: "image/png",
      fileName: "daily-report.png",
      sha256,
    },
    artifact: {
      artifactId: `source-image-${sha256.slice(0, 20)}`,
      kind: "SOURCE_IMAGE",
      mediaType: "image/png",
      sha256,
      storageKey: `artifacts/${sha256}.png`,
      sizeBytes: data.byteLength,
    },
  };
}

function imageDocumentOutput(): DailyReportModelOutput {
  const output = buildValidDailyReportModelOutput();
  output.reportDate = "2026-03-30";
  const confidenceGroups = [
    output.topLevelConfidence,
    ...output.progressEntries.map((entry) => entry.confidence),
    ...output.attendanceEntries.map((entry) => entry.confidence),
    ...output.materialSignals.map((entry) => entry.confidence),
  ];

  for (const confidence of confidenceGroups.flat()) {
    confidence.sourceImageIndex = 0;
    confidence.imageRegion = imageRegion;
  }

  return output;
}

function mockModel(output: DailyReportModelOutput) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          type: "text",
          text: JSON.stringify(output),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
  });
}

describe("A1 daily-report multimodal extraction", () => {
  it("estimates guarded input from the compact project catalog", async () => {
    const sourceImage = imageInput();
    const model = mockModel(imageDocumentOutput());
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await extractDailyReportDraft({
      model,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      sourceImages: [sourceImage],
      referenceDate: "2026-03-30",
      requestId: "daily-guarded-catalog-001",
      projectSnapshot: snapshot,
      telemetryEnabled: false,
      enforceSnapshotConsistency: false,
      runtimeGuard: createLocalAgentRuntimeGuard(),
    });

    expect(result.runtime).not.toBeNull();
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("sends an image and preserves image evidence plus artifact metadata", async () => {
    const sourceImage = imageInput();
    const model = mockModel(imageDocumentOutput());
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await extractDailyReportDraft({
      model,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      sourceImages: [sourceImage],
      referenceDate: "2026-03-30",
      requestId: "daily-image-request-001",
      projectSnapshot: snapshot,
      telemetryEnabled: false,
      enforceSnapshotConsistency: false,
    });

    expect(result.draft.rawText).toBeNull();
    expect(result.draft.sourceArtifacts).toEqual([sourceImage.artifact]);
    expect(result.draft.progressEntries[0]?.fieldConfidence[0]?.evidence[0]?.sourceType).toBe(
      "IMAGE",
    );
    expect(result.draft.progressEntries[0]?.fieldConfidence[0]?.evidence[0]?.sourceId).toBe(
      sourceImage.artifact.artifactId,
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("image/png");
  });

  it("keeps a construction-photo-only observation advisory", async () => {
    const sourceImage = imageInput();
    const output: DailyReportModelOutput = {
      schemaVersion: 1,
      language: "mn",
      reportDate: "2026-03-30",
      location: {
        block: null,
        stage: null,
        floor: null,
        zone: null,
      },
      progressEntries: [],
      attendanceEntries: [],
      materialSignals: [],
      photoObservations: [
        {
          sourceImageIndex: 0,
          kind: "SAFETY_ADVISORY",
          statement: "Хамгаалалтын хашлага харагдахгүй байна.",
          reviewQuestion: "Талбайн аюулгүй ажиллагааны ажилтан хашлагыг шалгах уу?",
          workItemCandidateCodes: ["BW-017"],
          confidence: 0.88,
          imageRegion,
        },
      ],
      topLevelConfidence: [
        {
          fieldPath: "reportDate",
          score: 0.9,
          evidenceQuote: "2026-03-30",
          sourceImageIndex: 0,
          imageRegion,
        },
      ],
    };
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await extractDailyReportDraft({
      model: mockModel(output),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      sourceImages: [sourceImage],
      referenceDate: "2026-03-30",
      requestId: "daily-photo-request-001",
      projectSnapshot: snapshot,
      telemetryEnabled: false,
      enforceSnapshotConsistency: false,
    });

    expect(result.draft.photoObservations).toHaveLength(1);
    expect(result.draft.photoObservations[0]).toMatchObject({
      photoArtifactId: sourceImage.artifact.artifactId,
      kind: "SAFETY_ADVISORY",
      advisoryOnly: true,
    });
    expect(result.draft.photoObservations[0]?.evidence[0]?.imageRegion).toEqual(imageRegion);
  });

  it("rejects artifact metadata that does not match image bytes", async () => {
    const sourceImage = imageInput();
    sourceImage.artifact.sizeBytes += 1;
    const snapshot = buildBuildWatchSimulation().snapshot;

    await expect(
      extractDailyReportDraft({
        model: mockModel(imageDocumentOutput()),
        tenantId: snapshot.tenantId,
        projectId: snapshot.projectId,
        sourceImages: [sourceImage],
        referenceDate: "2026-03-30",
        projectSnapshot: snapshot,
        telemetryEnabled: false,
      }),
    ).rejects.toThrow(/does not match its source bytes/);
  });

  it("deduplicates repeated image checksums before prompting", async () => {
    const sourceImage = imageInput();
    const model = mockModel(imageDocumentOutput());
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await extractDailyReportDraft({
      model,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      sourceImages: [sourceImage, structuredClone(sourceImage)],
      referenceDate: "2026-03-30",
      requestId: "daily-image-dedup-001",
      projectSnapshot: snapshot,
      telemetryEnabled: false,
      enforceSnapshotConsistency: false,
    });

    expect(result.draft.sourceArtifacts).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt).match(/image\/png/gu)).toHaveLength(1);
  });

  it("rejects more than five source images", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;

    await expect(
      extractDailyReportDraft({
        model: mockModel(imageDocumentOutput()),
        tenantId: snapshot.tenantId,
        projectId: snapshot.projectId,
        sourceImages: Array.from({ length: 6 }, () => structuredClone(imageInput())),
        referenceDate: "2026-03-30",
        projectSnapshot: snapshot,
        telemetryEnabled: false,
      }),
    ).rejects.toThrow(/at most 5 images/);
  });
});
