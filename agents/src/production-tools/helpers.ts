import type { AgentSourceRefV1 } from "../contracts/deterministic-analysis.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";
import { buildSourceCatalog, executableWorkItems } from "../production-analysis/index.js";
import { authorizeProject, ProductionToolNotFoundError } from "./context.js";
import {
  productionToolMetaSchema,
  type AuthorizationContext,
  type ProductionToolMeta,
} from "./contracts.js";
import type { ProductionReadRepository } from "./repository.js";

export async function resolveAuthorizedSnapshot(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  projectId: string,
  asOf?: string,
): Promise<{
  context: AuthorizationContext;
  snapshot: ProjectAnalysisSnapshotV1;
}> {
  const authorizedContext = authorizeProject(context, projectId);
  const snapshot = await repository.findProjectSnapshot(authorizedContext, projectId, asOf);

  if (snapshot === null) {
    throw new ProductionToolNotFoundError();
  }

  return {
    context: authorizedContext,
    snapshot,
  };
}

export function sourceCatalogFor(
  snapshot: ProjectAnalysisSnapshotV1,
  sourceIds: readonly string[],
): AgentSourceRefV1[] {
  const requested = new Set(sourceIds);
  return buildSourceCatalog(snapshot)
    .filter((source) => requested.has(source.sourceId))
    .slice(0, 2_000);
}

export function buildToolMeta(input: {
  toolName: ProductionToolMeta["toolName"];
  snapshot: ProjectAnalysisSnapshotV1;
  rowCount: number;
  returnedRowCount: number;
  startedAt: number;
  sourceIds: readonly string[];
}): ProductionToolMeta {
  return productionToolMetaSchema.parse({
    schemaVersion: 1,
    toolName: input.toolName,
    tenantId: input.snapshot.tenantId,
    projectId: input.snapshot.projectId,
    asOf: input.snapshot.asOf,
    rowCount: input.rowCount,
    returnedRowCount: input.returnedRowCount,
    truncated: input.returnedRowCount < input.rowCount,
    durationMs: Math.max(0, Math.round((performance.now() - input.startedAt) * 100) / 100),
    dataClassification: "AUTHORIZED_PROJECT_READ_ONLY",
    sourceCatalog: sourceCatalogFor(input.snapshot, input.sourceIds),
  });
}

export function latestProgressMap(
  snapshot: ProjectAnalysisSnapshotV1,
): Map<string, ProjectAnalysisSnapshotV1["progressEntries"][number]> {
  const approvedReportIds = new Set(
    snapshot.dailyReports
      .filter((report) => report.status === "APPROVED")
      .map((report) => report.dailyReportId),
  );
  const output = new Map<string, ProjectAnalysisSnapshotV1["progressEntries"][number]>();

  for (const entry of snapshot.progressEntries) {
    if (!approvedReportIds.has(entry.dailyReportId)) {
      continue;
    }

    const current = output.get(entry.workItemId);

    if (current === undefined || Date.parse(entry.capturedAt) > Date.parse(current.capturedAt)) {
      output.set(entry.workItemId, entry);
    }
  }

  return output;
}

export function leafWorkItems(
  snapshot: ProjectAnalysisSnapshotV1,
): ProjectAnalysisSnapshotV1["workItems"] {
  return executableWorkItems(snapshot);
}

export function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function decimalString(value: number, precision = 6): string {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
