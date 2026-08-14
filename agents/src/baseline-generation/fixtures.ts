import type {
  BuildWatchCatalogVersionReference,
  BuildWatchReviewDecision,
  BuildWatchSourceReference,
} from "../contracts/buildwatch-v2-common.js";
import {
  designElementCandidateV1Schema,
  verifiedDrawingScaleV1Schema,
  type DesignElementCandidateV1,
  type VerifiedDrawingScaleV1,
} from "../contracts/design/index.js";
import type { ApprovedEstimateVersionV1 } from "../contracts/estimate/index.js";
import type { ApprovedQuantityTakeoffVersionV1 } from "../contracts/quantity/index.js";
import {
  approvedMaterialNormV1Schema,
  approvedPriceV1Schema,
  approvedProductivityRateV1Schema,
  approvedWorkTemplateV1Schema,
  estimateCalculationPolicyV1Schema,
  scheduleGenerationRequestV1Schema,
  type ApprovedMaterialNormV1,
  type ApprovedPriceV1,
  type ApprovedProductivityRateV1,
  type ApprovedWorkTemplateV1,
  type EstimateCalculationPolicyV1,
  type QuantityGenerationRequestV1,
  type ScheduleGenerationRequestV1,
} from "./contracts.js";
import { createHumanDecisionSource, phase7Hash } from "./deterministic.js";

export const phase7FixtureScope = {
  tenantId: "tenant-demo",
  projectId: "project-atlas",
} as const;

export const phase7FixtureTimes = {
  candidateReview: "2026-08-03T00:10:00.000Z",
  quantityCreated: "2026-08-03T00:20:00.000Z",
  engineerReview: "2026-08-03T00:30:00.000Z",
  quantityApproval: "2026-08-03T00:40:00.000Z",
  estimateCreated: "2026-08-03T00:50:00.000Z",
  estimateApproval: "2026-08-03T01:00:00.000Z",
  scheduleCreated: "2026-08-03T01:10:00.000Z",
  scheduleApproval: "2026-08-03T01:20:00.000Z",
  baselineCreated: "2026-08-03T01:30:00.000Z",
  baselineApproval: "2026-08-03T01:40:00.000Z",
} as const;

function fixtureSource(
  sourceRefId: string,
  overrides: Partial<BuildWatchSourceReference> = {},
): BuildWatchSourceReference {
  return {
    sourceRefId,
    ...phase7FixtureScope,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: sourceRefId,
    sourceVersionId: null,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf: phase7FixtureTimes.quantityCreated,
    sha256: null,
    ...overrides,
  };
}

function reviewDecision(
  decisionId: string,
  role: BuildWatchReviewDecision["reviewerRole"],
  decidedAt: string,
  correctedFieldPaths: readonly string[] = [],
): BuildWatchReviewDecision {
  return {
    decisionId,
    action: "APPROVE",
    reviewerId: `user-${role.toLowerCase().replace(/_/gu, "-")}`,
    reviewerRole: role,
    decidedAt,
    reason: "Golden fixture evidence and calculation checked",
    correctedFieldPaths: [...correctedFieldPaths],
  };
}

function catalogVersion(
  catalogType: BuildWatchCatalogVersionReference["catalogType"],
  versionId: string,
  version = 1,
): BuildWatchCatalogVersionReference {
  return {
    ...phase7FixtureScope,
    catalogType,
    versionId,
    version,
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    approvedBy: "user-domain-owner",
    approvedAt: "2026-08-02T00:00:00.000Z",
    sourceRefs: [
      fixtureSource(`source-${versionId}`, {
        sourceType: "CATALOG_VERSION",
        sourceId: versionId,
        sourceVersionId: versionId,
      }),
    ],
  };
}

function elementCandidate(
  input: Readonly<{
    candidateId: string;
    elementType: DesignElementCandidateV1["elementType"];
    elementCode: string;
    name: string;
    region: DesignElementCandidateV1["boundingRegion"];
    dimensions: ReadonlyArray<
      Readonly<{
        dimensionId: string;
        kind: DesignElementCandidateV1["dimensions"][number]["kind"];
        value: string;
        unit: DesignElementCandidateV1["dimensions"][number]["quantity"]["unit"];
      }>
    >;
  }>,
): DesignElementCandidateV1 {
  const source = fixtureSource(`source-${input.candidateId}`, {
    sourceType: "VERIFIED_VECTOR_GEOMETRY",
    sourceId: input.candidateId,
    sourceVersionId: "drawing-revision-phase7",
    artifactId: "artifact-phase7-drawing",
    pageNumber: 1,
    fieldPath: `elements.${input.candidateId}`,
    region: input.region,
    sha256: phase7Hash(input.candidateId),
  });
  const confidencePaths = [
    "elementType",
    "elementCode",
    "name",
    "floorCode",
    "zoneCode",
    "geometryType",
    "boundingRegion",
  ];
  return designElementCandidateV1Schema.parse({
    schemaVersion: 1,
    candidateType: "DESIGN_ELEMENT",
    candidateId: input.candidateId,
    ...phase7FixtureScope,
    revisionId: "drawing-revision-phase7",
    pageId: "drawing-page-phase7",
    scaleId: "verified-scale-phase7",
    elementType: input.elementType,
    elementCode: input.elementCode,
    name: input.name,
    floorCode: "F-01",
    zoneCode: "Z-01",
    geometryType: "RECTANGLE",
    boundingRegion: input.region,
    extractionMethod: "ENGINEER_EDIT",
    extractionVersion: "buildwatch-phase7-fixture-v1",
    dimensions: input.dimensions.map((dimension) => ({
      dimensionId: dimension.dimensionId,
      kind: dimension.kind,
      quantity: {
        value: dimension.value,
        unit: dimension.unit,
        sourceRefs: [source],
      },
    })),
    properties: {},
    sourceRefs: [source],
    confidence: 1,
    confidenceLevel: "HIGH",
    fieldConfidence: confidencePaths.map((fieldPath) => ({
      fieldPath,
      score: 1,
      level: "HIGH",
      evidence: [
        {
          sourceType: "IMAGE",
          sourceId: source.sourceRefId,
          fieldPath,
          quote: null,
          imageRegion: input.region,
        },
      ],
    })),
    status: "ACCEPTED",
    reviewDecision: reviewDecision(
      `decision-${input.candidateId}`,
      "ENGINEER",
      phase7FixtureTimes.candidateReview,
    ),
    missingInformation: [],
    validationIssues: [],
    official: false,
    createdAt: phase7FixtureTimes.candidateReview,
    createdBy: "A0",
  });
}

export function buildPhase7VerifiedScale(): VerifiedDrawingScaleV1 {
  return verifiedDrawingScaleV1Schema.parse({
    schemaVersion: 1,
    scaleType: "VERIFIED_DRAWING_SCALE",
    scaleId: "verified-scale-phase7",
    ...phase7FixtureScope,
    revisionId: "drawing-revision-phase7",
    pageId: "drawing-page-phase7",
    status: "VERIFIED",
    drawingUnits: "100",
    drawingUnit: "mm",
    realWorldUnits: "1",
    realWorldUnit: "m",
    sourceRefs: [
      fixtureSource("source-verified-scale-phase7", {
        sourceType: "HUMAN_DECISION",
        sourceId: "decision-scale-phase7",
        sourceVersionId: "verified-scale-phase7",
      }),
    ],
    reviewedBy: "user-engineer",
    reviewedAt: phase7FixtureTimes.candidateReview,
    reviewDecision: reviewDecision(
      "decision-scale-phase7",
      "ENGINEER",
      phase7FixtureTimes.candidateReview,
    ),
  });
}

export function buildPhase7QuantityRequest(): QuantityGenerationRequestV1 {
  const candidates = [
    elementCandidate({
      candidateId: "candidate-wall",
      elementType: "WALL",
      elementCode: "W-01",
      name: "AAC wall",
      region: { x: 0.05, y: 0.05, width: 0.2, height: 0.2, description: "Wall" },
      dimensions: [
        { dimensionId: "wall-length", kind: "LENGTH", value: "10", unit: "m" },
        { dimensionId: "wall-height", kind: "HEIGHT", value: "3", unit: "m" },
      ],
    }),
    elementCandidate({
      candidateId: "candidate-door",
      elementType: "DOOR",
      elementCode: "D-01",
      name: "Door opening",
      region: { x: 0.26, y: 0.05, width: 0.08, height: 0.18, description: "Door" },
      dimensions: [
        { dimensionId: "door-area", kind: "AREA", value: "2", unit: "m2" },
        { dimensionId: "door-count", kind: "COUNT", value: "1", unit: "pcs" },
      ],
    }),
    elementCandidate({
      candidateId: "candidate-floor",
      elementType: "ROOM",
      elementCode: "R-01",
      name: "Floor finish",
      region: { x: 0.35, y: 0.05, width: 0.2, height: 0.2, description: "Floor" },
      dimensions: [
        { dimensionId: "floor-length", kind: "LENGTH", value: "4", unit: "m" },
        { dimensionId: "floor-width", kind: "WIDTH", value: "4", unit: "m" },
      ],
    }),
    elementCandidate({
      candidateId: "candidate-slab",
      elementType: "SLAB",
      elementCode: "S-01",
      name: "Concrete slab",
      region: { x: 0.56, y: 0.05, width: 0.2, height: 0.2, description: "Slab" },
      dimensions: [
        { dimensionId: "slab-length", kind: "LENGTH", value: "5", unit: "m" },
        { dimensionId: "slab-width", kind: "WIDTH", value: "4", unit: "m" },
        { dimensionId: "slab-thickness", kind: "THICKNESS", value: "0.15", unit: "m" },
      ],
    }),
    elementCandidate({
      candidateId: "candidate-beam",
      elementType: "BEAM",
      elementCode: "B-01",
      name: "Beam formwork",
      region: { x: 0.77, y: 0.05, width: 0.18, height: 0.2, description: "Beam" },
      dimensions: [{ dimensionId: "beam-length", kind: "LENGTH", value: "8", unit: "m" }],
    }),
  ];
  const adjustmentDecision = reviewDecision(
    "decision-floor-adjustment",
    "ENGINEER",
    phase7FixtureTimes.candidateReview,
    ["items.item-floor.adjustment"],
  );
  return {
    schemaVersion: 1,
    requestType: "GENERATE_QUANTITY_TAKEOFF",
    requestId: "quantity-request-phase7",
    ...phase7FixtureScope,
    draftId: "quantity-draft-phase7",
    verifiedScale: buildPhase7VerifiedScale(),
    candidates,
    items: [
      {
        itemId: "item-wall",
        elementCandidateId: "candidate-wall",
        workCode: "WALL-AAC-200",
        formulaId: "qty-area-net-openings-v1",
        dimensionInputIds: ["wall-length", "wall-height", "door-area"],
        adjustment: null,
      },
      {
        itemId: "item-floor",
        elementCandidateId: "candidate-floor",
        workCode: "FLOOR-TILE",
        formulaId: "qty-area-rectangle-v1",
        dimensionInputIds: ["floor-length", "floor-width"],
        adjustment: {
          adjustmentId: "adjustment-floor",
          kind: "ADD",
          quantity: {
            value: "0.5",
            unit: "m2",
            sourceRefs: [
              createHumanDecisionSource({
                ...phase7FixtureScope,
                sourceRefId: "source-floor-adjustment",
                decisionId: adjustmentDecision.decisionId,
                fieldPath: "items.item-floor.adjustment",
                asOf: adjustmentDecision.decidedAt,
              }),
            ],
          },
          reason: "Engineer measured the threshold strip",
          decision: adjustmentDecision,
        },
      },
      {
        itemId: "item-slab",
        elementCandidateId: "candidate-slab",
        workCode: "SLAB-CONCRETE",
        formulaId: "qty-volume-rectangular-v1",
        dimensionInputIds: ["slab-length", "slab-width", "slab-thickness"],
        adjustment: null,
      },
      {
        itemId: "item-beam",
        elementCandidateId: "candidate-beam",
        workCode: "BEAM-FORMWORK",
        formulaId: "qty-length-v1",
        dimensionInputIds: ["beam-length"],
        adjustment: null,
      },
      {
        itemId: "item-door",
        elementCandidateId: "candidate-door",
        workCode: "DOOR-INSTALL",
        formulaId: "qty-count-v1",
        dimensionInputIds: ["door-count"],
        adjustment: null,
      },
    ],
    createdAt: phase7FixtureTimes.quantityCreated,
    createdBy: "A0",
  };
}

const materialNormInputs = [
  ["norm-wall-aac", "WALL-AAC-200", "m2", "AAC-BLOCK", "pcs", "8", "0.05"],
  ["norm-floor-tile", "FLOOR-TILE", "m2", "TILE-600", "pcs", "4", "0.10"],
  ["norm-slab-concrete", "SLAB-CONCRETE", "m3", "CONCRETE-C30", "m3", "1", "0.03"],
  ["norm-beam-timber", "BEAM-FORMWORK", "m", "FORMWORK-TIMBER", "m3", "0.05", "0.10"],
  ["norm-door-unit", "DOOR-INSTALL", "pcs", "DOOR-UNIT", "pcs", "1", "0"],
] as const;

export function buildPhase7MaterialNorms(): ApprovedMaterialNormV1[] {
  return materialNormInputs.map(
    ([normId, workCode, workUnit, materialCode, materialUnit, rate, waste]) =>
      approvedMaterialNormV1Schema.parse({
        schemaVersion: 1,
        recordType: "APPROVED_MATERIAL_NORM",
        normId,
        workCode,
        workUnit,
        materialCode,
        materialUnit,
        quantityPerWorkUnit: rate,
        wasteFactor: waste,
        version: catalogVersion("MATERIAL_NORM", `version-${normId}`),
      }),
  );
}

const productivityInputs = [
  ["productivity-wall", "WALL-AAC-200", "m2", "10", "MASON", 4, "0.8", []],
  ["productivity-floor", "FLOOR-TILE", "m2", "8", "TILER", 3, "1", []],
  [
    "productivity-slab",
    "SLAB-CONCRETE",
    "m3",
    "2",
    "CONCRETE-CREW",
    5,
    "2",
    [["CONCRETE-PUMP", 1, "0.5"]],
  ],
  ["productivity-beam", "BEAM-FORMWORK", "m", "4", "CARPENTER", 3, "1.5", []],
  ["productivity-door", "DOOR-INSTALL", "pcs", "2", "INSTALLER", 2, "4", []],
] as const;

export function buildPhase7ProductivityRates(): ApprovedProductivityRateV1[] {
  return productivityInputs.map(
    ([productivityId, workCode, workUnit, output, laborCode, crewCount, laborHours, equipment]) =>
      approvedProductivityRateV1Schema.parse({
        schemaVersion: 1,
        recordType: "APPROVED_PRODUCTIVITY",
        productivityId,
        workCode,
        workUnit,
        quantityPerWorkingDay: output,
        laborClassCode: laborCode,
        crewCount,
        laborHoursPerWorkUnit: laborHours,
        equipment: equipment.map(([equipmentClassCode, count, hoursPerWorkUnit]) => ({
          equipmentClassCode,
          count,
          hoursPerWorkUnit,
        })),
        version: catalogVersion("PRODUCTIVITY", `version-${productivityId}`),
      }),
  );
}

const priceInputs = [
  ["price-aac", "AAC-BLOCK", "MATERIAL", "pcs", "4500.00", "quote-aac"],
  ["price-tile", "TILE-600", "MATERIAL", "pcs", "18000.00", "quote-tile"],
  ["price-concrete", "CONCRETE-C30", "MATERIAL", "m3", "420000.00", "quote-concrete"],
  ["price-timber", "FORMWORK-TIMBER", "MATERIAL", "m3", "950000.00", "quote-timber"],
  ["price-door", "DOOR-UNIT", "MATERIAL", "pcs", "650000.00", "quote-door"],
  ["price-mason", "MASON", "LABOR", "h", "18000.00", null],
  ["price-tiler", "TILER", "LABOR", "h", "20000.00", null],
  ["price-concrete-crew", "CONCRETE-CREW", "LABOR", "h", "22000.00", null],
  ["price-carpenter", "CARPENTER", "LABOR", "h", "21000.00", null],
  ["price-installer", "INSTALLER", "LABOR", "h", "19000.00", null],
  ["price-concrete-pump", "CONCRETE-PUMP", "EQUIPMENT", "h", "150000.00", null],
] as const;

export function buildPhase7Prices(): ApprovedPriceV1[] {
  return priceInputs.map(([priceId, itemCode, costType, unit, value, supplierQuotationId]) =>
    approvedPriceV1Schema.parse({
      schemaVersion: 1,
      recordType: "APPROVED_PRICE",
      priceId,
      itemCode,
      costType,
      unit,
      unitPriceMnt: {
        value,
        currency: "MNT",
        sourceRefs: [
          fixtureSource(`source-${priceId}`, {
            sourceType: "CATALOG_VERSION",
            sourceId: priceId,
            sourceVersionId: `version-${priceId}`,
          }),
        ],
      },
      supplierQuotationId,
      version: catalogVersion("PRICE", `version-${priceId}`),
    }),
  );
}

export function buildPhase7EstimatePolicy(): EstimateCalculationPolicyV1 {
  return estimateCalculationPolicyV1Schema.parse({
    schemaVersion: 1,
    policyType: "ESTIMATE_CALCULATION",
    pricingDate: "2026-08-03",
    taxRate: "0.10",
    contingencyRate: "0.05",
    roundingMode: "ROUND_HALF_UP",
    moneyDecimalPlaces: 2,
    version: catalogVersion("POLICY", "version-estimate-policy-phase7"),
  });
}

const workTemplateInputs = [
  ["template-wall", "WALL-AAC-200", "1.1", null, "AAC wall", "CRITICAL", []],
  [
    "template-floor",
    "FLOOR-TILE",
    "1.2",
    "1",
    "Floor tile",
    "HIGH",
    [["WALL-AAC-200", "FINISH_TO_START", 0]],
  ],
  [
    "template-slab",
    "SLAB-CONCRETE",
    "2.1",
    "2",
    "Concrete slab",
    "CRITICAL",
    [["FLOOR-TILE", "FINISH_TO_START", 0]],
  ],
  [
    "template-beam",
    "BEAM-FORMWORK",
    "2.2",
    "2",
    "Beam formwork",
    "HIGH",
    [["SLAB-CONCRETE", "START_TO_START", 1]],
  ],
  [
    "template-door",
    "DOOR-INSTALL",
    "3.1",
    "3",
    "Door installation",
    "MEDIUM",
    [["WALL-AAC-200", "FINISH_TO_START", 0]],
  ],
] as const;

export function buildPhase7WorkTemplates(): ApprovedWorkTemplateV1[] {
  return workTemplateInputs.map(
    ([templateId, workCode, wbsCode, parentWbsCode, name, priority, predecessors]) => {
      const version = catalogVersion("WORK_TEMPLATE", `version-${templateId}`);
      return approvedWorkTemplateV1Schema.parse({
        schemaVersion: 1,
        recordType: "APPROVED_WORK_TEMPLATE",
        templateId,
        workCode,
        wbsCode,
        parentWbsCode,
        name,
        zoneCode: "Z-01",
        priority,
        contractMilestone: false,
        predecessors: predecessors.map(([predecessorWorkCode, type, lagWorkingDays]) => ({
          predecessorWorkCode,
          type,
          lagWorkingDays,
          sourceRefs: version.sourceRefs,
        })),
        sourceRefs: version.sourceRefs,
        version,
      });
    },
  );
}

export function buildPhase7ScheduleRequest(
  input: Readonly<{
    approvedQuantity: ApprovedQuantityTakeoffVersionV1;
    approvedEstimate: ApprovedEstimateVersionV1;
  }>,
): ScheduleGenerationRequestV1 {
  return scheduleGenerationRequestV1Schema.parse({
    schemaVersion: 1,
    requestType: "GENERATE_BASELINE_SCHEDULE",
    requestId: "schedule-request-phase7",
    ...phase7FixtureScope,
    draftId: "schedule-draft-phase7",
    scheduleVersionId: "schedule-version-phase7",
    plannedStart: "2026-08-03",
    calendar: {
      calendarVersionId: "calendar-version-phase7",
      timezone: "Asia/Ulaanbaatar",
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      workHoursPerDay: 8,
      holidays: ["2026-08-05"],
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      sourceRefs: [
        fixtureSource("source-calendar-phase7", {
          sourceType: "CALENDAR_VERSION",
          sourceId: "calendar-version-phase7",
          sourceVersionId: "calendar-version-phase7",
        }),
      ],
    },
    productivityRates: buildPhase7ProductivityRates(),
    workTemplates: buildPhase7WorkTemplates(),
    createdAt: phase7FixtureTimes.scheduleCreated,
    createdBy: "A0",
    approvedQuantityVersionId: input.approvedQuantity.quantityTakeoffVersionId,
    approvedEstimateVersionId: input.approvedEstimate.estimateVersionId,
  });
}

export function buildPhase7Decision(
  phase:
    | "ENGINEER_REVIEW"
    | "QUANTITY_APPROVAL"
    | "ESTIMATE_APPROVAL"
    | "SCHEDULE_APPROVAL"
    | "BASELINE_APPROVAL",
): BuildWatchReviewDecision {
  const settings = {
    ENGINEER_REVIEW: ["decision-quantity-engineer", "ENGINEER", phase7FixtureTimes.engineerReview],
    QUANTITY_APPROVAL: [
      "decision-quantity-estimator",
      "ESTIMATOR",
      phase7FixtureTimes.quantityApproval,
    ],
    ESTIMATE_APPROVAL: [
      "decision-estimate-manager",
      "PROJECT_MANAGER",
      phase7FixtureTimes.estimateApproval,
    ],
    SCHEDULE_APPROVAL: [
      "decision-schedule-manager",
      "PROJECT_MANAGER",
      phase7FixtureTimes.scheduleApproval,
    ],
    BASELINE_APPROVAL: [
      "decision-baseline-manager",
      "PROJECT_MANAGER",
      phase7FixtureTimes.baselineApproval,
    ],
  } as const;
  const [decisionId, role, decidedAt] = settings[phase];
  return reviewDecision(decisionId, role, decidedAt);
}
