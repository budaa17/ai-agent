import {
  InMemoryProductionReadRepository,
  type AuthorizationContext,
} from "../../src/production-tools/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";

export const simulation = buildBuildWatchSimulation();

export const repository = new InMemoryProductionReadRepository([
  simulation.snapshot,
  simulation.privateSnapshot,
]);

export const authorizedContext: AuthorizationContext = {
  principalId: "principal-demo-manager",
  tenantId: "tenant-demo",
  allowedProjectIds: ["project-buildwatch-simulation"],
  permissions: ["AGENT_READ", "COST_READ", "REPORT_TEXT_READ"],
};

export const privateContext: AuthorizationContext = {
  principalId: "principal-private-manager",
  tenantId: "tenant-private",
  allowedProjectIds: ["project-private-secret"],
  permissions: ["AGENT_READ", "COST_READ", "REPORT_TEXT_READ"],
};
