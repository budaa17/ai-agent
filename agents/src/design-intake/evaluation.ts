import { BuiltInArtifactMalwareScanner } from "../artifacts/malware.js";
import { designElementCandidateV1Schema } from "../contracts/design/index.js";
import {
  buildEngineeringWorkbookFixture,
  buildVectorArchitecturalPdfFixture,
  vectorArchitectureGoldenLabels,
  type VectorPdfFixtureOptions,
} from "./fixtures.js";
import { intakeDesignFile } from "./file-intake.js";
import { prepareElementDecision, reviewScaleCandidate } from "./review.js";
import { extractVectorArchitecture, registerArchitecturalRevision } from "./vector-architecture.js";
import { importEngineeringWorkbook } from "./workbook.js";

const fixedTimes = {
  intake: "2026-08-01T00:00:00.000Z",
  revision: "2026-08-01T00:01:00.000Z",
  extraction: "2026-08-01T00:02:00.000Z",
  review: "2026-08-01T00:03:00.000Z",
};

async function buildPdfPipeline(suffix: string, options: VectorPdfFixtureOptions = {}) {
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
    scanner: new BuiltInArtifactMalwareScanner(() => fixedTimes.intake),
    createdBy: "engineer-evaluator",
    createdAt: fixedTimes.intake,
  });
  if (intake.inspectedPdf === null) {
    throw new Error(`Evaluation PDF ${suffix} was not inspected`);
  }
  const registration = registerArchitecturalRevision({
    intake: intake.result,
    inspectedPdf: intake.inspectedPdf,
    revisionId: `revision-${suffix}`,
    revisionCode: `R-${suffix}`,
    title: `Evaluation ${suffix}`,
    issuedOn: "2026-08-01",
    discipline: "ARCHITECTURE",
    registeredAt: fixedTimes.revision,
  });
  if (registration.revision === null) {
    throw new Error(`Evaluation revision ${suffix} was not registered`);
  }
  const extraction = extractVectorArchitecture({
    intake: intake.result,
    revision: registration.revision,
    inspectedPdf: intake.inspectedPdf,
    extractedAt: fixedTimes.extraction,
  });
  return { data, intake, registration, extraction };
}

export type DesignIntakeEvaluationReport = {
  schemaVersion: 1;
  evaluationType: "BUILDWATCH_V22_DESIGN_INTAKE";
  evaluatedAt: string;
  metrics: {
    workbookValid: boolean;
    workbookFormulaRejected: boolean;
    elementTruePositive: number;
    elementFalsePositive: number;
    elementFalseNegative: number;
    elementPrecision: number;
    elementRecall: number;
    unverifiedMetricDimensionCount: number;
    verifiedMetricDimensionCount: number;
    sourceLessAcceptedElementCount: number;
    revisionConflictRoutedToReview: boolean;
    rotatedPageDetected: boolean;
    mixedScaleRoutedToReview: boolean;
    missingScaleMetricDimensionCount: number;
    rejectedScaleMetricDimensionCount: number;
  };
  thresholds: {
    minimumElementPrecision: number;
    minimumElementRecall: number;
  };
  passed: boolean;
};

export async function evaluateDesignIntakeV22(): Promise<DesignIntakeEvaluationReport> {
  const workbookBytes = await buildEngineeringWorkbookFixture();
  const workbookIntake = await intakeDesignFile({
    intakeId: "intake-workbook-eval",
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    documentId: "document-workbook-eval",
    artifactId: "artifact-workbook-eval",
    originalFileName: "BuildWatch_Project_Input.xlsx",
    data: workbookBytes,
    declaredMediaType: "XLSX",
    scanner: new BuiltInArtifactMalwareScanner(() => fixedTimes.intake),
    createdBy: "engineer-evaluator",
    createdAt: fixedTimes.intake,
  });
  const workbook = await importEngineeringWorkbook({
    intake: workbookIntake.result,
    data: workbookBytes,
    importVersion: 1,
    importedBy: "engineer-evaluator",
    importedAt: fixedTimes.revision,
  });

  const formulaBytes = await buildEngineeringWorkbookFixture({
    overrides: [
      {
        sheetName: "07_Prices",
        columnName: "UnitPriceMnt",
        value: { formula: "1+1", result: 2 },
      },
    ],
  });
  const formulaIntake = await intakeDesignFile({
    intakeId: "intake-workbook-formula",
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    documentId: "document-workbook-formula",
    artifactId: "artifact-workbook-formula",
    originalFileName: "BuildWatch_Project_Formula.xlsx",
    data: formulaBytes,
    declaredMediaType: "XLSX",
    scanner: new BuiltInArtifactMalwareScanner(() => fixedTimes.intake),
    createdBy: "engineer-evaluator",
    createdAt: fixedTimes.intake,
  });
  const formulaWorkbook = await importEngineeringWorkbook({
    intake: formulaIntake.result,
    data: formulaBytes,
    importVersion: 1,
    importedBy: "engineer-evaluator",
    importedAt: fixedTimes.revision,
  });

  const standard = await buildPdfPipeline("standard");
  const predictedLabels = new Set(
    standard.extraction.elementCandidates.map(
      (candidate) => `${candidate.elementType}:${candidate.elementCode}`,
    ),
  );
  const goldenLabels = new Set(vectorArchitectureGoldenLabels);
  const truePositive = [...predictedLabels].filter((label) => goldenLabels.has(label)).length;
  const falsePositive = predictedLabels.size - truePositive;
  const falseNegative = goldenLabels.size - truePositive;
  const precision =
    truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall =
    truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const unverifiedMetricDimensionCount = standard.extraction.elementCandidates.flatMap(
    (candidate) => candidate.dimensions,
  ).length;
  const scaleCandidate = standard.extraction.scaleCandidates.find(
    (candidate) => candidate.sourceType === "VECTOR_DIMENSION",
  );
  if (scaleCandidate === undefined) {
    throw new Error("Golden PDF did not emit a vector scale candidate");
  }
  const scaleReview = reviewScaleCandidate({
    candidate: scaleCandidate,
    action: "APPROVE",
    scaleId: "scale-standard",
    reviewerId: "engineer-evaluator",
    reviewedAt: fixedTimes.review,
    reason: "Golden vector dimension checked",
  });
  if (scaleReview.status !== "VERIFIED") {
    throw new Error("Golden scale verification failed");
  }
  const verifiedExtraction = extractVectorArchitecture({
    intake: standard.intake.result,
    revision: standard.registration.revision!,
    inspectedPdf: standard.intake.inspectedPdf!,
    verifiedScales: [scaleReview.verifiedScale],
    extractedAt: fixedTimes.review,
  });
  const verifiedMetricDimensionCount = verifiedExtraction.elementCandidates.flatMap(
    (candidate) => candidate.dimensions,
  ).length;

  const prepared = prepareElementDecision({
    candidate: standard.extraction.elementCandidates[0]!,
    operation: "ACCEPT",
    reviewerId: "engineer-evaluator",
    reviewedAt: fixedTimes.review,
    reason: "Golden source checked",
  });
  const sourceLessAcceptedElementCount = designElementCandidateV1Schema.safeParse({
    ...prepared,
    sourceRefs: [],
  }).success
    ? 1
    : 0;

  const conflict = registerArchitecturalRevision({
    intake: standard.intake.result,
    inspectedPdf: standard.intake.inspectedPdf!,
    revisionId: "revision-conflict",
    revisionCode: standard.registration.revision!.revisionCode,
    title: "Conflicting revision",
    issuedOn: "2026-08-01",
    discipline: "ARCHITECTURE",
    existingRevisions: [
      {
        ...structuredClone(standard.registration.revision!),
        revisionId: "revision-existing",
        documentId: "document-existing",
      },
    ],
    registeredAt: fixedTimes.review,
  });

  const rotated = await buildPdfPipeline("rotated", { rotation: 90 });
  const mixed = await buildPdfPipeline("mixed", { mixedScale: true });
  const missing = await buildPdfPipeline("missing", { missingScale: true });
  const rejectedScale = reviewScaleCandidate({
    candidate: scaleCandidate,
    action: "REJECT",
    scaleId: "scale-rejected",
    reviewerId: "engineer-evaluator",
    reviewedAt: fixedTimes.review,
    reason: "Dimension label does not match engineer measurement",
  });
  const rejectedScaleExtraction = extractVectorArchitecture({
    intake: standard.intake.result,
    revision: standard.registration.revision!,
    inspectedPdf: standard.intake.inspectedPdf!,
    verifiedScales: rejectedScale.status === "VERIFIED" ? [rejectedScale.verifiedScale] : [],
    extractedAt: fixedTimes.review,
  });

  const metrics: DesignIntakeEvaluationReport["metrics"] = {
    workbookValid:
      workbook.status === "READY_FOR_REVIEW" &&
      workbook.sheets.length === 18 &&
      workbook.sheets.every((sheet) => sheet.acceptedRows.length === 1),
    workbookFormulaRejected:
      formulaWorkbook.status === "INVALID" &&
      formulaWorkbook.sheets.some((sheet) =>
        sheet.issues.some((item) => item.code === "WORKBOOK_CELL_UNSUPPORTED"),
      ),
    elementTruePositive: truePositive,
    elementFalsePositive: falsePositive,
    elementFalseNegative: falseNegative,
    elementPrecision: precision,
    elementRecall: recall,
    unverifiedMetricDimensionCount,
    verifiedMetricDimensionCount,
    sourceLessAcceptedElementCount,
    revisionConflictRoutedToReview:
      conflict.requiresHumanReview && conflict.conflictRevisionIds.length === 1,
    rotatedPageDetected:
      rotated.intake.result.pages[0]?.rotation === 90 &&
      rotated.extraction.elementCandidates.length === goldenLabels.size,
    mixedScaleRoutedToReview: mixed.extraction.issues.some(
      (item) => item.code === "DRAWING_MIXED_SCALE_CONFLICT",
    ),
    missingScaleMetricDimensionCount: missing.extraction.elementCandidates.flatMap(
      (candidate) => candidate.dimensions,
    ).length,
    rejectedScaleMetricDimensionCount: rejectedScaleExtraction.elementCandidates.flatMap(
      (candidate) => candidate.dimensions,
    ).length,
  };
  const thresholds = {
    minimumElementPrecision: 0.95,
    minimumElementRecall: 0.95,
  };
  const passed =
    metrics.workbookValid &&
    metrics.workbookFormulaRejected &&
    metrics.elementPrecision >= thresholds.minimumElementPrecision &&
    metrics.elementRecall >= thresholds.minimumElementRecall &&
    metrics.unverifiedMetricDimensionCount === 0 &&
    metrics.verifiedMetricDimensionCount > 0 &&
    metrics.sourceLessAcceptedElementCount === 0 &&
    metrics.revisionConflictRoutedToReview &&
    metrics.rotatedPageDetected &&
    metrics.mixedScaleRoutedToReview &&
    metrics.missingScaleMetricDimensionCount === 0 &&
    metrics.rejectedScaleMetricDimensionCount === 0;

  return {
    schemaVersion: 1,
    evaluationType: "BUILDWATCH_V22_DESIGN_INTAKE",
    evaluatedAt: fixedTimes.review,
    metrics,
    thresholds,
    passed,
  };
}
