import { PRODUCTION_RULE_THRESHOLDS } from "./rule-thresholds.js";

/**
 * GoRules JSON Decision Model (JDM) graph shape, matching the schema consumed
 * by @gorules/zen-engine and edited by @gorules/jdm-editor (verified against
 * https://github.com/gorules/zen/blob/master/test-data/table.json). Every
 * seven-rule threshold graph here is a single inputNode -> decisionTableNode
 * -> outputNode chain with one expression-mode input column ("match") and one
 * string output column ("severity"), evaluated top-to-bottom (hit policy
 * "first"): the first row whose expression is truthy against the rule's
 * facts wins. No row matching means "no deviation" -- this mirrors the
 * `if (...) continue;` early-return shape every rule in rules.ts already had.
 */
export interface JdmRuleGraph {
  nodes: [JdmInputNode, JdmDecisionTableNode, JdmOutputNode];
  edges: JdmEdge[];
}

export interface JdmInputNode {
  id: string;
  type: "inputNode";
  name: string;
  position: { x: number; y: number };
}

export interface JdmOutputNode {
  id: string;
  type: "outputNode";
  name: string;
  position: { x: number; y: number };
}

export interface JdmDecisionTableNode {
  id: string;
  type: "decisionTableNode";
  name: string;
  position: { x: number; y: number };
  content: {
    hitPolicy: "first";
    inputs: [{ id: string; name: string; field: ""; type: "expression" }];
    outputs: [{ id: string; name: string; field: "severity"; type: "string" }];
    rules: Array<{ _id: string; match: string; severity: string }>;
  };
}

export interface JdmEdge {
  id: string;
  type: "edge";
  sourceId: string;
  targetId: string;
}

function buildRuleGraph(
  name: string,
  rules: Array<{ match: string; severity: string }>,
): JdmRuleGraph {
  const inputId = "input";
  const tableId = "table";
  const outputId = "output";
  const matchColumnId = "match";
  const severityColumnId = "severity";

  return {
    nodes: [
      { id: inputId, type: "inputNode", name: "Request", position: { x: 0, y: 0 } },
      {
        id: tableId,
        type: "decisionTableNode",
        name,
        position: { x: 260, y: 0 },
        content: {
          hitPolicy: "first",
          inputs: [{ id: matchColumnId, name: "Match", field: "", type: "expression" }],
          outputs: [
            {
              id: severityColumnId,
              name: "Severity",
              field: "severity",
              type: "string",
            },
          ],
          rules: rules.map((rule, index) => ({
            _id: `rule-${index}`,
            [matchColumnId]: rule.match,
            [severityColumnId]: rule.severity,
          })) as Array<{ _id: string; match: string; severity: string }>,
        },
      },
      { id: outputId, type: "outputNode", name: "Response", position: { x: 520, y: 0 } },
    ],
    edges: [
      { id: "edge-1", type: "edge", sourceId: inputId, targetId: tableId },
      { id: "edge-2", type: "edge", sourceId: tableId, targetId: outputId },
    ],
  };
}

const t = PRODUCTION_RULE_THRESHOLDS;

/**
 * Seed JDM graphs reproducing today's PRODUCTION_RULE_THRESHOLDS-driven
 * severity decisions exactly, one per DET-14 rule. These are the ACTIVE
 * default used whenever a tenant has not published a customized version via
 * the /tenants/:tenantId/rules API (see rule-engine.ts).
 */
export const DEFAULT_RULE_GRAPHS: Record<
  | "OVERDUE_WORK_ITEM"
  | "MATERIAL_OVERUSE"
  | "STOCK_SHORTAGE"
  | "PRODUCTIVITY_DECLINE"
  | "COST_AHEAD_OF_PROGRESS"
  | "SUBCONTRACTOR_DEVIATION"
  | "MISSING_DAILY_REPORT",
  JdmRuleGraph
> = {
  OVERDUE_WORK_ITEM: buildRuleGraph("Overdue severity", [
    { match: "isCritical and delayWorkingDays >= 5", severity: "CRITICAL" },
    { match: "isCritical or delayWorkingDays >= 10", severity: "HIGH" },
    { match: "delayWorkingDays >= 5", severity: "MEDIUM" },
    { match: "true", severity: "LOW" },
  ]),
  MATERIAL_OVERUSE: buildRuleGraph("Material overuse severity", [
    { match: "ratio >= 1.3", severity: "HIGH" },
    { match: `ratio > ${t.materialOveruseRatio}`, severity: "MEDIUM" },
  ]),
  STOCK_SHORTAGE: buildRuleGraph("Stock shortage severity", [
    {
      match: `coverageDays < ${t.criticalStockCoverageDays}`,
      severity: "CRITICAL",
    },
    {
      match: `coverageDays < ${t.warningStockCoverageDays}`,
      severity: "MEDIUM",
    },
  ]),
  PRODUCTIVITY_DECLINE: buildRuleGraph("Productivity decline severity", [
    { match: "ratio < 0.5", severity: "HIGH" },
    { match: `ratio < ${t.productivityRatio}`, severity: "MEDIUM" },
  ]),
  COST_AHEAD_OF_PROGRESS: buildRuleGraph("Cost ahead of progress severity", [
    { match: "lead >= 30", severity: "HIGH" },
    { match: `lead > ${t.costLeadPercentagePoints}`, severity: "MEDIUM" },
  ]),
  SUBCONTRACTOR_DEVIATION: buildRuleGraph("Subcontractor deviation severity", [
    { match: "lag >= 30", severity: "HIGH" },
    { match: `lag > ${t.subcontractorLagPercentagePoints}`, severity: "MEDIUM" },
  ]),
  MISSING_DAILY_REPORT: buildRuleGraph("Missing daily report severity", [
    { match: "true", severity: "MEDIUM" },
  ]),
};

export type RuleGraphSet = typeof DEFAULT_RULE_GRAPHS;
export type ThresholdRuleId = keyof RuleGraphSet;
