import type { PrismaClient } from "@prisma/client";
import { evaluateExpressionSync } from "@gorules/zen-engine";
import { DEFAULT_RULE_GRAPHS, type JdmRuleGraph, type RuleGraphSet } from "./rule-graphs.js";

export type { RuleGraphSet, ThresholdRuleId, JdmRuleGraph } from "./rule-graphs.js";
export { DEFAULT_RULE_GRAPHS } from "./rule-graphs.js";

/**
 * Evaluates a single-decision-table JDM rule graph (see rule-graphs.ts)
 * against a fact object, returning the first matching row's output, or null
 * if no row matched -- the JDM analogue of the `if (...) continue;` skip
 * every rules.ts threshold check used before this migration.
 *
 * This intentionally does not use ZenEngine/ZenDecision's async graph
 * executor: our graphs are always exactly inputNode -> one decisionTableNode
 * -> outputNode with hit policy "first", so walking the `rules` array with
 * the synchronous evaluateExpressionSync primitive reproduces the same
 * semantics while keeping evaluateProductionRules/analyzeProjectSnapshot
 * synchronous (no async-coloring cascade into the A2/A3 call chains that
 * consume them). The stored graph is still standard JDM JSON, so it remains
 * fully open-able and editable in the @gorules/jdm-editor UI.
 */
export function evaluateRuleThreshold(
  graph: JdmRuleGraph,
  facts: Record<string, unknown>,
): { severity: string } | null {
  const table = graph.nodes[1];
  for (const rule of table.content.rules) {
    const matched = evaluateExpressionSync(rule.match, facts);
    if (matched === true) {
      return { severity: rule.severity };
    }
  }
  return null;
}

interface TenantRuleCacheEntry {
  graphs: RuleGraphSet;
  loadedAt: number;
}

const tenantRuleCache = new Map<string, TenantRuleCacheEntry>();

/**
 * Loads the ACTIVE (status = APPLIED) JDM graph for every DET-14 threshold
 * rule for a tenant, falling back to DEFAULT_RULE_GRAPHS for any rule the
 * tenant has not customized/published yet. Results are cached in-process
 * per tenant; call invalidateTenantRuleGraphs after a publish to refresh.
 */
export async function loadTenantRuleGraphs(
  prisma: PrismaClient,
  tenantId: string,
): Promise<RuleGraphSet> {
  const cached = tenantRuleCache.get(tenantId);
  if (cached !== undefined) {
    return cached.graphs;
  }

  const appliedVersions = await prisma.ruleCatalogVersion.findMany({
    where: { tenantId, status: "APPLIED" },
    include: { catalog: true },
  });

  const graphs: Record<string, JdmRuleGraph> = { ...DEFAULT_RULE_GRAPHS };
  for (const version of appliedVersions) {
    const ruleId = version.catalog.ruleId;
    if (ruleId in DEFAULT_RULE_GRAPHS) {
      graphs[ruleId] = version.jdmGraph as unknown as JdmRuleGraph;
    }
  }

  const resolved = graphs as RuleGraphSet;
  tenantRuleCache.set(tenantId, { graphs: resolved, loadedAt: Date.now() });
  return resolved;
}

export function invalidateTenantRuleGraphs(tenantId: string): void {
  tenantRuleCache.delete(tenantId);
}
