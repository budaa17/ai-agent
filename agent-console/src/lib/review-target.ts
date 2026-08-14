import type { Workspace } from "../api/schemas";
import { entityNumber, entityString } from "./format";
import { formatDate, formatMoney, formatNumber } from "./format";

/**
 * A review task only carries a target type and an id. On its own that renders
 * as `khud-a1-plan-2026-08-06`, which tells a manager nothing. This resolves the
 * task against the workspace so the decision screen can show what is actually
 * being approved.
 */

export type TargetMetric = { readonly label: string; readonly value: string };

/**
 * Some targets cannot be judged from a summary — an A1 draft needs its source
 * text and photo, an A3 letter needs its rendered PDF. Those point at the
 * screen that shows the evidence; the rest are decided in place.
 */
const CONTEXT_ROUTE: Readonly<Record<string, string>> = {
  REGISTRATION_DRAFT: "a1",
  DAILY_REPORT: "a1",
};

export function contextRouteFor(targetType: string): string | null {
  return CONTEXT_ROUTE[targetType] ?? null;
}

export type ResolvedTarget = {
  readonly typeLabel: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly metrics: readonly TargetMetric[];
  /** Extra permission the apply step needs on top of COMMAND_APPLY. */
  readonly applyPermission: string;
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  REGISTRATION_DRAFT: "A1 бүртгэлийн ноорог",
  QUANTITY_TAKEOFF: "Тоо хэмжээ",
  ESTIMATE: "Төсөв",
  SCHEDULE: "Хуваарь",
  BASELINE: "Суурь хувилбар",
  DAILY_WORK_PLAN: "Өдрийн даалгавар",
  DAILY_REPORT: "Өдрийн тайлан",
  PROGRESS_VERIFICATION: "Гүйцэтгэлийн баталгаажуулалт",
  RECOVERY_SCENARIO: "Сэргээх хувилбар",
};

/** Mirrors `targetPermission` in the backend command service. */
const APPLY_PERMISSION: Readonly<Record<string, string>> = {
  REGISTRATION_DRAFT: "REPORT_APPROVE",
  QUANTITY_TAKEOFF: "DESIGN_APPROVE",
  SCHEDULE: "DESIGN_APPROVE",
  ESTIMATE: "ESTIMATE_APPROVE",
  DAILY_WORK_PLAN: "PLAN_APPROVE",
  DAILY_REPORT: "REPORT_APPROVE",
  PROGRESS_VERIFICATION: "VERIFICATION_APPROVE",
  BASELINE: "COMMAND_APPLY",
  RECOVERY_SCENARIO: "COMMAND_APPLY",
};

export function applyPermissionFor(targetType: string): string {
  return APPLY_PERMISSION[targetType] ?? "COMMAND_APPLY";
}

export function targetTypeLabel(targetType: string): string {
  return TYPE_LABELS[targetType] ?? targetType.replaceAll("_", " ");
}

type Row = Record<string, unknown>;

function find(rows: readonly Row[], id: string): Row | undefined {
  return rows.find((row) => entityString(row, "id") === id);
}

function workItemName(workspace: Workspace, workItemId: string): string {
  const item = find(workspace.workItems, workItemId);
  if (item === undefined) return workItemId;
  return `${entityString(item, "code")} · ${entityString(item, "name")}`;
}

export function resolveReviewTarget(workspace: Workspace, task: Row): ResolvedTarget {
  const targetType = entityString(task, "targetType");
  const targetId = entityString(task, "targetId");
  const base = {
    typeLabel: targetTypeLabel(targetType),
    applyPermission: applyPermissionFor(targetType),
  };

  if (targetType === "REGISTRATION_DRAFT") {
    const draft = find(workspace.assistants.a1Drafts, targetId);
    const structured =
      typeof draft?.structuredData === "object" &&
      draft.structuredData !== null &&
      !Array.isArray(draft.structuredData)
        ? (draft.structuredData as Row)
        : {};
    const confidence =
      typeof draft?.confidence === "object" && draft.confidence !== null
        ? (draft.confidence as Row)
        : {};
    return {
      ...base,
      title:
        draft === undefined
          ? targetId
          : entityString(structured, "workItemName", "workItemCode", "requestId"),
      subtitle: draft === undefined ? null : entityString(draft, "sourceText"),
      metrics: [
        { label: "Ажлын код", value: entityString(structured, "workItemCode") },
        {
          label: "Гүйцэтгэл",
          value:
            structured.progressPercent === null || structured.progressPercent === undefined
              ? "—"
              : `${formatNumber(entityNumber(structured, "progressPercent"), 0)}%`,
        },
        {
          label: "Confidence",
          value: `${formatNumber((entityNumber(confidence, "overall") ?? 0) * 100, 0)}%`,
        },
      ],
    };
  }

  if (targetType === "DAILY_REPORT") {
    const report = find(workspace.operations.reports, targetId);
    const progress = workspace.operations.progress.filter(
      (row) => entityString(row, "dailyReportId") === targetId,
    );
    const attendance = workspace.operations.attendance.filter(
      (row) => entityString(row, "dailyReportId") === targetId,
    );
    const workers = attendance.reduce(
      (sum, row) => sum + (entityNumber(row, "workerCount") ?? 0),
      0,
    );
    const hours = attendance.reduce(
      (sum, row) =>
        sum + (entityNumber(row, "workerCount") ?? 0) * (entityNumber(row, "hoursPerWorker") ?? 0),
      0,
    );
    const photos = workspace.operations.photos.filter(
      (row) => entityString(row, "dailyReportId") === targetId,
    );
    return {
      ...base,
      title: report === undefined ? targetId : formatDate(entityString(report, "reportDate")),
      subtitle: report === undefined ? null : entityString(report, "narrative"),
      metrics: [
        { label: "Ажлын мөр", value: `${progress.length}` },
        {
          label: "Мэдүүлсэн хэмжээ",
          value: progress
            .map(
              (row) =>
                `${formatNumber(entityNumber(row, "quantity"), 2)} ${entityString(row, "unit")}`,
            )
            .join(" · "),
        },
        { label: "Ирц", value: `${workers} хүн · ${formatNumber(hours, 0)} цаг` },
        { label: "Гэрэл зураг", value: `${photos.length}` },
      ],
    };
  }

  if (targetType === "DAILY_WORK_PLAN") {
    const plan = find(workspace.operations.plans, targetId);
    const items = workspace.operations.planItems.filter(
      (row) => entityString(row, "planId") === targetId,
    );
    const shortages = items.flatMap((item) =>
      ((item.materials as Row[] | undefined) ?? []).filter(
        (material) => (entityNumber(material, "shortageQuantity") ?? 0) > 0,
      ),
    );
    const unmet = items.flatMap((item) =>
      ((item.preconditions as Row[] | undefined) ?? []).filter(
        (precondition) => precondition.satisfied !== true,
      ),
    );
    return {
      ...base,
      title: plan === undefined ? targetId : formatDate(entityString(plan, "planDate")),
      subtitle: `${items.length} ажил төлөвлөсөн`,
      metrics: [
        {
          label: "Ажлууд",
          value: items
            .map((item) => workItemName(workspace, entityString(item, "workItemId")))
            .join(" · "),
        },
        {
          label: "Материалын дутагдал",
          value: shortages.length === 0 ? "Байхгүй" : `${shortages.length} мөр`,
        },
        { label: "Биелээгүй нөхцөл", value: unmet.length === 0 ? "Байхгүй" : `${unmet.length}` },
      ],
    };
  }

  if (targetType === "PROGRESS_VERIFICATION") {
    const verification = find(workspace.operations.verifications, targetId);
    // Verification issues are not exposed as their own collection; they reach
    // the client folded into the derived alert feed.
    const issues = workspace.alerts.filter(
      (row) =>
        entityString(row, "type") === "VERIFICATION" && entityString(row, "sourceId") === targetId,
    );
    const blocking = issues.filter((row) => row.blocksApproval === true);
    return {
      ...base,
      title:
        verification === undefined
          ? targetId
          : formatDate(entityString(verification, "verificationDate")),
      subtitle: verification === undefined ? null : entityString(verification, "decision"),
      metrics: [
        {
          label: "Мэдүүлсэн / баталгаажсан",
          value:
            verification === undefined
              ? "—"
              : `${formatNumber(entityNumber(verification, "claimedPercent"), 1)}% / ${formatNumber(entityNumber(verification, "verifiedPercent"), 1)}%`,
        },
        {
          label: "Итгэл",
          value:
            verification === undefined
              ? "—"
              : `${formatNumber((entityNumber(verification, "confidence") ?? 0) * 100, 0)}%`,
        },
        { label: "Илэрсэн зөрчил", value: `${issues.length}` },
        { label: "Батлахыг хаах", value: blocking.length === 0 ? "Үгүй" : `${blocking.length}` },
      ],
    };
  }

  if (targetType === "RECOVERY_SCENARIO") {
    const scenario = find(workspace.forecast.recoveryScenarios, targetId);
    return {
      ...base,
      title: scenario === undefined ? targetId : entityString(scenario, "name"),
      subtitle: "Хоцрогдол нөхөх санал",
      metrics: [
        {
          label: "Хугацаа хэмнэх",
          value:
            scenario === undefined
              ? "—"
              : `${formatNumber(entityNumber(scenario, "delayReductionDays"), 1)} хоног`,
        },
        {
          label: "Нэмэлт зардал",
          value: scenario === undefined ? "—" : formatMoney(entityString(scenario, "costImpact")),
        },
        {
          label: "Шинэ дуусах огноо",
          value:
            scenario === undefined ? "—" : formatDate(entityString(scenario, "projectedFinish")),
        },
      ],
    };
  }

  if (targetType === "QUANTITY_TAKEOFF") {
    const version = find(workspace.commercial.quantityVersions, targetId);
    const items = workspace.commercial.quantityItems.filter(
      (row) => entityString(row, "versionId") === targetId,
    );
    return {
      ...base,
      title:
        version === undefined
          ? targetId
          : `Хувилбар ${entityNumber(version, "versionNumber") ?? "?"}`,
      subtitle: `${items.length} мөр`,
      metrics: [
        { label: "Тоо хэмжээний мөр", value: `${items.length}` },
        {
          label: "Формулын хувилбар",
          value: version === undefined ? "—" : entityString(version, "formulaVersion"),
        },
      ],
    };
  }

  if (targetType === "ESTIMATE") {
    const version = find(workspace.commercial.estimateVersions, targetId);
    return {
      ...base,
      title:
        version === undefined
          ? targetId
          : `Хувилбар ${entityNumber(version, "versionNumber") ?? "?"}`,
      subtitle: null,
      metrics: [
        {
          label: "Нийт дүн",
          value: version === undefined ? "—" : formatMoney(entityString(version, "totalAmount")),
        },
        {
          label: "Дэд дүн",
          value: version === undefined ? "—" : formatMoney(entityString(version, "subtotal")),
        },
        {
          label: "НӨАТ",
          value: version === undefined ? "—" : formatMoney(entityString(version, "taxAmount")),
        },
      ],
    };
  }

  if (targetType === "BASELINE") {
    const baseline = find(workspace.commercial.baselines, targetId);
    return {
      ...base,
      title:
        baseline === undefined
          ? targetId
          : `Суурь хувилбар ${entityNumber(baseline, "versionNumber") ?? "?"}`,
      subtitle: baseline === undefined ? null : entityString(baseline, "reason"),
      metrics: [],
    };
  }

  return { ...base, title: targetId, subtitle: null, metrics: [] };
}
