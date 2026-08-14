import { z } from "zod";
import type { Phase9JobPayload, Phase9JobRunner } from "./jobs.js";

export const phase9AgentAdapterNameSchema = z.enum(["A0", "A1", "A2", "A3", "A4", "A5"]);

export interface Phase9AgentProductionAdapter {
  name: z.infer<typeof phase9AgentAdapterNameSchema>;
  version: string;
  mode: "JOB" | "REQUEST";
  readOnly: boolean;
  run: Phase9JobRunner;
}

export class Phase9AgentAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, Phase9AgentProductionAdapter>;

  constructor(adapters: readonly Phase9AgentProductionAdapter[]) {
    const parsed = adapters.map((adapter) => ({
      ...adapter,
      name: phase9AgentAdapterNameSchema.parse(adapter.name),
    }));
    const names = parsed.map((adapter) => adapter.name);
    if (new Set(names).size !== names.length) {
      throw new Error("Phase 9 agent adapter names must be unique");
    }
    for (const required of phase9AgentAdapterNameSchema.options) {
      if (!names.includes(required)) {
        throw new Error(`Phase 9 production adapter ${required} is required`);
      }
    }
    const a4 = parsed.find((adapter) => adapter.name === "A4")!;
    if (a4.mode !== "REQUEST" || !a4.readOnly) {
      throw new Error("Phase 9 A4 adapter must remain request-scoped and read-only");
    }
    this.#adapters = new Map(parsed.map((adapter) => [adapter.name, adapter]));
  }

  get(name: z.infer<typeof phase9AgentAdapterNameSchema>): Phase9AgentProductionAdapter {
    return this.#adapters.get(name)!;
  }

  readiness() {
    return phase9AgentAdapterNameSchema.options.map((name) => {
      const adapter = this.get(name);
      return {
        name,
        version: adapter.version,
        mode: adapter.mode,
        readOnly: adapter.readOnly,
        ready: true,
      };
    });
  }
}

export function phase9JobRunnersFromAdapters(
  registry: Phase9AgentAdapterRegistry,
): Readonly<
  Record<
    | "PARSE_EXTRACT"
    | "QUANTITY_RECALCULATION"
    | "DAILY_PLAN"
    | "EVENING_REMINDER"
    | "PROGRESS_VERIFICATION"
    | "ROLLING_FORECAST"
    | "OBSERVATION"
    | "REPORT",
    (payload: Phase9JobPayload) => Promise<unknown>
  >
> {
  return {
    PARSE_EXTRACT: registry.get("A0").run,
    QUANTITY_RECALCULATION: registry.get("A0").run,
    DAILY_PLAN: registry.get("A5").run,
    EVENING_REMINDER: registry.get("A1").run,
    PROGRESS_VERIFICATION: registry.get("A5").run,
    ROLLING_FORECAST: registry.get("A5").run,
    OBSERVATION: registry.get("A2").run,
    REPORT: registry.get("A3").run,
  };
}
