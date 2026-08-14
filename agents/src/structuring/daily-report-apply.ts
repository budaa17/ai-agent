import {
  approvedDailyReportCommandV1Schema,
  type ApprovedDailyReportCommandV1,
} from "../contracts/daily-report.js";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";

export type ApplyApprovedDailyReportResult = {
  snapshot: ProjectAnalysisSnapshotV1;
  applied: boolean;
  dailyReportId: string;
};

function decimal(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function averageConfidence(entries: readonly { score: number }[]): number | null {
  if (entries.length === 0) {
    return null;
  }

  return (
    Math.round((entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length) * 10_000) /
    10_000
  );
}

function latestProgress(snapshot: ProjectAnalysisSnapshotV1, workItemId: string) {
  return snapshot.progressEntries
    .filter((entry) => entry.workItemId === workItemId)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0];
}

export function applyApprovedDailyReportToSnapshot(
  snapshotInput: ProjectAnalysisSnapshotV1,
  commandInput: ApprovedDailyReportCommandV1,
): ApplyApprovedDailyReportResult {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const command = approvedDailyReportCommandV1Schema.parse(commandInput);

  if (snapshot.tenantId !== command.tenantId || snapshot.projectId !== command.projectId) {
    throw new Error("Approved daily-report command is outside snapshot scope");
  }

  const dailyReportId = `daily-report-approved-${command.draftId}`;
  const existing = snapshot.dailyReports.find((report) => report.sourceDraftId === command.draftId);

  if (existing !== undefined) {
    return {
      snapshot,
      applied: false,
      dailyReportId: existing.dailyReportId,
    };
  }

  const reportDate = command.approvedDraft.reportDate!;

  if (
    snapshot.dailyReports.some(
      (report) => report.status === "APPROVED" && report.date === reportDate,
    )
  ) {
    throw new Error(`An approved daily report already exists for ${reportDate}`);
  }

  const workItemsByCode = new Map(
    snapshot.workItems.map((workItem) => [workItem.code.toUpperCase(), workItem]),
  );
  const materialsByReference = new Map(
    snapshot.materials.flatMap((material) => [
      [material.materialId.toUpperCase(), material] as const,
      [material.code.toUpperCase(), material] as const,
    ]),
  );
  const progressEntries = command.approvedDraft.progressEntries.map((entry, index) => {
    const code = entry.workItem.code!;
    const workItem = workItemsByCode.get(code.toUpperCase());

    if (workItem === undefined) {
      throw new Error(`Approved work-item code is outside snapshot: ${code}`);
    }

    const previousProgress = latestProgress(snapshot, workItem.workItemId);
    const previousCumulative = Number(previousProgress?.cumulativeQuantityDone ?? "0");
    const plannedQuantity = Number(workItem.plannedQuantity);
    let cumulativeQuantity = previousCumulative;
    let quantityIncrement = 0;

    if (entry.quantityDone !== null) {
      if (entry.progressMode === "INCREMENTAL") {
        quantityIncrement = Number(entry.quantityDone);
        cumulativeQuantity = previousCumulative + quantityIncrement;
      } else {
        cumulativeQuantity = Number(entry.quantityDone);
        quantityIncrement = Math.max(0, cumulativeQuantity - previousCumulative);
      }
    } else if (entry.progressPercent !== null) {
      cumulativeQuantity = plannedQuantity * (entry.progressPercent / 100);
      quantityIncrement = Math.max(0, cumulativeQuantity - previousCumulative);
    }

    if (
      entry.progressMode === "CUMULATIVE" &&
      entry.quantityDone !== null &&
      cumulativeQuantity + 0.000001 < previousCumulative
    ) {
      throw new Error(
        `Cumulative quantity for ${code} cannot decrease from ${previousCumulative} to ${cumulativeQuantity}`,
      );
    }

    const progressPercent =
      entry.progressPercent ??
      (plannedQuantity > 0
        ? Math.min(100, Math.round((cumulativeQuantity / plannedQuantity) * 10_000) / 100)
        : 0);

    if (
      previousProgress !== undefined &&
      progressPercent + 0.01 < previousProgress.progressPercent
    ) {
      throw new Error(
        `Progress for ${code} cannot decrease from ${previousProgress.progressPercent}% to ${progressPercent}%`,
      );
    }

    if (entry.quantityDone !== null && entry.progressPercent !== null && plannedQuantity > 0) {
      const quantityPercent = (cumulativeQuantity / plannedQuantity) * 100;

      if (Math.abs(quantityPercent - entry.progressPercent) > 2) {
        throw new Error(
          `Quantity for ${code} implies ${quantityPercent.toFixed(
            2,
          )}% but the approved report states ${entry.progressPercent}%`,
        );
      }
    }

    const status = entry.status ?? (progressPercent >= 100 ? "COMPLETED" : "IN_PROGRESS");
    const fieldPrefix = `progressEntries.${index}`;
    const humanEdited = command.humanEditedFieldPaths.some(
      (fieldPath) => fieldPath === fieldPrefix || fieldPath.startsWith(`${fieldPrefix}.`),
    );

    return {
      progressEntryId: `${dailyReportId}-progress-${String(index + 1).padStart(3, "0")}`,
      dailyReportId,
      workItemId: workItem.workItemId,
      capturedAt: command.reviewedAt,
      quantityDoneIncrement: decimal(quantityIncrement),
      cumulativeQuantityDone: decimal(cumulativeQuantity),
      progressPercent,
      status,
      blockerReason: entry.blocker?.description ?? null,
      note: entry.note,
      aiConfidence: averageConfidence(entry.fieldConfidence),
      humanEdited,
    };
  });
  const attendanceEntries = command.approvedDraft.attendanceEntries.map((entry, index) => {
    const resolvedWorkItems = entry.workItemCodes
      .map((code) => workItemsByCode.get(code.toUpperCase()))
      .filter(
        (workItem): workItem is ProjectAnalysisSnapshotV1["workItems"][number] =>
          workItem !== undefined,
      );
    const subcontractor =
      entry.teamType === "SUBCONTRACTOR"
        ? snapshot.subcontractors.find(
            (candidate) =>
              candidate.subcontractorId === entry.teamRef ||
              candidate.code.toUpperCase() === entry.teamRef?.toUpperCase(),
          )
        : undefined;
    const hoursPerPerson =
      entry.hoursPerPerson ??
      (entry.totalHours === null
        ? snapshot.activeBaseline.calendar.workHoursPerDay
        : entry.totalHours / entry.headcount);
    const totalHours = entry.totalHours ?? entry.headcount * hoursPerPerson;

    return {
      attendanceEntryId: `${dailyReportId}-attendance-${String(index + 1).padStart(3, "0")}`,
      dailyReportId,
      workItemId: resolvedWorkItems.length === 1 ? resolvedWorkItems[0]!.workItemId : null,
      subcontractorId: subcontractor?.subcontractorId ?? null,
      teamName: entry.teamName ?? subcontractor?.name ?? entry.teamRef!,
      headcount: entry.headcount,
      hoursPerPerson,
      totalHours,
    };
  });
  const stockMovements = command.approvedDraft.materialSignals.flatMap((signal, index) => {
    if (
      signal.quantity === null ||
      !["RECEIVED", "CONSUMED", "DAMAGED", "RETURNED"].includes(signal.signalType)
    ) {
      return [];
    }

    const material = materialsByReference.get(signal.materialRef!.toUpperCase());

    if (material === undefined) {
      throw new Error(`Approved material is outside snapshot: ${signal.materialRef}`);
    }

    if (
      signal.unit !== null &&
      signal.unit.toLocaleLowerCase() !== material.unit.toLocaleLowerCase()
    ) {
      throw new Error(`Approved material unit ${signal.unit} conflicts with ${material.unit}`);
    }

    const resolvedWorkItems = signal.workItemCodes
      .map((code) => workItemsByCode.get(code.toUpperCase()))
      .filter(
        (workItem): workItem is ProjectAnalysisSnapshotV1["workItems"][number] =>
          workItem !== undefined,
      );
    const kind =
      signal.signalType === "RECEIVED"
        ? "RECEIPT"
        : signal.signalType === "RETURNED"
          ? "ADJUSTMENT"
          : "ISSUE";

    return [
      {
        stockMovementId: `${dailyReportId}-stock-${String(index + 1).padStart(3, "0")}`,
        materialId: material.materialId,
        kind,
        quantity: signal.quantity,
        unitPriceMnt: null,
        workItemId: resolvedWorkItems.length === 1 ? resolvedWorkItems[0]!.workItemId : null,
        supplierName: signal.supplierName,
        documentArtifactId: null,
        occurredAt: command.reviewedAt,
        recordedBy: command.reviewedBy,
        reversesMovementId: null,
        reference: command.commandId,
      },
    ];
  });
  const blockers = command.approvedDraft.progressEntries.flatMap((entry, index) => {
    if (entry.blocker === null) {
      return [];
    }

    const workItem = workItemsByCode.get(entry.workItem.code!.toUpperCase())!;
    return [
      {
        blockerId: `${dailyReportId}-blocker-${String(index + 1).padStart(3, "0")}`,
        dailyReportId,
        workItemId: workItem.workItemId,
        category: entry.blocker.category,
        description: entry.blocker.description,
        responsibleParty: entry.blocker.responsibleParty,
        supplierName: null,
        openedAt: command.reviewedAt,
        resolvedAt: null,
      },
    ];
  });
  const touchedStatus = new Map(progressEntries.map((entry) => [entry.workItemId, entry.status]));
  const output = projectAnalysisSnapshotV1Schema.parse({
    ...snapshot,
    snapshotId: `${snapshot.snapshotId}-applied-${command.draftId}`,
    asOf: command.reviewedAt,
    workItems: snapshot.workItems.map((workItem) => ({
      ...workItem,
      status: touchedStatus.get(workItem.workItemId) ?? workItem.status,
    })),
    dailyReports: [
      ...snapshot.dailyReports,
      {
        dailyReportId,
        date: reportDate,
        reportedBy: command.reviewedBy,
        rawText: command.approvedDraft.rawText,
        status: "APPROVED",
        submittedAt: command.reviewedAt,
        approvedBy: command.reviewedBy,
        approvedAt: command.reviewedAt,
        rejectionReason: null,
        sourceDraftId: command.draftId,
      },
    ],
    progressEntries: [...snapshot.progressEntries, ...progressEntries],
    attendanceEntries: [...snapshot.attendanceEntries, ...attendanceEntries],
    stockMovements: [...snapshot.stockMovements, ...stockMovements],
    blockers: [...snapshot.blockers, ...blockers],
  });

  return {
    snapshot: output,
    applied: true,
    dailyReportId,
  };
}
