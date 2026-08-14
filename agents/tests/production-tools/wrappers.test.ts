import { describe, expect, it } from "vitest";
import {
  createProductionAgentTools,
  type AuthorizationContext,
  type ProductionAgentToolName,
} from "../../src/production-tools/index.js";
import { authorizedContext, repository } from "./fixtures.js";

type ExecutableTool = {
  execute: (
    input: unknown,
    options: { context: AuthorizationContext },
  ) => Promise<{ meta: { toolName: string } }>;
};

const projectId = "project-buildwatch-simulation";
const inputs: Record<ProductionAgentToolName, unknown> = {
  getProjectSummary: { projectId },
  getWorkItems: { projectId, limit: 1 },
  getProgressHistory: { projectId, limit: 1 },
  getStockStatus: { projectId, limit: 1 },
  getConsumptionVsNorm: { projectId, limit: 1 },
  getAttendanceStats: { projectId, limit: 1 },
  getBlockerHistory: { projectId, limit: 1 },
  getAlerts: { projectId, limit: 1 },
  getScheduleForecast: { projectId, limit: 1 },
  getSubcontractorPerformance: { projectId, limit: 1 },
  searchDailyReports: {
    projectId,
    query: "Өдрийн",
    limit: 1,
  },
};

describe("11 AI SDK production tool wrappers", () => {
  const tools = createProductionAgentTools(repository);

  for (const name of Object.keys(tools) as ProductionAgentToolName[]) {
    it(`${name} validates context and executes its core`, async () => {
      const executable = tools[name] as unknown as ExecutableTool;

      expect(executable.execute).toBeTypeOf("function");
      const result = await executable.execute(inputs[name], {
        context: authorizedContext,
      });

      expect(result.meta.toolName).toBe(name);
    });
  }
});
