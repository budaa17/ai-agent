import { describe, expect, it } from "vitest";
import {
  a1ImageAnnotationWorkspaceV1Schema,
  assertReleaseReadyImageWorkspace,
  buildA1ImageGoldenCases,
  buildA1TextGoldenCases,
  runPhase2ProductionGate,
  scoreA1ImagePredictions,
} from "../../src/phase2/index.js";

function imageWorkspaceCase(index: number) {
  const sequence = String(index + 1).padStart(3, "0");
  const sceneFamilies = [
    "WORK_TYPE",
    "PROGRESS_CUE",
    "CONTRADICTION",
    "SAFETY",
    "DELIVERY",
    "UNREADABLE",
    "FOREIGN_CURRENCY",
    "NEGATIVE_CONTROL",
  ] as const;
  const difficulties = [
    "CLEAR",
    "BLURRED",
    "NIGHT",
    "ANGLE",
    "OCCLUDED",
    "LOW_CONTRAST",
    "MULTI_OBJECT",
    "DISTANT",
  ] as const;
  const expectedKinds = {
    WORK_TYPE: ["WORK_TYPE_CANDIDATE"],
    PROGRESS_CUE: ["PROGRESS_CUE"],
    CONTRADICTION: ["PROGRESS_CONTRADICTION"],
    SAFETY: ["SAFETY_ADVISORY"],
    DELIVERY: ["DELIVERY_CANDIDATE"],
    UNREADABLE: ["UNREADABLE"],
    FOREIGN_CURRENCY: [],
    NEGATIVE_CONTROL: [],
  } as const;
  const sceneFamily = sceneFamilies[index % sceneFamilies.length]!;
  const expected = expectedKinds[sceneFamily];

  return {
    schemaVersion: 1 as const,
    caseId: `a1-image-real-${sequence}`,
    sourceFileName: `real-${sequence}.jpg`,
    sourceText: sceneFamily === "CONTRADICTION" ? "Ажил 100 хувь дууссан." : null,
    artifactPath: `a1-real-images.assets/${sequence}.jpg`,
    artifactSha256: (index + 1).toString(16).padStart(64, "0"),
    sceneFamily,
    difficulty: difficulties[index % difficulties.length]!,
    expectedKinds: [...expected],
    requireVisibleRegionEvidence: expected.length > 0,
    humanReviewed: true,
    notes: "Хүний баталгаажуулсан, нууцлал арилгасан зураг.",
  };
}

describe("Phase 2 production evaluation gate", () => {
  it("defines 120 balanced A1 text-label contract cases", () => {
    const cases = buildA1TextGoldenCases();

    expect(cases).toHaveLength(120);
    expect(new Set(cases.map((item) => item.caseId)).size).toBe(120);
    expect(new Set(cases.map((item) => item.category)).size).toBe(10);
    expect(cases.every((item) => item.requiresHumanReview && item.forbidInventedFields)).toBe(true);
  });

  it("defines 64 balanced A1 image-label contract cases", () => {
    const cases = buildA1ImageGoldenCases();

    expect(cases).toHaveLength(64);
    expect(new Set(cases.map((item) => item.caseId)).size).toBe(64);
    expect(new Set(cases.map((item) => item.sceneFamily)).size).toBe(8);
    expect(new Set(cases.map((item) => item.difficulty)).size).toBe(8);
    expect(
      cases.every(
        (item) =>
          item.forbidAutomaticAlert &&
          item.forbidAutomaticSafetyDecision &&
          item.forbidUngroundedNumericProgress,
      ),
    ).toBe(true);
  });

  it("scores vision precision, recall, regions, and false accusations", () => {
    const cases = buildA1ImageGoldenCases();
    const metrics = scoreA1ImagePredictions(
      cases.map((golden) => ({
        golden,
        prediction: {
          caseId: golden.caseId,
          predictedKinds: golden.expectedKinds,
          automaticAlertCreated: false,
          automaticSafetyDecisionCreated: false,
          ungroundedNumericProgressClaim: false,
          visibleRegionEvidence: golden.requireVisibleRegionEvidence,
        },
      })),
    );

    expect(metrics).toMatchObject({
      caseCount: 64,
      precision: 1,
      recall: 1,
      f1: 1,
      falseAccusationRate: 0,
      missingVisibleRegionRate: 0,
    });
  });

  it("requires 60 complete human-reviewed real-image labels", () => {
    const workspace = a1ImageAnnotationWorkspaceV1Schema.parse({
      schemaVersion: 1,
      datasetId: "a1-real-images-v1",
      reviewedBy: "qa-reviewer",
      reviewedAt: "2026-07-30T00:00:00.000Z",
      anonymized: true,
      collectionConsentConfirmed: true,
      cases: Array.from({ length: 60 }, (_, index) => imageWorkspaceCase(index)),
    });

    expect(assertReleaseReadyImageWorkspace(workspace).cases).toHaveLength(60);
    expect(() =>
      assertReleaseReadyImageWorkspace({
        ...workspace,
        reviewedAt: null,
      }),
    ).toThrow("requires reviewedAt");
    expect(() =>
      assertReleaseReadyImageWorkspace({
        ...workspace,
        cases: workspace.cases.slice(0, 59),
      }),
    ).toThrow("requires 60+ images");
  });

  it("passes the deterministic Phase 2 gate and keeps real-image release evidence explicit", async () => {
    const report = await runPhase2ProductionGate();

    expect(report.a1.textContractCaseCount).toBe(120);
    expect(report.a1.syntheticContractCaseCount).toBe(64);
    expect(report.a2.caseCount).toBeGreaterThanOrEqual(30);
    expect(report.a2.forecastCandidateCount).toBeGreaterThan(report.a2.forecastSampleCount);
    expect(report.a2.forecastSampleCount).toBeGreaterThanOrEqual(30);
    expect(report.a2.forecastInsufficientDataExcludedCount).toBeGreaterThan(0);
    expect(report.a2.forecastMeanAbsoluteErrorDays).toBeLessThanOrEqual(7);
    expect(report.a2.forecastP90AbsoluteErrorDays).toBeLessThanOrEqual(7);
    expect(report.a2.forecastMaximumAbsoluteErrorDays).toBeLessThanOrEqual(7);
    expect(report.a3.caseCount).toBeGreaterThanOrEqual(20);
    expect(report.a4.questionCount).toBeGreaterThanOrEqual(80);
    expect(report.a4.toolCoverage).toBe(11);
    expect(report.technicalPass).toBe(true);
    expect(report.releasePass).toBe(false);
    expect(report.externalRequirements).toHaveLength(1);
  }, 120_000);
});
