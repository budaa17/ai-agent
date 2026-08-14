import { createHash } from "node:crypto";
import { z } from "zod";
import {
  approvedDailyReportCommandV1Schema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  contractArtifactReferenceSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  dailyReportAttendanceTeamTypeSchema,
  dailyReportBlockerCategorySchema,
  dailyReportEquipmentUsageStatusSchema,
  dailyReportMaterialSignalTypeSchema,
  dailyReportProgressModeSchema,
  dailyReportWorkStatusSchema,
  operationalPlanningSnapshotV1Schema,
  sourceReferenceMatchesScope,
  type ApprovedDailyReportCommandV1,
  type BuildWatchCanonicalUnit,
  type BuildWatchSourceReference,
  type OperationalPlanningSnapshotV1,
} from "../contracts/index.js";
import { DECIMAL_SCALE, decimalToScaledInteger } from "../production-analysis/decimal.js";

const approvedA1BlockerCandidateSchema = z
  .object({
    blockerCandidateId: contractIdentifierSchema,
    category: dailyReportBlockerCategorySchema,
    description: z.string().trim().min(1).max(1_000),
    isBlocking: z.boolean(),
    startedOn: contractIsoDateSchema.nullable(),
    responsibleParty: z.string().trim().min(1).max(300).nullable(),
    approvedOperationalBlockerId: contractIdentifierSchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const approvedA1WorkItemActualSchema = z
  .object({
    actualInputId: contractIdentifierSchema,
    dailyProgressEntryId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    workItemCode: z.string().trim().min(1).max(200),
    progressMode: dailyReportProgressModeSchema,
    declaredActualQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    declaredCumulativeQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    declaredProgressPercent: z.number().finite().min(0).max(100).nullable(),
    reportedStatus: dailyReportWorkStatusSchema.nullable(),
    blockerCandidate: approvedA1BlockerCandidateSchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((actual, context) => {
    const quantities = [actual.declaredActualQuantity, actual.declaredCumulativeQuantity].filter(
      (quantity): quantity is NonNullable<typeof quantity> => quantity !== null,
    );
    if (quantities.length === 2 && quantities[0]!.unit !== quantities[1]!.unit) {
      context.addIssue({
        code: "custom",
        message: "Actual and cumulative quantities must use the same unit",
        path: ["declaredCumulativeQuantity", "unit"],
      });
    }
  });

export const approvedA1AttendanceInputSchema = z
  .object({
    attendanceInputId: contractIdentifierSchema,
    sourceAttendanceEntryId: contractIdentifierSchema,
    workItemIds: z.array(contractIdentifierSchema).max(20),
    teamType: dailyReportAttendanceTeamTypeSchema,
    teamRef: z.string().trim().min(1).max(200).nullable(),
    teamName: z.string().trim().min(1).max(500).nullable(),
    headcount: z.number().int().positive().max(10_000),
    hoursPerPerson: z.number().finite().positive().max(24).nullable(),
    totalHours: z.number().finite().positive().max(240_000).nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const approvedA1MaterialInputSchema = z
  .object({
    materialInputId: contractIdentifierSchema,
    sourceMaterialSignalId: contractIdentifierSchema,
    signalType: dailyReportMaterialSignalTypeSchema,
    materialId: contractIdentifierSchema.nullable(),
    workItemIds: z.array(contractIdentifierSchema).max(20),
    quantity: buildWatchSourceBackedQuantitySchema.nullable(),
    supplierName: z.string().trim().min(1).max(500).nullable(),
    note: z.string().trim().min(1).max(1_000).nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.quantity !== null && input.materialId === null) {
      context.addIssue({
        code: "custom",
        message: "Material quantity requires a resolved material ID",
        path: ["materialId"],
      });
    }
  });

export const approvedA1EquipmentInputSchema = z
  .object({
    equipmentInputId: contractIdentifierSchema,
    sourceEquipmentEntryId: contractIdentifierSchema,
    equipmentId: contractIdentifierSchema,
    workItemIds: z.array(contractIdentifierSchema).max(20),
    hoursUsed: z.number().finite().positive().max(24).nullable(),
    usageQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    status: dailyReportEquipmentUsageStatusSchema,
    note: z.string().trim().min(1).max(1_000).nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const approvedA1ActualBundleV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    bundleType: z.literal("APPROVED_A1_ACTUAL"),
    bundleId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    commandId: contractIdentifierSchema,
    commandHash: z.string().regex(/^[a-f0-9]{64}$/),
    draftId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    reviewedBy: contractIdentifierSchema,
    reviewedAt: contractIsoDateTimeSchema,
    approvalStatus: z.literal("APPROVED"),
    approvalBoundary: z.literal("APPROVED_COMMAND_ONLY"),
    workItemActuals: z.array(approvedA1WorkItemActualSchema).max(50),
    attendanceInputs: z.array(approvedA1AttendanceInputSchema).max(50),
    materialInputs: z.array(approvedA1MaterialInputSchema).max(100),
    equipmentInputs: z.array(approvedA1EquipmentInputSchema).max(50),
    sourceArtifacts: z.array(contractArtifactReferenceSchema).max(6),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(2).max(100),
    eligibleForVerification: z.literal(true),
    eligibleForForecast: z.literal(false),
    forecastExclusionReason: z.literal("REQUIRES_APPROVED_PROGRESS_VERIFICATION"),
    deterministic: z.literal(true),
  })
  .strict()
  .superRefine((bundle, context) => {
    const identifierCollections = [
      bundle.workItemActuals.map((item) => item.actualInputId),
      bundle.attendanceInputs.map((item) => item.attendanceInputId),
      bundle.materialInputs.map((item) => item.materialInputId),
      bundle.equipmentInputs.map((item) => item.equipmentInputId),
    ];
    if (identifierCollections.some((values) => new Set(values).size !== values.length)) {
      context.addIssue({
        code: "custom",
        message: "Approved A1 input identifiers must be unique",
        path: ["workItemActuals"],
      });
    }
    const allSources = [
      ...bundle.sourceRefs,
      ...bundle.workItemActuals.flatMap((item) => [
        ...(item.declaredActualQuantity?.sourceRefs ?? []),
        ...(item.declaredCumulativeQuantity?.sourceRefs ?? []),
        ...(item.blockerCandidate?.sourceRefs ?? []),
        ...item.sourceRefs,
      ]),
      ...bundle.attendanceInputs.flatMap((item) => item.sourceRefs),
      ...bundle.materialInputs.flatMap((item) => [
        ...(item.quantity?.sourceRefs ?? []),
        ...item.sourceRefs,
      ]),
      ...bundle.equipmentInputs.flatMap((item) => [
        ...(item.usageQuantity?.sourceRefs ?? []),
        ...item.sourceRefs,
      ]),
    ];
    allSources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, bundle.tenantId, bundle.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Approved A1 source is outside bundle scope",
          path: ["sources", index],
        });
      }
    });
  });

export const approvedA1PreviousCumulativeSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    quantity: buildWatchSourceBackedQuantitySchema,
  })
  .strict();

export const approvedA1ActualContextSchema = z
  .object({
    operationalSnapshot: operationalPlanningSnapshotV1Schema,
    previousCumulativeQuantities: z.array(approvedA1PreviousCumulativeSchema).max(100_000),
  })
  .strict()
  .superRefine((context, refinement) => {
    const ids = context.previousCumulativeQuantities.map((item) => item.workItemId);
    if (new Set(ids).size !== ids.length) {
      refinement.addIssue({
        code: "custom",
        message: "Previous cumulative work-item IDs must be unique",
        path: ["previousCumulativeQuantities"],
      });
    }
  });

export type ApprovedA1ActualBundleV1 = z.infer<typeof approvedA1ActualBundleV1Schema>;
export type ApprovedA1ActualContext = z.infer<typeof approvedA1ActualContextSchema>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedId(prefix: string, value: string): string {
  const candidate = `${prefix}-${value}`;
  return candidate.length <= 200 ? candidate : `${prefix}-${hash(candidate).slice(0, 32)}`;
}

function scaledIntegerToDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE)
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

function dedupeSources(sources: readonly BuildWatchSourceReference[]): BuildWatchSourceReference[] {
  const values = new Map<string, BuildWatchSourceReference>();
  for (const source of sources) {
    values.set(source.sourceRefId, source);
  }
  return [...values.values()].sort((left, right) =>
    left.sourceRefId.localeCompare(right.sourceRefId),
  );
}

function canonicalUnit(value: string): BuildWatchCanonicalUnit | null {
  const normalized = value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll("²", "2")
    .replaceAll("³", "3");
  const aliases: Record<string, BuildWatchCanonicalUnit> = {
    m: "m",
    м: "m",
    m2: "m2",
    м2: "m2",
    m3: "m3",
    м3: "m3",
    kg: "kg",
    кг: "kg",
    pcs: "pcs",
    pc: "pcs",
    ш: "pcs",
    h: "h",
    hr: "h",
    цаг: "h",
    working_day: "working_day",
    өдөр: "working_day",
    percent: "percent",
    "%": "percent",
  };
  return aliases[normalized] ?? null;
}

function reportSource(
  command: ApprovedDailyReportCommandV1,
  dailyReportId: string,
  fieldPath: string | null,
): BuildWatchSourceReference {
  return {
    sourceRefId: boundedId(
      "source-a1-report",
      hash(`${command.commandId}:${fieldPath ?? "root"}`).slice(0, 24),
    ),
    tenantId: command.tenantId,
    projectId: command.projectId,
    sourceType: "DAILY_REPORT",
    sourceId: dailyReportId,
    sourceVersionId: command.commandId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath,
    region: null,
    asOf: command.reviewedAt,
    sha256: null,
  };
}

function decisionSource(command: ApprovedDailyReportCommandV1): BuildWatchSourceReference {
  return {
    sourceRefId: boundedId("source-a1-decision", command.commandId),
    tenantId: command.tenantId,
    projectId: command.projectId,
    sourceType: "HUMAN_DECISION",
    sourceId: command.commandId,
    sourceVersionId: null,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: "approval",
    region: null,
    asOf: command.reviewedAt,
    sha256: null,
  };
}

function calculationSource(
  command: ApprovedDailyReportCommandV1,
  dailyReportId: string,
  fieldPath: string,
): BuildWatchSourceReference {
  return {
    ...reportSource(command, dailyReportId, fieldPath),
    sourceRefId: boundedId(
      "source-a1-calculation",
      hash(`${command.commandId}:${fieldPath}`).slice(0, 24),
    ),
    sourceType: "SYSTEM_CALCULATION",
  };
}

function artifactSources(
  command: ApprovedDailyReportCommandV1,
  dailyReportId: string,
): BuildWatchSourceReference[] {
  return command.approvedDraft.sourceArtifacts.map((artifact) => ({
    sourceRefId: boundedId("source-a1-artifact", artifact.artifactId),
    tenantId: command.tenantId,
    projectId: command.projectId,
    sourceType: artifact.kind === "SOURCE_IMAGE" ? "PHOTO_EVIDENCE" : "DAILY_REPORT",
    sourceId: dailyReportId,
    sourceVersionId: command.commandId,
    artifactId: artifact.artifactId,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf: command.reviewedAt,
    sha256: artifact.sha256,
  }));
}

function backedQuantity(
  value: string | bigint,
  unit: BuildWatchCanonicalUnit,
  sources: readonly BuildWatchSourceReference[],
) {
  const scaledValue = typeof value === "bigint" ? value : decimalToScaledInteger(value);
  if (scaledValue < 0n) {
    throw new Error("Approved A1 quantity cannot be negative");
  }
  return buildWatchSourceBackedQuantitySchema.parse({
    value: scaledIntegerToDecimal(scaledValue),
    unit,
    sourceRefs: dedupeSources(sources),
  });
}

function resolveWorkItemIds(
  codes: readonly string[],
  byCode: ReadonlyMap<string, OperationalPlanningSnapshotV1["workItems"][number]>,
): string[] {
  return [
    ...new Set(
      codes.map((code) => {
        const workItem = byCode.get(code.toLocaleUpperCase());
        if (workItem === undefined) {
          throw new Error(`Approved A1 work-item code is outside snapshot: ${code}`);
        }
        return workItem.workItemId;
      }),
    ),
  ].sort();
}

function assertReportedUnit(
  reportedUnit: string,
  expectedUnit: BuildWatchCanonicalUnit,
  label: string,
): void {
  const normalized = canonicalUnit(reportedUnit);
  if (normalized === null || normalized !== expectedUnit) {
    throw new Error(`${label} unit ${reportedUnit} does not match canonical ${expectedUnit}`);
  }
}

export function buildApprovedA1ActualBundle(
  commandInput: unknown,
  contextInput: unknown,
): ApprovedA1ActualBundleV1 {
  const command = approvedDailyReportCommandV1Schema.parse(commandInput);
  const context = approvedA1ActualContextSchema.parse(contextInput);
  const snapshot = context.operationalSnapshot;
  if (command.tenantId !== snapshot.tenantId || command.projectId !== snapshot.projectId) {
    throw new Error("Approved A1 command is outside operational snapshot scope");
  }
  const reportDate = command.approvedDraft.reportDate!;
  if (snapshot.asOf.slice(0, 10) < reportDate) {
    throw new Error("Operational snapshot predates the approved A1 report");
  }
  const dailyReportId = boundedId("daily-report-approved", command.draftId);
  const reportRootSource = reportSource(command, dailyReportId, null);
  const humanDecisionSource = decisionSource(command);
  const allArtifactSources = artifactSources(command, dailyReportId);
  const byCode = new Map(
    snapshot.workItems.map((workItem) => [workItem.code.toLocaleUpperCase(), workItem]),
  );
  if (byCode.size !== snapshot.workItems.length) {
    throw new Error("Operational snapshot contains duplicate work-item codes");
  }
  const previousByWorkItem = new Map(
    context.previousCumulativeQuantities.map((item) => [item.workItemId, item]),
  );
  const workItemIds = new Set(snapshot.workItems.map((workItem) => workItem.workItemId));
  for (const previous of context.previousCumulativeQuantities) {
    if (!workItemIds.has(previous.workItemId)) {
      throw new Error(`Previous cumulative work item is outside snapshot: ${previous.workItemId}`);
    }
    if (decimalToScaledInteger(previous.quantity.value) < 0n) {
      throw new Error("Previous cumulative quantity cannot be negative");
    }
    for (const source of previous.quantity.sourceRefs) {
      if (!sourceReferenceMatchesScope(source, command.tenantId, command.projectId)) {
        throw new Error("Previous cumulative source is outside command scope");
      }
      if (source.asOf === null || source.asOf > command.reviewedAt) {
        throw new Error("Previous cumulative source must predate the approval decision");
      }
    }
  }

  const workItemActuals = command.approvedDraft.progressEntries.map((entry, index) => {
    const workItem = byCode.get(entry.workItem.code!.toLocaleUpperCase());
    if (workItem === undefined) {
      throw new Error(`Approved A1 work-item code is outside snapshot: ${entry.workItem.code}`);
    }
    const fieldSource = reportSource(
      command,
      dailyReportId,
      `approvedDraft.progressEntries.${index}`,
    );
    const directSources = dedupeSources([fieldSource, humanDecisionSource, ...allArtifactSources]);
    const previous = previousByWorkItem.get(workItem.workItemId);
    if (previous !== undefined && previous.quantity.unit !== workItem.unit) {
      throw new Error(
        `Previous cumulative unit for ${workItem.code} does not match ${workItem.unit}`,
      );
    }
    let declaredActualQuantity = null;
    let declaredCumulativeQuantity = null;
    if (entry.quantityDone !== null) {
      assertReportedUnit(entry.unit!, workItem.unit, workItem.code);
      const reportedValue = decimalToScaledInteger(entry.quantityDone);
      if (reportedValue < 0n) {
        throw new Error(`Approved quantity for ${workItem.code} cannot be negative`);
      }
      if (entry.progressMode === "INCREMENTAL") {
        declaredActualQuantity = backedQuantity(entry.quantityDone, workItem.unit, directSources);
        if (previous !== undefined) {
          declaredCumulativeQuantity = backedQuantity(
            decimalToScaledInteger(previous.quantity.value) + reportedValue,
            workItem.unit,
            [
              ...previous.quantity.sourceRefs,
              ...directSources,
              calculationSource(
                command,
                dailyReportId,
                `workItemActuals.${index}.declaredCumulativeQuantity`,
              ),
            ],
          );
        }
      } else {
        declaredCumulativeQuantity = backedQuantity(
          entry.quantityDone,
          workItem.unit,
          directSources,
        );
        if (previous !== undefined) {
          const increment = reportedValue - decimalToScaledInteger(previous.quantity.value);
          if (increment < 0n) {
            throw new Error(`Approved cumulative quantity for ${workItem.code} cannot decrease`);
          }
          declaredActualQuantity = backedQuantity(increment, workItem.unit, [
            ...previous.quantity.sourceRefs,
            ...directSources,
            calculationSource(
              command,
              dailyReportId,
              `workItemActuals.${index}.declaredActualQuantity`,
            ),
          ]);
        }
      }
    }
    const blocker = entry.blocker;
    const approvedBlocker =
      blocker === null
        ? undefined
        : snapshot.blockers.find(
            (candidate) =>
              candidate.workItemId === workItem.workItemId &&
              candidate.isOpen &&
              candidate.approved &&
              candidate.category === blocker.category,
          );
    return {
      actualInputId: boundedId("a1-actual", `${command.commandId}-${entry.entryId}`),
      dailyProgressEntryId: entry.entryId,
      workItemId: workItem.workItemId,
      workItemCode: workItem.code,
      progressMode: entry.progressMode,
      declaredActualQuantity,
      declaredCumulativeQuantity,
      declaredProgressPercent: entry.progressPercent,
      reportedStatus: entry.status,
      blockerCandidate:
        blocker === null
          ? null
          : {
              blockerCandidateId: boundedId(
                "a1-blocker-candidate",
                `${command.commandId}-${entry.entryId}`,
              ),
              category: blocker.category,
              description: blocker.description,
              isBlocking: blocker.isBlocking,
              startedOn: blocker.startedOn,
              responsibleParty: blocker.responsibleParty,
              approvedOperationalBlockerId: approvedBlocker?.blockerId ?? null,
              sourceRefs: directSources,
            },
      sourceRefs: directSources,
    };
  });

  const attendanceInputs = command.approvedDraft.attendanceEntries.map((entry, index) => {
    const sources = dedupeSources([
      reportSource(command, dailyReportId, `approvedDraft.attendanceEntries.${index}`),
      humanDecisionSource,
      ...allArtifactSources,
    ]);
    return {
      attendanceInputId: boundedId("a1-attendance", `${command.commandId}-${entry.entryId}`),
      sourceAttendanceEntryId: entry.entryId,
      workItemIds: resolveWorkItemIds(entry.workItemCodes, byCode),
      teamType: entry.teamType,
      teamRef: entry.teamRef,
      teamName: entry.teamName,
      headcount: entry.headcount,
      hoursPerPerson: entry.hoursPerPerson,
      totalHours: entry.totalHours,
      sourceRefs: sources,
    };
  });

  const materialInputs = command.approvedDraft.materialSignals.map((signal, index) => {
    const inventory =
      signal.materialRef === null
        ? undefined
        : snapshot.materials.find(
            (candidate) =>
              candidate.materialId.toLocaleUpperCase() === signal.materialRef!.toLocaleUpperCase(),
          );
    if (signal.quantity !== null && inventory === undefined) {
      throw new Error(`Approved A1 material is outside snapshot: ${signal.materialRef}`);
    }
    const sources = dedupeSources([
      reportSource(command, dailyReportId, `approvedDraft.materialSignals.${index}`),
      humanDecisionSource,
      ...allArtifactSources,
    ]);
    if (signal.quantity !== null) {
      assertReportedUnit(signal.unit!, inventory!.availableQuantity.unit, signal.materialRef!);
    }
    return {
      materialInputId: boundedId("a1-material", `${command.commandId}-${signal.signalId}`),
      sourceMaterialSignalId: signal.signalId,
      signalType: signal.signalType,
      materialId: inventory?.materialId ?? null,
      workItemIds: resolveWorkItemIds(signal.workItemCodes, byCode),
      quantity:
        signal.quantity === null
          ? null
          : backedQuantity(signal.quantity, inventory!.availableQuantity.unit, sources),
      supplierName: signal.supplierName,
      note: signal.note,
      sourceRefs: sources,
    };
  });

  const equipmentInputs = (command.approvedDraft.equipmentEntries ?? []).map((entry, index) => {
    const normalizedReference = entry.equipmentRef?.toLocaleUpperCase();
    const normalizedName = entry.equipmentName?.toLocaleUpperCase();
    const matches = snapshot.equipment.filter(
      (candidate) =>
        candidate.equipmentId.toLocaleUpperCase() === normalizedReference ||
        candidate.equipmentType.toLocaleUpperCase() === normalizedReference ||
        candidate.equipmentType.toLocaleUpperCase() === normalizedName,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Approved A1 equipment must resolve exactly once: ${entry.equipmentRef ?? entry.equipmentName}`,
      );
    }
    const equipment = matches[0]!;
    const sources = dedupeSources([
      reportSource(command, dailyReportId, `approvedDraft.equipmentEntries.${index}`),
      humanDecisionSource,
      ...allArtifactSources,
    ]);
    const usageUnit = entry.usageQuantity === null ? null : canonicalUnit(entry.unit!);
    if (entry.usageQuantity !== null && usageUnit === null) {
      throw new Error(`Unsupported equipment usage unit: ${entry.unit}`);
    }
    return {
      equipmentInputId: boundedId("a1-equipment", `${command.commandId}-${entry.entryId}`),
      sourceEquipmentEntryId: entry.entryId,
      equipmentId: equipment.equipmentId,
      workItemIds: resolveWorkItemIds(entry.workItemCodes, byCode),
      hoursUsed: entry.hoursUsed,
      usageQuantity:
        entry.usageQuantity === null
          ? null
          : backedQuantity(entry.usageQuantity, usageUnit!, sources),
      status: entry.status,
      note: entry.note,
      sourceRefs: sources,
    };
  });

  const commandHash = hash(JSON.stringify(command));
  return approvedA1ActualBundleV1Schema.parse({
    schemaVersion: 1,
    bundleType: "APPROVED_A1_ACTUAL",
    bundleId: boundedId("a1-approved-actual", command.commandId),
    idempotencyKey: command.idempotencyKey,
    commandId: command.commandId,
    commandHash,
    draftId: command.draftId,
    dailyReportId,
    tenantId: command.tenantId,
    projectId: command.projectId,
    reportDate,
    reviewedBy: command.reviewedBy,
    reviewedAt: command.reviewedAt,
    approvalStatus: "APPROVED",
    approvalBoundary: "APPROVED_COMMAND_ONLY",
    workItemActuals,
    attendanceInputs,
    materialInputs,
    equipmentInputs,
    sourceArtifacts: command.approvedDraft.sourceArtifacts,
    sourceRefs: dedupeSources([reportRootSource, humanDecisionSource, ...allArtifactSources]),
    eligibleForVerification: true,
    eligibleForForecast: false,
    forecastExclusionReason: "REQUIRES_APPROVED_PROGRESS_VERIFICATION",
    deterministic: true,
  });
}

export class ApprovedA1ActualGateway {
  readonly #byIdempotencyKey = new Map<string, ApprovedA1ActualBundleV1>();

  ingest(commandInput: unknown, contextInput: unknown): ApprovedA1ActualBundleV1 {
    const bundle = buildApprovedA1ActualBundle(commandInput, contextInput);
    const existing = this.#byIdempotencyKey.get(bundle.idempotencyKey);
    if (existing !== undefined) {
      if (existing.commandHash !== bundle.commandHash) {
        throw new Error("A1 idempotency key was reused with different approved content");
      }
      return existing;
    }
    this.#byIdempotencyKey.set(bundle.idempotencyKey, bundle);
    return bundle;
  }
}
