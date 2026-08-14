import { describe, expect, it } from "vitest";
import {
  agentErrorV1Schema,
  documentBundleV1Schema,
  recommendationDraftV1Schema,
  referenceAnswerV1Schema,
} from "../../src/contracts/index.js";

const source = {
  sourceId: "source-progress-001",
  catalog: "PROGRESS" as const,
  entityId: "progress-001",
  tenantId: "tenant-demo",
  projectId: "project-atlas",
  observedAt: "2026-03-31T10:00:00.000Z",
  fieldPaths: ["progressPercent"],
};

function groundedRecommendation() {
  return {
    schemaVersion: 1 as const,
    artifactType: "RECOMMENDATION_DRAFT" as const,
    recommendationId: "recommendation-001",
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    snapshotId: "snapshot-001",
    analysisId: "analysis-001",
    generatedAt: "2026-03-31T18:00:00.000Z",
    observationKind: "ROOT_CAUSE" as const,
    priority: "HIGH" as const,
    title: "Өрлөгийн ажлын нөөцийг нэмэх",
    summary: "Баталгаатай хоцрогдлыг бууруулах ноорог.",
    rootCause: "Бүтээмж төлөвлөснөөс буурсан.",
    rootCauseGroupId: "root-cause-001",
    workItemIds: ["work-item-001"],
    actions: [
      {
        actionId: "action-001",
        actionType: "ADD_RESOURCE" as const,
        title: "Нэмэлт багийн scenario-г хэлэлцэх",
        description: "Менежер deterministic scenario-г шалгана.",
        scenarioType: "EXTRA_CREW" as const,
        scenarioId: "scenario-extra-crew-001",
        estimatedImpactWorkingDays: 4,
        estimatedCostMnt: "2500000.00",
        ownerRef: "user-project-manager",
        requiredResources: [
          {
            resourceType: "LABOR" as const,
            description: "Нэмэлт баг",
            quantity: null,
          },
        ],
        optionRisks: ["Чанарын хяналтын ачаалал нэмэгдэнэ."],
        dependencyConflicts: [],
        feasibilityStatus: "FEASIBLE" as const,
        dataSufficient: true,
      },
    ],
    sourceRefs: [source],
    contextMemoryRefs: [],
    dataFreshnessAt: "2026-03-31T10:00:00.000Z",
    confidenceScore: 0.91,
    confidenceLevel: "HIGH" as const,
    validationIssues: [],
    status: "PENDING_REVIEW" as const,
    requiresHumanReview: true as const,
  };
}

describe("versioned agent output contracts", () => {
  it("accepts a grounded recommendation draft", () => {
    const parsed = recommendationDraftV1Schema.parse(groundedRecommendation());

    expect(parsed.actions[0]?.estimatedImpactWorkingDays).toBe(4);
  });

  it("accepts a grounded document bundle and read-only answer", () => {
    const bundle = documentBundleV1Schema.parse({
      schemaVersion: 1,
      artifactType: "DOCUMENT_BUNDLE",
      bundleId: "bundle-001",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      snapshotId: "snapshot-001",
      analysisId: "analysis-001",
      generatedAt: "2026-03-31T18:00:00.000Z",
      documents: [
        {
          documentId: "document-001",
          documentType: "WEEKLY_REPORT",
          title: "Долоо хоногийн тайлан",
          language: "mn",
          periodFrom: "2026-03-25",
          periodTo: "2026-03-31",
          markdown: "# Тайлан\n\nБаримттай агуулга.",
          sourceRefs: [source],
          deterministicFactCount: 1,
          styleProfileRef: "style-tenant-demo",
          unsupportedClaimCount: 0,
          outputArtifact: null,
          status: "PENDING_REVIEW",
        },
      ],
      totalUnsupportedClaimCount: 0,
      status: "PENDING_REVIEW",
      requiresHumanReview: true,
    });
    const answer = referenceAnswerV1Schema.parse({
      schemaVersion: 1,
      artifactType: "REFERENCE_ANSWER",
      answerId: "answer-001",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      snapshotId: "snapshot-001",
      generatedAt: "2026-03-31T18:00:00.000Z",
      question: "Өрлөгийн явц хэд вэ?",
      answer: "Өрлөгийн явц 60 хувь байна.",
      status: "ANSWERED",
      suggestedRouteCode: null,
      claims: [
        {
          claimId: "claim-001",
          text: "Өрлөгийн явц 60 хувь.",
          status: "SUPPORTED",
          sourceValue: 60,
          asOf: "2026-03-31T18:00:00.000Z",
          sourceRefs: [source],
        },
      ],
      inspectedTools: ["getProgressHistory"],
      insufficientData: false,
      readOnly: true,
    });

    expect(bundle.documents).toHaveLength(1);
    expect(answer.readOnly).toBe(true);
  });

  it("rejects unknown fields, versions, and unsafe impact", () => {
    expect(
      agentErrorV1Schema.safeParse({
        category: "DATA",
        message: "Invalid snapshot",
        retryable: false,
        secret: "must-not-pass",
      }).success,
    ).toBe(false);
    expect(
      referenceAnswerV1Schema.safeParse({
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    const unsafe = groundedRecommendation();
    unsafe.actions[0] = {
      ...unsafe.actions[0]!,
      scenarioType: null as never,
      scenarioId: null as never,
      estimatedImpactWorkingDays: 5,
    };
    expect(recommendationDraftV1Schema.safeParse(unsafe).success).toBe(false);
  });
});
