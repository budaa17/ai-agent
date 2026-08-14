import { createHash } from "node:crypto";
import {
  buildWatchSourceReferenceSchema,
  type BuildWatchSourceReference,
} from "../contracts/buildwatch-v2-common.js";
import { phase8ToolRecordSchema, type Phase8ToolName, type Phase8ToolRecord } from "./contracts.js";

export function phase8CanonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input === null || typeof input !== "object") {
      return input;
    }
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function phase8Hash(value: unknown): string {
  return createHash("sha256").update(phase8CanonicalJson(value)).digest("hex");
}

export function collectPhase8Sources(value: unknown): BuildWatchSourceReference[] {
  const byId = new Map<string, BuildWatchSourceReference>();
  const visited = new Set<object>();

  const visit = (input: unknown): void => {
    if (input === null || typeof input !== "object") {
      return;
    }
    if (visited.has(input)) {
      return;
    }
    visited.add(input);

    const parsed = buildWatchSourceReferenceSchema.safeParse(input);
    if (parsed.success) {
      byId.set(parsed.data.sourceRefId, parsed.data);
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    Object.values(input as Record<string, unknown>).forEach(visit);
  };

  visit(value);
  return [...byId.values()].sort((left, right) =>
    left.sourceRefId.localeCompare(right.sourceRefId),
  );
}

function collectNamedIdentifiers(value: unknown, names: ReadonlySet<string>): string[] {
  const output = new Set<string>();
  const visited = new Set<object>();
  const visit = (input: unknown): void => {
    if (input === null || typeof input !== "object" || visited.has(input)) {
      return;
    }
    visited.add(input);
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      if (names.has(key) && typeof entry === "string" && entry.length > 0) {
        output.add(entry);
      }
      visit(entry);
    }
  };
  visit(value);
  return [...output].sort();
}

export function collectPhase8ArtifactIds(value: unknown): string[] {
  return collectNamedIdentifiers(value, new Set(["artifactId", "photoArtifactId"]));
}

export function collectPhase8CatalogVersionIds(value: unknown): string[] {
  const names = new Set([
    "versionId",
    "normVersionId",
    "priceVersionId",
    "productivityVersionId",
    "policyVersionId",
    "optionVersionId",
    "calendarVersionId",
  ]);
  const output = new Set(collectNamedIdentifiers(value, names));
  for (const source of collectPhase8Sources(value)) {
    if (source.sourceType === "CATALOG_VERSION") {
      output.add(source.sourceVersionId ?? source.sourceId);
    }
  }
  return [...output].sort();
}

export function buildPhase8ToolRecord(
  input: Readonly<{
    recordId: string;
    toolName: Phase8ToolName;
    tenantId: string;
    projectId: string;
    versionId: string;
    effectiveAt: string;
    data: Record<string, unknown>;
    extraSources?: readonly BuildWatchSourceReference[];
  }>,
): Phase8ToolRecord {
  const recordValue = [input.data, ...(input.extraSources ?? [])];
  const sources = collectPhase8Sources(recordValue);
  return phase8ToolRecordSchema.parse({
    recordId: input.recordId,
    toolName: input.toolName,
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId: input.versionId,
    effectiveAt: input.effectiveAt,
    artifactIds: collectPhase8ArtifactIds(recordValue),
    catalogVersionIds: collectPhase8CatalogVersionIds(recordValue),
    sourceRefs: sources,
    data: input.data,
  });
}

function sameIdentifiers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export function phase8ToolRecordIntegrityIssues(record: Phase8ToolRecord): string[] {
  const issues: string[] = [];
  const dataSourceIds = collectPhase8Sources(record.data).map((source) => source.sourceRefId);
  const recordSourceIds = new Set(record.sourceRefs.map((source) => source.sourceRefId));
  if (dataSourceIds.some((sourceId) => !recordSourceIds.has(sourceId))) {
    issues.push("SOURCE_METADATA_MISMATCH");
  }
  const expectedArtifacts = collectPhase8ArtifactIds([record.data, record.sourceRefs]);
  if (!sameIdentifiers(expectedArtifacts, record.artifactIds)) {
    issues.push("ARTIFACT_METADATA_MISMATCH");
  }
  const expectedCatalogs = collectPhase8CatalogVersionIds([record.data, record.sourceRefs]);
  if (!sameIdentifiers(expectedCatalogs, record.catalogVersionIds)) {
    issues.push("CATALOG_METADATA_MISMATCH");
  }
  return issues;
}

export function clonePhase8<T>(value: T): T {
  return structuredClone(value);
}

export function uniquePhase8Sources(
  values: readonly BuildWatchSourceReference[],
): BuildWatchSourceReference[] {
  const byId = new Map(values.map((source) => [source.sourceRefId, source]));
  return [...byId.values()].sort((left, right) =>
    left.sourceRefId.localeCompare(right.sourceRefId),
  );
}
