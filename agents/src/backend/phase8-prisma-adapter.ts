import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildPhase8ToolRecord,
  phase8Hash,
  phase8ToolNameSchema,
  phase8ToolRecordSchema,
  type Phase8ReadRepository,
  type Phase8ToolName,
  type Phase8ToolRecord,
} from "../orchestration/index.js";
import type { BuildWatchSourceReference } from "../contracts/buildwatch-v2-common.js";

type Phase9ReadModelClient = Pick<Prisma.TransactionClient, "agentToolReadModel">;

export interface Phase9AgentReadScope {
  tenantId: string;
  projectIds: readonly string[];
}

export function phase9AgentReadModelHash(record: Phase8ToolRecord): string {
  return phase8Hash({
    tenantId: record.tenantId,
    projectId: record.projectId,
    toolName: record.toolName,
    recordId: record.recordId,
    versionId: record.versionId,
    effectiveAt: record.effectiveAt,
    artifactIds: record.artifactIds,
    catalogVersionIds: record.catalogVersionIds,
    sourceRefs: record.sourceRefs,
    data: record.data,
  });
}

export class PrismaPhase8ReadRepository implements Phase8ReadRepository {
  readonly #projectIds: string[];

  constructor(
    private readonly client: Pick<PrismaClient, "agentToolReadModel">,
    private readonly scope: Phase9AgentReadScope,
  ) {
    this.#projectIds = [...new Set(scope.projectIds)].sort();
    if (this.#projectIds.length === 0) {
      throw new Error("Phase 9 agent read scope requires at least one project");
    }
  }

  async list(toolNameInput: Phase8ToolName): Promise<readonly Phase8ToolRecord[]> {
    const toolName = phase8ToolNameSchema.parse(toolNameInput);
    const rows = await this.client.agentToolReadModel.findMany({
      where: {
        tenantId: this.scope.tenantId,
        projectId: { in: this.#projectIds },
        toolName,
      },
      orderBy: [{ effectiveAt: "desc" }, { recordId: "asc" }],
    });
    return rows.map((row) => {
      const record = phase8ToolRecordSchema.parse({
        recordId: row.recordId,
        toolName: row.toolName,
        tenantId: row.tenantId,
        projectId: row.projectId,
        versionId: row.versionId,
        effectiveAt: row.effectiveAt.toISOString(),
        artifactIds: row.artifactIds,
        catalogVersionIds: row.catalogVersionIds,
        sourceRefs: row.sourceRefs,
        data: row.data,
      });
      if (phase9AgentReadModelHash(record) !== row.sourceHash) {
        throw new Error("Phase 9 agent read model integrity validation failed");
      }
      return record;
    });
  }
}

export interface Phase9AgentReadModelInput {
  recordId: string;
  toolName: Phase8ToolName;
  tenantId: string;
  projectId: string;
  versionId: string;
  effectiveAt: string;
  data: Record<string, unknown>;
  extraSources?: readonly BuildWatchSourceReference[];
}

export async function upsertPhase9AgentReadModel(
  client: Phase9ReadModelClient,
  input: Phase9AgentReadModelInput,
): Promise<Phase8ToolRecord> {
  const record = buildPhase8ToolRecord(input);
  const sourceHash = phase9AgentReadModelHash(record);
  await client.agentToolReadModel.upsert({
    where: {
      tenantId_projectId_toolName_recordId: {
        tenantId: record.tenantId,
        projectId: record.projectId,
        toolName: record.toolName,
        recordId: record.recordId,
      },
    },
    update: {
      versionId: record.versionId,
      effectiveAt: new Date(record.effectiveAt),
      artifactIds: record.artifactIds,
      catalogVersionIds: record.catalogVersionIds,
      sourceRefs: record.sourceRefs as Prisma.InputJsonValue,
      data: record.data as Prisma.InputJsonValue,
      sourceHash,
    },
    create: {
      tenantId: record.tenantId,
      projectId: record.projectId,
      toolName: record.toolName,
      recordId: record.recordId,
      versionId: record.versionId,
      effectiveAt: new Date(record.effectiveAt),
      artifactIds: record.artifactIds,
      catalogVersionIds: record.catalogVersionIds,
      sourceRefs: record.sourceRefs as Prisma.InputJsonValue,
      data: record.data as Prisma.InputJsonValue,
      sourceHash,
    },
  });
  return record;
}
