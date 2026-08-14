import {
  designElementCandidateV1Schema,
  verifiedDrawingScaleV1Schema,
  type DesignElementCandidateV1,
  type VerifiedDrawingScaleV1,
} from "../contracts/design/index.js";
import {
  designReviewAuditV1Schema,
  drawingScaleCandidateV1Schema,
  type DesignReviewAuditV1,
  type DrawingScaleCandidateV1,
} from "./contracts.js";
import { hashCanonical } from "./deterministic.js";

type ScaleCorrection = {
  drawingUnits: string;
  drawingUnit: DrawingScaleCandidateV1["drawingUnit"];
  realWorldUnits: string;
};

export type ReviewScaleCandidateInput = {
  candidate: DrawingScaleCandidateV1;
  action: "APPROVE" | "REJECT";
  scaleId: string;
  reviewerId: string;
  reviewedAt: string;
  reason: string;
  correction?: ScaleCorrection;
};

export type ReviewScaleCandidateResult =
  | {
      status: "VERIFIED";
      candidate: DrawingScaleCandidateV1;
      verifiedScale: VerifiedDrawingScaleV1;
      audit: DesignReviewAuditV1;
    }
  | {
      status: "REJECTED";
      candidate: DrawingScaleCandidateV1;
      verifiedScale: null;
      audit: DesignReviewAuditV1;
    };

export function reviewScaleCandidate(input: ReviewScaleCandidateInput): ReviewScaleCandidateResult {
  const candidate = drawingScaleCandidateV1Schema.parse(input.candidate);
  if (input.reason.trim().length === 0) {
    throw new Error("Scale review requires an audit reason");
  }
  const decision = {
    decisionId: `scale-decision-${input.scaleId}`,
    action: input.action,
    reviewerId: input.reviewerId,
    reviewerRole: "ENGINEER" as const,
    decidedAt: input.reviewedAt,
    reason: input.action === "APPROVE" ? null : input.reason,
    correctedFieldPaths:
      input.correction === undefined ? [] : ["drawingUnits", "drawingUnit", "realWorldUnits"],
  };

  if (input.action === "REJECT") {
    const rejected = drawingScaleCandidateV1Schema.parse({
      ...candidate,
      status: "REJECTED",
      drawingUnits: null,
      drawingUnit: null,
      realWorldUnits: null,
      issues: [
        ...candidate.issues,
        {
          code: "DRAWING_SCALE_REJECTED",
          severity: "ERROR",
          fieldPaths: ["status"],
          message: input.reason,
          deterministic: false,
        },
      ],
    });
    const audit = designReviewAuditV1Schema.parse({
      schemaVersion: 1,
      auditType: "DESIGN_REVIEW_AUDIT",
      auditId: `scale-audit-${input.scaleId}`,
      tenantId: candidate.tenantId,
      projectId: candidate.projectId,
      operation: "SCALE_REJECT",
      sourceIds: [candidate.candidateId],
      resultIds: [rejected.candidateId],
      beforeHashes: [hashCanonical(candidate)],
      afterHashes: [hashCanonical(rejected)],
      reason: input.reason,
      actorId: input.reviewerId,
      actorRole: "ENGINEER",
      reviewDecision: decision,
      occurredAt: input.reviewedAt,
    });
    return {
      status: "REJECTED",
      candidate: rejected,
      verifiedScale: null,
      audit,
    };
  }

  const drawingUnits = input.correction?.drawingUnits ?? candidate.drawingUnits;
  const drawingUnit = input.correction?.drawingUnit ?? candidate.drawingUnit;
  const realWorldUnits = input.correction?.realWorldUnits ?? candidate.realWorldUnits;
  if (
    candidate.status !== "CANDIDATE" ||
    drawingUnits === null ||
    drawingUnit === null ||
    realWorldUnits === null
  ) {
    throw new Error("Only a complete scale candidate can be verified");
  }
  if (drawingUnit === "px") {
    throw new Error("Pixel scale cannot verify vector PDF metric geometry");
  }

  const verifiedScale = verifiedDrawingScaleV1Schema.parse({
    schemaVersion: 1,
    scaleType: "VERIFIED_DRAWING_SCALE",
    scaleId: input.scaleId,
    tenantId: candidate.tenantId,
    projectId: candidate.projectId,
    revisionId: candidate.revisionId,
    pageId: candidate.pageId,
    status: "VERIFIED",
    drawingUnits,
    drawingUnit,
    realWorldUnits,
    realWorldUnit: "m",
    sourceRefs: candidate.sourceRefs,
    reviewedBy: input.reviewerId,
    reviewedAt: input.reviewedAt,
    reviewDecision: decision,
  });
  const audit = designReviewAuditV1Schema.parse({
    schemaVersion: 1,
    auditType: "DESIGN_REVIEW_AUDIT",
    auditId: `scale-audit-${input.scaleId}`,
    tenantId: candidate.tenantId,
    projectId: candidate.projectId,
    operation: "SCALE_VERIFY",
    sourceIds: [candidate.candidateId],
    resultIds: [verifiedScale.scaleId],
    beforeHashes: [hashCanonical(candidate)],
    afterHashes: [hashCanonical(verifiedScale)],
    reason: input.reason,
    actorId: input.reviewerId,
    actorRole: "ENGINEER",
    reviewDecision: decision,
    occurredAt: input.reviewedAt,
  });
  return {
    status: "VERIFIED",
    candidate,
    verifiedScale,
    audit,
  };
}

export type ElementReviewOperation = "ACCEPT" | "EDIT" | "REJECT" | "MERGE" | "SPLIT";

export type ReviewDesignCandidatesInput = {
  operation: ElementReviewOperation;
  sourceCandidates: readonly DesignElementCandidateV1[];
  resultCandidates: readonly DesignElementCandidateV1[];
  verifiedScales?: readonly VerifiedDrawingScaleV1[];
  auditId: string;
  reviewerId: string;
  reviewedAt: string;
  reason: string;
};

function ensureReviewShape(input: ReviewDesignCandidatesInput): void {
  const sourceCount = input.sourceCandidates.length;
  const resultCount = input.resultCandidates.length;
  const valid =
    (input.operation === "ACCEPT" && sourceCount === 1 && resultCount === 1) ||
    (input.operation === "EDIT" && sourceCount === 1 && resultCount === 1) ||
    (input.operation === "REJECT" && sourceCount === 1 && resultCount === 1) ||
    (input.operation === "MERGE" && sourceCount >= 2 && resultCount === 1) ||
    (input.operation === "SPLIT" && sourceCount === 1 && resultCount >= 2);
  if (!valid) {
    throw new Error(`Invalid ${input.operation} source/result cardinality`);
  }
}

export function reviewDesignCandidates(input: ReviewDesignCandidatesInput): DesignReviewAuditV1 {
  ensureReviewShape(input);
  if (input.reason.trim().length === 0) {
    throw new Error("Design review requires an audit reason");
  }
  const sources = input.sourceCandidates.map((candidate) =>
    designElementCandidateV1Schema.parse(candidate),
  );
  const results = input.resultCandidates.map((candidate) =>
    designElementCandidateV1Schema.parse(candidate),
  );
  const scope = sources[0]!;
  if (
    [...sources, ...results].some(
      (candidate) =>
        candidate.tenantId !== scope.tenantId ||
        candidate.projectId !== scope.projectId ||
        candidate.revisionId !== scope.revisionId,
    )
  ) {
    throw new Error("Design review candidates cross tenant, project, or revision scope");
  }
  if (input.operation === "ACCEPT" && results[0]!.candidateId !== sources[0]!.candidateId) {
    throw new Error("Accept review must retain the candidate identifier");
  }
  if (input.operation === "REJECT" && results[0]!.candidateId !== sources[0]!.candidateId) {
    throw new Error("Reject review must retain the candidate identifier");
  }
  if (
    ["EDIT", "MERGE", "SPLIT"].includes(input.operation) &&
    results.some((result) => sources.some((source) => source.candidateId === result.candidateId))
  ) {
    throw new Error("Edit, merge, and split results require new immutable identifiers");
  }

  const expectedMethod = {
    EDIT: "ENGINEER_EDIT",
    MERGE: "ENGINEER_MERGE",
    SPLIT: "ENGINEER_SPLIT",
  } as const;
  if (
    input.operation in expectedMethod &&
    results.some(
      (result) =>
        result.extractionMethod !== expectedMethod[input.operation as keyof typeof expectedMethod],
    )
  ) {
    throw new Error(`${input.operation} result has incorrect extraction lineage`);
  }

  const action = input.operation === "REJECT" ? "REJECT" : "APPROVE";
  for (const result of results) {
    if (
      result.status !== (action === "APPROVE" ? "ACCEPTED" : "REJECTED") ||
      result.reviewDecision?.action !== action ||
      result.reviewDecision.reviewerId !== input.reviewerId ||
      result.reviewDecision.reviewerRole !== "ENGINEER" ||
      result.reviewDecision.decidedAt !== input.reviewedAt
    ) {
      throw new Error("Result candidate does not carry the current engineer decision");
    }
    if (result.dimensions.length === 0) {
      continue;
    }
    const scale = (input.verifiedScales ?? []).find(
      (candidate) => candidate.scaleId === result.scaleId,
    );
    if (
      scale === undefined ||
      scale.status !== "VERIFIED" ||
      scale.tenantId !== result.tenantId ||
      scale.projectId !== result.projectId ||
      scale.revisionId !== result.revisionId ||
      scale.pageId !== result.pageId
    ) {
      throw new Error("Metric candidate review requires its exact VERIFIED page scale");
    }
  }

  const reviewDecision = results[0]!.reviewDecision!;
  return designReviewAuditV1Schema.parse({
    schemaVersion: 1,
    auditType: "DESIGN_REVIEW_AUDIT",
    auditId: input.auditId,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    operation: input.operation,
    sourceIds: sources.map((candidate) => candidate.candidateId),
    resultIds: results.map((candidate) => candidate.candidateId),
    beforeHashes: sources.map(hashCanonical),
    afterHashes: results.map(hashCanonical),
    reason: input.reason,
    actorId: input.reviewerId,
    actorRole: "ENGINEER",
    reviewDecision,
    occurredAt: input.reviewedAt,
  });
}

type EditableCandidateFields = Pick<
  DesignElementCandidateV1,
  | "elementCode"
  | "name"
  | "floorCode"
  | "zoneCode"
  | "geometryType"
  | "boundingRegion"
  | "dimensions"
  | "properties"
  | "sourceRefs"
  | "scaleId"
>;

export function prepareElementDecision(input: {
  candidate: DesignElementCandidateV1;
  operation: "ACCEPT" | "EDIT" | "REJECT";
  resultCandidateId?: string;
  patch?: Partial<EditableCandidateFields>;
  reviewerId: string;
  reviewedAt: string;
  reason: string;
}): DesignElementCandidateV1 {
  const candidate = designElementCandidateV1Schema.parse(input.candidate);
  if (input.operation === "EDIT" && input.resultCandidateId === undefined) {
    throw new Error("Edited candidate requires a new identifier");
  }
  const action = input.operation === "REJECT" ? "REJECT" : "APPROVE";
  const patch = input.patch ?? {};
  return designElementCandidateV1Schema.parse({
    ...candidate,
    ...patch,
    candidateId: input.operation === "EDIT" ? input.resultCandidateId : candidate.candidateId,
    extractionMethod: input.operation === "EDIT" ? "ENGINEER_EDIT" : candidate.extractionMethod,
    status: action === "APPROVE" ? "ACCEPTED" : "REJECTED",
    reviewDecision: {
      decisionId: `element-decision-${input.resultCandidateId ?? candidate.candidateId}`,
      action,
      reviewerId: input.reviewerId,
      reviewerRole: "ENGINEER",
      decidedAt: input.reviewedAt,
      reason: action === "REJECT" ? input.reason : null,
      correctedFieldPaths: Object.keys(patch),
    },
    createdAt: input.operation === "EDIT" ? input.reviewedAt : candidate.createdAt,
    createdBy: input.operation === "EDIT" ? input.reviewerId : candidate.createdBy,
  });
}
