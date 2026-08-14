import type { ContractValidationIssue } from "../contracts/common.js";
import {
  designElementCandidateV1Schema,
  drawingRevisionV1Schema,
  verifiedDrawingScaleV1Schema,
  type DesignElementCandidateV1,
  type DrawingRevisionV1,
  type VerifiedDrawingScaleV1,
} from "../contracts/design/index.js";
import type { BuildWatchSourceReference } from "../contracts/buildwatch-v2-common.js";
import {
  designExtractionBatchV1Schema,
  drawingRevisionRegistrationV1Schema,
  drawingScaleCandidateV1Schema,
  type DesignExtractionBatchV1,
  type DesignFileIntakeResultV1,
  type DrawingRevisionRegistrationV1,
  type DrawingScaleCandidateV1,
} from "./contracts.js";
import { decimal, deterministicId } from "./deterministic.js";
import type {
  InspectedPdfDocument,
  PdfNormalizedRegion,
  PdfTextSpan,
  PdfVectorPath,
} from "./pdf-inspection.js";

const extractionVersion = "buildwatch-vector-architecture-v1";

function issue(
  code: string,
  severity: ContractValidationIssue["severity"],
  fieldPath: string,
  message: string,
): ContractValidationIssue {
  return {
    code,
    severity,
    fieldPaths: [fieldPath],
    message,
    deterministic: true,
  };
}

function pageSource(
  input: {
    tenantId: string;
    projectId: string;
    artifactId: string;
    sha256: string;
    sourceId: string;
  },
  pageNumber: number,
  region: PdfNormalizedRegion | null,
  description: string,
): BuildWatchSourceReference {
  return {
    sourceRefId: deterministicId(
      "drawing-source",
      input.sourceId,
      String(pageNumber),
      region === null ? "page" : JSON.stringify(region),
      description,
    ),
    tenantId: input.tenantId,
    projectId: input.projectId,
    sourceType: "DRAWING_REGION",
    sourceId: input.sourceId,
    sourceVersionId: null,
    artifactId: input.artifactId,
    pageNumber,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region:
      region === null
        ? null
        : {
            ...region,
            description,
          },
    asOf: null,
    sha256: input.sha256,
  };
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

function inferDiscipline(text: string): DrawingRevisionV1["discipline"] {
  const value = firstMatch(text, /(?:^|\n)\s*DISCIPLINE\s*[:#=-]?\s*([^\n]+)/iu)?.toLocaleUpperCase(
    "en-US",
  );
  if (value?.includes("ARCH")) return "ARCHITECTURE";
  if (value?.includes("STRUCT")) return "STRUCTURE";
  if (value?.includes("MECHAN")) return "MECHANICAL";
  if (value?.includes("ELECT")) return "ELECTRICAL";
  if (value?.includes("PLUMB")) return "PLUMBING";
  if (value?.includes("FIRE")) return "FIRE_SAFETY";
  return "UNKNOWN";
}

export type RegisterArchitecturalRevisionInput = {
  intake: DesignFileIntakeResultV1;
  inspectedPdf: InspectedPdfDocument;
  revisionId: string;
  revisionCode?: string;
  title?: string;
  issuedOn?: string;
  discipline?: DrawingRevisionV1["discipline"];
  supersedesRevisionId?: string | null;
  existingRevisions?: readonly DrawingRevisionV1[];
  registeredAt?: string;
};

export function registerArchitecturalRevision(
  input: RegisterArchitecturalRevisionInput,
): DrawingRevisionRegistrationV1 {
  if (input.intake.detectedMediaType !== "PDF" || input.intake.status === "REJECTED") {
    throw new Error("Revision registration requires a non-rejected PDF intake");
  }
  if (input.intake.sha256 !== input.intake.malwareScan.sha256) {
    throw new Error("Revision source checksum is not malware-grounded");
  }

  const fullText = input.inspectedPdf.pages
    .map((page) => page.textSpans.map((span) => span.text).join("\n"))
    .join("\n");
  const revisionCode =
    input.revisionCode ??
    firstMatch(fullText, /(?:^|\n)\s*REV(?:ISION)?\s*[:#=-]?\s*([A-Z0-9._-]+)/iu);
  const title = input.title ?? firstMatch(fullText, /(?:^|\n)\s*TITLE\s*[:#=-]?\s*([^\n]+)/iu);
  const issuedOn =
    input.issuedOn ??
    firstMatch(fullText, /(?:^|\n)\s*ISSUED(?:\s+ON)?\s*[:#=-]?\s*(\d{4}-\d{2}-\d{2})/iu);
  const discipline = input.discipline ?? inferDiscipline(fullText);
  const issues: ContractValidationIssue[] = [];

  if (revisionCode === null) {
    issues.push(
      issue(
        "DRAWING_REVISION_CODE_MISSING",
        "ERROR",
        "revisionCode",
        "Revision code is missing; engineer input is required",
      ),
    );
  }
  if (title === null) {
    issues.push(
      issue(
        "DRAWING_TITLE_MISSING",
        "ERROR",
        "title",
        "Drawing title is missing; engineer input is required",
      ),
    );
  }
  if (issuedOn === null) {
    issues.push(
      issue(
        "DRAWING_ISSUE_DATE_MISSING",
        "ERROR",
        "issuedOn",
        "Drawing issue date is missing; engineer input is required",
      ),
    );
  }
  if (discipline === "UNKNOWN") {
    issues.push(
      issue(
        "DRAWING_DISCIPLINE_MISSING",
        "ERROR",
        "discipline",
        "Drawing discipline is missing; engineer input is required",
      ),
    );
  }

  let revision: DrawingRevisionV1 | null = null;
  if (revisionCode !== null && title !== null && issuedOn !== null && discipline !== "UNKNOWN") {
    revision = drawingRevisionV1Schema.parse({
      schemaVersion: 1,
      revisionType: "DRAWING_REVISION",
      revisionId: input.revisionId,
      tenantId: input.intake.tenantId,
      projectId: input.intake.projectId,
      documentId: input.intake.documentId,
      revisionCode,
      title,
      discipline,
      issuedOn,
      status: "CANDIDATE",
      supersedesRevisionId: input.supersedesRevisionId ?? null,
      pages: input.inspectedPdf.pages.map((page) => {
        const pageText = page.textSpans.map((span) => span.text).join("\n");
        const sheetCode = firstMatch(
          pageText,
          /(?:^|\n)\s*SHEET(?:\s+CODE)?\s*[:#=-]?\s*([A-Z0-9._-]+)/iu,
        );
        const pageTitle = firstMatch(pageText, /(?:^|\n)\s*TITLE\s*[:#=-]?\s*([^\n]+)/iu) ?? title;
        return {
          pageId: `${input.revisionId}-page-${page.pageNumber}`,
          pageNumber: page.pageNumber,
          sheetCode,
          title: pageTitle,
          discipline,
          scaleStatus: /\b(?:SCALE\s*[:=]?\s*1\s*[:/]\s*\d+|DIM(?:ENSION)?\s*[:=]?\s*\d+)/iu.test(
            pageText,
          )
            ? "CANDIDATE"
            : "UNKNOWN",
          sourceRefs: [
            pageSource(
              {
                tenantId: input.intake.tenantId,
                projectId: input.intake.projectId,
                artifactId: input.intake.artifactId,
                sha256: input.intake.sha256,
                sourceId: input.revisionId,
              },
              page.pageNumber,
              null,
              `Drawing page ${page.pageNumber}`,
            ),
          ],
        };
      }),
      createdAt: input.registeredAt ?? new Date().toISOString(),
    });
  }

  const conflictRevisionIds =
    revision === null
      ? []
      : (input.existingRevisions ?? [])
          .filter(
            (existing) =>
              existing.tenantId === revision!.tenantId &&
              existing.projectId === revision!.projectId &&
              existing.revisionId !== revision!.revisionId &&
              existing.revisionCode.toLocaleUpperCase("en-US") ===
                revision!.revisionCode.toLocaleUpperCase("en-US") &&
              existing.documentId !== revision!.documentId,
          )
          .map((existing) => existing.revisionId);
  if (conflictRevisionIds.length > 0) {
    issues.push(
      issue(
        "DRAWING_REVISION_CONFLICT",
        "WARNING",
        "revisionCode",
        `Revision code conflicts with ${conflictRevisionIds.join(", ")}`,
      ),
    );
  }

  return drawingRevisionRegistrationV1Schema.parse({
    schemaVersion: 1,
    registrationType: "DRAWING_REVISION_REGISTRATION",
    tenantId: input.intake.tenantId,
    projectId: input.intake.projectId,
    documentId: input.intake.documentId,
    revision,
    conflictRevisionIds,
    requiresHumanReview: revision === null || conflictRevisionIds.length > 0,
    issues,
    registeredAt: input.registeredAt ?? new Date().toISOString(),
  });
}

function center(region: PdfNormalizedRegion): readonly [number, number] {
  return [region.x + region.width / 2, region.y + region.height / 2];
}

function regionDistance(left: PdfNormalizedRegion, right: PdfNormalizedRegion): number {
  const [leftX, leftY] = center(left);
  const [rightX, rightY] = center(right);
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function nearestPath(span: PdfTextSpan, paths: readonly PdfVectorPath[]): PdfVectorPath | null {
  return (
    [...paths]
      .sort(
        (left, right) =>
          regionDistance(span.region, left.region) - regionDistance(span.region, right.region),
      )
      .find((path) => regionDistance(span.region, path.region) <= 0.35) ?? null
  );
}

function regionUnion(left: PdfNormalizedRegion, right: PdfNormalizedRegion): PdfNormalizedRegion {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

function unitToMeters(value: number, unit: string): number {
  if (unit === "M") return value;
  if (unit === "CM") return value / 100;
  return value / 1_000;
}

export type ScaleCalibrationInput = {
  pageNumber: number;
  drawingDistancePt: number;
  realDistanceM: number;
  region: PdfNormalizedRegion;
  sourceType: "ENGINEER_KNOWN_DISTANCE" | "APPROVED_MANUAL_CALIBRATION";
};

export function extractDrawingScaleCandidates(input: {
  intake: DesignFileIntakeResultV1;
  revision: DrawingRevisionV1;
  inspectedPdf: InspectedPdfDocument;
  calibrations?: readonly ScaleCalibrationInput[];
  createdAt?: string;
}): DrawingScaleCandidateV1[] {
  const candidates: DrawingScaleCandidateV1[] = [];
  const createdAt = input.createdAt ?? new Date().toISOString();

  for (const page of input.inspectedPdf.pages) {
    const revisionPage = input.revision.pages.find(
      (candidate) => candidate.pageNumber === page.pageNumber,
    );
    if (revisionPage === undefined) {
      throw new Error(`Revision has no page ${page.pageNumber}`);
    }

    for (const [spanIndex, span] of page.textSpans.entries()) {
      const dimension = /\bDIM(?:ENSION)?\s*[:#=-]?\s*(\d+(?:\.\d+)?)\s*(MM|CM|M)\b/iu.exec(
        span.text,
      );
      if (dimension !== null) {
        const path = nearestPath(span, page.vectorPaths);
        if (path !== null) {
          const drawingDistancePt = Math.max(
            Math.abs(path.boundsPt[2] - path.boundsPt[0]),
            Math.abs(path.boundsPt[3] - path.boundsPt[1]),
          );
          if (drawingDistancePt > 0) {
            const region = regionUnion(span.region, path.region);
            candidates.push(
              drawingScaleCandidateV1Schema.parse({
                schemaVersion: 1,
                candidateType: "DRAWING_SCALE",
                candidateId: deterministicId(
                  "scale-candidate",
                  input.revision.revisionId,
                  String(page.pageNumber),
                  "dimension",
                  String(spanIndex),
                ),
                tenantId: input.revision.tenantId,
                projectId: input.revision.projectId,
                revisionId: input.revision.revisionId,
                pageId: revisionPage.pageId,
                sourceType: "VECTOR_DIMENSION",
                sourcePriority: 1,
                status: "CANDIDATE",
                drawingUnits: decimal(drawingDistancePt),
                drawingUnit: "pt",
                realWorldUnits: decimal(
                  unitToMeters(Number(dimension[1]), dimension[2]!.toUpperCase()),
                ),
                realWorldUnit: "m",
                displayScale: span.text,
                confidence: 0.95,
                sourceRefs: [
                  pageSource(
                    {
                      tenantId: input.revision.tenantId,
                      projectId: input.revision.projectId,
                      artifactId: input.intake.artifactId,
                      sha256: input.intake.sha256,
                      sourceId: input.revision.revisionId,
                    },
                    page.pageNumber,
                    region,
                    span.text,
                  ),
                ],
                extractionVersion,
                issues: [],
                createdAt,
              }),
            );
          }
        }
      }

      const titleScale = /\bSCALE\s*[:=]?\s*1\s*[:/]\s*(\d+(?:\.\d+)?)\b/iu.exec(span.text);
      if (titleScale !== null) {
        const denominator = Number(titleScale[1]);
        candidates.push(
          drawingScaleCandidateV1Schema.parse({
            schemaVersion: 1,
            candidateType: "DRAWING_SCALE",
            candidateId: deterministicId(
              "scale-candidate",
              input.revision.revisionId,
              String(page.pageNumber),
              "title",
              String(spanIndex),
            ),
            tenantId: input.revision.tenantId,
            projectId: input.revision.projectId,
            revisionId: input.revision.revisionId,
            pageId: revisionPage.pageId,
            sourceType: "TITLE_BLOCK",
            sourcePriority: 2,
            status: "CANDIDATE",
            drawingUnits: "1",
            drawingUnit: "pt",
            realWorldUnits: decimal((denominator * 0.0254) / 72),
            realWorldUnit: "m",
            displayScale: `1:${titleScale[1]}`,
            confidence: 0.85,
            sourceRefs: [
              pageSource(
                {
                  tenantId: input.revision.tenantId,
                  projectId: input.revision.projectId,
                  artifactId: input.intake.artifactId,
                  sha256: input.intake.sha256,
                  sourceId: input.revision.revisionId,
                },
                page.pageNumber,
                span.region,
                span.text,
              ),
            ],
            extractionVersion,
            issues: [],
            createdAt,
          }),
        );
      }
    }

    for (const calibration of input.calibrations?.filter(
      (candidate) => candidate.pageNumber === page.pageNumber,
    ) ?? []) {
      if (calibration.drawingDistancePt <= 0 || calibration.realDistanceM <= 0) {
        throw new Error("Scale calibration distances must be positive");
      }
      candidates.push(
        drawingScaleCandidateV1Schema.parse({
          schemaVersion: 1,
          candidateType: "DRAWING_SCALE",
          candidateId: deterministicId(
            "scale-candidate",
            input.revision.revisionId,
            String(page.pageNumber),
            calibration.sourceType,
            decimal(calibration.drawingDistancePt),
            decimal(calibration.realDistanceM),
          ),
          tenantId: input.revision.tenantId,
          projectId: input.revision.projectId,
          revisionId: input.revision.revisionId,
          pageId: revisionPage.pageId,
          sourceType: calibration.sourceType,
          sourcePriority: calibration.sourceType === "ENGINEER_KNOWN_DISTANCE" ? 3 : 4,
          status: "CANDIDATE",
          drawingUnits: decimal(calibration.drawingDistancePt),
          drawingUnit: "pt",
          realWorldUnits: decimal(calibration.realDistanceM),
          realWorldUnit: "m",
          displayScale: `${decimal(calibration.drawingDistancePt)}pt=${decimal(calibration.realDistanceM)}m`,
          confidence: calibration.sourceType === "ENGINEER_KNOWN_DISTANCE" ? 0.8 : 0.9,
          sourceRefs: [
            pageSource(
              {
                tenantId: input.revision.tenantId,
                projectId: input.revision.projectId,
                artifactId: input.intake.artifactId,
                sha256: input.intake.sha256,
                sourceId: input.revision.revisionId,
              },
              page.pageNumber,
              calibration.region,
              calibration.sourceType,
            ),
          ],
          extractionVersion,
          issues: [],
          createdAt,
        }),
      );
    }

    if (!candidates.some((candidate) => candidate.pageId === revisionPage.pageId)) {
      candidates.push(
        drawingScaleCandidateV1Schema.parse({
          schemaVersion: 1,
          candidateType: "DRAWING_SCALE",
          candidateId: deterministicId(
            "scale-candidate",
            input.revision.revisionId,
            String(page.pageNumber),
            "unknown",
          ),
          tenantId: input.revision.tenantId,
          projectId: input.revision.projectId,
          revisionId: input.revision.revisionId,
          pageId: revisionPage.pageId,
          sourceType: "TITLE_BLOCK",
          sourcePriority: 2,
          status: "UNKNOWN",
          drawingUnits: null,
          drawingUnit: null,
          realWorldUnits: null,
          realWorldUnit: "m",
          displayScale: null,
          confidence: 0,
          sourceRefs: [
            pageSource(
              {
                tenantId: input.revision.tenantId,
                projectId: input.revision.projectId,
                artifactId: input.intake.artifactId,
                sha256: input.intake.sha256,
                sourceId: input.revision.revisionId,
              },
              page.pageNumber,
              null,
              "Scale not found on page",
            ),
          ],
          extractionVersion,
          issues: [
            issue(
              "DRAWING_SCALE_MISSING",
              "WARNING",
              `pages.${page.pageNumber}.scale`,
              "No source-backed scale candidate was found",
            ),
          ],
          createdAt,
        }),
      );
    }
  }

  return candidates.sort(
    (left, right) =>
      left.pageId.localeCompare(right.pageId) ||
      left.sourcePriority - right.sourcePriority ||
      left.candidateId.localeCompare(right.candidateId),
  );
}

function pointDistanceInDrawingUnit(
  points: number,
  unit: VerifiedDrawingScaleV1["drawingUnit"],
): number {
  if (unit === "pt") return points;
  if (unit === "mm") return (points * 25.4) / 72;
  if (unit === "cm") return (points * 2.54) / 72;
  if (unit === "m") return (points * 0.0254) / 72;
  throw new Error("Pixel-based PDF scales require manual vector calibration");
}

function metricDistance(points: number, scale: VerifiedDrawingScaleV1): string {
  const drawingDistance = pointDistanceInDrawingUnit(points, scale.drawingUnit);
  return decimal((drawingDistance * Number(scale.realWorldUnits)) / Number(scale.drawingUnits));
}

const elementPattern =
  /^(FLOOR|ZONE|ROOM|WALL|DOOR|WINDOW)\s*(?:[:#=-]\s*)?([A-Z0-9._-]+)(?:\s+(.+))?$/iu;

export function extractVectorArchitecture(input: {
  intake: DesignFileIntakeResultV1;
  revision: DrawingRevisionV1;
  inspectedPdf: InspectedPdfDocument;
  verifiedScales?: readonly VerifiedDrawingScaleV1[];
  extractedAt?: string;
  createdBy?: string;
}): DesignExtractionBatchV1 {
  const extractedAt = input.extractedAt ?? new Date().toISOString();
  const candidates: DesignElementCandidateV1[] = [];
  const issues: ContractValidationIssue[] = [];
  const verifiedScales = (input.verifiedScales ?? []).map((scale) =>
    verifiedDrawingScaleV1Schema.parse(scale),
  );

  for (const scale of verifiedScales) {
    if (
      scale.tenantId !== input.revision.tenantId ||
      scale.projectId !== input.revision.projectId ||
      scale.revisionId !== input.revision.revisionId
    ) {
      throw new Error("Verified scale is outside the extraction scope");
    }
  }

  for (const page of input.inspectedPdf.pages) {
    const revisionPage = input.revision.pages.find(
      (candidate) => candidate.pageNumber === page.pageNumber,
    );
    if (revisionPage === undefined) {
      throw new Error(`Revision has no page ${page.pageNumber}`);
    }
    const scale = verifiedScales.find((candidate) => candidate.pageId === revisionPage.pageId);
    let activeFloor: string | null = null;
    let activeZone: string | null = null;

    for (const [spanIndex, span] of page.textSpans.entries()) {
      const match = elementPattern.exec(span.text.trim());
      if (match === null) continue;
      const elementType = match[1]!.toLocaleUpperCase(
        "en-US",
      ) as DesignElementCandidateV1["elementType"];
      const elementCode = match[2]!.toLocaleUpperCase("en-US");
      const path = nearestPath(span, page.vectorPaths);
      if (elementType === "FLOOR") activeFloor = elementCode;
      if (elementType === "ZONE") activeZone = elementCode;

      if (path === null) {
        issues.push(
          issue(
            "ELEMENT_VECTOR_GEOMETRY_MISSING",
            "WARNING",
            `pages.${page.pageNumber}.text.${spanIndex}`,
            `${elementType} ${elementCode} has no source-backed vector geometry`,
          ),
        );
        continue;
      }

      const sourceRegion = regionUnion(span.region, path.region);
      const source = pageSource(
        {
          tenantId: input.revision.tenantId,
          projectId: input.revision.projectId,
          artifactId: input.intake.artifactId,
          sha256: input.intake.sha256,
          sourceId: input.revision.revisionId,
        },
        page.pageNumber,
        sourceRegion,
        `${elementType} ${elementCode}`,
      );
      const widthPt = Math.abs(path.boundsPt[2] - path.boundsPt[0]);
      const heightPt = Math.abs(path.boundsPt[3] - path.boundsPt[1]);
      const dimensions: DesignElementCandidateV1["dimensions"] = [];
      if (scale !== undefined) {
        const dimensionsToAdd =
          elementType === "WALL"
            ? ([["LENGTH", Math.max(widthPt, heightPt)]] as const)
            : elementType === "DOOR" || elementType === "WINDOW"
              ? ([
                  ["WIDTH", widthPt],
                  ["HEIGHT", heightPt],
                ] as const)
              : ([
                  ["LENGTH", widthPt],
                  ["WIDTH", heightPt],
                ] as const);
        for (const [kind, pointValue] of dimensionsToAdd) {
          if (pointValue <= 0) continue;
          dimensions.push({
            dimensionId: deterministicId(
              "element-dimension",
              input.revision.revisionId,
              String(page.pageNumber),
              elementCode,
              kind,
              String(spanIndex),
            ),
            kind,
            quantity: {
              value: metricDistance(pointValue, scale),
              unit: "m",
              sourceRefs: [source],
            },
          });
        }
      }

      const missingInformation =
        scale === undefined
          ? [
              {
                issueId: deterministicId(
                  "missing-scale",
                  input.revision.revisionId,
                  revisionPage.pageId,
                  elementCode,
                  String(spanIndex),
                ),
                code: "VERIFIED_SCALE_REQUIRED",
                fieldPath: "dimensions",
                message: "Metric dimensions are blocked until scale verification",
                clarificationQuestion: "Инженер энэ хуудасны масштабыг баталгаажуулна уу?",
                blocksQuantity: true,
                sourceRefs: [source],
              },
            ]
          : [];
      const validationIssues =
        scale === undefined
          ? [
              issue(
                "METRIC_DIMENSIONS_BLOCKED",
                "WARNING",
                "dimensions",
                "No metric dimension was emitted because scale is not VERIFIED",
              ),
            ]
          : [];

      candidates.push(
        designElementCandidateV1Schema.parse({
          schemaVersion: 1,
          candidateType: "DESIGN_ELEMENT",
          candidateId: deterministicId(
            "element-candidate",
            input.revision.revisionId,
            String(page.pageNumber),
            elementType,
            elementCode,
            String(spanIndex),
          ),
          tenantId: input.revision.tenantId,
          projectId: input.revision.projectId,
          revisionId: input.revision.revisionId,
          pageId: revisionPage.pageId,
          scaleId: scale?.scaleId ?? null,
          elementType,
          elementCode,
          name: match[3]?.trim() || `${elementType} ${elementCode}`,
          floorCode: elementType === "FLOOR" ? elementCode : activeFloor,
          zoneCode: elementType === "ZONE" ? elementCode : activeZone,
          geometryType: widthPt <= 1 || heightPt <= 1 ? "LINE" : "RECTANGLE",
          boundingRegion: {
            ...sourceRegion,
            description: `${elementType} ${elementCode}`,
          },
          extractionMethod: "PDF_VECTOR_LABEL",
          extractionVersion,
          dimensions,
          properties: {
            sourceLabel: span.text,
            boundsPt: path.boundsPt.join(","),
          },
          sourceRefs: [source],
          confidence: 0.95,
          confidenceLevel: "HIGH",
          fieldConfidence: [
            "elementType",
            "elementCode",
            "name",
            ...(elementType === "FLOOR" || activeFloor !== null ? ["floorCode"] : []),
            ...(elementType === "ZONE" || activeZone !== null ? ["zoneCode"] : []),
            "geometryType",
            "boundingRegion",
          ].map((fieldPath) => ({
            fieldPath,
            score: 0.95,
            level: "HIGH" as const,
            evidence: [
              {
                sourceType: "IMAGE" as const,
                sourceId: source.sourceRefId,
                fieldPath,
                quote: null,
                imageRegion: {
                  ...sourceRegion,
                  description: `${elementType} ${elementCode}`,
                },
              },
            ],
          })),
          status: "REVIEW_REQUIRED",
          reviewDecision: null,
          missingInformation,
          validationIssues,
          official: false,
          createdAt: extractedAt,
          createdBy: input.createdBy ?? "A0",
        }),
      );
    }
  }

  if (candidates.length === 0) {
    issues.push(
      issue(
        "ARCHITECTURE_ELEMENT_LABELS_MISSING",
        "WARNING",
        "elementCandidates",
        "No supported engineer-labeled architectural element was found",
      ),
    );
  }

  const scaleCandidates = extractDrawingScaleCandidates({
    intake: input.intake,
    revision: input.revision,
    inspectedPdf: input.inspectedPdf,
    createdAt: extractedAt,
  });
  const ratiosByPage = new Map<string, number[]>();
  for (const candidate of scaleCandidates) {
    if (
      candidate.status === "CANDIDATE" &&
      candidate.drawingUnits !== null &&
      candidate.realWorldUnits !== null
    ) {
      const ratio = Number(candidate.realWorldUnits) / Number(candidate.drawingUnits);
      const ratios = ratiosByPage.get(candidate.pageId) ?? [];
      ratios.push(ratio);
      ratiosByPage.set(candidate.pageId, ratios);
    }
  }
  for (const [pageId, ratios] of ratiosByPage) {
    if (ratios.length > 1 && Math.max(...ratios) / Math.min(...ratios) > 1.02) {
      issues.push(
        issue(
          "DRAWING_MIXED_SCALE_CONFLICT",
          "WARNING",
          `pages.${pageId}.scale`,
          "Scale candidates differ by more than 2%; engineer resolution is required",
        ),
      );
    }
  }

  return designExtractionBatchV1Schema.parse({
    schemaVersion: 1,
    extractionType: "VECTOR_ARCHITECTURE",
    extractionId: deterministicId(
      "design-extraction",
      input.revision.revisionId,
      input.intake.sha256,
      extractionVersion,
    ),
    tenantId: input.revision.tenantId,
    projectId: input.revision.projectId,
    revisionId: input.revision.revisionId,
    sourceArtifactId: input.intake.artifactId,
    scaleCandidates,
    verifiedScales,
    elementCandidates: candidates,
    issues,
    deterministic: true,
    extractionVersion,
    extractedAt,
  });
}
