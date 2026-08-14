import type { BuildWatchSourceReference } from "../contracts/buildwatch-v2-common.js";
import type { SignedArtifactReadReferenceV1 } from "../artifacts/contracts.js";
import {
  buildPhase7EstimatePolicy,
  buildPhase7MaterialNorms,
  buildPhase7Prices,
  buildPhase7ProductivityRates,
  buildPhase7QuantityRequest,
  buildPhase7ScheduleRequest,
  buildPhase7WorkTemplates,
  phase7FixtureScope,
  phase7FixtureTimes,
} from "../baseline-generation/fixtures.js";
import { runPhase7GoldenPipeline } from "../baseline-generation/pipeline.js";
import { buildA5SimulationRequest } from "../planning/evaluation.js";
import { generateA5DailyPlan } from "../planning/plan.js";
import {
  BUILDWATCH_SIMULATION_GENERATED_AT,
  buildBuildWatchOperationalSimulation,
} from "../simulation/index.js";
import {
  a0OrchestrationRequestV1Schema,
  a5OrchestrationRequestV1Schema,
  phase8AuthorizationContextSchema,
  phase8ToolNames,
  type A0OrchestrationRequestV1,
  type A5OrchestrationRequestV1,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
  type Phase8ToolRecord,
} from "./contracts.js";
import { buildPhase8ToolRecord, collectPhase8ArtifactIds, phase8Hash } from "./deterministic.js";
import { InMemoryPhase8ReadRepository } from "./repository.js";
import { Phase8ToolGateway } from "./tools.js";

function jsonObject(value: object): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

function designSummarySource(): BuildWatchSourceReference {
  return buildPhase7QuantityRequest().candidates[0]!.sourceRefs[0]!;
}

function a0Records(): {
  records: Phase8ToolRecord[];
  request: A0OrchestrationRequestV1;
} {
  const pipeline = runPhase7GoldenPipeline();
  const quantityRequest = buildPhase7QuantityRequest();
  const source = designSummarySource();
  const records: Phase8ToolRecord[] = [
    buildPhase8ToolRecord({
      recordId: "phase8-design-document",
      toolName: "getDesignDocuments",
      ...phase7FixtureScope,
      versionId: "drawing-revision-phase7",
      effectiveAt: "2026-08-03T00:00:00.000Z",
      data: {
        documentId: "document-phase7",
        artifactId: "artifact-phase7-drawing",
        originalFileName: "architecture-phase7.pdf",
        mediaType: "PDF",
        classification: "ARCHITECTURAL_DRAWING",
        discipline: "ARCHITECTURE",
        status: "ACCEPTED",
        pageCount: 1,
        sourceRefs: [source],
      },
    }),
    buildPhase8ToolRecord({
      recordId: "phase8-drawing-revision",
      toolName: "getDrawingRevisions",
      ...phase7FixtureScope,
      versionId: "drawing-revision-phase7",
      effectiveAt: "2026-08-03T00:01:00.000Z",
      data: {
        revisionId: "drawing-revision-phase7",
        documentId: "document-phase7",
        revisionCode: "A-PHASE7",
        issuedOn: "2026-08-03",
        status: "ACTIVE",
        supersedesRevisionId: null,
        sourceRefs: [source],
      },
    }),
    buildPhase8ToolRecord({
      recordId: "phase8-drawing-page",
      toolName: "getDrawingPages",
      ...phase7FixtureScope,
      versionId: "drawing-revision-phase7",
      effectiveAt: "2026-08-03T00:01:00.000Z",
      data: {
        pageId: "drawing-page-phase7",
        revisionId: "drawing-revision-phase7",
        artifactId: "artifact-phase7-drawing",
        pageNumber: 1,
        title: "Golden architecture page",
        discipline: "ARCHITECTURE",
        scaleStatus: "VERIFIED",
        sourceRefs: [source],
      },
    }),
    buildPhase8ToolRecord({
      recordId: "phase8-verified-scale",
      toolName: "getVerifiedScale",
      ...phase7FixtureScope,
      versionId: quantityRequest.verifiedScale.scaleId,
      effectiveAt: quantityRequest.verifiedScale.reviewedAt,
      data: jsonObject(quantityRequest.verifiedScale),
    }),
    ...quantityRequest.candidates.map((candidate) =>
      buildPhase8ToolRecord({
        recordId: `phase8-element-${candidate.candidateId}`,
        toolName: "getExtractedElements",
        ...phase7FixtureScope,
        versionId: candidate.revisionId,
        effectiveAt: candidate.createdAt,
        data: jsonObject(candidate),
      }),
    ),
    buildPhase8ToolRecord({
      recordId: "phase8-approved-quantity",
      toolName: "getQuantityTakeoff",
      ...phase7FixtureScope,
      versionId: pipeline.quantityCommand.approvedVersion.quantityTakeoffVersionId,
      effectiveAt: pipeline.quantityCommand.approvedVersion.metadata.approvedAt,
      data: jsonObject(pipeline.quantityCommand.approvedVersion),
    }),
    ...buildPhase7MaterialNorms().map((norm) =>
      buildPhase8ToolRecord({
        recordId: `phase8-material-norm-${norm.normId}`,
        toolName: "getMaterialNorms",
        ...phase7FixtureScope,
        versionId: norm.version.versionId,
        effectiveAt: `${norm.version.effectiveFrom}T00:00:00.000Z`,
        data: jsonObject(norm),
      }),
    ),
    ...buildPhase7Prices().map((price) =>
      buildPhase8ToolRecord({
        recordId: `phase8-price-${price.priceId}`,
        toolName: "getMaterialPrices",
        ...phase7FixtureScope,
        versionId: price.version.versionId,
        effectiveAt: `${price.version.effectiveFrom}T00:00:00.000Z`,
        data: jsonObject(price),
      }),
    ),
    ...buildPhase7ProductivityRates().map((productivity) =>
      buildPhase8ToolRecord({
        recordId: `phase8-productivity-${productivity.productivityId}`,
        toolName: "getProductivityRates",
        ...phase7FixtureScope,
        versionId: productivity.version.versionId,
        effectiveAt: `${productivity.version.effectiveFrom}T00:00:00.000Z`,
        data: jsonObject(productivity),
      }),
    ),
    ...buildPhase7WorkTemplates().map((template) =>
      buildPhase8ToolRecord({
        recordId: `phase8-template-${template.templateId}`,
        toolName: "getScheduleDependencies",
        ...phase7FixtureScope,
        versionId: template.version.versionId,
        effectiveAt: `${template.version.effectiveFrom}T00:00:00.000Z`,
        data: jsonObject(template),
      }),
    ),
    buildPhase8ToolRecord({
      recordId: "phase8-estimate-policy",
      toolName: "getEstimateAssumptions",
      ...phase7FixtureScope,
      versionId: buildPhase7EstimatePolicy().version.versionId,
      effectiveAt: `${buildPhase7EstimatePolicy().version.effectiveFrom}T00:00:00.000Z`,
      data: jsonObject(buildPhase7EstimatePolicy()),
    }),
  ];
  return {
    records,
    request: a0OrchestrationRequestV1Schema.parse({
      schemaVersion: 1,
      requestType: "A0_ORCHESTRATION",
      runId: "phase8-a0-golden-run",
      ...phase7FixtureScope,
      asOf: "2026-08-03T02:00:00.000Z",
      quantityRequest,
      approvedQuantity: pipeline.quantityCommand.approvedVersion,
      approvedEstimate: pipeline.estimateCommand.approvedVersion,
      approvedSchedule: pipeline.approvedSchedule,
      scheduleRequest: buildPhase7ScheduleRequest({
        approvedQuantity: pipeline.quantityCommand.approvedVersion,
        approvedEstimate: pipeline.estimateCommand.approvedVersion,
      }),
      estimateGeneratedAt: phase7FixtureTimes.estimateCreated,
      baselineDraftId: "baseline-draft-phase8-orchestration",
      llmMode: "OFF",
      generatedAt: "2026-08-03T02:00:00.000Z",
    }),
  };
}

function selectedOperationalCase() {
  const simulation = buildBuildWatchOperationalSimulation();
  const answerCase = simulation.answerKey.cases.find((candidate) => {
    const snapshot = simulation.agentDataset.operationalSnapshots.find(
      (value) => value.asOf.slice(0, 10) === candidate.effectiveDate,
    );
    return (
      candidate.expectedEligible === true &&
      candidate.dailyPlanDraftId !== null &&
      candidate.progressVerificationDraftId !== null &&
      candidate.forecastSnapshotId !== null &&
      candidate.recoveryProposalDraftId !== null &&
      candidate.photoIds.length > 0 &&
      (snapshot?.approvedActuals.length ?? 0) > 0
    );
  });
  if (answerCase === undefined) {
    throw new Error("Phase 8 golden simulation has no complete A5 orchestration case");
  }
  return { simulation, answerCase };
}

function a5Records(): {
  records: Phase8ToolRecord[];
  request: A5OrchestrationRequestV1;
} {
  const { simulation, answerCase } = selectedOperationalCase();
  const planningRequest = buildA5SimulationRequest(simulation, answerCase);
  const planResult = generateA5DailyPlan(planningRequest);
  if (planResult.draft === null) {
    throw new Error("Phase 8 golden A5 case did not produce a daily plan draft");
  }
  const snapshot = planningRequest.operationalSnapshot;
  const photoIds = new Set(answerCase.photoIds);
  const photos = simulation.agentDataset.photoMetadata.filter((photo) =>
    photoIds.has(photo.photoId),
  );
  const verification = simulation.agentDataset.verificationDrafts.find(
    (draft) => draft.draftId === answerCase.progressVerificationDraftId,
  );
  const forecast = simulation.agentDataset.rollingForecasts.find(
    (candidate) => candidate.snapshotId === answerCase.forecastSnapshotId,
  );
  if (verification === undefined || forecast === undefined) {
    throw new Error("Phase 8 golden A5 verification or forecast is missing");
  }
  const rolling = simulation.agentDataset.rollingProductivitySnapshots.find(
    (candidate) => candidate.snapshotId === forecast.rollingProductivitySnapshotId,
  );
  if (rolling === undefined) {
    throw new Error("Phase 8 golden rolling-productivity snapshot is missing");
  }
  const recoveries = simulation.agentDataset.recoveryProposals.filter(
    (proposal) => proposal.operationalForecastSnapshotId === forecast.snapshotId,
  );
  const scope = { tenantId: snapshot.tenantId, projectId: snapshot.projectId };
  const record = (
    toolName: Phase8ToolName,
    recordId: string,
    versionId: string,
    effectiveAt: string,
    data: object,
  ) =>
    buildPhase8ToolRecord({
      recordId,
      toolName,
      ...scope,
      versionId,
      effectiveAt,
      data: jsonObject(data),
    });
  const records: Phase8ToolRecord[] = [
    ...snapshot.workItems.map((item) =>
      record(
        "getCurrentSchedule",
        `phase8-schedule-${item.workItemId}`,
        snapshot.scheduleVersionId,
        snapshot.asOf,
        item,
      ),
    ),
    ...planResult.decisions.map((decision) =>
      record(
        "getEligibleWorkItems",
        `phase8-eligibility-${decision.workItemId}`,
        snapshot.snapshotId,
        planningRequest.generatedAt,
        decision,
      ),
    ),
    ...snapshot.workItems.map((item) =>
      record(
        "getRemainingQuantities",
        `phase8-remaining-${item.workItemId}`,
        snapshot.snapshotId,
        snapshot.asOf,
        item,
      ),
    ),
    ...snapshot.crews.map((crew) =>
      record(
        "getCrewAvailability",
        `phase8-crew-${crew.crewId}`,
        snapshot.snapshotId,
        snapshot.asOf,
        crew,
      ),
    ),
    ...snapshot.equipment.map((equipment) =>
      record(
        "getEquipmentAvailability",
        `phase8-equipment-${equipment.equipmentId}`,
        snapshot.snapshotId,
        snapshot.asOf,
        equipment,
      ),
    ),
    ...snapshot.materials.map((material) =>
      record(
        "getMaterialAvailability",
        `phase8-material-${material.materialId}`,
        snapshot.snapshotId,
        material.asOf,
        material,
      ),
    ),
    ...snapshot.weatherConstraints.map((weather) =>
      record(
        "getWeatherConstraints",
        `phase8-weather-${weather.weatherConstraintId}`,
        snapshot.snapshotId,
        `${weather.date}T00:00:00.000Z`,
        weather,
      ),
    ),
    ...snapshot.blockers
      .filter((blocker) => blocker.isOpen)
      .map((blocker) =>
        record(
          "getOpenBlockers",
          `phase8-blocker-${blocker.blockerId}`,
          snapshot.snapshotId,
          `${blocker.startedOn}T00:00:00.000Z`,
          blocker,
        ),
      ),
    record(
      "getDailyPlan",
      `phase8-plan-${planResult.draft.draftId}`,
      planResult.draft.draftId,
      planResult.draft.generatedAt,
      planResult.draft,
    ),
    ...snapshot.approvedActuals.map((actual) =>
      record(
        "getDailyActuals",
        `phase8-actual-${actual.actualId}`,
        actual.progressVerificationId,
        actual.approvedAt,
        actual,
      ),
    ),
    ...photos.map((photo) =>
      record(
        "getPhotoEvidence",
        `phase8-photo-${photo.photoId}`,
        photo.photoId,
        photo.uploadedAt,
        photo,
      ),
    ),
    record(
      "getProgressVerification",
      `phase8-verification-${verification.draftId}`,
      verification.draftId,
      verification.createdAt,
      verification,
    ),
    record(
      "getRollingProductivity",
      `phase8-productivity-${rolling.snapshotId}`,
      rolling.snapshotId,
      rolling.asOf,
      rolling,
    ),
    record(
      "getLatestForecast",
      `phase8-forecast-${forecast.snapshotId}`,
      forecast.snapshotId,
      forecast.asOf,
      forecast,
    ),
    ...recoveries.map((proposal) =>
      record(
        "getRecoveryScenarios",
        `phase8-recovery-${proposal.draftId}`,
        proposal.draftId,
        proposal.createdAt,
        proposal,
      ),
    ),
  ];
  return {
    records,
    request: a5OrchestrationRequestV1Schema.parse({
      schemaVersion: 1,
      requestType: "A5_ORCHESTRATION",
      runId: "phase8-a5-golden-run",
      ...scope,
      asOf: BUILDWATCH_SIMULATION_GENERATED_AT,
      planningRequest,
      llmMode: "OFF",
      generatedAt: BUILDWATCH_SIMULATION_GENERATED_AT,
    }),
  };
}

function privateRecords(): Phase8ToolRecord[] {
  const source: BuildWatchSourceReference = {
    sourceRefId: "phase8-private-source",
    tenantId: "tenant-private",
    projectId: "project-private",
    sourceType: "SYSTEM_CALCULATION",
    sourceId: "TENANT-PRIVATE-ONLY",
    sourceVersionId: "phase8-private-v1",
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: "private",
    region: null,
    asOf: "2026-01-01T00:00:00.000Z",
    sha256: null,
  };
  return phase8ToolNames.map((toolName) =>
    buildPhase8ToolRecord({
      recordId: `phase8-private-${toolName}`,
      toolName,
      tenantId: "tenant-private",
      projectId: "project-private",
      versionId: "phase8-private-v1",
      effectiveAt: "2026-01-01T00:00:00.000Z",
      data: {
        marker: "TENANT-PRIVATE-ONLY",
        sourceRefs: [source],
      },
    }),
  );
}

function signedReference(
  artifactId: string,
  tenantId: string,
  projectId: string,
): SignedArtifactReadReferenceV1 {
  return {
    schemaVersion: 1,
    referenceId: `phase8-signed-${phase8Hash(artifactId).slice(0, 20)}`,
    artifactId,
    tenantId,
    projectId,
    storageKey: `${tenantId}/${projectId}/${artifactId}.bin`,
    sha256: phase8Hash(artifactId),
    expiresAt: "2027-01-01T00:00:00.000Z",
    accessToken: phase8Hash(`signed:${tenantId}:${projectId}:${artifactId}`),
  };
}

export function verifyPhase8FixtureSignedRead(reference: SignedArtifactReadReferenceV1): boolean {
  return (
    reference.accessToken ===
    phase8Hash(`signed:${reference.tenantId}:${reference.projectId}:${reference.artifactId}`)
  );
}

export type Phase8GoldenFixture = Readonly<{
  records: readonly Phase8ToolRecord[];
  repository: InMemoryPhase8ReadRepository;
  gateway: Phase8ToolGateway;
  context: Phase8AuthorizationContext;
  a0Request: A0OrchestrationRequestV1;
  a5Request: A5OrchestrationRequestV1;
}>;

let cachedFixture: Phase8GoldenFixture | undefined;

export function buildPhase8GoldenFixture(): Phase8GoldenFixture {
  if (cachedFixture !== undefined) {
    return cachedFixture;
  }
  const a0 = a0Records();
  const a5 = a5Records();
  const publicRecords = [...a0.records, ...a5.records];
  const records = [...publicRecords, ...privateRecords()];
  const artifactScopes = new Map<string, { tenantId: string; projectId: string }>();
  for (const record of publicRecords) {
    for (const artifactId of collectPhase8ArtifactIds(record.data)) {
      artifactScopes.set(artifactId, {
        tenantId: record.tenantId,
        projectId: record.projectId,
      });
    }
  }
  const catalogVersionIds = [
    ...new Set(publicRecords.flatMap((record) => record.catalogVersionIds)),
  ].sort();
  const context = phase8AuthorizationContextSchema.parse({
    principalId: "phase8-project-manager",
    tenantId: phase7FixtureScope.tenantId,
    roles: ["PROJECT_MANAGER"],
    allowedProjectIds: [...new Set(publicRecords.map((record) => record.projectId))].sort(),
    permissions: [
      "AGENT_READ",
      "A0_READ",
      "A5_READ",
      "A0_RUN",
      "A5_RUN",
      "DESIGN_DOCUMENT_READ",
      "CATALOG_READ",
      "COST_READ",
      "REPORT_TEXT_READ",
      "ARTIFACT_SIGNED_READ",
    ],
    allowedCatalogVersionIds: catalogVersionIds,
    signedArtifactReads: [...artifactScopes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([artifactId, scope]) => signedReference(artifactId, scope.tenantId, scope.projectId)),
    requestedAt: "2026-08-03T02:00:00.000Z",
  });
  const repository = new InMemoryPhase8ReadRepository(records);
  const gateway = new Phase8ToolGateway(repository, verifyPhase8FixtureSignedRead);
  cachedFixture = Object.freeze({
    records,
    repository,
    gateway,
    context,
    a0Request: a0.request,
    a5Request: a5.request,
  });
  return cachedFixture;
}
