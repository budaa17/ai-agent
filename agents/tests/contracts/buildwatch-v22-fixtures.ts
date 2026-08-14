import type {
  ApprovedBaselineCommandV1,
  ApprovedDailyWorkPlanCommandV1,
  ApprovedEstimateCommandV1,
  ApprovedProgressVerificationCommandV1,
  ApprovedQuantityTakeoffCommandV1,
  BaselineDraftV1,
  BuildWatchCatalogVersionReference,
  BuildWatchReviewDecision,
  BuildWatchSourceReference,
  DailyWorkPlanDraftV1,
  DesignDocumentManifestV1,
  DesignElementCandidateV1,
  DrawingRevisionV1,
  EstimateDraftV1,
  OperationalForecastSnapshotV1,
  OperationalPlanningSnapshotV1,
  ProgressVerificationDraftV1,
  QuantityTakeoffDraftV1,
  RecoveryProposalDraftV1,
  RollingProductivitySnapshotV1,
  VerifiedDrawingScaleV1,
} from "../../src/contracts/index.js";

export const buildWatchV22TenantId = "tenant-demo";
export const buildWatchV22ProjectId = "project-atlas";

const sourceHash = "a".repeat(64);
const artifactHash = "b".repeat(64);

export function buildV22Source(
  sourceRefId: string,
  overrides: Partial<BuildWatchSourceReference> = {},
): BuildWatchSourceReference {
  return {
    sourceRefId,
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: `source-${sourceRefId}`,
    sourceVersionId: "source-version-1",
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf: "2026-08-01T00:00:00.000Z",
    sha256: null,
    ...overrides,
  };
}

export function buildV22ReviewDecision(
  reviewerRole: BuildWatchReviewDecision["reviewerRole"],
  overrides: Partial<BuildWatchReviewDecision> = {},
): BuildWatchReviewDecision {
  return {
    decisionId: `decision-${reviewerRole.toLowerCase()}`,
    action: "APPROVE",
    reviewerId: `user-${reviewerRole.toLowerCase()}`,
    reviewerRole,
    decidedAt: "2026-08-01T08:00:00.000Z",
    reason: null,
    correctedFieldPaths: [],
    ...overrides,
  };
}

export function buildV22CatalogVersion(
  catalogType: BuildWatchCatalogVersionReference["catalogType"],
  versionId: string,
): BuildWatchCatalogVersionReference {
  return {
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    catalogType,
    versionId,
    version: 1,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    approvedBy: "user-manager",
    approvedAt: "2026-01-01T00:00:00.000Z",
    sourceRefs: [
      buildV22Source(`catalog-${versionId}`, {
        sourceType: "CATALOG_VERSION",
      }),
    ],
  };
}

export function buildDesignDocumentManifest(): DesignDocumentManifestV1 {
  return {
    schemaVersion: 1,
    manifestType: "DESIGN_INTAKE",
    manifestId: "manifest-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "user-engineer",
    documents: [
      {
        documentId: "document-001",
        artifactId: "artifact-drawing-001",
        originalFileName: "architecture-plan.pdf",
        mediaType: "PDF",
        mediaTypeValue: "application/pdf",
        sha256: artifactHash,
        sizeBytes: 12_345,
        classification: "ARCHITECTURAL_DRAWING",
        discipline: "ARCHITECTURE",
        extractionMode: "VECTOR",
        pageCount: 1,
        duplicateOfDocumentId: null,
        status: "ACCEPTED",
      },
    ],
  };
}

export function buildDrawingRevision(): DrawingRevisionV1 {
  return {
    schemaVersion: 1,
    revisionType: "DRAWING_REVISION",
    revisionId: "drawing-revision-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    documentId: "document-001",
    revisionCode: "A-01",
    title: "First floor architecture plan",
    discipline: "ARCHITECTURE",
    issuedOn: "2026-07-31",
    status: "ACTIVE",
    supersedesRevisionId: null,
    pages: [
      {
        pageId: "drawing-page-001",
        pageNumber: 1,
        sheetCode: "A-101",
        title: "First floor plan",
        discipline: "ARCHITECTURE",
        scaleStatus: "VERIFIED",
        sourceRefs: [
          buildV22Source("drawing-page-source", {
            sourceType: "DRAWING_REGION",
            sourceId: "document-001",
            artifactId: "artifact-drawing-001",
            pageNumber: 1,
            sha256: artifactHash,
          }),
        ],
      },
    ],
    createdAt: "2026-08-01T00:10:00.000Z",
  };
}

export function buildVerifiedDrawingScale(): VerifiedDrawingScaleV1 {
  return {
    schemaVersion: 1,
    scaleType: "VERIFIED_DRAWING_SCALE",
    scaleId: "scale-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    revisionId: "drawing-revision-001",
    pageId: "drawing-page-001",
    status: "VERIFIED",
    drawingUnits: "1",
    drawingUnit: "cm",
    realWorldUnits: "1",
    realWorldUnit: "m",
    sourceRefs: [
      buildV22Source("scale-source", {
        sourceType: "VERIFIED_VECTOR_GEOMETRY",
        sourceId: "drawing-page-001",
        artifactId: "artifact-drawing-001",
        pageNumber: 1,
        region: {
          x: 0.8,
          y: 0.05,
          width: 0.15,
          height: 0.1,
          description: "Scale label 1:100",
        },
      }),
    ],
    reviewedBy: "user-engineer",
    reviewedAt: "2026-08-01T01:00:00.000Z",
    reviewDecision: buildV22ReviewDecision("ENGINEER"),
  };
}

export function buildDesignElementCandidate(): DesignElementCandidateV1 {
  const source = buildV22Source("element-source", {
    sourceType: "VERIFIED_VECTOR_GEOMETRY",
    sourceId: "drawing-page-001",
    artifactId: "artifact-drawing-001",
    pageNumber: 1,
    region: {
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.2,
      description: "Wall W-01",
    },
  });

  return {
    schemaVersion: 1,
    candidateType: "DESIGN_ELEMENT",
    candidateId: "element-candidate-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    revisionId: "drawing-revision-001",
    pageId: "drawing-page-001",
    scaleId: "scale-001",
    elementType: "WALL",
    elementCode: "W-01",
    name: "AAC wall",
    floorCode: "F-01",
    zoneCode: "Z-01",
    geometryType: "LINE",
    boundingRegion: {
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.2,
      description: "Wall W-01",
    },
    extractionMethod: "PDF_VECTOR_LABEL",
    extractionVersion: "buildwatch-vector-architecture-v1",
    dimensions: [
      {
        dimensionId: "dimension-length",
        kind: "LENGTH",
        quantity: {
          value: "10",
          unit: "m",
          sourceRefs: [source],
        },
      },
      {
        dimensionId: "dimension-height",
        kind: "HEIGHT",
        quantity: {
          value: "3",
          unit: "m",
          sourceRefs: [source],
        },
      },
    ],
    properties: {
      material: "AAC",
      thickness: "200 mm",
    },
    sourceRefs: [source],
    confidence: 0.9,
    confidenceLevel: "HIGH",
    fieldConfidence: [
      "elementType",
      "elementCode",
      "name",
      "floorCode",
      "zoneCode",
      "geometryType",
      "boundingRegion",
    ].map((fieldPath) => ({
      fieldPath,
      score: 0.9,
      level: "HIGH" as const,
      evidence: [
        {
          sourceType: "IMAGE" as const,
          sourceId: source.sourceRefId,
          fieldPath,
          quote: null,
          imageRegion: {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.2,
            description: "Wall W-01",
          },
        },
      ],
    })),
    status: "ACCEPTED",
    reviewDecision: buildV22ReviewDecision("ENGINEER"),
    missingInformation: [],
    validationIssues: [],
    official: false,
    createdAt: "2026-08-01T01:30:00.000Z",
    createdBy: "A0",
  };
}

function buildQuantityContent(): QuantityTakeoffDraftV1["content"] {
  const vectorSource = buildV22Source("quantity-vector", {
    sourceType: "VERIFIED_VECTOR_GEOMETRY",
    sourceId: "element-candidate-001",
  });
  const calculationSource = buildV22Source("quantity-calculation");

  return {
    drawingRevisionId: "drawing-revision-001",
    verifiedScaleId: "scale-001",
    scaleStatus: "VERIFIED",
    items: [
      {
        itemId: "takeoff-item-001",
        elementCandidateId: "element-candidate-001",
        workCode: "WALL-AAC-200",
        formula: {
          formulaId: "formula-wall-area",
          expression: "length * height",
          resultUnit: "m2",
          dimensionInputIds: ["dimension-length", "dimension-height"],
          ruleVersion: "wall-area-v1",
          roundingMode: "ROUND_HALF_UP",
          decimalPlaces: 2,
          unitConversionVersion: "canonical-si-v1",
          reviewedBy: "user-engineer",
          reviewedAt: "2026-08-01T01:30:00.000Z",
        },
        dimensions: [
          {
            dimensionId: "dimension-length",
            kind: "LENGTH",
            quantity: {
              value: "10",
              unit: "m",
              sourceRefs: [vectorSource],
            },
          },
          {
            dimensionId: "dimension-height",
            kind: "HEIGHT",
            quantity: {
              value: "3",
              unit: "m",
              sourceRefs: [vectorSource],
            },
          },
        ],
        baseQuantity: {
          value: "30",
          unit: "m2",
          sourceRefs: [calculationSource],
        },
        wasteFactor: "0.05",
        adjustment: null,
        finalQuantity: {
          value: "31.5",
          unit: "m2",
          sourceRefs: [calculationSource],
        },
        sourceRefs: [vectorSource, calculationSource],
      },
    ],
  };
}

export function buildQuantityTakeoffDraft(): QuantityTakeoffDraftV1 {
  return {
    schemaVersion: 1,
    draftType: "QUANTITY_TAKEOFF",
    draftId: "quantity-draft-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    status: "REVIEW_REQUIRED",
    content: buildQuantityContent(),
    validationIssues: [],
    requiresHumanReview: true,
    createdAt: "2026-08-01T02:00:00.000Z",
    createdBy: "A0",
  };
}

export function buildApprovedQuantityCommand(): ApprovedQuantityTakeoffCommandV1 {
  return {
    schemaVersion: 1,
    commandType: "APPROVE_QUANTITY_TAKEOFF",
    commandId: "approve-quantity-command-001",
    idempotencyKey: "approve-quantity-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    draftId: "quantity-draft-001",
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_QUANTITY_TAKEOFF",
      quantityTakeoffVersionId: "quantity-version-001",
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      status: "APPROVED",
      content: buildQuantityContent(),
      metadata: {
        version: 1,
        approvedBy: "user-estimator",
        approvedAt: "2026-08-01T03:00:00.000Z",
        sourceHash,
        supersedesVersionId: null,
      },
    },
    decision: buildV22ReviewDecision("ESTIMATOR"),
  };
}

function buildEstimateContent(): EstimateDraftV1["content"] {
  const quantitySource = buildV22Source("estimate-quantity", {
    sourceType: "APPROVED_ENGINEER_QUANTITY",
    sourceId: "quantity-version-001",
  });
  const priceSource = buildV22Source("estimate-price", {
    sourceType: "CATALOG_VERSION",
    sourceId: "price-version-001",
  });
  const calculationSource = buildV22Source("estimate-calculation");
  const normVersion = buildV22CatalogVersion("MATERIAL_NORM", "norm-version-001");
  const priceVersion = buildV22CatalogVersion("PRICE", "price-version-001");
  const productivityVersion = buildV22CatalogVersion("PRODUCTIVITY", "productivity-version-001");

  return {
    quantityTakeoffVersionId: "quantity-version-001",
    pricingDate: "2026-08-01",
    policyVersion: buildV22CatalogVersion("POLICY", "estimate-policy-version-001"),
    materialRequirements: [
      {
        requirementId: "material-requirement-001",
        takeoffItemId: "takeoff-item-001",
        materialCode: "AAC-200",
        requiredQuantity: {
          value: "100",
          unit: "pcs",
          sourceRefs: [calculationSource],
        },
        wasteFactor: "0.05",
        normVersion,
      },
    ],
    lines: [
      {
        lineId: "estimate-line-001",
        takeoffItemId: "takeoff-item-001",
        workCode: "WALL-AAC-200",
        pricedItemCode: "AAC-200",
        costType: "MATERIAL",
        description: "AAC wall construction",
        quantity: {
          value: "10",
          unit: "m2",
          sourceRefs: [quantitySource],
        },
        unit: "m2",
        unitPriceMnt: {
          value: "100.00",
          currency: "MNT",
          sourceRefs: [priceSource],
        },
        lineCostMnt: {
          value: "1000.00",
          currency: "MNT",
          sourceRefs: [calculationSource],
        },
        priceVersion,
        normVersion,
        productivityVersion,
        supplierQuotationId: "supplier-quotation-001",
        sourceRefs: [quantitySource, priceSource, calculationSource],
      },
    ],
    assumptions: [
      {
        assumptionId: "estimate-assumption-001",
        code: "ASSUME-ACCESS",
        statement: "Normal site access is available",
        approved: true,
        sourceRefs: [
          buildV22Source("estimate-assumption", {
            sourceType: "HUMAN_DECISION",
          }),
        ],
      },
    ],
    subtotalMnt: {
      value: "1000.00",
      currency: "MNT",
      sourceRefs: [calculationSource],
    },
    taxMnt: {
      value: "100.00",
      currency: "MNT",
      sourceRefs: [calculationSource],
    },
    contingencyMnt: {
      value: "50.00",
      currency: "MNT",
      sourceRefs: [calculationSource],
    },
    totalMnt: {
      value: "1150.00",
      currency: "MNT",
      sourceRefs: [calculationSource],
    },
    costBreakdownMnt: {
      material: {
        value: "1000.00",
        currency: "MNT",
        sourceRefs: [calculationSource],
      },
      labor: {
        value: "0.00",
        currency: "MNT",
        sourceRefs: [calculationSource],
      },
      equipment: {
        value: "0.00",
        currency: "MNT",
        sourceRefs: [calculationSource],
      },
    },
  };
}

export function buildEstimateDraft(): EstimateDraftV1 {
  return {
    schemaVersion: 1,
    draftType: "ESTIMATE",
    draftId: "estimate-draft-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    status: "REVIEW_REQUIRED",
    content: buildEstimateContent(),
    validationIssues: [],
    requiresHumanReview: true,
    createdAt: "2026-08-01T03:10:00.000Z",
    createdBy: "SYSTEM",
  };
}

export function buildApprovedEstimateCommand(): ApprovedEstimateCommandV1 {
  return {
    schemaVersion: 1,
    commandType: "APPROVE_ESTIMATE",
    commandId: "approve-estimate-command-001",
    idempotencyKey: "approve-estimate-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    draftId: "estimate-draft-001",
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_ESTIMATE",
      estimateVersionId: "estimate-version-001",
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      status: "APPROVED",
      content: buildEstimateContent(),
      metadata: {
        version: 1,
        approvedBy: "user-manager",
        approvedAt: "2026-08-01T04:00:00.000Z",
        sourceHash,
        supersedesVersionId: null,
      },
    },
    decision: buildV22ReviewDecision("PROJECT_MANAGER"),
  };
}

function buildBaselineContent(): BaselineDraftV1["content"] {
  const scheduleSource = buildV22Source("schedule-source", {
    sourceType: "SCHEDULE_VERSION",
    sourceId: "schedule-version-001",
  });
  const calendarSource = buildV22Source("calendar-source", {
    sourceType: "CALENDAR_VERSION",
    sourceId: "calendar-version-001",
  });
  const quantitySource = buildV22Source("baseline-quantity", {
    sourceType: "APPROVED_ENGINEER_QUANTITY",
    sourceId: "quantity-version-001",
  });

  return {
    quantityTakeoffVersionId: "quantity-version-001",
    estimateVersionId: "estimate-version-001",
    scheduleVersionId: "schedule-version-001",
    plannedStart: "2026-08-01",
    plannedFinish: "2026-12-31",
    budgetMnt: "1150.00",
    calendar: {
      calendarVersionId: "calendar-version-001",
      timezone: "Asia/Ulaanbaatar",
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      workHoursPerDay: 8,
      holidays: [],
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      sourceRefs: [calendarSource],
    },
    activities: [
      {
        activityId: "activity-001",
        workItemId: "work-item-001",
        wbsCode: "1.1",
        parentWbsCode: "1",
        code: "WALL-AAC-200",
        name: "AAC wall construction",
        zoneCode: "Z-01",
        unit: "m2",
        plannedQuantity: {
          value: "100",
          unit: "m2",
          sourceRefs: [quantitySource],
        },
        durationWorkingDays: 10,
        plannedStart: "2026-08-01",
        plannedEnd: "2026-08-12",
        priority: "CRITICAL",
        isCritical: true,
        totalFloatWorkingDays: 0,
        contractMilestone: false,
        productivityVersion: buildV22CatalogVersion("PRODUCTIVITY", "productivity-version-001"),
        resourceRequirements: [
          {
            requirementId: "resource-requirement-001",
            resourceType: "CREW",
            resourceClassCode: "MASON",
            count: 1,
            sourceRefs: [scheduleSource],
          },
        ],
        sourceRefs: [scheduleSource, quantitySource],
      },
    ],
    dependencies: [],
  };
}

export function buildBaselineDraft(): BaselineDraftV1 {
  return {
    schemaVersion: 1,
    draftType: "BASELINE",
    draftId: "baseline-draft-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    status: "REVIEW_REQUIRED",
    content: buildBaselineContent(),
    validationIssues: [],
    requiresHumanReview: true,
    createdAt: "2026-08-01T04:10:00.000Z",
    createdBy: "SYSTEM",
  };
}

export function buildApprovedBaselineCommand(): ApprovedBaselineCommandV1 {
  return {
    schemaVersion: 1,
    commandType: "APPROVE_BASELINE",
    commandId: "approve-baseline-command-001",
    idempotencyKey: "approve-baseline-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    draftId: "baseline-draft-001",
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_BASELINE",
      baselineVersionId: "baseline-version-001",
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      status: "APPROVED",
      content: buildBaselineContent(),
      metadata: {
        version: 1,
        approvedBy: "user-manager",
        approvedAt: "2026-08-01T05:00:00.000Z",
        sourceHash,
        supersedesVersionId: null,
      },
    },
    decision: buildV22ReviewDecision("PROJECT_MANAGER"),
    changeReason: null,
  };
}

export function buildOperationalPlanningSnapshot(): OperationalPlanningSnapshotV1 {
  const scheduleSource = buildV22Source("ops-schedule", {
    sourceType: "SCHEDULE_VERSION",
  });
  const resourceSource = buildV22Source("ops-resource", {
    sourceType: "RESOURCE_AVAILABILITY",
  });
  const materialSource = buildV22Source("ops-material", {
    sourceType: "MATERIAL_LEDGER",
  });
  const inspectionSource = buildV22Source("ops-inspection", {
    sourceType: "INSPECTION",
  });
  const weatherSource = buildV22Source("ops-weather", {
    sourceType: "WEATHER_LOGISTICS",
  });
  const actualSource = buildV22Source("ops-actual", {
    sourceType: "DAILY_REPORT",
  });

  return {
    schemaVersion: 1,
    snapshotType: "OPERATIONAL_PLANNING",
    snapshotId: "operational-snapshot-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    asOf: "2026-08-01T05:00:00.000Z",
    baselineVersionId: "baseline-version-001",
    scheduleVersionId: "schedule-version-001",
    policyVersion: {
      policyVersionId: "planning-policy-001",
      version: 1,
      effectiveFrom: "2026-08-01",
    },
    calendar: {
      calendarVersionId: "calendar-version-001",
      timezone: "Asia/Ulaanbaatar",
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      workHoursPerDay: 8,
      holidays: [],
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      sourceRefs: [
        buildV22Source("ops-calendar", {
          sourceType: "CALENDAR_VERSION",
        }),
      ],
    },
    workItems: [
      {
        workItemId: "work-item-001",
        activityId: "activity-001",
        code: "WALL-AAC-200",
        name: "AAC wall construction",
        zoneCode: "Z-01",
        workClassCode: "MASONRY",
        unit: "m2",
        plannedQuantity: {
          value: "100",
          unit: "m2",
          sourceRefs: [scheduleSource],
        },
        remainingQuantity: {
          value: "50",
          unit: "m2",
          sourceRefs: [scheduleSource, actualSource],
        },
        status: "IN_PROGRESS",
        priority: "CRITICAL",
        isCritical: true,
        totalFloatWorkingDays: 0,
        downstreamUnlockCount: 2,
        contractMilestone: false,
        plannedStart: "2026-08-01",
        plannedFinish: "2026-08-12",
        predecessorWorkItemIds: [],
        requiredInspectionIds: ["inspection-001"],
        requiredCrewType: "MASON",
        requiredEquipmentIds: ["equipment-001"],
        requiredMaterials: [
          {
            materialId: "material-001",
            quantity: {
              value: "100",
              unit: "kg",
              sourceRefs: [scheduleSource],
            },
          },
        ],
        weatherRestrictions: ["NO_HEAVY_RAIN"],
        safetyRestrictions: ["ACCESS_CLEAR"],
        sourceRefs: [scheduleSource],
      },
    ],
    crews: [
      {
        crewId: "crew-001",
        crewType: "MASON",
        headcount: 5,
        shiftStart: "08:00",
        shiftEnd: "17:00",
        productivityPerShift: {
          value: "10",
          unit: "m2",
          sourceRefs: [resourceSource],
        },
        productivityVersion: buildV22CatalogVersion("PRODUCTIVITY", "productivity-version-001"),
        availableFrom: "2026-08-01",
        availableTo: "2026-12-31",
        available: true,
        sourceRefs: [resourceSource],
      },
    ],
    equipment: [
      {
        equipmentId: "equipment-001",
        equipmentType: "MIXER",
        capacityPerShift: {
          value: "20",
          unit: "m2",
          sourceRefs: [resourceSource],
        },
        availableFrom: "2026-08-01",
        availableTo: "2026-12-31",
        available: true,
        sourceRefs: [resourceSource],
      },
    ],
    materials: [
      {
        materialId: "material-001",
        availableQuantity: {
          value: "500",
          unit: "kg",
          sourceRefs: [materialSource],
        },
        reservedQuantity: {
          value: "100",
          unit: "kg",
          sourceRefs: [materialSource],
        },
        asOf: "2026-08-01T05:00:00.000Z",
        sourceRefs: [materialSource],
      },
    ],
    zones: [
      {
        zoneCode: "Z-01",
        maxConcurrentActivities: 2,
        available: true,
        sourceRefs: [resourceSource],
      },
    ],
    inspections: [
      {
        inspectionId: "inspection-001",
        workItemId: "work-item-001",
        code: "WALL-START",
        status: "PASSED",
        decidedAt: "2026-07-31T08:00:00.000Z",
        sourceRefs: [inspectionSource],
      },
    ],
    blockers: [],
    weatherConstraints: [
      {
        weatherConstraintId: "weather-001",
        date: "2026-08-01",
        weatherCode: "CLEAR",
        restrictedWorkClassCodes: [],
        sourceRefs: [weatherSource],
      },
    ],
    approvedActuals: [
      {
        actualId: "actual-001",
        workItemId: "work-item-001",
        reportDate: "2026-07-31",
        approvedQuantity: {
          value: "10",
          unit: "m2",
          sourceRefs: [actualSource],
        },
        progressVerificationId: "verification-version-previous",
        approvedAt: "2026-07-31T12:00:00.000Z",
        sourceRefs: [actualSource],
      },
    ],
  };
}

function buildDailyPlanContent(): DailyWorkPlanDraftV1["content"] {
  const scheduleSource = buildV22Source("plan-schedule", {
    sourceType: "SCHEDULE_VERSION",
  });
  const resourceSource = buildV22Source("plan-resource", {
    sourceType: "RESOURCE_AVAILABILITY",
  });
  const materialSource = buildV22Source("plan-material", {
    sourceType: "MATERIAL_LEDGER",
  });
  const inspectionSource = buildV22Source("plan-inspection", {
    sourceType: "INSPECTION",
  });
  const calculationSource = buildV22Source("plan-calculation");

  return {
    planDate: "2026-08-01",
    timezone: "Asia/Ulaanbaatar",
    baselineVersionId: "baseline-version-001",
    scheduleVersionId: "schedule-version-001",
    operationalSnapshotId: "operational-snapshot-001",
    items: [
      {
        planItemId: "plan-item-001",
        workItemId: "work-item-001",
        sourceScheduleActivityId: "activity-001",
        workCode: "WALL-AAC-200",
        workName: "AAC wall construction",
        zoneCode: "Z-01",
        unit: "m2",
        plannedQuantity: {
          value: "10",
          unit: "m2",
          sourceRefs: [calculationSource],
        },
        plannedStartTime: "08:00",
        plannedEndTime: "17:00",
        priorityRank: 1,
        criticality: "CRITICAL",
        status: "PLANNED",
        resources: [
          {
            assignmentId: "assignment-crew-001",
            resourceType: "CREW",
            resourceId: "crew-001",
            plannedStartTime: "08:00",
            plannedEndTime: "17:00",
            capacity: {
              value: "10",
              unit: "m2",
              sourceRefs: [resourceSource],
            },
            sourceRefs: [resourceSource],
          },
          {
            assignmentId: "assignment-equipment-001",
            resourceType: "EQUIPMENT",
            resourceId: "equipment-001",
            plannedStartTime: "08:00",
            plannedEndTime: "17:00",
            capacity: {
              value: "20",
              unit: "m2",
              sourceRefs: [resourceSource],
            },
            sourceRefs: [resourceSource],
          },
          {
            assignmentId: "assignment-zone-001",
            resourceType: "ZONE",
            resourceId: "Z-01",
            plannedStartTime: "08:00",
            plannedEndTime: "17:00",
            capacity: null,
            sourceRefs: [resourceSource],
          },
        ],
        materials: [
          {
            requirementId: "plan-material-001",
            materialId: "material-001",
            requiredQuantity: {
              value: "100",
              unit: "kg",
              sourceRefs: [materialSource],
            },
            availableQuantity: {
              value: "500",
              unit: "kg",
              sourceRefs: [materialSource],
            },
            sourceRefs: [materialSource],
          },
        ],
        preconditions: [
          {
            preconditionId: "precondition-inspection-001",
            type: "INSPECTION",
            referenceId: "inspection-001",
            status: "SATISFIED",
            message: "Required inspection passed",
            sourceRefs: [inspectionSource],
          },
        ],
        evidenceRuleId: "photo-rule-wall-001",
        feasibility: {
          eligible: true,
          feasible: true,
          targetQuantity: {
            value: "10",
            unit: "m2",
            sourceRefs: [calculationSource],
          },
          limitingFactor: "CREW_PRODUCTIVITY",
          reasonCodes: [],
          sourceRefs: [scheduleSource, resourceSource, materialSource, calculationSource],
        },
        sourceRefs: [scheduleSource, calculationSource],
      },
    ],
    conflicts: [],
  };
}

export function buildDailyWorkPlanDraft(): DailyWorkPlanDraftV1 {
  return {
    schemaVersion: 1,
    draftType: "DAILY_WORK_PLAN",
    draftId: "daily-plan-draft-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    status: "REVIEW_REQUIRED",
    content: buildDailyPlanContent(),
    validationIssues: [],
    requiresHumanReview: true,
    generatedAt: "2026-08-01T05:00:00.000Z",
    generatedBy: "A5",
  };
}

export function buildApprovedDailyWorkPlanCommand(): ApprovedDailyWorkPlanCommandV1 {
  return {
    schemaVersion: 1,
    commandType: "APPROVE_DAILY_WORK_PLAN",
    commandId: "approve-daily-plan-command-001",
    idempotencyKey: "approve-daily-plan-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    draftId: "daily-plan-draft-001",
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_DAILY_WORK_PLAN",
      dailyWorkPlanVersionId: "daily-plan-version-001",
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      status: "APPROVED",
      content: buildDailyPlanContent(),
      metadata: {
        version: 1,
        approvedBy: "user-manager",
        approvedAt: "2026-08-01T06:00:00.000Z",
        sourceHash,
        supersedesVersionId: null,
      },
    },
    decision: buildV22ReviewDecision("PROJECT_MANAGER"),
  };
}

function buildVerificationContent(): ProgressVerificationDraftV1["content"] {
  const planSource = buildV22Source("verification-plan", {
    sourceType: "SCHEDULE_VERSION",
    sourceId: "daily-plan-version-001",
  });
  const reportSource = buildV22Source("verification-report", {
    sourceType: "DAILY_REPORT",
    sourceId: "daily-report-001",
  });
  const photoSource = buildV22Source("verification-photo", {
    sourceType: "PHOTO_EVIDENCE",
    sourceId: "photo-001",
    artifactId: "photo-artifact-001",
  });
  const calculationSource = buildV22Source("verification-calculation");
  const engineerSource = buildV22Source("verification-engineer", {
    sourceType: "HUMAN_DECISION",
    sourceId: "verification-engineer-decision-001",
  });

  return {
    dailyWorkPlanVersionId: "daily-plan-version-001",
    dailyReportId: "daily-report-001",
    reportDate: "2026-08-01",
    items: [
      {
        verificationItemId: "verification-item-001",
        dailyPlanItemId: "plan-item-001",
        workItemId: "work-item-001",
        dailyProgressEntryId: "progress-entry-001",
        reportDate: "2026-08-01",
        unit: "m2",
        measurementMode: "QUANTITY",
        plannedQuantity: {
          value: "10",
          unit: "m2",
          sourceRefs: [planSource],
        },
        declaredQuantity: {
          value: "10",
          unit: "m2",
          sourceRefs: [reportSource],
        },
        verifiedQuantity: {
          value: "10",
          unit: "m2",
          sourceRefs: [reportSource, calculationSource],
        },
        cumulativeQuantity: {
          value: "60",
          unit: "m2",
          sourceRefs: [reportSource, calculationSource],
        },
        completionRatePercent: "100",
        workStarted: true,
        crewOrEquipmentAssigned: true,
        approvedBlockerId: null,
        mandatoryChecklistStatus: "PASSED",
        engineerDecision: {
          decisionId: "verification-engineer-decision-001",
          dailyPlanItemId: "plan-item-001",
          workItemId: "work-item-001",
          action: "ACCEPT_DECLARED",
          reviewerId: "user-site-engineer",
          reviewerRole: "SITE_ENGINEER",
          decidedAt: "2026-08-01T11:30:00.000Z",
          reason: null,
          overrideQuantity: null,
          sourceRefs: [engineerSource],
        },
        evidenceCoverage: {
          requiredCount: 1,
          acceptedCount: 1,
          coveragePercent: 100,
          requiredAnglesComplete: true,
          referenceMarkerPresent: true,
          sourceRefs: [photoSource],
        },
        photoChecks: [
          {
            checkId: "photo-check-001",
            photoArtifactId: "photo-artifact-001",
            code: "PE-01",
            result: "PASS",
            score: 1,
            message: "Photo decoded successfully",
            deterministic: true,
            sourceRefs: [photoSource],
          },
        ],
        completionStatus: "COMPLETED",
        variance: {
          quantity: {
            value: "0",
            unit: "m2",
            sourceRefs: [calculationSource],
          },
          percentage: "0",
          percentageSourceRefs: [calculationSource],
        },
        confidence: 0.95,
        issues: [],
        sourceRefs: [planSource, reportSource, photoSource, calculationSource, engineerSource],
      },
    ],
  };
}

export function buildProgressVerificationDraft(): ProgressVerificationDraftV1 {
  return {
    schemaVersion: 1,
    draftType: "PROGRESS_VERIFICATION",
    draftId: "verification-draft-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    status: "REVIEW_REQUIRED",
    content: buildVerificationContent(),
    validationIssues: [],
    requiresHumanReview: true,
    createdAt: "2026-08-01T12:00:00.000Z",
    createdBy: "A5",
  };
}

export function buildApprovedProgressVerificationCommand(): ApprovedProgressVerificationCommandV1 {
  return {
    schemaVersion: 1,
    commandType: "APPROVE_PROGRESS_VERIFICATION",
    commandId: "approve-verification-command-001",
    idempotencyKey: "approve-verification-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    draftId: "verification-draft-001",
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_PROGRESS_VERIFICATION",
      progressVerificationVersionId: "verification-version-001",
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      status: "APPROVED",
      content: buildVerificationContent(),
      metadata: {
        version: 1,
        approvedBy: "user-manager",
        approvedAt: "2026-08-01T13:00:00.000Z",
        sourceHash,
        supersedesVersionId: null,
      },
    },
    decision: buildV22ReviewDecision("PROJECT_MANAGER"),
  };
}

export function buildRollingProductivitySnapshot(): RollingProductivitySnapshotV1 {
  const actualSource = buildV22Source("productivity-actual", {
    sourceType: "DAILY_REPORT",
  });
  const calculationSource = buildV22Source("productivity-calculation");
  const normSource = buildV22Source("productivity-norm", {
    sourceType: "CATALOG_VERSION",
  });
  const samples = [1, 2, 3].map((day) => ({
    sampleId: `productivity-sample-00${day}`,
    workItemId: "work-item-001",
    reportDate: `2026-07-${28 + day}`,
    approvedVerificationId: `verification-version-00${day}`,
    quantity: {
      value: String(7 + day),
      unit: "m2" as const,
      sourceRefs: [actualSource],
    },
    included: true,
    exclusionReason: null,
    outlierCandidate: false,
    sourceRefs: [actualSource],
  }));

  return {
    schemaVersion: 1,
    snapshotType: "ROLLING_PRODUCTIVITY",
    snapshotId: "rolling-productivity-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    asOf: "2026-08-01T13:10:00.000Z",
    policyVersion: {
      policyVersionId: "forecast-policy-001",
      version: 1,
      effectiveFrom: "2026-08-01",
    },
    workItems: [
      {
        workItemId: "work-item-001",
        unit: "m2",
        samples,
        windows: [
          {
            windowWorkingDays: 3,
            method: "ROLLING_ACTUAL",
            sampleIds: samples.map((sample) => sample.sampleId),
            validSampleCount: 3,
            coveragePercent: 100,
            productivityPerWorkingDay: {
              value: "9",
              unit: "m2",
              sourceRefs: [calculationSource],
            },
            confidence: 0.9,
            sourceRefs: [actualSource, calculationSource],
          },
          {
            windowWorkingDays: 7,
            method: "COLD_START_NORM",
            sampleIds: [],
            validSampleCount: 0,
            coveragePercent: 42.86,
            productivityPerWorkingDay: {
              value: "8",
              unit: "m2",
              sourceRefs: [normSource],
            },
            confidence: 0.6,
            sourceRefs: [normSource],
          },
          {
            windowWorkingDays: 14,
            method: "INSUFFICIENT_DATA",
            sampleIds: [],
            validSampleCount: 0,
            coveragePercent: 21.43,
            productivityPerWorkingDay: null,
            confidence: 0.2,
            sourceRefs: [actualSource],
          },
        ],
        selectedWindowWorkingDays: 3,
        selectedProductivity: {
          value: "9",
          unit: "m2",
          sourceRefs: [calculationSource],
        },
      },
    ],
  };
}

function buildConfidenceFactor() {
  return {
    factor: "APPROVED_REPORT_COVERAGE" as const,
    score: 0.9,
    weight: 1,
    sourceRefs: [
      buildV22Source("forecast-confidence", {
        sourceType: "DAILY_REPORT",
      }),
    ],
  };
}

function buildForecastDriver() {
  const calculationSource = buildV22Source("forecast-driver-calculation");
  return {
    driverId: "forecast-driver-001",
    type: "PRODUCTIVITY" as const,
    workItemId: "work-item-001",
    summary: "Recent productivity is below baseline",
    impactWorkingDays: {
      value: 4,
      sourceRefs: [calculationSource],
    },
    sourceRefs: [calculationSource],
  };
}

export function buildOperationalForecastSnapshot(): OperationalForecastSnapshotV1 {
  const calculationSource = buildV22Source("forecast-calculation");
  const scheduleSource = buildV22Source("forecast-schedule", {
    sourceType: "SCHEDULE_VERSION",
  });

  return {
    schemaVersion: 1,
    snapshotType: "OPERATIONAL_FORECAST",
    snapshotId: "operational-forecast-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    asOf: "2026-08-01T13:20:00.000Z",
    baselineVersionId: "baseline-version-001",
    scheduleVersionId: "schedule-version-001",
    rollingProductivitySnapshotId: "rolling-productivity-001",
    policyVersion: {
      policyVersionId: "forecast-policy-001",
      version: 1,
      effectiveFrom: "2026-08-01",
    },
    thresholds: {
      warningWorkingDays: 5,
      criticalWorkingDays: 10,
      sourceRefs: [scheduleSource],
    },
    baselineFinish: "2026-12-31",
    projectedFinish: "2027-01-06",
    delayWorkingDays: {
      value: 4,
      sourceRefs: [calculationSource],
    },
    status: "AT_RISK",
    confidence: 0.9,
    confidenceFactors: [buildConfidenceFactor()],
    workItems: [
      {
        workItemId: "work-item-001",
        remainingQuantity: {
          value: "50",
          unit: "m2",
          sourceRefs: [scheduleSource],
        },
        adjustedDailyProductivity: {
          value: "9",
          unit: "m2",
          sourceRefs: [calculationSource],
        },
        remainingDurationWorkingDays: {
          value: 6,
          sourceRefs: [calculationSource],
        },
        projectedFinish: "2026-08-08",
        delayWorkingDays: {
          value: 1,
          sourceRefs: [calculationSource],
        },
        status: "AT_RISK",
        confidence: 0.9,
        confidenceFactors: [buildConfidenceFactor()],
        drivers: [buildForecastDriver()],
        sourceRefs: [scheduleSource, calculationSource],
      },
    ],
    drivers: [buildForecastDriver()],
    sourceRefs: [scheduleSource, calculationSource],
    deterministic: true,
    baselineChanged: false,
  };
}

export function buildRecoveryProposalDraft(): RecoveryProposalDraftV1 {
  const calculationSource = buildV22Source("recovery-calculation");

  return {
    schemaVersion: 1,
    draftType: "RECOVERY_PROPOSAL",
    draftId: "recovery-draft-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    operationalForecastSnapshotId: "operational-forecast-001",
    status: "REVIEW_REQUIRED",
    proposal: "Add one masonry crew for five working days",
    actions: [
      {
        actionId: "recovery-action-001",
        type: "ADD_CREW",
        workItemIds: ["work-item-001"],
        description: "Assign CREW-MASON-02",
        sourceRefs: [calculationSource],
      },
    ],
    estimatedScheduleImpactWorkingDays: {
      value: -4,
      sourceRefs: [calculationSource],
    },
    additionalCostMnt: {
      value: "500000.00",
      currency: "MNT",
      sourceRefs: [calculationSource],
    },
    requiredResourceIds: ["crew-002"],
    dependencyConflictIds: [],
    risks: ["Site congestion"],
    sourceRefs: [calculationSource],
    calculatedBy: "DETERMINISTIC_SCENARIO_ENGINE",
    baselineChanged: false,
    requiresHumanReview: true,
    createdAt: "2026-08-01T13:30:00.000Z",
  };
}
