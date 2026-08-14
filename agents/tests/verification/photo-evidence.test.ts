import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  photoEvidenceEvaluationV1Schema,
  type BuildWatchSourceReference,
  type PhotoEvidenceByteInspectionV1,
  type PhotoEvidenceEvaluationRequestV1,
  type PhotoEvidenceHistoryEntryV1,
  type PhotoEvidenceSubmissionV1,
} from "../../src/contracts/index.js";
import { buildBuildWatchOperationalSimulation } from "../../src/simulation/index.js";
import {
  PhotoEvidenceEvaluationGateway,
  evaluatePhotoEvidence,
  inspectPhotoEvidenceBytes,
} from "../../src/verification/index.js";

const simulation = buildBuildWatchOperationalSimulation();
const answerCase = simulation.answerKey.cases.find(
  (candidate) => candidate.scenario === "HEALTHY_CONTROL",
)!;
const operationalSnapshot = simulation.agentDataset.operationalSnapshots.find(
  (candidate) => candidate.asOf.slice(0, 10) === answerCase.effectiveDate,
)!;
const workItem = operationalSnapshot.workItems.find(
  (candidate) => candidate.workItemId === answerCase.workItemIds[0],
)!;
const reportDate = answerCase.effectiveDate;

function source(input: {
  sourceRefId: string;
  sourceType: BuildWatchSourceReference["sourceType"];
  sourceId: string;
  asOf: string;
  artifactId?: string | null;
  sha256?: string | null;
  tenantId?: string;
  projectId?: string;
}): BuildWatchSourceReference {
  return {
    sourceRefId: input.sourceRefId,
    tenantId: input.tenantId ?? operationalSnapshot.tenantId,
    projectId: input.projectId ?? operationalSnapshot.projectId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceVersionId: null,
    artifactId: input.artifactId ?? null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf: input.asOf,
    sha256: input.sha256 ?? null,
  };
}

function inspection(
  changes: Partial<PhotoEvidenceByteInspectionV1> = {},
): PhotoEvidenceByteInspectionV1 {
  return {
    schemaVersion: 1,
    inspectionType: "PHOTO_BYTE_INSPECTION",
    expectedMediaType: "image/jpeg",
    actualMediaType: "image/jpeg",
    sizeBytes: 4_096,
    sha256: "1".repeat(64),
    decoded: true,
    widthPixels: 1_920,
    heightPixels: 1_080,
    sharpnessScore: 0.9,
    brightnessScore: 0.6,
    perceptualHash: "0123456789abcdef",
    errorCode: null,
    methodVersion: "buildwatch-photo-inspection-v1",
    deterministic: true,
    ...changes,
  };
}

function photo(changes: Partial<PhotoEvidenceSubmissionV1> = {}): PhotoEvidenceSubmissionV1 {
  const photoInspection = changes.inspection ?? inspection();
  const photoId = changes.photoId ?? "photo-phase-42-001";
  const artifactId = changes.artifactId ?? "artifact-phase-42-001";
  const tenantId = changes.tenantId ?? operationalSnapshot.tenantId;
  const projectId = changes.projectId ?? operationalSnapshot.projectId;
  return {
    schemaVersion: 1,
    submissionType: "PHOTO_EVIDENCE_SUBMISSION",
    photoId,
    artifactId,
    tenantId,
    projectId,
    reportDate,
    capturedAt: `${reportDate}T10:00:00.000Z`,
    uploadedAt: `${reportDate}T11:00:00.000Z`,
    reportedWorkItemId: workItem.workItemId,
    detectedWorkItemId: workItem.workItemId,
    observedAngles: ["OVERVIEW"],
    referenceMarkerPresent: true,
    contradictionSignal: "SUPPORTS",
    privacyStatus: "CLEARED",
    privacySignals: [],
    sourceRefs: [
      source({
        sourceRefId: `source-${photoId}`,
        sourceType: "PHOTO_EVIDENCE",
        sourceId: photoId,
        artifactId,
        sha256: photoInspection.sha256,
        asOf: `${reportDate}T11:00:00.000Z`,
        tenantId,
        projectId,
      }),
    ],
    ...changes,
    inspection: photoInspection,
  };
}

function history(
  currentPhoto: PhotoEvidenceSubmissionV1,
  changes: Partial<PhotoEvidenceHistoryEntryV1> = {},
): PhotoEvidenceHistoryEntryV1 {
  const photoId = changes.photoId ?? "photo-history-001";
  const artifactId = changes.artifactId ?? "artifact-history-001";
  const sha = changes.sha256 ?? currentPhoto.inspection.sha256;
  return {
    schemaVersion: 1,
    historyType: "PHOTO_EVIDENCE_HISTORY",
    photoId,
    artifactId,
    tenantId: operationalSnapshot.tenantId,
    projectId: operationalSnapshot.projectId,
    reportDate: "2026-02-09",
    capturedAt: "2026-02-09T10:00:00.000Z",
    reportedWorkItemId: currentPhoto.reportedWorkItemId,
    sha256: sha,
    perceptualHash: currentPhoto.inspection.perceptualHash,
    sourceRefs: [
      source({
        sourceRefId: `source-${photoId}`,
        sourceType: "PHOTO_EVIDENCE",
        sourceId: photoId,
        artifactId,
        sha256: sha,
        asOf: "2026-02-09T11:00:00.000Z",
      }),
    ],
    ...changes,
  };
}

function request(
  changes: Partial<PhotoEvidenceEvaluationRequestV1> = {},
): PhotoEvidenceEvaluationRequestV1 {
  return {
    schemaVersion: 1,
    requestType: "PHOTO_EVIDENCE_EVALUATION",
    requestId: "request-phase-42-001",
    idempotencyKey: "photo-evidence-phase-42-001",
    tenantId: operationalSnapshot.tenantId,
    projectId: operationalSnapshot.projectId,
    reportDate,
    workItemId: workItem.workItemId,
    generatedAt: `${reportDate}T13:00:00.000Z`,
    operationalSnapshot,
    policy: {
      schemaVersion: 1,
      policyType: "PHOTO_EVIDENCE_POLICY",
      policyId: "photo-policy-commissioning",
      policyVersionId: "photo-policy-commissioning-v1",
      version: 1,
      tenantId: operationalSnapshot.tenantId,
      projectId: operationalSnapshot.projectId,
      workClassCode: workItem.workClassCode,
      effectiveFrom: "2026-01-01",
      approvedBy: "user-project-manager",
      approvedAt: "2025-12-31T05:00:00.000Z",
      requiredPhotoCount: 1,
      requiredAngles: ["OVERVIEW"],
      referenceMarkerRequired: true,
      maxPhotoAgeMinutes: 720,
      minimumSharpnessScore: 0.1,
      minimumBrightnessScore: 0.15,
      maximumBrightnessScore: 0.95,
      nearDuplicateHammingDistanceThreshold: 2,
      sourceRefs: [
        source({
          sourceRefId: "source-photo-policy-commissioning-v1",
          sourceType: "CATALOG_VERSION",
          sourceId: "photo-policy-commissioning",
          asOf: "2025-12-31T05:00:00.000Z",
        }),
      ],
    },
    photos: [photo()],
    history: [],
    ...changes,
  };
}

function checkResult(evaluation: ReturnType<typeof evaluatePhotoEvidence>, code: string) {
  return evaluation.photoResults[0]!.checks.find((check) => check.code === code)?.result;
}

async function checkerImage() {
  const width = 256;
  const height = 256;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 255;
      const offset = (y * width + x) * channels;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  return sharp(data, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();
}

describe("Phase 4.2 photo byte inspection", () => {
  it("calculates deterministic sharpness, brightness, and dHash", async () => {
    const crispBytes = await checkerImage();
    const blurredBytes = await sharp(crispBytes).blur(12).png().toBuffer();
    const darkBytes = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 10, g: 10, b: 10 },
      },
    })
      .png()
      .toBuffer();
    const crisp = await inspectPhotoEvidenceBytes({
      data: crispBytes,
      mediaType: "image/png",
    });
    const repeated = await inspectPhotoEvidenceBytes({
      data: crispBytes,
      mediaType: "image/png",
    });
    const blurred = await inspectPhotoEvidenceBytes({
      data: blurredBytes,
      mediaType: "image/png",
    });
    const dark = await inspectPhotoEvidenceBytes({
      data: darkBytes,
      mediaType: "image/png",
    });

    expect(repeated).toEqual(crisp);
    expect(crisp.decoded).toBe(true);
    expect(crisp.sharpnessScore).toBeGreaterThan(0.1);
    expect(blurred.sharpnessScore).toBeLessThan(0.1);
    expect(dark.brightnessScore).toBeLessThan(0.15);
    expect(crisp.perceptualHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("returns PE-01-compatible failures for invalid or mismatched bytes", async () => {
    const invalid = await inspectPhotoEvidenceBytes({
      data: Buffer.from("not-an-image"),
      mediaType: "image/jpeg",
    });
    const png = await checkerImage();
    const mismatch = await inspectPhotoEvidenceBytes({
      data: png,
      mediaType: "image/jpeg",
    });

    expect(invalid).toMatchObject({
      decoded: false,
      errorCode: "IMAGE_DECODE_FAILED",
    });
    expect(mismatch).toMatchObject({
      decoded: false,
      actualMediaType: "image/png",
      errorCode: "MEDIA_TYPE_MISMATCH",
    });
  });
});

describe("Phase 4.2 deterministic photo evidence evaluation", () => {
  it("runs exactly one correctly mapped PE-01..PE-10 check", () => {
    const evaluation = evaluatePhotoEvidence(request());

    expect(evaluation.photoResults[0]?.checks.map((check) => check.code)).toEqual([
      "PE-01",
      "PE-02",
      "PE-03",
      "PE-04",
      "PE-05",
      "PE-06",
      "PE-07",
      "PE-08",
      "PE-09",
      "PE-10",
    ]);
    expect(evaluation.photoResults[0]?.acceptedForVerification).toBe(true);
    expect(evaluation.coverage).toMatchObject({
      coveragePercent: 100,
      requiredAnglesComplete: true,
      referenceMarkerPresent: true,
      evidenceComplete: true,
    });
    expect(evaluation.automaticEvidenceAcceptanceAllowed).toBe(true);
    expect(evaluation.requiresHumanReview).toBe(true);
    expect(evaluation.exactQuantityDerived).toBe(false);
  });

  it("maps decode and quality failures to PE-01 and PE-02", () => {
    const decodeFailure = photo({
      inspection: inspection({
        actualMediaType: null,
        decoded: false,
        widthPixels: null,
        heightPixels: null,
        sharpnessScore: null,
        brightnessScore: null,
        perceptualHash: null,
        errorCode: "IMAGE_DECODE_FAILED",
      }),
    });
    const decodeEvaluation = evaluatePhotoEvidence(request({ photos: [decodeFailure] }));
    const qualityFailure = photo({
      inspection: inspection({ sharpnessScore: 0.01 }),
    });
    const qualityEvaluation = evaluatePhotoEvidence(request({ photos: [qualityFailure] }));

    expect(checkResult(decodeEvaluation, "PE-01")).toBe("FAIL");
    expect(checkResult(decodeEvaluation, "PE-02")).toBe("NOT_APPLICABLE");
    expect(checkResult(qualityEvaluation, "PE-01")).toBe("PASS");
    expect(checkResult(qualityEvaluation, "PE-02")).toBe("FAIL");
  });

  it("detects exact duplicate and previous-day reuse", () => {
    const current = photo();
    const evaluation = evaluatePhotoEvidence(
      request({ photos: [current], history: [history(current)] }),
    );

    expect(checkResult(evaluation, "PE-03")).toBe("FAIL");
    expect(checkResult(evaluation, "PE-04")).toBe("FAIL");
    expect(evaluation.photoResults[0]).toMatchObject({
      exactDuplicateOfPhotoId: "photo-history-001",
      reusedFromReportDate: "2026-02-09",
      usableForEvidence: false,
      acceptedForVerification: false,
    });
  });

  it("keeps near-duplicate as a review warning instead of exact rejection", () => {
    const current = photo();
    const previous = history(current, {
      sha256: "2".repeat(64),
      perceptualHash: "0123456789abcdee",
      sourceRefs: [
        source({
          sourceRefId: "source-photo-history-near",
          sourceType: "PHOTO_EVIDENCE",
          sourceId: "photo-history-near",
          artifactId: "artifact-history-001",
          sha256: "2".repeat(64),
          asOf: "2026-02-09T11:00:00.000Z",
        }),
      ],
    });
    const evaluation = evaluatePhotoEvidence(request({ photos: [current], history: [previous] }));

    expect(checkResult(evaluation, "PE-03")).toBe("WARNING");
    expect(checkResult(evaluation, "PE-04")).toBe("WARNING");
    expect(evaluation.photoResults[0]).toMatchObject({
      exactDuplicateOfPhotoId: null,
      nearDuplicateOfPhotoId: "photo-history-001",
      nearDuplicateHammingDistance: 1,
      usableForEvidence: true,
      acceptedForVerification: false,
    });
  });

  it.each([
    [
      "PE-05",
      {
        capturedAt: "2026-02-09T10:00:00.000Z",
      } satisfies Partial<PhotoEvidenceSubmissionV1>,
    ],
    [
      "PE-06",
      {
        detectedWorkItemId: "work-item-other",
      } satisfies Partial<PhotoEvidenceSubmissionV1>,
    ],
    [
      "PE-09",
      {
        contradictionSignal: "CONTRADICTS" as const,
      } satisfies Partial<PhotoEvidenceSubmissionV1>,
    ],
    [
      "PE-10",
      {
        privacyStatus: "RESTRICTED" as const,
        privacySignals: ["FACE" as const],
      } satisfies Partial<PhotoEvidenceSubmissionV1>,
    ],
  ])("fails %s for its matching signal", (code, photoChanges) => {
    const evaluation = evaluatePhotoEvidence(request({ photos: [photo(photoChanges)] }));

    expect(checkResult(evaluation, code)).toBe("FAIL");
    expect(evaluation.automaticEvidenceAcceptanceAllowed).toBe(false);
  });

  it("fails missing required angles and reference marker without inventing evidence", () => {
    const current = photo({
      observedAngles: [],
      referenceMarkerPresent: null,
    });
    const evaluation = evaluatePhotoEvidence(request({ photos: [current] }));

    expect(checkResult(evaluation, "PE-07")).toBe("FAIL");
    expect(checkResult(evaluation, "PE-08")).toBe("FAIL");
    expect(evaluation.coverage).toMatchObject({
      missingAngles: ["OVERVIEW"],
      requiredAnglesComplete: false,
      referenceMarkerPresent: false,
      evidenceComplete: false,
    });
  });

  it("is order-stable and enforces idempotency", () => {
    const firstPhoto = photo({
      photoId: "photo-a",
      artifactId: "artifact-a",
    });
    const secondPhoto = photo({
      photoId: "photo-b",
      artifactId: "artifact-b",
      inspection: inspection({
        sha256: "3".repeat(64),
        perceptualHash: "fedcba9876543210",
      }),
    });
    const forward = request({ photos: [firstPhoto, secondPhoto] });
    const reversed = request({ photos: [secondPhoto, firstPhoto] });
    const first = evaluatePhotoEvidence(forward);
    const second = evaluatePhotoEvidence(reversed);
    const gateway = new PhotoEvidenceEvaluationGateway();

    expect(second).toEqual(first);
    expect(gateway.evaluate(forward)).toEqual(first);
    expect(gateway.evaluate(reversed)).toBe(gateway.evaluate(forward));

    const changed = request({
      photos: [
        photo({
          observedAngles: [],
          referenceMarkerPresent: null,
        }),
      ],
    });
    expect(() => gateway.evaluate(changed)).toThrow("idempotency key was reused");
  });

  it("rejects cross-tenant input and any exact-quantity field", () => {
    const privatePhoto = photo({
      tenantId: "tenant-private",
      sourceRefs: [
        source({
          sourceRefId: "source-private-photo",
          sourceType: "PHOTO_EVIDENCE",
          sourceId: "private-photo",
          artifactId: "artifact-phase-42-001",
          sha256: "1".repeat(64),
          asOf: `${reportDate}T11:00:00.000Z`,
          tenantId: "tenant-private",
        }),
      ],
    });
    expect(() => evaluatePhotoEvidence(request({ photos: [privatePhoto] }))).toThrow();
    expect(() =>
      evaluatePhotoEvidence({
        ...request(),
        exactQuantity: "12.5",
      }),
    ).toThrow();
  });

  it("rejects tampered coverage and acceptance output", () => {
    const evaluation = evaluatePhotoEvidence(request());

    expect(
      photoEvidenceEvaluationV1Schema.safeParse({
        ...evaluation,
        coverage: {
          ...evaluation.coverage,
          coveragePercent: 50,
        },
      }).success,
    ).toBe(false);
    expect(
      photoEvidenceEvaluationV1Schema.safeParse({
        ...evaluation,
        photoResults: evaluation.photoResults.map((result) => ({
          ...result,
          acceptedForVerification: false,
        })),
      }).success,
    ).toBe(false);
  });
});
