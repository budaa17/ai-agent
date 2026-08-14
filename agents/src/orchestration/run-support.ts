import type { z } from "zod";
import type { BuildWatchSourceReference } from "../contracts/buildwatch-v2-common.js";
import {
  phase8AgentRunSchema,
  type Phase8AgentRun,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
  type Phase8ToolOutput,
  type Phase8ToolQuery,
} from "./contracts.js";
import { collectPhase8Sources, phase8Hash, uniquePhase8Sources } from "./deterministic.js";
import type { Phase8ToolGateway } from "./tools.js";

export type ExecutedPhase8Tools = Readonly<{
  outputs: ReadonlyMap<Phase8ToolName, Phase8ToolOutput>;
  calls: Phase8AgentRun["toolCalls"];
  sources: readonly BuildWatchSourceReference[];
}>;

export async function executePhase8Tools(
  input: Readonly<{
    agent: "A0" | "A5";
    runId: string;
    names: readonly Phase8ToolName[];
    gateway: Phase8ToolGateway;
    context: Phase8AuthorizationContext;
    query: Phase8ToolQuery;
    completedAt: string;
  }>,
): Promise<ExecutedPhase8Tools> {
  const outputs = new Map<Phase8ToolName, Phase8ToolOutput>();
  const calls: Phase8AgentRun["toolCalls"] = [];

  for (const [index, toolName] of input.names.entries()) {
    const output = await input.gateway.execute(toolName, input.query, input.context);
    outputs.set(toolName, output);
    calls.push({
      callId: `${input.agent.toLowerCase()}-${input.runId}-${index + 1}-${toolName}`,
      toolName,
      inputHash: phase8Hash(input.query),
      outputHash: phase8Hash(output),
      returnedRecordIds: output.records.map((record) => record.recordId),
      sourceRefIds: output.meta.sourceCatalog.map((source) => source.sourceRefId),
      toolContractVersion: "buildwatch-v22-phase8-tools-v1",
      readOnly: true,
      completedAt: input.completedAt,
    });
  }

  return {
    outputs,
    calls,
    sources: uniquePhase8Sources(
      [...outputs.values()].flatMap((output) => output.meta.sourceCatalog),
    ),
  };
}

export function outputFor(
  executed: ExecutedPhase8Tools,
  toolName: Phase8ToolName,
): Phase8ToolOutput {
  const output = executed.outputs.get(toolName);
  if (output === undefined) {
    throw new Error(`Phase 8 tool ${toolName} was not executed`);
  }
  return output;
}

export function parseToolData<T extends z.ZodTypeAny>(
  executed: ExecutedPhase8Tools,
  toolName: Phase8ToolName,
  schema: T,
): Array<z.output<T>> {
  return outputFor(executed, toolName).records.map((record) => schema.parse(record.data));
}

export function recordIdsFor(
  executed: ExecutedPhase8Tools,
  toolNames: readonly Phase8ToolName[],
): string[] {
  return toolNames.flatMap((toolName) =>
    outputFor(executed, toolName).records.map((record) => record.recordId),
  );
}

export function validatePhase8SourceLineage(
  input: Readonly<{
    value: unknown;
    tenantId: string;
    projectId: string;
    authorizedSources: readonly BuildWatchSourceReference[];
  }>,
): string[] {
  const authorizedIds = new Set(input.authorizedSources.map((source) => source.sourceRefId));
  return collectPhase8Sources(input.value)
    .filter(
      (source) =>
        source.tenantId !== input.tenantId ||
        source.projectId !== input.projectId ||
        (source.sourceType !== "SYSTEM_CALCULATION" && !authorizedIds.has(source.sourceRefId)),
    )
    .map((source) => source.sourceRefId)
    .sort();
}

export function buildPhase8Run(
  input: Readonly<{
    runId: string;
    agent: "A0" | "A5";
    tenantId: string;
    projectId: string;
    status: Phase8AgentRun["status"];
    llmMode: Phase8AgentRun["llmMode"];
    calls: Phase8AgentRun["toolCalls"];
    sources: readonly BuildWatchSourceReference[];
    generatedAt: string;
  }>,
): Phase8AgentRun {
  return phase8AgentRunSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    agent: input.agent,
    tenantId: input.tenantId,
    projectId: input.projectId,
    status: input.status,
    promptVersion:
      input.agent === "A0"
        ? "buildwatch-a0-orchestration-prompt-v1"
        : "buildwatch-a5-orchestration-prompt-v1",
    modelProvider: "NONE",
    modelName: "DETERMINISTIC_ONLY",
    modelVersion: "llm-off-v1",
    toolContractVersion: "buildwatch-v22-phase8-tools-v1",
    outputSchemaVersion: 1,
    deterministicServiceVersions:
      input.agent === "A0"
        ? [
            "design-intake-v1",
            "quantity-formula-registry-v1",
            "estimate-engine-v1",
            "calendar-cpm-v1",
          ]
        : ["a5-planning-v1", "progress-verification-v1", "operational-forecast-v1"],
    llmMode: input.llmMode,
    numericAuthority: "DETERMINISTIC_SERVICES_ONLY",
    toolCalls: input.calls,
    authorizedSourceRefIds: uniquePhase8Sources(input.sources).map((source) => source.sourceRefId),
    startedAt: input.generatedAt,
    completedAt: input.generatedAt,
  });
}
