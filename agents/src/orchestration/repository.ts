import { phase8ToolRecordSchema, type Phase8ToolName, type Phase8ToolRecord } from "./contracts.js";
import { clonePhase8, phase8ToolRecordIntegrityIssues } from "./deterministic.js";

export interface Phase8ReadRepository {
  list(toolName: Phase8ToolName): Promise<readonly Phase8ToolRecord[]>;
}

export class InMemoryPhase8ReadRepository implements Phase8ReadRepository {
  readonly #records: readonly Phase8ToolRecord[];

  constructor(records: readonly Phase8ToolRecord[]) {
    const parsed = records.map((record) => phase8ToolRecordSchema.parse(record));
    if (parsed.some((record) => phase8ToolRecordIntegrityIssues(record).length > 0)) {
      throw new Error("Phase 8 repository record authorization metadata is inconsistent");
    }
    const identifiers = parsed.map(
      (record) => `${record.toolName}:${record.tenantId}:${record.projectId}:${record.recordId}`,
    );
    if (new Set(identifiers).size !== identifiers.length) {
      throw new Error("Phase 8 repository record identifiers must be unique per tool scope");
    }
    this.#records = parsed.map((record) => Object.freeze(clonePhase8(record)));
  }

  async list(toolName: Phase8ToolName): Promise<readonly Phase8ToolRecord[]> {
    return this.#records
      .filter((record) => record.toolName === toolName)
      .map((record) => clonePhase8(record));
  }
}
