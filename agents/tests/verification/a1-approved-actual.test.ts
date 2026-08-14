import { describe, expect, it } from "vitest";
import {
  approvedDailyReportCommandV1Schema,
  type ApprovedDailyReportCommandV1,
} from "../../src/contracts/index.js";
import { buildBuildWatchOperationalSimulation } from "../../src/simulation/index.js";
import {
  ApprovedA1ActualGateway,
  approvedA1ActualContextSchema,
  buildApprovedA1ActualBundle,
} from "../../src/verification/index.js";

const simulation = buildBuildWatchOperationalSimulation();

function buildFixture(scenario = "HEALTHY_CONTROL") {
  const answerCase = simulation.answerKey.cases.find(
    (candidate) => candidate.scenario === scenario,
  );
  if (answerCase === undefined) {
    throw new Error(`Missing answer case ${scenario}`);
  }
  const operationalSnapshot = simulation.agentDataset.operationalSnapshots.find(
    (candidate) => candidate.asOf.slice(0, 10) === answerCase.effectiveDate,
  );
  if (operationalSnapshot === undefined) {
    throw new Error(`Missing snapshot for ${answerCase.effectiveDate}`);
  }
  const workItem = operationalSnapshot.workItems.find(
    (candidate) => candidate.workItemId === answerCase.workItemIds[0],
  );
  if (workItem === undefined) {
    throw new Error(`Missing scenario work item ${answerCase.workItemIds[0]}`);
  }
  const materialRequirement = workItem.requiredMaterials[0];
  const material = operationalSnapshot.materials.find(
    (candidate) => candidate.materialId === materialRequirement?.materialId,
  );
  const equipment = operationalSnapshot.equipment.find((candidate) =>
    workItem.requiredEquipmentIds.includes(candidate.equipmentId),
  );
  const blocker = operationalSnapshot.blockers.find(
    (candidate) =>
      candidate.workItemId === workItem.workItemId && candidate.isOpen && candidate.approved,
  );
  const scenarioId = scenario.toLocaleLowerCase();
  const command = approvedDailyReportCommandV1Schema.parse({
    schemaVersion: 1,
    commandType: "APPROVE_DAILY_REPORT",
    commandId: `command-phase-41-${scenarioId}`,
    idempotencyKey: `approve-phase-41-${scenarioId}`,
    tenantId: operationalSnapshot.tenantId,
    projectId: operationalSnapshot.projectId,
    draftId: `draft-phase-41-${scenarioId}`,
    reviewedBy: "user-project-manager",
    reviewedAt: `${answerCase.effectiveDate}T10:00:00.000Z`,
    approvedDraft: {
      schemaVersion: 1,
      draftType: "DAILY_REPORT",
      draftId: `draft-phase-41-${scenarioId}`,
      requestId: `request-phase-41-${scenarioId}`,
      tenantId: operationalSnapshot.tenantId,
      projectId: operationalSnapshot.projectId,
      sourceArtifacts: [
        {
          artifactId: `artifact-phase-41-${scenarioId}`,
          kind: "SOURCE_IMAGE",
          mediaType: "image/jpeg",
          sha256: "a".repeat(64),
          storageKey: `daily-reports/${scenarioId}.jpg`,
          sizeBytes: 2_048,
        },
      ],
      rawText: `${workItem.code} ажил 5 ${workItem.unit} хийсэн.`,
      language: "mn",
      reportDate: answerCase.effectiveDate,
      location: {
        block: null,
        stage: null,
        floor: null,
        zone: workItem.zoneCode,
      },
      progressEntries: [
        {
          entryId: `progress-phase-41-${scenarioId}`,
          workItem: {
            code: workItem.code,
            name: workItem.name,
            candidateCodes: [],
          },
          progressMode: "INCREMENTAL",
          progressPercent: 25,
          quantityDone: "5",
          unit: workItem.unit,
          status: blocker === undefined ? "IN_PROGRESS" : "BLOCKED",
          blocker:
            blocker === undefined
              ? null
              : {
                  category: blocker.category,
                  description: "Батлагдсан саад үргэлжилж байна.",
                  isBlocking: true,
                  startedOn: blocker.startedOn,
                  responsibleParty: "project-manager",
                },
          note: null,
          fieldConfidence: [],
        },
      ],
      attendanceEntries: [
        {
          entryId: `attendance-phase-41-${scenarioId}`,
          teamType: "OWN",
          teamRef: workItem.requiredCrewType,
          teamName: "Талбайн баг",
          workItemCodes: [workItem.code],
          headcount: 6,
          hoursPerPerson: 8,
          totalHours: 48,
          fieldConfidence: [],
        },
      ],
      materialSignals:
        material === undefined
          ? []
          : [
              {
                signalId: `material-phase-41-${scenarioId}`,
                signalType: "CONSUMED",
                rawName: material.materialId,
                normalizedName: null,
                materialRef: material.materialId,
                quantity: "10",
                unit: material.availableQuantity.unit,
                supplierName: null,
                workItemCodes: [workItem.code],
                note: null,
                fieldConfidence: [],
              },
            ],
      equipmentEntries:
        equipment === undefined
          ? []
          : [
              {
                entryId: `equipment-phase-41-${scenarioId}`,
                equipmentRef: equipment.equipmentId,
                equipmentName: equipment.equipmentType,
                workItemCodes: [workItem.code],
                hoursUsed: 8,
                usageQuantity: null,
                unit: null,
                status: "USED",
                note: null,
                fieldConfidence: [],
              },
            ],
      photoObservations: [],
      clarificationQuestions: [],
      duplicateCandidates: [],
      fieldConfidence: [],
      overallConfidence: 0.95,
      confidenceLevel: "HIGH",
      validationIssues: [],
      status: "APPROVED",
      requiresHumanReview: true,
    },
    humanEditedFieldPaths: [],
    reviewNote: "Phase 4.1 deterministic fixture",
  });
  const context = approvedA1ActualContextSchema.parse({
    operationalSnapshot,
    previousCumulativeQuantities: [
      {
        workItemId: workItem.workItemId,
        quantity: {
          value: "20",
          unit: workItem.unit,
          sourceRefs: workItem.sourceRefs,
        },
      },
    ],
  });
  return {
    workItem,
    material,
    equipment,
    blocker,
    command,
    context,
  };
}

function changeCommand(
  command: ApprovedDailyReportCommandV1,
  changes: Partial<ApprovedDailyReportCommandV1>,
): ApprovedDailyReportCommandV1 {
  return approvedDailyReportCommandV1Schema.parse({
    ...command,
    ...changes,
  });
}

describe("A1 approved actual integration", () => {
  it("maps approved actuals and keeps them outside forecast", () => {
    const fixture = buildFixture();
    const bundle = buildApprovedA1ActualBundle(fixture.command, fixture.context);

    expect(bundle.approvalBoundary).toBe("APPROVED_COMMAND_ONLY");
    expect(bundle.eligibleForVerification).toBe(true);
    expect(bundle.eligibleForForecast).toBe(false);
    expect(bundle.forecastExclusionReason).toBe("REQUIRES_APPROVED_PROGRESS_VERIFICATION");
    expect(bundle.workItemActuals[0]?.declaredActualQuantity?.value).toBe("5");
    expect(bundle.workItemActuals[0]?.declaredCumulativeQuantity?.value).toBe("25");
    expect(bundle.attendanceInputs[0]?.totalHours).toBe(48);
    expect(bundle.materialInputs[0]?.materialId).toBe(fixture.material?.materialId);
    expect(bundle.equipmentInputs[0]?.equipmentId).toBe(fixture.equipment?.equipmentId);
    expect(bundle.sourceArtifacts).toEqual(fixture.command.approvedDraft.sourceArtifacts);
    expect(bundle.sourceRefs.some((source) => source.sourceType === "HUMAN_DECISION")).toBe(true);
  });

  it("is deterministic and enforces idempotency", () => {
    const fixture = buildFixture();
    const first = buildApprovedA1ActualBundle(fixture.command, fixture.context);
    const second = buildApprovedA1ActualBundle(fixture.command, fixture.context);
    const gateway = new ApprovedA1ActualGateway();

    expect(second).toEqual(first);
    expect(gateway.ingest(fixture.command, fixture.context)).toEqual(first);
    expect(gateway.ingest(fixture.command, fixture.context)).toBe(
      gateway.ingest(fixture.command, fixture.context),
    );

    const conflictingCommand = changeCommand(fixture.command, {
      reviewNote: "Same idempotency key, different approved command content",
    });
    expect(() => gateway.ingest(conflictingCommand, fixture.context)).toThrow(
      "idempotency key was reused",
    );
  });

  it("rejects drafts and commands outside snapshot scope", () => {
    const fixture = buildFixture();

    expect(() =>
      buildApprovedA1ActualBundle(fixture.command.approvedDraft, fixture.context),
    ).toThrow();

    const outsideScopeCommand = changeCommand(fixture.command, {
      tenantId: "tenant-private",
      approvedDraft: {
        ...fixture.command.approvedDraft,
        tenantId: "tenant-private",
      },
    });
    expect(() => buildApprovedA1ActualBundle(outsideScopeCommand, fixture.context)).toThrow(
      "outside operational snapshot scope",
    );
  });

  it("does not invent quantity from a percentage or previous value", () => {
    const fixture = buildFixture();
    const command = changeCommand(fixture.command, {
      commandId: "command-phase-41-percent-only",
      idempotencyKey: "approve-phase-41-percent-only",
      approvedDraft: {
        ...fixture.command.approvedDraft,
        progressEntries: fixture.command.approvedDraft.progressEntries.map((entry) => ({
          ...entry,
          progressMode: "UNSPECIFIED" as const,
          quantityDone: null,
          unit: null,
        })),
      },
    });
    const bundle = buildApprovedA1ActualBundle(command, fixture.context);

    expect(bundle.workItemActuals[0]?.declaredActualQuantity).toBeNull();
    expect(bundle.workItemActuals[0]?.declaredCumulativeQuantity).toBeNull();
    expect(bundle.workItemActuals[0]?.declaredProgressPercent).toBe(25);
  });

  it("rejects a decreasing approved cumulative quantity", () => {
    const fixture = buildFixture();
    const command = changeCommand(fixture.command, {
      commandId: "command-phase-41-regression",
      idempotencyKey: "approve-phase-41-regression",
      approvedDraft: {
        ...fixture.command.approvedDraft,
        progressEntries: fixture.command.approvedDraft.progressEntries.map((entry) => ({
          ...entry,
          progressMode: "CUMULATIVE" as const,
          quantityDone: "19",
        })),
      },
    });

    expect(() => buildApprovedA1ActualBundle(command, fixture.context)).toThrow("cannot decrease");
  });

  it("adds six-decimal quantities without IEEE-754 precision loss", () => {
    const fixture = buildFixture();
    const command = changeCommand(fixture.command, {
      commandId: "command-phase-41-exact-decimal",
      idempotencyKey: "approve-phase-41-exact-decimal",
      approvedDraft: {
        ...fixture.command.approvedDraft,
        progressEntries: fixture.command.approvedDraft.progressEntries.map((entry) => ({
          ...entry,
          quantityDone: "0.000001",
        })),
      },
    });
    const context = {
      ...fixture.context,
      previousCumulativeQuantities: fixture.context.previousCumulativeQuantities.map(
        (previous) => ({
          ...previous,
          quantity: {
            ...previous.quantity,
            value: "9007199254740993.123456",
          },
        }),
      ),
    };
    const bundle = buildApprovedA1ActualBundle(command, context);

    expect(bundle.workItemActuals[0]?.declaredActualQuantity?.value).toBe("0.000001");
    expect(bundle.workItemActuals[0]?.declaredCumulativeQuantity?.value).toBe(
      "9007199254740993.123457",
    );
  });

  it("rejects negative approved quantities", () => {
    const fixture = buildFixture();
    const command = changeCommand(fixture.command, {
      commandId: "command-phase-41-negative",
      idempotencyKey: "approve-phase-41-negative",
      approvedDraft: {
        ...fixture.command.approvedDraft,
        progressEntries: fixture.command.approvedDraft.progressEntries.map((entry) => ({
          ...entry,
          quantityDone: "-1",
        })),
      },
    });

    expect(() => buildApprovedA1ActualBundle(command, fixture.context)).toThrow(
      "cannot be negative",
    );
  });

  it("rejects previous cumulative evidence from after approval", () => {
    const fixture = buildFixture();
    const context = {
      ...fixture.context,
      previousCumulativeQuantities: fixture.context.previousCumulativeQuantities.map(
        (previous) => ({
          ...previous,
          quantity: {
            ...previous.quantity,
            sourceRefs: previous.quantity.sourceRefs.map((source) => ({
              ...source,
              asOf: fixture.command.reviewedAt.replace("10:00:00", "10:00:01"),
            })),
          },
        }),
      ),
    };

    expect(() => buildApprovedA1ActualBundle(fixture.command, context)).toThrow(
      "must predate the approval decision",
    );
  });

  it("links only a matching approved operational blocker", () => {
    const fixture = buildFixture("APPROVED_BLOCKER");
    const bundle = buildApprovedA1ActualBundle(fixture.command, fixture.context);

    expect(bundle.workItemActuals[0]?.blockerCandidate?.approvedOperationalBlockerId).toBe(
      fixture.blocker?.blockerId,
    );
  });

  it("rejects equipment that is absent from the operational snapshot", () => {
    const fixture = buildFixture();
    const command = changeCommand(fixture.command, {
      commandId: "command-phase-41-unknown-equipment",
      idempotencyKey: "approve-phase-41-unknown-equipment",
      approvedDraft: {
        ...fixture.command.approvedDraft,
        equipmentEntries: fixture.command.approvedDraft.equipmentEntries?.map((entry) => ({
          ...entry,
          equipmentRef: "equipment-outside-project",
          equipmentName: "Unknown equipment",
        })),
      },
    });

    expect(() => buildApprovedA1ActualBundle(command, fixture.context)).toThrow(
      "must resolve exactly once",
    );
  });
});
