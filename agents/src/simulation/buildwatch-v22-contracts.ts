import { z } from "zod";
import {
  buildWatchCanonicalQuantitySchema,
  buildWatchCanonicalUnitSchema,
  buildWatchPolicyVersionSchema,
  buildWatchSignedPercentageDecimalSchema,
  buildWatchSourceReferenceSchema,
  dailyWorkPlanDraftV1Schema,
  operationalForecastSnapshotV1Schema,
  operationalPlanningSnapshotV1Schema,
  progressCompletionStatusSchema,
  progressVerificationDraftV1Schema,
  projectAnalysisSnapshotV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
  sourceReferenceMatchesScope,
} from "../contracts/index.js";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "../contracts/common.js";

export const OPERATIONAL_SIMULATION_SCENARIOS = [
  "HEALTHY_CONTROL",
  "PREDECESSOR_UNFINISHED",
  "MATERIAL_SHORTAGE",
  "CREW_UNAVAILABLE",
  "EQUIPMENT_DOUBLE_BOOKING",
  "ZONE_CONFLICT",
  "HEAVY_RAIN_RESTRICTION",
  "INSPECTION_PENDING",
  "CRITICAL_WORK_OMITTED",
  "PLANNED_TARGET_PARTIAL",
  "APPROVED_BLOCKER",
  "MISSING_REPORT",
  "BLURRY_DARK_PHOTO",
  "DUPLICATE_PHOTO",
  "PREVIOUS_DAY_REUSED_PHOTO",
  "REPORT_PHOTO_MISMATCH",
  "FALSE_COMPLETED",
  "INSUFFICIENT_FORECAST_DATA",
  "CRITICAL_DELAY",
  "RECOVERY_OPTION_CONFLICT",
] as const;

export const operationalSimulationScenarioSchema = z.enum(OPERATIONAL_SIMULATION_SCENARIOS);

export const operationalSimulationControlTypeSchema = z.enum(["POSITIVE", "NEGATIVE", "BOUNDARY"]);

export const operationalPlanningRuleV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ruleId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(100),
    version: z.number().int().positive(),
    description: z.string().trim().min(1).max(2_000),
    inputCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    outputCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    deterministic: z.literal(true),
    policyVersion: buildWatchPolicyVersionSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const operationalEvidenceRuleV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ruleId: contractIdentifierSchema,
    workClassCode: z.string().trim().min(1).max(200),
    requiredPhotoCount: z.number().int().nonnegative().max(100),
    requiredAngles: z.array(z.string().trim().min(1).max(100)).max(100),
    checklistRequired: z.boolean(),
    referenceMarkerRequired: z.boolean(),
    maxPhotoAgeMinutes: z.number().int().positive().max(100_000),
    duplicateHammingDistanceThreshold: z.number().int().nonnegative().max(256),
    deterministic: z.literal(true),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const operationalPhotoMetadataV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    photoId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    capturedAt: contractIsoDateTimeSchema,
    uploadedAt: contractIsoDateTimeSchema,
    reportedWorkItemId: contractIdentifierSchema,
    detectedWorkItemId: contractIdentifierSchema.nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    perceptualHash: z.string().regex(/^[a-f0-9]{16}$/),
    widthPixels: z.number().int().positive().max(100_000),
    heightPixels: z.number().int().positive().max(100_000),
    sharpnessScore: z.number().finite().min(0).max(1),
    brightnessScore: z.number().finite().min(0).max(1),
    duplicateOfPhotoId: contractIdentifierSchema.nullable(),
    reusedFromReportDate: contractIsoDateSchema.nullable(),
    privacyStatus: z.enum(["CLEARED", "REDACTED", "RESTRICTED"]),
    acceptedForVerification: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((photo, context) => {
    if (
      photo.duplicateOfPhotoId === photo.photoId ||
      (photo.reusedFromReportDate !== null && photo.reusedFromReportDate >= photo.reportDate)
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo duplicate and reuse lineage must point to an earlier photo",
        path: ["duplicateOfPhotoId"],
      });
    }

    const qualityRejected =
      photo.sharpnessScore < 0.25 ||
      photo.brightnessScore < 0.2 ||
      photo.duplicateOfPhotoId !== null ||
      photo.reusedFromReportDate !== null ||
      (photo.detectedWorkItemId !== null && photo.detectedWorkItemId !== photo.reportedWorkItemId);
    if (qualityRejected && photo.acceptedForVerification) {
      context.addIssue({
        code: "custom",
        message: "Rejected quality, duplicate, reused, or mismatched photos cannot be accepted",
        path: ["acceptedForVerification"],
      });
    }

    photo.sourceRefs.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, photo.tenantId, photo.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Photo source is outside its tenant/project scope",
          path: ["sourceRefs", index],
        });
      }
    });
  });

export const operationalSimulationExpectedVarianceSchema = z
  .object({
    quantity: z
      .string()
      .trim()
      .regex(/^-?\d+(?:\.\d+)?$/),
    percentage: buildWatchSignedPercentageDecimalSchema,
    unit: buildWatchCanonicalUnitSchema,
  })
  .strict();

export const operationalSimulationAnswerCaseV1Schema = z
  .object({
    caseId: contractIdentifierSchema,
    scenario: operationalSimulationScenarioSchema,
    controlType: operationalSimulationControlTypeSchema,
    effectiveDate: contractIsoDateSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    workItemIds: z.array(contractIdentifierSchema).min(1).max(100),
    dailyPlanDraftId: contractIdentifierSchema.nullable(),
    progressVerificationDraftId: contractIdentifierSchema.nullable(),
    forecastSnapshotId: contractIdentifierSchema.nullable(),
    recoveryProposalDraftId: contractIdentifierSchema.nullable(),
    photoIds: z.array(contractIdentifierSchema).max(100),
    expectedEligible: z.boolean().nullable(),
    expectedPriority: z.number().int().positive().nullable(),
    expectedDailyTarget: buildWatchCanonicalQuantitySchema.nullable(),
    expectedConflicts: z.array(z.string().trim().min(1).max(200)).max(100),
    expectedCompletionStatus: progressCompletionStatusSchema.nullable(),
    expectedVariance: operationalSimulationExpectedVarianceSchema.nullable(),
    expectedForecastStatus: z
      .enum(["ON_TRACK", "AT_RISK", "LIKELY_LATE", "CRITICAL_LATE", "INSUFFICIENT_DATA"])
      .nullable(),
    expectedDrivers: z
      .array(
        z.enum([
          "PRODUCTIVITY",
          "MATERIAL",
          "CREW",
          "EQUIPMENT",
          "BLOCKER",
          "WEATHER",
          "DEPENDENCY",
          "DATA_QUALITY",
        ]),
      )
      .max(100),
    expectedSourceIds: z.array(contractIdentifierSchema).min(1).max(1_000),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((answerCase, context) => {
    if (
      new Set(answerCase.workItemIds).size !== answerCase.workItemIds.length ||
      new Set(answerCase.photoIds).size !== answerCase.photoIds.length ||
      new Set(answerCase.expectedConflicts).size !== answerCase.expectedConflicts.length ||
      new Set(answerCase.expectedDrivers).size !== answerCase.expectedDrivers.length ||
      new Set(answerCase.expectedSourceIds).size !== answerCase.expectedSourceIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Answer-key references and expected values must be unique",
        path: ["expectedSourceIds"],
      });
    }
  });

export const operationalSimulationAnswerKeyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    answerKeyType: z.literal("BUILDWATCH_OPERATIONAL_V22"),
    seed: z.string().trim().min(1).max(200),
    generatedAt: contractIsoDateTimeSchema,
    windowStart: contractIsoDateSchema,
    windowEnd: contractIsoDateSchema,
    cases: z
      .array(operationalSimulationAnswerCaseV1Schema)
      .min(OPERATIONAL_SIMULATION_SCENARIOS.length)
      .max(1_000),
  })
  .strict()
  .superRefine((answerKey, context) => {
    const caseIds = answerKey.cases.map((answerCase) => answerCase.caseId);
    const scenarios = answerKey.cases.map((answerCase) => answerCase.scenario);
    if (new Set(caseIds).size !== caseIds.length || new Set(scenarios).size !== scenarios.length) {
      context.addIssue({
        code: "custom",
        message: "Answer-key case IDs and scenarios must be unique",
        path: ["cases"],
      });
    }

    const actualScenarios = new Set(scenarios);
    for (const scenario of OPERATIONAL_SIMULATION_SCENARIOS) {
      if (!actualScenarios.has(scenario)) {
        context.addIssue({
          code: "custom",
          message: `Answer key is missing scenario ${scenario}`,
          path: ["cases"],
        });
      }
    }

    const controls = new Set(answerKey.cases.map((answerCase) => answerCase.controlType));
    for (const control of ["POSITIVE", "NEGATIVE", "BOUNDARY"] as const) {
      if (!controls.has(control)) {
        context.addIssue({
          code: "custom",
          message: `Answer key is missing ${control} control coverage`,
          path: ["cases"],
        });
      }
    }
  });

export const operationalPrivateFixtureV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureType: z.literal("CROSS_TENANT_PRIVATE"),
    marker: z.literal("TENANT-PRIVATE-ONLY"),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    operationalSnapshot: operationalPlanningSnapshotV1Schema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if (
      fixture.operationalSnapshot.tenantId !== fixture.tenantId ||
      fixture.operationalSnapshot.projectId !== fixture.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Private fixture scope must match its snapshot",
        path: ["operationalSnapshot"],
      });
    }
  });

function collectSourceReferences(value: unknown): Array<{
  sourceRefId: string;
  sourceId: string;
}> {
  const references: Array<{
    sourceRefId: string;
    sourceId: string;
  }> = [];

  function visit(candidate: unknown): void {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }

    if (candidate === null || typeof candidate !== "object") {
      return;
    }

    const record = candidate as Record<string, unknown>;
    const sourceRefs = record.sourceRefs;
    if (Array.isArray(sourceRefs)) {
      for (const source of sourceRefs) {
        if (
          source !== null &&
          typeof source === "object" &&
          typeof (source as Record<string, unknown>).sourceRefId === "string" &&
          typeof (source as Record<string, unknown>).sourceId === "string"
        ) {
          references.push({
            sourceRefId: (source as { sourceRefId: string }).sourceRefId,
            sourceId: (source as { sourceId: string }).sourceId,
          });
        }
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (key !== "sourceRefs") {
        visit(child);
      }
    }
  }

  visit(value);
  return references;
}

function addAgentDatasetIssues(
  dataset: z.infer<typeof operationalSimulationAgentDatasetV1Schema>,
  context: z.RefinementCtx,
): void {
  const scopeMatches = (tenantId: string, projectId: string): boolean =>
    tenantId === dataset.tenantId && projectId === dataset.projectId;

  if (!scopeMatches(dataset.analysisSnapshot.tenantId, dataset.analysisSnapshot.projectId)) {
    context.addIssue({
      code: "custom",
      message: "Analysis snapshot is outside the agent dataset scope",
      path: ["analysisSnapshot"],
    });
  }

  if (dataset.operationalSnapshots.length < 30 || dataset.dailyPlans.length < 30) {
    context.addIssue({
      code: "custom",
      message: "Operational simulation requires at least 30 snapshots and planning days",
      path: ["operationalSnapshots"],
    });
  }

  const planDecisionCount = dataset.dailyPlans.reduce(
    (sum, plan) => sum + plan.content.items.length,
    0,
  );
  if (planDecisionCount < 100) {
    context.addIssue({
      code: "custom",
      message: "Operational simulation requires at least 100 plan-item decisions",
      path: ["dailyPlans"],
    });
  }

  if (
    dataset.operationalSnapshots.some(
      (snapshot) => snapshot.workItems.length < 40 || snapshot.workItems.length > 60,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Every operational snapshot must contain 40–60 work items",
      path: ["operationalSnapshots"],
    });
  }

  const uniqueCollections = [
    dataset.sourceCatalog.map((source) => source.sourceRefId),
    dataset.sourceCatalog.map((source) => source.sourceId),
    dataset.planningRules.map((rule) => rule.ruleId),
    dataset.evidenceRules.map((rule) => rule.ruleId),
    dataset.operationalSnapshots.map((snapshot) => snapshot.snapshotId),
    dataset.dailyPlans.map((plan) => plan.draftId),
    dataset.dailyPlans.map((plan) => plan.content.planDate),
    dataset.photoMetadata.map((photo) => photo.photoId),
    dataset.photoMetadata.map((photo) => photo.artifactId),
    dataset.verificationDrafts.map((draft) => draft.draftId),
    dataset.rollingProductivitySnapshots.map((snapshot) => snapshot.snapshotId),
    dataset.rollingForecasts.map((forecast) => forecast.snapshotId),
    dataset.recoveryProposals.map((proposal) => proposal.draftId),
  ];
  if (uniqueCollections.some((values) => new Set(values).size !== values.length)) {
    context.addIssue({
      code: "custom",
      message: "Operational simulation aggregate IDs must be unique",
      path: ["sourceCatalog"],
    });
  }

  const sourceByRefId = new Map(
    dataset.sourceCatalog.map((source) => [source.sourceRefId, source]),
  );
  for (const [index, reference] of collectSourceReferences(dataset).entries()) {
    const catalogSource = sourceByRefId.get(reference.sourceRefId);
    if (catalogSource === undefined || catalogSource.sourceId !== reference.sourceId) {
      context.addIssue({
        code: "custom",
        message: "Public aggregate source is missing or inconsistent in the source catalog",
        path: ["sourceCatalog", index],
      });
    }
  }

  dataset.sourceCatalog.forEach((source, index) => {
    if (!sourceReferenceMatchesScope(source, dataset.tenantId, dataset.projectId)) {
      context.addIssue({
        code: "custom",
        message: "Source catalog entry is outside the dataset scope",
        path: ["sourceCatalog", index],
      });
    }
  });

  const operationalSnapshots = new Map(
    dataset.operationalSnapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  const evidenceRuleIds = new Set(dataset.evidenceRules.map((rule) => rule.ruleId));
  dataset.dailyPlans.forEach((plan, index) => {
    const snapshot = operationalSnapshots.get(plan.content.operationalSnapshotId);
    if (
      snapshot === undefined ||
      snapshot.asOf.slice(0, 10) !== plan.content.planDate ||
      !scopeMatches(plan.tenantId, plan.projectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Daily plan must reference the same-date operational snapshot in scope",
        path: ["dailyPlans", index],
      });
    }
    for (const [itemIndex, item] of plan.content.items.entries()) {
      if (!evidenceRuleIds.has(item.evidenceRuleId)) {
        context.addIssue({
          code: "custom",
          message: "Daily plan references an unknown evidence rule",
          path: ["dailyPlans", index, "content", "items", itemIndex, "evidenceRuleId"],
        });
      }
    }
  });

  const planDates = new Set(dataset.dailyPlans.map((plan) => plan.content.planDate));
  dataset.verificationDrafts.forEach((draft, index) => {
    if (
      !planDates.has(draft.content.reportDate) ||
      !scopeMatches(draft.tenantId, draft.projectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification must reference a planning date in the same scope",
        path: ["verificationDrafts", index],
      });
    }
  });

  const artifactIds = new Set(dataset.photoMetadata.map((photo) => photo.artifactId));
  const photoIds = new Set(dataset.photoMetadata.map((photo) => photo.photoId));
  dataset.photoMetadata.forEach((photo, index) => {
    if (
      !scopeMatches(photo.tenantId, photo.projectId) ||
      (photo.duplicateOfPhotoId !== null && !photoIds.has(photo.duplicateOfPhotoId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo metadata scope or duplicate lineage is invalid",
        path: ["photoMetadata", index],
      });
    }
  });
  dataset.verificationDrafts.forEach((draft, draftIndex) => {
    draft.content.items.forEach((item, itemIndex) => {
      item.photoChecks.forEach((check, checkIndex) => {
        if (!artifactIds.has(check.photoArtifactId)) {
          context.addIssue({
            code: "custom",
            message: "Verification photo check references an unknown artifact",
            path: [
              "verificationDrafts",
              draftIndex,
              "content",
              "items",
              itemIndex,
              "photoChecks",
              checkIndex,
            ],
          });
        }
      });
    });
  });

  const productivitySnapshotIds = new Set(
    dataset.rollingProductivitySnapshots.map((snapshot) => snapshot.snapshotId),
  );
  const forecastIds = new Set(dataset.rollingForecasts.map((forecast) => forecast.snapshotId));
  dataset.rollingForecasts.forEach((forecast, index) => {
    if (
      !productivitySnapshotIds.has(forecast.rollingProductivitySnapshotId) ||
      !scopeMatches(forecast.tenantId, forecast.projectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast must reference a rolling-productivity snapshot in scope",
        path: ["rollingForecasts", index],
      });
    }
  });
  dataset.recoveryProposals.forEach((proposal, index) => {
    if (
      !forecastIds.has(proposal.operationalForecastSnapshotId) ||
      !scopeMatches(proposal.tenantId, proposal.projectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Recovery proposal must reference a forecast in scope",
        path: ["recoveryProposals", index],
      });
    }
  });

  if (JSON.stringify(dataset).includes("TENANT-PRIVATE-ONLY")) {
    context.addIssue({
      code: "custom",
      message: "Private fixture marker leaked into the public dataset",
      path: [],
    });
  }
}

export const operationalSimulationAgentDatasetV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    datasetType: z.literal("BUILDWATCH_OPERATIONAL_V22_AGENT_DATA"),
    seed: z.string().trim().min(1).max(200),
    generatedAt: contractIsoDateTimeSchema,
    windowStart: contractIsoDateSchema,
    windowEnd: contractIsoDateSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    deterministic: z.literal(true),
    llmRequired: z.literal(false),
    analysisSnapshot: projectAnalysisSnapshotV1Schema,
    sourceCatalog: z.array(buildWatchSourceReferenceSchema).min(1).max(100_000),
    planningRules: z.array(operationalPlanningRuleV1Schema).min(1).max(100),
    evidenceRules: z.array(operationalEvidenceRuleV1Schema).min(1).max(1_000),
    operationalSnapshots: z.array(operationalPlanningSnapshotV1Schema).min(30).max(1_000),
    dailyPlans: z.array(dailyWorkPlanDraftV1Schema).min(30).max(10_000),
    photoMetadata: z.array(operationalPhotoMetadataV1Schema).min(60).max(1_000_000),
    verificationDrafts: z.array(progressVerificationDraftV1Schema).min(1).max(10_000),
    rollingProductivitySnapshots: z.array(rollingProductivitySnapshotV1Schema).min(3).max(10_000),
    rollingForecasts: z.array(operationalForecastSnapshotV1Schema).min(3).max(10_000),
    recoveryProposals: z.array(recoveryProposalDraftV1Schema).min(1).max(10_000),
  })
  .strict()
  .superRefine(addAgentDatasetIssues);

export const buildWatchOperationalSimulationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    simulationType: z.literal("BUILDWATCH_OPERATIONAL_V22"),
    seed: z.string().trim().min(1).max(200),
    generatedAt: contractIsoDateTimeSchema,
    windowStart: contractIsoDateSchema,
    windowEnd: contractIsoDateSchema,
    agentDataset: operationalSimulationAgentDatasetV1Schema,
    privateFixture: operationalPrivateFixtureV1Schema,
    answerKey: operationalSimulationAnswerKeyV1Schema,
  })
  .strict()
  .superRefine((simulation, context) => {
    const metadataMatches =
      simulation.seed === simulation.agentDataset.seed &&
      simulation.seed === simulation.answerKey.seed &&
      simulation.generatedAt === simulation.agentDataset.generatedAt &&
      simulation.generatedAt === simulation.answerKey.generatedAt &&
      simulation.windowStart === simulation.agentDataset.windowStart &&
      simulation.windowStart === simulation.answerKey.windowStart &&
      simulation.windowEnd === simulation.agentDataset.windowEnd &&
      simulation.windowEnd === simulation.answerKey.windowEnd;
    if (!metadataMatches) {
      context.addIssue({
        code: "custom",
        message: "Simulation, public dataset, and answer-key metadata must match",
        path: ["agentDataset"],
      });
    }

    if (
      simulation.privateFixture.tenantId === simulation.agentDataset.tenantId ||
      simulation.privateFixture.projectId === simulation.agentDataset.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Cross-tenant fixture must use a different tenant and project",
        path: ["privateFixture"],
      });
    }

    const planIds = new Set(simulation.agentDataset.dailyPlans.map((plan) => plan.draftId));
    const verificationIds = new Set(
      simulation.agentDataset.verificationDrafts.map((draft) => draft.draftId),
    );
    const forecastIds = new Set(
      simulation.agentDataset.rollingForecasts.map((forecast) => forecast.snapshotId),
    );
    const recoveryIds = new Set(
      simulation.agentDataset.recoveryProposals.map((proposal) => proposal.draftId),
    );
    const photoIds = new Set(simulation.agentDataset.photoMetadata.map((photo) => photo.photoId));
    const workItemIds = new Set(
      simulation.agentDataset.operationalSnapshots[0]?.workItems.map(
        (workItem) => workItem.workItemId,
      ) ?? [],
    );
    const sourceIds = new Set(
      simulation.agentDataset.sourceCatalog.map((source) => source.sourceId),
    );

    simulation.answerKey.cases.forEach((answerCase, index) => {
      const optionalReferencesAreValid =
        (answerCase.dailyPlanDraftId === null || planIds.has(answerCase.dailyPlanDraftId)) &&
        (answerCase.progressVerificationDraftId === null ||
          verificationIds.has(answerCase.progressVerificationDraftId)) &&
        (answerCase.forecastSnapshotId === null ||
          forecastIds.has(answerCase.forecastSnapshotId)) &&
        (answerCase.recoveryProposalDraftId === null ||
          recoveryIds.has(answerCase.recoveryProposalDraftId));
      const collectionReferencesAreValid =
        answerCase.workItemIds.every((id) => workItemIds.has(id)) &&
        answerCase.photoIds.every((id) => photoIds.has(id)) &&
        answerCase.expectedSourceIds.every((id) => sourceIds.has(id));
      if (
        !optionalReferencesAreValid ||
        !collectionReferencesAreValid ||
        answerCase.tenantId !== simulation.agentDataset.tenantId ||
        answerCase.projectId !== simulation.agentDataset.projectId
      ) {
        context.addIssue({
          code: "custom",
          message: "Answer-key case references data outside the public simulation",
          path: ["answerKey", "cases", index],
        });
      }
    });
  });

export type OperationalSimulationScenario = z.infer<typeof operationalSimulationScenarioSchema>;
export type OperationalSimulationControlType = z.infer<
  typeof operationalSimulationControlTypeSchema
>;
export type OperationalPlanningRuleV1 = z.infer<typeof operationalPlanningRuleV1Schema>;
export type OperationalEvidenceRuleV1 = z.infer<typeof operationalEvidenceRuleV1Schema>;
export type OperationalPhotoMetadataV1 = z.infer<typeof operationalPhotoMetadataV1Schema>;
export type OperationalSimulationAnswerCaseV1 = z.infer<
  typeof operationalSimulationAnswerCaseV1Schema
>;
export type OperationalSimulationAnswerKeyV1 = z.infer<
  typeof operationalSimulationAnswerKeyV1Schema
>;
export type OperationalPrivateFixtureV1 = z.infer<typeof operationalPrivateFixtureV1Schema>;
export type OperationalSimulationAgentDatasetV1 = z.infer<
  typeof operationalSimulationAgentDatasetV1Schema
>;
export type BuildWatchOperationalSimulationV1 = z.infer<
  typeof buildWatchOperationalSimulationV1Schema
>;
