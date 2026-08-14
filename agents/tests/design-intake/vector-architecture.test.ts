import { describe, expect, it } from "vitest";
import { BuiltInArtifactMalwareScanner } from "../../src/artifacts/index.js";
import {
  buildVectorArchitecturalPdfFixture,
  evaluateDesignIntakeV22,
  extractVectorArchitecture,
  intakeDesignFile,
  prepareElementDecision,
  registerArchitecturalRevision,
  reviewDesignCandidates,
  reviewScaleCandidate,
} from "../../src/design-intake/index.js";

const times = {
  intake: "2026-08-01T00:00:00.000Z",
  revision: "2026-08-01T00:01:00.000Z",
  review: "2026-08-01T00:02:00.000Z",
};

async function pipeline(
  suffix: string,
  options: Parameters<typeof buildVectorArchitecturalPdfFixture>[0] = {},
) {
  const data = buildVectorArchitecturalPdfFixture(options);
  const intake = await intakeDesignFile({
    intakeId: `intake-${suffix}`,
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    documentId: `document-${suffix}`,
    artifactId: `artifact-${suffix}`,
    originalFileName: `${suffix}.pdf`,
    data,
    declaredMediaType: "PDF",
    scanner: new BuiltInArtifactMalwareScanner(() => times.intake),
    createdAt: times.intake,
    createdBy: "engineer-test",
  });
  const registration = registerArchitecturalRevision({
    intake: intake.result,
    inspectedPdf: intake.inspectedPdf!,
    revisionId: `revision-${suffix}`,
    revisionCode: `R-${suffix}`,
    title: suffix,
    issuedOn: "2026-08-01",
    discipline: "ARCHITECTURE",
    registeredAt: times.revision,
  });
  const extraction = extractVectorArchitecture({
    intake: intake.result,
    revision: registration.revision!,
    inspectedPdf: intake.inspectedPdf!,
    extractedAt: times.revision,
  });
  return { intake, registration, extraction };
}

describe("BuildWatch v2.2 vector architecture pipeline", () => {
  it("extracts six source-backed types while blocking unverified metric dimensions", async () => {
    const result = await pipeline("elements");

    expect(new Set(result.extraction.elementCandidates.map((item) => item.elementType))).toEqual(
      new Set(["FLOOR", "ZONE", "ROOM", "WALL", "DOOR", "WINDOW"]),
    );
    expect(result.extraction.elementCandidates.flatMap((item) => item.dimensions)).toHaveLength(0);
    expect(
      result.extraction.elementCandidates.every((item) => item.sourceRefs[0]?.region !== null),
    ).toBe(true);
  });

  it("emits metric dimensions only after engineer scale approval", async () => {
    const result = await pipeline("verified");
    const scale = result.extraction.scaleCandidates.find(
      (candidate) => candidate.sourceType === "VECTOR_DIMENSION",
    )!;
    const review = reviewScaleCandidate({
      candidate: scale,
      action: "APPROVE",
      scaleId: "scale-verified",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Dimension checked against drawing",
    });
    expect(review.status).toBe("VERIFIED");
    if (review.status !== "VERIFIED") return;

    const verified = extractVectorArchitecture({
      intake: result.intake.result,
      revision: result.registration.revision!,
      inspectedPdf: result.intake.inspectedPdf!,
      verifiedScales: [review.verifiedScale],
      extractedAt: times.review,
    });
    expect(verified.elementCandidates.flatMap((item) => item.dimensions).length).toBeGreaterThan(0);

    const rejected = reviewScaleCandidate({
      candidate: scale,
      action: "REJECT",
      scaleId: "scale-rejected",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Engineer measurement conflicts",
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.verifiedScale).toBeNull();
  });

  it("keeps accept/edit/reject decisions immutable and auditable", async () => {
    const result = await pipeline("review");
    const source = result.extraction.elementCandidates[0]!;
    const accepted = prepareElementDecision({
      candidate: source,
      operation: "ACCEPT",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Source geometry checked",
    });
    const acceptAudit = reviewDesignCandidates({
      operation: "ACCEPT",
      sourceCandidates: [source],
      resultCandidates: [accepted],
      auditId: "audit-accept",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Source geometry checked",
    });
    expect(acceptAudit.operation).toBe("ACCEPT");
    expect(source.status).toBe("REVIEW_REQUIRED");

    const edited = prepareElementDecision({
      candidate: source,
      operation: "EDIT",
      resultCandidateId: "element-edited",
      patch: { name: "Engineer corrected element" },
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Name corrected",
    });
    const editAudit = reviewDesignCandidates({
      operation: "EDIT",
      sourceCandidates: [source],
      resultCandidates: [edited],
      auditId: "audit-edit",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Name corrected",
    });
    expect(editAudit.resultIds).toEqual(["element-edited"]);

    const rejected = prepareElementDecision({
      candidate: source,
      operation: "REJECT",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Label is not an architectural element",
    });
    const rejectAudit = reviewDesignCandidates({
      operation: "REJECT",
      sourceCandidates: [source],
      resultCandidates: [rejected],
      auditId: "audit-reject",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Label is not an architectural element",
    });
    expect(rejectAudit.reviewDecision.action).toBe("REJECT");
  });

  it("audits engineer merge, split, and scale correction operations", async () => {
    const result = await pipeline("merge-split");
    const [first, second] = result.extraction.elementCandidates;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const merged = {
      ...prepareElementDecision({
        candidate: first!,
        operation: "EDIT",
        resultCandidateId: "element-merged",
        patch: {
          name: "Engineer merged region",
          sourceRefs: [...first!.sourceRefs, ...second!.sourceRefs],
        },
        reviewerId: "engineer-test",
        reviewedAt: times.review,
        reason: "Two labels describe one element",
      }),
      extractionMethod: "ENGINEER_MERGE" as const,
    };
    const mergeAudit = reviewDesignCandidates({
      operation: "MERGE",
      sourceCandidates: [first!, second!],
      resultCandidates: [merged],
      auditId: "audit-merge",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Two labels describe one element",
    });
    expect(mergeAudit.sourceIds).toHaveLength(2);
    expect(mergeAudit.resultIds).toEqual(["element-merged"]);

    const splitResults = ["element-split-a", "element-split-b"].map((candidateId) => ({
      ...prepareElementDecision({
        candidate: first!,
        operation: "EDIT",
        resultCandidateId: candidateId,
        reviewerId: "engineer-test",
        reviewedAt: times.review,
        reason: "One vector region contains two elements",
      }),
      extractionMethod: "ENGINEER_SPLIT" as const,
    }));
    const splitAudit = reviewDesignCandidates({
      operation: "SPLIT",
      sourceCandidates: [first!],
      resultCandidates: splitResults,
      auditId: "audit-split",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "One vector region contains two elements",
    });
    expect(splitAudit.resultIds).toHaveLength(2);

    const scale = result.extraction.scaleCandidates.find(
      (candidate) => candidate.sourceType === "TITLE_BLOCK",
    )!;
    const correctedScale = reviewScaleCandidate({
      candidate: scale,
      action: "APPROVE",
      scaleId: "scale-corrected",
      reviewerId: "engineer-test",
      reviewedAt: times.review,
      reason: "Known dimension supersedes title block",
      correction: {
        drawingUnits: "100",
        drawingUnit: "pt",
        realWorldUnits: "3.5",
      },
    });
    expect(correctedScale.status).toBe("VERIFIED");
    expect(correctedScale.audit.reviewDecision.correctedFieldPaths).toEqual([
      "drawingUnits",
      "drawingUnit",
      "realWorldUnits",
    ]);
  });

  it("passes rotated, mixed-scale, conflict, and no-fabrication gates", async () => {
    const report = await evaluateDesignIntakeV22();

    expect(report.passed).toBe(true);
    expect(report.metrics).toMatchObject({
      elementPrecision: 1,
      elementRecall: 1,
      unverifiedMetricDimensionCount: 0,
      sourceLessAcceptedElementCount: 0,
      revisionConflictRoutedToReview: true,
      rotatedPageDetected: true,
      mixedScaleRoutedToReview: true,
      missingScaleMetricDimensionCount: 0,
      rejectedScaleMetricDimensionCount: 0,
    });
  });
});
