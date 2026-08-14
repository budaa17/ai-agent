import { createHash } from "node:crypto";
import type { ContractValidationIssue } from "../contracts/common.js";
import type {
  BuildWatchCatalogVersionReference,
  BuildWatchSourceReference,
} from "../contracts/buildwatch-v2-common.js";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function phase7Hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function phase7Id(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20)}`;
}

export function uniqueSources(
  sources: readonly BuildWatchSourceReference[],
): BuildWatchSourceReference[] {
  const byId = new Map<string, BuildWatchSourceReference>();
  for (const source of sources) {
    const existing = byId.get(source.sourceRefId);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(source)) {
      throw new Error(`Source reference ${source.sourceRefId} was reused with different content`);
    }
    byId.set(source.sourceRefId, source);
  }
  return [...byId.values()].sort((left, right) =>
    left.sourceRefId.localeCompare(right.sourceRefId),
  );
}

export function validationIssue(
  code: string,
  fieldPaths: readonly string[],
  message: string,
  severity: ContractValidationIssue["severity"] = "ERROR",
): ContractValidationIssue {
  return {
    code,
    severity,
    fieldPaths: [...fieldPaths],
    message,
    deterministic: true,
  };
}

export function sourceMatchesScope(
  source: BuildWatchSourceReference,
  tenantId: string,
  projectId: string,
): boolean {
  return source.tenantId === tenantId && source.projectId === projectId;
}

export function catalogIsEffective(
  version: BuildWatchCatalogVersionReference,
  date: string,
): boolean {
  return (
    version.effectiveFrom <= date && (version.effectiveTo === null || version.effectiveTo >= date)
  );
}

export function catalogMatchesScope(
  version: BuildWatchCatalogVersionReference,
  tenantId: string,
  projectId: string,
): boolean {
  return (
    version.tenantId === tenantId &&
    version.projectId === projectId &&
    version.sourceRefs.every((source) => sourceMatchesScope(source, tenantId, projectId))
  );
}

export function createCalculationSource(
  input: Readonly<{
    tenantId: string;
    projectId: string;
    sourceRefId: string;
    sourceId: string;
    fieldPath: string | null;
    asOf: string;
  }>,
): BuildWatchSourceReference {
  return {
    sourceRefId: input.sourceRefId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: input.sourceId,
    sourceVersionId: "buildwatch-phase7-v1",
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: input.fieldPath,
    region: null,
    asOf: input.asOf,
    sha256: null,
  };
}

export function createHumanDecisionSource(
  input: Readonly<{
    tenantId: string;
    projectId: string;
    sourceRefId: string;
    decisionId: string;
    fieldPath: string | null;
    asOf: string;
  }>,
): BuildWatchSourceReference {
  return {
    sourceRefId: input.sourceRefId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    sourceType: "HUMAN_DECISION",
    sourceId: input.decisionId,
    sourceVersionId: null,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: input.fieldPath,
    region: null,
    asOf: input.asOf,
    sha256: null,
  };
}

export function createApprovedQuantitySource(
  input: Readonly<{
    tenantId: string;
    projectId: string;
    sourceRefId: string;
    quantityVersionId: string;
    itemId: string;
    asOf: string;
  }>,
): BuildWatchSourceReference {
  return {
    sourceRefId: input.sourceRefId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    sourceType: "APPROVED_ENGINEER_QUANTITY",
    sourceId: input.quantityVersionId,
    sourceVersionId: input.quantityVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: `items.${input.itemId}.finalQuantity`,
    region: null,
    asOf: input.asOf,
    sha256: null,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function cloneJson<T>(value: T): T {
  return structuredClone(value);
}
