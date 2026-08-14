import type { BuildWatchSourceReference } from "../contracts/buildwatch-v2-common.js";
import {
  authorizePhase8Tool,
  phase8RecordIsAuthorized,
  type Phase8SignedArtifactVerifier,
} from "./authorization.js";
import {
  phase8ToolOutputSchema,
  phase8ToolQuerySchema,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
  type Phase8ToolOutput,
  type Phase8ToolQuery,
} from "./contracts.js";
import {
  clonePhase8,
  phase8ToolRecordIntegrityIssues,
  uniquePhase8Sources,
} from "./deterministic.js";
import type { Phase8ReadRepository } from "./repository.js";

function compareRecords(
  left: Phase8ToolOutput["records"][number],
  right: Phase8ToolOutput["records"][number],
): number {
  return (
    Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt) ||
    left.recordId.localeCompare(right.recordId)
  );
}

function sourceIds(sources: readonly BuildWatchSourceReference[]): Set<string> {
  return new Set(sources.map((source) => source.sourceRefId));
}

export class Phase8ToolGateway {
  constructor(
    private readonly repository: Phase8ReadRepository,
    private readonly signedArtifactVerifier: Phase8SignedArtifactVerifier,
  ) {}

  async execute(
    toolName: Phase8ToolName,
    input: Phase8ToolQuery,
    inputContext: Phase8AuthorizationContext,
  ): Promise<Phase8ToolOutput> {
    const query = phase8ToolQuerySchema.parse(input);
    const context = authorizePhase8Tool(inputContext, query.projectId, toolName);
    const repositoryRecords = await this.repository.list(toolName);
    if (repositoryRecords.some((record) => phase8ToolRecordIntegrityIssues(record).length > 0)) {
      throw new Error("Phase 8 repository integrity validation failed");
    }
    const filteredByQuery = repositoryRecords.filter(
      (record) =>
        record.tenantId === context.tenantId &&
        record.projectId === query.projectId &&
        Date.parse(record.effectiveAt) <= Date.parse(query.asOf) &&
        (query.versionId === null || record.versionId === query.versionId),
    );
    const authorized = filteredByQuery
      .filter((record) =>
        phase8RecordIsAuthorized(record, context, query.projectId, this.signedArtifactVerifier),
      )
      .sort(compareRecords);
    const selected: Phase8ToolOutput["records"] = [];
    const selectedSourceIds = new Set<string>();

    for (const record of authorized) {
      if (selected.length >= query.limit) {
        break;
      }
      const candidateSourceIds = sourceIds(record.sourceRefs);
      const projectedSourceCount = new Set([...selectedSourceIds, ...candidateSourceIds]).size;
      if (projectedSourceCount > query.sourceLimit) {
        continue;
      }
      selected.push(clonePhase8(record));
      candidateSourceIds.forEach((sourceId) => selectedSourceIds.add(sourceId));
    }

    const sourceCatalog = uniquePhase8Sources(selected.flatMap((record) => record.sourceRefs));
    const authorizedSources = uniquePhase8Sources(
      authorized.flatMap((record) => record.sourceRefs),
    );
    return phase8ToolOutputSchema.parse({
      meta: {
        schemaVersion: 1,
        toolContractVersion: "buildwatch-v22-phase8-tools-v1",
        toolName,
        principalId: context.principalId,
        tenantId: context.tenantId,
        projectId: query.projectId,
        asOf: query.asOf,
        versionId: query.versionId,
        rowCount: authorized.length,
        returnedRowCount: selected.length,
        truncated: selected.length < authorized.length,
        sourceCatalogTruncated: sourceCatalog.length < authorizedSources.length,
        appliedLimit: query.limit,
        appliedSourceLimit: query.sourceLimit,
        dataClassification: "AUTHORIZED_PROJECT_READ_ONLY",
        authorizationChecks: {
          tenantScope: true,
          projectAssignment: true,
          rolePermission: true,
          fieldPermission: true,
          signedArtifactRead: true,
          catalogScope: true,
          sourceScope: true,
        },
        sourceCatalog,
      },
      records: selected,
    });
  }
}
