import { z } from "zod";
import { projectAnalysisResultSchema, type ProjectAnalysisResult } from "../analysis/analyze.js";
import { projectAnalysisDataSchema, type ProjectAnalysisData } from "../analysis/schema.js";
import {
  deriveRecommendationRiskPosture,
  recommendationReportSchema,
  recommendationSourceSchema,
  type RecommendationReport,
  type RecommendationSource,
  type RecommendationSourceValue,
  type RecommendationSourceType,
} from "./schema.js";

const groundingIssueSchema = z
  .object({
    code: z.string().min(1),
    path: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const recommendationGroundingResultSchema = z
  .object({
    valid: z.boolean(),
    checkedObservationCount: z.number().int().nonnegative(),
    checkedRecommendationCount: z.number().int().nonnegative(),
    checkedSourceCount: z.number().int().nonnegative(),
    groundedNumericClaimCount: z.number().int().nonnegative(),
    groundedDateClaimCount: z.number().int().nonnegative(),
    issues: z.array(groundingIssueSchema),
  })
  .strict();

export type RecommendationGroundingResult = z.infer<typeof recommendationGroundingResultSchema>;

export interface RecommendationGroundingContext {
  facts: RecommendationSource[];
  impactRefs: Array<{
    impactRef: string;
    workItemId: string;
    priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  }>;
}

type GroundingIssue = z.infer<typeof groundingIssueSchema>;

const isoDatePattern = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?\b/g;
const workItemCodePattern = /\b[A-Z][A-Z0-9]{0,15}-\d{1,8}\b/g;
const workItemIdPattern = /\bwi-[a-z0-9][a-z0-9-]*\b/giu;
const standaloneNumberPattern = /(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)?(?![\p{L}\p{N}_])/gu;

function normalizeNumber(value: string | number) {
  const numberValue = typeof value === "number" ? value : Number(value.replace(",", "."));

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return Object.is(numberValue, -0) ? "0" : numberValue.toString();
}

function numericScalar(value: unknown) {
  if (typeof value === "number") {
    return normalizeNumber(value);
  }

  if (typeof value === "string" && /^[-+]?\d+(?:[.,]\d+)?$/.test(value)) {
    return normalizeNumber(value);
  }

  return null;
}

function dateVariants(value: string) {
  const match = value.match(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/);

  return match ? [value, value.slice(0, 10)] : [];
}

function collectScalarNumbers(value: unknown, target: Set<string>) {
  const normalized = numericScalar(value);

  if (normalized !== null) {
    target.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectScalarNumbers(item, target);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectScalarNumbers(item, target);
    }
  }
}

function collectDatabaseDates(data: ProjectAnalysisData) {
  const dates = new Set<string>();
  const add = (value: string | null) => {
    if (value) {
      for (const variant of dateVariants(value)) {
        dates.add(variant);
      }
    }
  };

  add(data.asOf);
  add(data.projectPlannedStart);
  add(data.projectPlannedEnd);

  for (const workItem of data.workItems) {
    add(workItem.plannedStart);
    add(workItem.plannedEnd);
    add(workItem.actualStart);
    add(workItem.actualEnd);

    for (const snapshot of workItem.snapshots) {
      add(snapshot.capturedAt);
    }

    for (const entry of workItem.costEntries) {
      add(entry.occurredAt);
    }
  }

  return dates;
}

function flattenFacts(
  sourceType: RecommendationSourceType,
  sourceId: string,
  value: unknown,
  addFact: (
    sourceType: RecommendationSourceType,
    sourceId: string,
    field: string,
    value: RecommendationSourceValue,
  ) => void,
  path = "",
) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (path) {
      addFact(sourceType, sourceId, path, value);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenFacts(sourceType, sourceId, item, addFact, path ? `${path}.${index}` : String(index));
    });
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flattenFacts(sourceType, sourceId, item, addFact, path ? `${path}.${key}` : key);
    }
  }
}

function factIdentity(source: RecommendationSource) {
  return `${source.sourceType}\u0000${source.sourceId}\u0000${source.field}`;
}

function factValueIdentity(source: RecommendationSource) {
  return `${factIdentity(source)}\u0000${JSON.stringify(source.value)}`;
}

export function buildRecommendationGroundingContext(
  dataInput: ProjectAnalysisData,
  analysisInput: ProjectAnalysisResult,
): RecommendationGroundingContext {
  const data = projectAnalysisDataSchema.parse(dataInput);
  const analysis = projectAnalysisResultSchema.parse(analysisInput);

  if (
    data.tenantId !== analysis.tenantId ||
    data.projectId !== analysis.projectId ||
    data.asOf !== analysis.asOf
  ) {
    throw new Error("Analysis and database grounding scopes do not match");
  }

  const allowedNumbers = new Set<string>();
  const allowedDates = collectDatabaseDates(data);
  const factsByIdentity = new Map<string, RecommendationSource>();

  collectScalarNumbers(analysis, allowedNumbers);

  const addFact = (
    sourceType: RecommendationSourceType,
    sourceId: string,
    field: string,
    value: RecommendationSourceValue,
  ) => {
    const numericValue = numericScalar(value);
    const dateValue = typeof value === "string" ? dateVariants(value) : [];

    if (numericValue !== null && !allowedNumbers.has(numericValue)) {
      return;
    }

    if (dateValue.length > 0 && !dateValue.some((candidate) => allowedDates.has(candidate))) {
      return;
    }

    const fact = recommendationSourceSchema.parse({
      sourceType,
      sourceId,
      field,
      value,
    });
    factsByIdentity.set(factIdentity(fact), fact);
  };

  flattenFacts(
    "PROJECT",
    data.projectId,
    {
      tenantId: data.tenantId,
      projectId: data.projectId,
      code: data.projectCode,
      name: data.projectName,
      plannedStart: data.projectPlannedStart,
      plannedEnd: data.projectPlannedEnd,
      asOf: data.asOf,
    },
    addFact,
  );

  for (const workItem of data.workItems) {
    const { snapshots, costEntries, ...workItemFields } = workItem;
    flattenFacts("WORK_ITEM", workItem.id, workItemFields, addFact);

    for (const snapshot of snapshots) {
      flattenFacts(
        "PROGRESS_SNAPSHOT",
        snapshot.id,
        {
          workItemId: workItem.id,
          ...snapshot,
        },
        addFact,
      );
    }

    for (const entry of costEntries) {
      flattenFacts(
        "COST_ENTRY",
        entry.id,
        {
          workItemId: workItem.id,
          ...entry,
        },
        addFact,
      );
    }
  }

  for (const dependency of data.dependencies) {
    flattenFacts("DEPENDENCY", dependency.id, dependency, addFact);
  }

  flattenFacts("ANALYSIS_SUMMARY", analysis.projectId, analysis.summary, addFact);
  flattenFacts(
    "CPM_PROJECT",
    analysis.projectId,
    {
      projectStart: analysis.cpm.projectStart,
      projectFinish: analysis.cpm.projectFinish,
      projectDurationDays: analysis.cpm.projectDurationDays,
      topologicalOrder: analysis.cpm.topologicalOrder,
      criticalWorkItemIds: analysis.cpm.criticalWorkItemIds,
      criticalPaths: analysis.cpm.criticalPaths,
    },
    addFact,
  );

  for (const task of analysis.cpm.tasks) {
    flattenFacts("CPM_TASK", task.workItemId, task, addFact);
  }

  for (const issue of analysis.issues) {
    flattenFacts("ISSUE", issue.id, issue, addFact);
  }

  return {
    facts: [...factsByIdentity.values()].sort((left, right) =>
      factIdentity(left).localeCompare(factIdentity(right)),
    ),
    impactRefs: analysis.issues.map((issue) => ({
      impactRef: issue.id,
      workItemId: issue.workItemId,
      priority: issue.severity,
    })),
  };
}

function extractDateClaims(text: string) {
  return [...text.matchAll(isoDatePattern)].map((match) => match[0]);
}

function extractNumericClaims(text: string) {
  const withoutDates = text
    .replace(isoDatePattern, " ")
    .replace(workItemCodePattern, " ")
    .replace(workItemIdPattern, " ");

  return [...withoutDates.matchAll(standaloneNumberPattern)]
    .map((match) => normalizeNumber(match[0]))
    .filter((value): value is string => value !== null);
}

function addIssue(issues: GroundingIssue[], code: string, path: string, message: string) {
  issues.push({ code, path, message });
}

function checkNarrative(
  text: string,
  path: string,
  sourceNumbers: ReadonlySet<string>,
  sourceDates: ReadonlySet<string>,
  databaseDates: ReadonlySet<string>,
  knownWorkItemIds: ReadonlySet<string>,
  knownWorkItemCodes: ReadonlySet<string>,
  issues: GroundingIssue[],
) {
  let groundedNumericClaimCount = 0;
  let groundedDateClaimCount = 0;

  for (const numericClaim of extractNumericClaims(text)) {
    if (!sourceNumbers.has(numericClaim)) {
      addIssue(
        issues,
        "UNGROUNDED_NUMBER",
        path,
        `Numeric claim ${numericClaim} is not present in this recommendation's grounded sources`,
      );
    } else {
      groundedNumericClaimCount += 1;
    }
  }

  for (const dateClaim of extractDateClaims(text)) {
    const variants = dateVariants(dateClaim);

    if (!variants.some((candidate) => databaseDates.has(candidate))) {
      addIssue(
        issues,
        "UNKNOWN_DATE",
        path,
        `Date ${dateClaim} is not present in the project database scope`,
      );
    } else if (!variants.some((candidate) => sourceDates.has(candidate))) {
      addIssue(
        issues,
        "UNGROUNDED_DATE",
        path,
        `Date ${dateClaim} is not present in this recommendation's grounded sources`,
      );
    } else {
      groundedDateClaimCount += 1;
    }
  }

  for (const workItemId of text.match(workItemIdPattern) ?? []) {
    if (!knownWorkItemIds.has(workItemId)) {
      addIssue(
        issues,
        "UNKNOWN_WORK_ITEM_ID",
        path,
        `Work item id ${workItemId} is outside the project database scope`,
      );
    }
  }

  for (const workItemCode of text.match(workItemCodePattern) ?? []) {
    if (!knownWorkItemCodes.has(workItemCode)) {
      addIssue(
        issues,
        "UNKNOWN_WORK_ITEM_CODE",
        path,
        `Work item code ${workItemCode} is outside the project database scope`,
      );
    }
  }

  return {
    groundedNumericClaimCount,
    groundedDateClaimCount,
  };
}

export function validateRecommendationGrounding(
  reportInput: unknown,
  dataInput: ProjectAnalysisData,
  analysisInput: ProjectAnalysisResult,
): RecommendationGroundingResult {
  const data = projectAnalysisDataSchema.parse(dataInput);
  const analysis = projectAnalysisResultSchema.parse(analysisInput);
  const parsedReport = recommendationReportSchema.safeParse(reportInput);
  const issues: GroundingIssue[] = [];

  if (!parsedReport.success) {
    for (const issue of parsedReport.error.issues) {
      addIssue(issues, "SCHEMA_VIOLATION", issue.path.join(".") || "report", issue.message);
    }

    return recommendationGroundingResultSchema.parse({
      valid: false,
      checkedObservationCount: 0,
      checkedRecommendationCount: 0,
      checkedSourceCount: 0,
      groundedNumericClaimCount: 0,
      groundedDateClaimCount: 0,
      issues,
    });
  }

  const report = parsedReport.data;
  const grounding = buildRecommendationGroundingContext(data, analysis);
  const validFacts = new Set(grounding.facts.map(factValueIdentity));
  const impactRefs = new Map(grounding.impactRefs.map((impact) => [impact.impactRef, impact]));
  const workItemsById = new Map(data.workItems.map((workItem) => [workItem.id, workItem]));
  const knownWorkItemIds = new Set(workItemsById.keys());
  const knownWorkItemCodes = new Set(data.workItems.map((workItem) => workItem.code));
  const databaseDates = collectDatabaseDates(data);
  let groundedNumericClaimCount = 0;
  let groundedDateClaimCount = 0;
  let checkedSourceCount = 0;
  const priorityOrder = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  } as const;
  const expectedRiskPosture = deriveRecommendationRiskPosture(
    analysis.issues.map((issue) => issue.severity),
  );

  const scopeChecks: Array<[actual: string, expected: string, path: string]> = [
    [report.tenantId, data.tenantId, "tenantId"],
    [report.projectId, data.projectId, "projectId"],
    [report.projectCode, data.projectCode, "projectCode"],
    [report.projectName, data.projectName, "projectName"],
    [report.asOf, data.asOf, "asOf"],
  ];

  for (const [actual, expected, path] of scopeChecks) {
    if (actual !== expected) {
      addIssue(issues, "SCOPE_MISMATCH", path, `Expected ${expected}, received ${actual}`);
    }
  }

  if (report.riskBrief.posture !== expectedRiskPosture) {
    addIssue(
      issues,
      "RISK_POSTURE_MISMATCH",
      "riskBrief.posture",
      `Expected ${expectedRiskPosture}, received ${report.riskBrief.posture}`,
    );
  }

  const summaryClaims = checkNarrative(
    report.executiveSummary,
    "executiveSummary",
    new Set(),
    new Set(),
    databaseDates,
    knownWorkItemIds,
    knownWorkItemCodes,
    issues,
  );
  groundedNumericClaimCount += summaryClaims.groundedNumericClaimCount;
  groundedDateClaimCount += summaryClaims.groundedDateClaimCount;

  const riskSummaryClaims = checkNarrative(
    report.riskBrief.summary,
    "riskBrief.summary",
    new Set(),
    new Set(),
    databaseDates,
    knownWorkItemIds,
    knownWorkItemCodes,
    issues,
  );
  groundedNumericClaimCount += riskSummaryClaims.groundedNumericClaimCount;
  groundedDateClaimCount += riskSummaryClaims.groundedDateClaimCount;

  const inspectSources = (sources: RecommendationSource[], basePath: string) => {
    const sourceNumbers = new Set<string>();
    const sourceDates = new Set<string>();

    for (const [sourceIndex, source] of sources.entries()) {
      checkedSourceCount += 1;

      if (!validFacts.has(factValueIdentity(source))) {
        addIssue(
          issues,
          "UNKNOWN_SOURCE_FACT",
          `${basePath}.sources.${sourceIndex}`,
          `Source ${source.sourceType}:${source.sourceId}:${source.field} does not exactly match the database and Part 5 fact catalog`,
        );
      }

      const numericValue = numericScalar(source.value);

      if (numericValue !== null) {
        sourceNumbers.add(numericValue);
      }

      if (typeof source.value === "string") {
        for (const variant of dateVariants(source.value)) {
          sourceDates.add(variant);
        }
      }
    }

    return { sourceNumbers, sourceDates };
  };

  report.riskBrief.observations.forEach((observation, index) => {
    const basePath = `riskBrief.observations.${index}`;
    const observationImpacts = observation.impactRefs.flatMap((impactRef) => {
      const impact = impactRefs.get(impactRef);

      if (!impact) {
        addIssue(
          issues,
          "UNKNOWN_IMPACT_REF",
          `${basePath}.impactRefs`,
          `Impact reference ${impactRef} is not a Part 5 issue`,
        );
        return [];
      }

      if (!observation.workItemIds.includes(impact.workItemId)) {
        addIssue(
          issues,
          "IMPACT_WORK_ITEM_MISMATCH",
          `${basePath}.workItemIds`,
          `Impact ${impactRef} belongs to ${impact.workItemId}`,
        );
      }

      return [impact];
    });

    for (const workItemId of observation.workItemIds) {
      if (!knownWorkItemIds.has(workItemId)) {
        addIssue(
          issues,
          "UNKNOWN_WORK_ITEM_ID",
          `${basePath}.workItemIds`,
          `Work item ${workItemId} is outside the project database scope`,
        );
      }
    }

    if (observationImpacts.length > 0) {
      const expectedPriority = observationImpacts.reduce(
        (highest, impact) =>
          priorityOrder[impact.priority] > priorityOrder[highest] ? impact.priority : highest,
        "LOW" as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      );

      if (observation.priority !== expectedPriority) {
        addIssue(
          issues,
          "OBSERVATION_PRIORITY_MISMATCH",
          `${basePath}.priority`,
          `Expected ${expectedPriority} from linked impact severities`,
        );
      }
    }

    const { sourceNumbers, sourceDates } = inspectSources(observation.sources, basePath);

    for (const impactRef of observation.impactRefs) {
      if (
        !observation.sources.some(
          (source) => source.sourceType === "ISSUE" && source.sourceId === impactRef,
        )
      ) {
        addIssue(
          issues,
          "MISSING_IMPACT_SOURCE",
          `${basePath}.sources`,
          `An ISSUE source must reference ${impactRef}`,
        );
      }
    }

    const seriesSourceCount = observation.sources.filter((source) =>
      ["PROGRESS_SNAPSHOT", "COST_ENTRY"].includes(source.sourceType),
    ).length;

    if (observation.kind === "TREND" && seriesSourceCount < 2) {
      addIssue(
        issues,
        "MISSING_TREND_SERIES",
        `${basePath}.sources`,
        "TREND observation requires at least two progress snapshot or cost entry sources",
      );
    }

    if (
      observation.kind === "ROOT_CAUSE" &&
      !observation.sources.some((source) => source.sourceType !== "ISSUE")
    ) {
      addIssue(
        issues,
        "MISSING_ROOT_CAUSE_EVIDENCE",
        `${basePath}.sources`,
        "ROOT_CAUSE observation requires at least one non-ISSUE source",
      );
    }

    if (
      observation.kind === "PATTERN" &&
      observation.impactRefs.length < 2 &&
      seriesSourceCount < 2
    ) {
      addIssue(
        issues,
        "MISSING_PATTERN_EVIDENCE",
        `${basePath}.sources`,
        "PATTERN observation requires multiple impacts or repeated series evidence",
      );
    }

    for (const [field, text] of [
      ["title", observation.title],
      ["summary", observation.summary],
    ] as const) {
      const claims = checkNarrative(
        text,
        `${basePath}.${field}`,
        sourceNumbers,
        sourceDates,
        databaseDates,
        knownWorkItemIds,
        knownWorkItemCodes,
        issues,
      );
      groundedNumericClaimCount += claims.groundedNumericClaimCount;
      groundedDateClaimCount += claims.groundedDateClaimCount;
    }
  });

  report.recommendations.forEach((recommendation, index) => {
    const basePath = `recommendations.${index}`;
    const workItem = workItemsById.get(recommendation.workItemId);
    const impact = impactRefs.get(recommendation.impactRef);

    if (!workItem) {
      addIssue(
        issues,
        "UNKNOWN_WORK_ITEM_ID",
        `${basePath}.workItemId`,
        `Work item ${recommendation.workItemId} is outside the project database scope`,
      );
    } else if (recommendation.workItemName !== workItem.name) {
      addIssue(
        issues,
        "WORK_ITEM_NAME_MISMATCH",
        `${basePath}.workItemName`,
        `Expected exact database name ${workItem.name}`,
      );
    }

    if (!impact) {
      addIssue(
        issues,
        "UNKNOWN_IMPACT_REF",
        `${basePath}.impactRef`,
        `Impact reference ${recommendation.impactRef} is not a Part 5 issue`,
      );
    } else {
      if (impact.workItemId !== recommendation.workItemId) {
        addIssue(
          issues,
          "IMPACT_WORK_ITEM_MISMATCH",
          `${basePath}.impactRef`,
          `Impact ${recommendation.impactRef} belongs to ${impact.workItemId}`,
        );
      }

      if (impact.priority !== recommendation.priority) {
        addIssue(
          issues,
          "IMPACT_PRIORITY_MISMATCH",
          `${basePath}.priority`,
          `Expected ${impact.priority} from Part 5 issue severity`,
        );
      }
    }

    const { sourceNumbers, sourceDates } = inspectSources(recommendation.sources, basePath);

    if (
      !recommendation.sources.some(
        (source) => source.sourceType === "ISSUE" && source.sourceId === recommendation.impactRef,
      )
    ) {
      addIssue(
        issues,
        "MISSING_IMPACT_SOURCE",
        `${basePath}.sources`,
        `At least one ISSUE source must reference ${recommendation.impactRef}`,
      );
    }

    for (const [field, text] of [
      ["title", recommendation.title],
      ["action", recommendation.action],
      ["rationale", recommendation.rationale],
    ] as const) {
      const claims = checkNarrative(
        text,
        `${basePath}.${field}`,
        sourceNumbers,
        sourceDates,
        databaseDates,
        knownWorkItemIds,
        knownWorkItemCodes,
        issues,
      );
      groundedNumericClaimCount += claims.groundedNumericClaimCount;
      groundedDateClaimCount += claims.groundedDateClaimCount;
    }
  });

  return recommendationGroundingResultSchema.parse({
    valid: issues.length === 0,
    checkedObservationCount: report.riskBrief.observations.length,
    checkedRecommendationCount: report.recommendations.length,
    checkedSourceCount,
    groundedNumericClaimCount,
    groundedDateClaimCount,
    issues,
  });
}

export class RecommendationGroundingError extends Error {
  readonly validation: RecommendationGroundingResult;

  constructor(validation: RecommendationGroundingResult) {
    super(`Recommendation grounding failed with ${validation.issues.length} issue(s)`);
    this.name = "RecommendationGroundingError";
    this.validation = validation;
  }
}

export function assertRecommendationGrounded(
  report: RecommendationReport,
  data: ProjectAnalysisData,
  analysis: ProjectAnalysisResult,
) {
  const validation = validateRecommendationGrounding(report, data, analysis);

  if (!validation.valid) {
    throw new RecommendationGroundingError(validation);
  }

  return validation;
}
