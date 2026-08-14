import type { BuildWatchCanonicalUnit, BuildWatchSourceReference } from "../contracts/index.js";
import type { A5DailyPlanRequestV1 } from "./contracts.js";

export function roundHalfUp(value: number, decimalPlaces = 6): number {
  const factor = 10 ** decimalPlaces;
  return Math.floor(value * factor + 0.5 + Number.EPSILON) / factor;
}

export function formatPlanningDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Planning decimal must be finite");
  }
  const fixed = roundHalfUp(value).toFixed(6);
  const trimmed = fixed.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
  return trimmed === "-0" ? "0" : trimmed;
}

export function dedupeSourceRefs(
  sources: readonly BuildWatchSourceReference[],
): BuildWatchSourceReference[] {
  const byId = new Map<string, BuildWatchSourceReference>();
  for (const source of sources) {
    if (!byId.has(source.sourceRefId)) {
      byId.set(source.sourceRefId, source);
    }
  }
  return [...byId.values()].sort((left, right) =>
    left.sourceRefId.localeCompare(right.sourceRefId),
  );
}

export function planningCalculationSource(
  request: A5DailyPlanRequestV1,
  fieldPath: string,
): BuildWatchSourceReference {
  const safeField = fieldPath.replace(/[^a-zA-Z0-9._/-]/gu, "-").slice(0, 80);
  return {
    sourceRefId: `source-a5-${request.planDate}-${safeField}`,
    tenantId: request.tenantId,
    projectId: request.projectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: `a5-plan-${request.planDate}`,
    sourceVersionId: request.operationalSnapshot.policyVersion.policyVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath,
    region: null,
    asOf: request.generatedAt,
    sha256: null,
  };
}

export function sourceBackedQuantity(
  value: number,
  unit: BuildWatchCanonicalUnit,
  sourceRefs: readonly BuildWatchSourceReference[],
) {
  return {
    value: formatPlanningDecimal(Math.max(0, value)),
    unit,
    sourceRefs: dedupeSourceRefs(sourceRefs),
  };
}

export function isWorkingDate(
  date: string,
  workingWeekdays: readonly number[],
  holidays: readonly string[],
): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const isoWeekday = day === 0 ? 7 : day;
  return workingWeekdays.includes(isoWeekday) && !holidays.includes(date);
}

export function timeRangesOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
