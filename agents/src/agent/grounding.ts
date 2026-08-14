import { z } from "zod";
import { getCostLedgerResultSchema } from "../tools/cost-ledger.js";
import { getDependenciesResultSchema } from "../tools/dependencies.js";
import { getProgressHistoryResultSchema } from "../tools/progress-history.js";
import { getWorkItemsResultSchema } from "../tools/work-items.js";
import {
  a4AnswerSchema,
  a4ToolNameSchema,
  type A4Answer,
  type A4SourceReference,
  type A4ToolName,
} from "./schema.js";

const a4SourceTypeSchema = z.enum([
  "AGGREGATE",
  "WORK_ITEM",
  "DEPENDENCY",
  "PROGRESS_SNAPSHOT",
  "COST_ENTRY",
]);

const a4SourceValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const a4SourceFactSchema = z
  .object({
    toolName: a4ToolNameSchema,
    sourceType: a4SourceTypeSchema,
    sourceId: z.string().trim().min(1),
    field: z.string().trim().min(1),
    value: a4SourceValueSchema,
  })
  .strict();

export const a4GroundingIssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string().trim().min(1),
  })
  .strict();

export const a4ResolvedSourceSchema = a4SourceFactSchema.extend({
  claimIndex: z.number().int().nonnegative(),
});

export const a4GroundingResultSchema = z
  .object({
    valid: z.boolean(),
    checkedClaimCount: z.number().int().nonnegative(),
    checkedSourceCount: z.number().int().nonnegative(),
    availableSourceCount: z.number().int().nonnegative(),
    resolvedSources: z.array(a4ResolvedSourceSchema),
    issues: z.array(a4GroundingIssueSchema),
  })
  .strict();

export type A4SourceFact = z.infer<typeof a4SourceFactSchema>;
export type A4GroundingResult = z.infer<typeof a4GroundingResultSchema>;

export interface A4ToolEvidence {
  toolName: string;
  output: unknown;
}

type SourceType = z.infer<typeof a4SourceTypeSchema>;
type Scalar = z.infer<typeof a4SourceValueSchema>;

const KNOWN_ENUM_VALUES = new Set([
  "PLANNED",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "IN_PROGRESS",
  "BLOCKED",
  "CANCELLED",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
  "FINISH_TO_START",
  "START_TO_START",
  "FINISH_TO_FINISH",
  "START_TO_FINISH",
  "LABOR",
  "MATERIAL",
  "EQUIPMENT",
  "SOFTWARE",
  "TRAVEL",
  "OTHER",
]);

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function factKey(source: { toolName: string; sourceId: string; field: string }) {
  return [source.toolName, source.sourceId, source.field].join("\u0000");
}

function flattenRecord(
  toolName: A4ToolName,
  sourceType: SourceType,
  sourceId: string,
  value: unknown,
  facts: A4SourceFact[],
  prefix = "",
) {
  if (isScalar(value)) {
    if (prefix) {
      facts.push({
        toolName,
        sourceType,
        sourceId,
        field: prefix,
        value,
      });
    }
    return;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  for (const [field, nestedValue] of Object.entries(value)) {
    flattenRecord(
      toolName,
      sourceType,
      sourceId,
      nestedValue,
      facts,
      prefix ? `${prefix}.${field}` : field,
    );
  }
}

function addWorkItemFacts(toolName: A4ToolName, output: unknown, facts: A4SourceFact[]) {
  const result = getWorkItemsResultSchema.parse(output);
  const { items, ...aggregate } = result;

  flattenRecord(toolName, "AGGREGATE", `${toolName}:aggregate`, aggregate, facts);

  for (const item of items) {
    flattenRecord(toolName, "WORK_ITEM", item.id, item, facts);
  }
}

function addDependencyFacts(toolName: A4ToolName, output: unknown, facts: A4SourceFact[]) {
  const result = getDependenciesResultSchema.parse(output);
  const { dependencies, ...aggregate } = result;

  flattenRecord(toolName, "AGGREGATE", `${toolName}:aggregate`, aggregate, facts);

  for (const dependency of dependencies) {
    flattenRecord(toolName, "DEPENDENCY", dependency.id, dependency, facts);
  }
}

function addProgressFacts(toolName: A4ToolName, output: unknown, facts: A4SourceFact[]) {
  const result = getProgressHistoryResultSchema.parse(output);
  const { histories, ...aggregate } = result;

  flattenRecord(toolName, "AGGREGATE", `${toolName}:aggregate`, aggregate, facts);

  for (const history of histories) {
    flattenRecord(toolName, "WORK_ITEM", history.workItem.id, history.workItem, facts);

    for (const snapshot of history.snapshots) {
      flattenRecord(
        toolName,
        "PROGRESS_SNAPSHOT",
        snapshot.id,
        {
          ...snapshot,
          workItemId: history.workItem.id,
          projectId: history.workItem.projectId,
        },
        facts,
      );
    }
  }
}

function addCostFacts(toolName: A4ToolName, output: unknown, facts: A4SourceFact[]) {
  const result = getCostLedgerResultSchema.parse(output);
  const { workItems, ...aggregate } = result;

  flattenRecord(toolName, "AGGREGATE", `${toolName}:aggregate`, aggregate, facts);

  for (const workItem of workItems) {
    const { entries, ...workItemSummary } = workItem;

    flattenRecord(toolName, "WORK_ITEM", workItem.id, workItemSummary, facts);

    for (const entry of entries) {
      flattenRecord(
        toolName,
        "COST_ENTRY",
        entry.id,
        {
          ...entry,
          workItemId: workItem.id,
          projectId: workItem.projectId,
        },
        facts,
      );
    }
  }
}

export function buildA4SourceCatalog(toolEvidence: ReadonlyArray<A4ToolEvidence>) {
  const facts: A4SourceFact[] = [];

  for (const evidence of toolEvidence) {
    const toolName = a4ToolNameSchema.parse(evidence.toolName);

    if (toolName === "lookupWorkItems") {
      addWorkItemFacts(toolName, evidence.output, facts);
    } else if (toolName === "lookupDependencies") {
      addDependencyFacts(toolName, evidence.output, facts);
    } else if (toolName === "lookupProgressHistory") {
      addProgressFacts(toolName, evidence.output, facts);
    } else {
      addCostFacts(toolName, evidence.output, facts);
    }
  }

  const unique = new Map<string, A4SourceFact>();

  for (const fact of facts) {
    const key = `${factKey(fact)}\u0000${JSON.stringify(fact.value)}`;
    unique.set(key, a4SourceFactSchema.parse(fact));
  }

  return [...unique.values()];
}

function numericScalar(value: Scalar) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return String(Number(value));
  }

  return null;
}

function dateVariants(value: Scalar) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    return [];
  }

  return [value, value.slice(0, 10)];
}

function extractDateClaims(text: string) {
  return [...new Set(text.match(/\b\d{4}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?\b/g) ?? [])];
}

function extractNumericClaims(text: string) {
  const withoutDates = text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?\b/g, " ")
    .replace(/\b[\p{L}]+(?:-[\p{L}]+)*-\d+\b/gu, " ");
  const matches =
    withoutDates.match(/(?<![\p{L}\p{N}_-])-?\d[\d,]*(?:\.\d+)?(?![\p{L}\p{N}_-])/gu) ?? [];

  return [...new Set(matches.map((value) => String(Number(value.replaceAll(",", "")))))];
}

function inspectClaimValues(
  claimText: string,
  sources: readonly A4SourceFact[],
  claimIndex: number,
  issues: z.infer<typeof a4GroundingIssueSchema>[],
) {
  const numbers = new Set<string>();
  const dates = new Set<string>();
  const categories = new Set<string>();

  for (const source of sources) {
    const numericValue = numericScalar(source.value);

    if (numericValue !== null) {
      numbers.add(numericValue);
    }

    for (const date of dateVariants(source.value)) {
      dates.add(date);
    }

    if (typeof source.value === "string") {
      categories.add(source.value);
    }
  }

  for (const numericClaim of extractNumericClaims(claimText)) {
    if (!numbers.has(numericClaim)) {
      issues.push({
        path: ["claims", claimIndex, "text"],
        message: `Numeric claim ${numericClaim} is absent from this claim's cited sources`,
      });
    }
  }

  for (const dateClaim of extractDateClaims(claimText)) {
    if (!dates.has(dateClaim)) {
      issues.push({
        path: ["claims", claimIndex, "text"],
        message: `Date ${dateClaim} is absent from this claim's cited sources`,
      });
    }
  }

  for (const token of claimText.match(/\b[A-Z][A-Z_]{2,}\b/g) ?? []) {
    if (KNOWN_ENUM_VALUES.has(token) && !categories.has(token)) {
      issues.push({
        path: ["claims", claimIndex, "text"],
        message: `Enum claim ${token} is absent from this claim's cited sources`,
      });
    }
  }
}

export function validateA4Grounding(
  answerInput: A4Answer,
  toolEvidence: ReadonlyArray<A4ToolEvidence>,
): A4GroundingResult {
  const answer = a4AnswerSchema.parse(answerInput);
  const catalog = buildA4SourceCatalog(toolEvidence);
  const factsByReference = new Map<string, A4SourceFact>();
  const issues: z.infer<typeof a4GroundingIssueSchema>[] = [];
  const resolvedSources: z.infer<typeof a4ResolvedSourceSchema>[] = [];
  let checkedSourceCount = 0;

  for (const fact of catalog) {
    factsByReference.set(factKey(fact), fact);
  }

  if (toolEvidence.length === 0) {
    issues.push({
      path: ["toolResults"],
      message: "A4 must inspect at least one authorized read-only tool result",
    });
  }

  answer.claims.forEach((claim, claimIndex) => {
    const claimSources: A4SourceFact[] = [];
    const seen = new Set<string>();

    claim.sources.forEach((source: A4SourceReference, sourceIndex) => {
      checkedSourceCount += 1;
      const key = factKey(source);

      if (seen.has(key)) {
        issues.push({
          path: ["claims", claimIndex, "sources", sourceIndex],
          message: "Duplicate source reference",
        });
        return;
      }

      seen.add(key);
      const fact = factsByReference.get(key);

      if (!fact) {
        issues.push({
          path: ["claims", claimIndex, "sources", sourceIndex],
          message: `Source ${source.toolName}:${source.sourceId}:${source.field} is absent from authorized tool evidence`,
        });
        return;
      }

      claimSources.push(fact);
      resolvedSources.push({
        claimIndex,
        ...fact,
      });
    });

    inspectClaimValues(claim.text, claimSources, claimIndex, issues);
  });

  return a4GroundingResultSchema.parse({
    valid: issues.length === 0,
    checkedClaimCount: answer.claims.length,
    checkedSourceCount,
    availableSourceCount: catalog.length,
    resolvedSources,
    issues,
  });
}

export class A4GroundingError extends Error {
  readonly validation: A4GroundingResult;

  constructor(validation: A4GroundingResult) {
    super(
      `A4 grounding rejected ${validation.issues.length} issue(s): ${validation.issues.map((issue) => issue.message).join("; ")}`,
    );
    this.name = "A4GroundingError";
    this.validation = validation;
  }
}

export function assertA4Grounded(answer: A4Answer, toolEvidence: ReadonlyArray<A4ToolEvidence>) {
  const validation = validateA4Grounding(answer, toolEvidence);

  if (!validation.valid) {
    throw new A4GroundingError(validation);
  }

  return validation;
}
