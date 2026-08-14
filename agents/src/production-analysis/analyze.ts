import {
  deterministicAnalysisV1Schema,
  type DeterministicAnalysisV1,
} from "../contracts/deterministic-analysis.js";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";
import { calculateScheduleForecast } from "./forecast.js";
import { evaluateProductionRules } from "./rules.js";
import { DEFAULT_RULE_GRAPHS, type RuleGraphSet } from "./rule-engine.js";
import { simulateRecoveryScenarios } from "./scenarios.js";
import { buildSourceCatalog } from "./source-catalog.js";

export const PRODUCTION_RULE_BUNDLE_VERSION = "buildwatch-rules-v1";

/**
 * ruleGraphs defaults to DEFAULT_RULE_GRAPHS (the seed JDM decision tables
 * derived from PRODUCTION_RULE_THRESHOLDS), so every existing caller keeps
 * today's exact behavior with no changes. Callers with tenant context that
 * want a tenant's published rule overrides should resolve them first via
 * rule-engine.ts:loadTenantRuleGraphs(prisma, tenantId) and pass the result
 * in here (or into the analysisInput override param the A2/A3 pipelines
 * already accept).
 */
export function analyzeProjectSnapshot(
  input: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicAnalysisV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(input);
  const forecast = calculateScheduleForecast(snapshot);
  const ruleEvaluations = evaluateProductionRules(snapshot, ruleGraphs);
  const deviations = ruleEvaluations.flatMap((evaluation) => evaluation.deviations);
  const recoveryScenarios = simulateRecoveryScenarios(snapshot, forecast);
  const sourceCatalog = buildSourceCatalog(snapshot);

  return deterministicAnalysisV1Schema.parse({
    schemaVersion: 1,
    analysisType: "DETERMINISTIC_PROJECT_ANALYSIS",
    analysisId: `analysis-${snapshot.snapshotId}`,
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    snapshotId: snapshot.snapshotId,
    asOf: snapshot.asOf,
    ruleBundleVersion: PRODUCTION_RULE_BUNDLE_VERSION,
    forecast,
    ruleEvaluations,
    deviations,
    recoveryScenarios,
    sourceCatalog,
  });
}
