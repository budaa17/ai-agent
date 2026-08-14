import { createHash } from "node:crypto";
import { z } from "zod";
import {
  referenceAnswerV1Schema,
  referenceClaimV1Schema,
  type ReferenceAnswerV1,
  type ReferenceClaimV1,
} from "../contracts/agent-outputs.js";
import type { AgentSourceRefV1 } from "../contracts/deterministic-analysis.js";
import {
  authorizationContextSchema,
  getAlertsCore,
  getAttendanceStatsCore,
  getBlockerHistoryCore,
  getConsumptionVsNormCore,
  getProductionProgressHistoryCore,
  getProductionWorkItemsCore,
  getProjectSummaryCore,
  getScheduleForecastCore,
  getStockStatusCore,
  getSubcontractorPerformanceCore,
  productionToolNameSchema,
  searchDailyReportsCore,
  type AuthorizationContext,
  type ProductionReadRepository,
  type ProductionToolMeta,
} from "../production-tools/index.js";

export const a4PolicyActionSchema = z.enum([
  "ANSWER_READ_ONLY",
  "REFUSE_WRITE",
  "REDIRECT_REPORT",
  "INSUFFICIENT",
]);

export const a4QuestionRouteV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    policyAction: a4PolicyActionSchema,
    tools: z.array(productionToolNameSchema).max(11),
    reasonCode: z.enum(["READ_INTENT", "WRITE_INTENT", "DOCUMENT_WORKFLOW_INTENT", "OUT_OF_SCOPE"]),
  })
  .strict()
  .superRefine((route, context) => {
    if (route.policyAction === "ANSWER_READ_ONLY" && route.tools.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A read-only route requires at least one tool",
        path: ["tools"],
      });
    }

    if (route.policyAction !== "ANSWER_READ_ONLY" && route.tools.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Policy routes cannot invoke tools",
        path: ["tools"],
      });
    }
  });

export type A4QuestionRouteV1 = z.infer<typeof a4QuestionRouteV1Schema>;

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

const latinMongolianQuestionAliases: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:tosow|tosov|tusuv|t[oö]s[oö]v)\b/giu, "төсөв"],
  [/\b(?:tugrug|togrog|t[oö]gr[oö]g)\b/giu, "төгрөг"],
  [/\bproject(?:iin|in|yn)\b/giu, "төслийн"],
  [/\b(?:medeelliig|medeeleliig|medeellee|medeelel|medeelee)\b/giu, "мэдээлэл"],
  [/\b(?:yawuul|yavuul|haruul|hel)\b/giu, "харуул"],
];

function normalizeQuestion(question: string) {
  let normalized = question.normalize("NFKC").toLocaleLowerCase().trim();

  for (const [pattern, replacement] of latinMongolianQuestionAliases) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/gu, " ");
}

const writeIntent =
  /\b(?:delete|update|insert|upsert|create|write|approve|reject|patch|post|put|drop|alter|truncate|sql)\b|(?:устга|өөрчил|шинэчил|батал(?!га)|зөвшөөр|цуцал|хадгал|бүртгэ|өгөгдөл\s+оруул|төлөв(?:ийг)?\s+болго)/iu;

const reportWorkflowIntent =
  /(?:(?:тайлан|дүгнэлт|албан\s+бичиг|мэдэгдэл|санамж|шаардлага|pdf|report|letter|document).*(?:гарга|үүсгэ|бэлд|зохио|боловсруул|generate|create|draft))|(?:(?:гарга|үүсгэ|бэлд|зохио|боловсруул|generate|create|draft).*(?:тайлан|дүгнэлт|албан\s+бичиг|мэдэгдэл|санамж|шаардлага|pdf|report|letter|document))/iu;

const toolIntentPatterns: ReadonlyArray<{
  tool: z.infer<typeof productionToolNameSchema>;
  pattern: RegExp;
}> = [
  {
    tool: "searchDailyReports",
    pattern:
      /(?:өдрийн\s+тайлан|daily\s+report).*(?:хай|дурд|бич|search|find)|(?:хай|search|find).*(?:өдрийн\s+тайлан|daily\s+report)/iu,
  },
  {
    tool: "getSubcontractorPerformance",
    pattern: /туслан\s+гүйцэтгэгч|subcontractor|гүйцэтгэгчийн\s+(?:гүйцэтгэл|чанар)/iu,
  },
  {
    tool: "getConsumptionVsNorm",
    pattern:
      /(?:материалын\s+)?норм|зарцуулалт.*(?:хэт|зөр)|consumption.*norm|over[-\s]?consumption/iu,
  },
  {
    tool: "getStockStatus",
    pattern: /агуулах|үлдэгдэл|нөөц|stock|material\s+balance|материалын\s+төлөв/iu,
  },
  {
    tool: "getAttendanceStats",
    pattern: /ирц|хүн[-\s]?цаг|ажиллах\s+хүч|attendance|headcount|labor\s+hours/iu,
  },
  {
    tool: "getBlockerHistory",
    pattern: /саад|гацаа|түгжээ|blocker|impediment|шалтгааны\s+түүх/iu,
  },
  {
    tool: "getAlerts",
    pattern: /дохио|анхааруулга|alert|эрсдэлийн\s+(?:жагсаалт|дохио)/iu,
  },
  {
    tool: "getScheduleForecast",
    pattern:
      /таамаг|тооцоолсон\s+дуус|хоцролт|critical\s+path|критик\s+зам|forecast|projected\s+end/iu,
  },
  {
    tool: "getProgressHistory",
    pattern:
      /явцын\s+түүх|гүйцэтгэлийн\s+түүх|өмнөх\s+явц|сүүлийн\s+явц|progress\s+history|progress\s+trend/iu,
  },
  {
    tool: "getWorkItems",
    pattern: /ажлын\s+жагсаалт|нийт\s+хэдэн\s+ажил|ажлуудын\s+төлөв|work\s*items?|tasks?\s+list/iu,
  },
  {
    tool: "getProjectSummary",
    pattern:
      /төслийн\s+(?:ерөнхий|хураангуй|нэгтгэл|нийт\s+төлөв|мэдээл(?:эл|лийг)?)|project\s+summary|(?:нийт\s+)?(?:төсөв|зардал)|төгрөг/iu,
  },
];

export function routeA4Question(questionInput: string): A4QuestionRouteV1 {
  const question = normalizeQuestion(questionInput);

  if (question.length === 0) {
    throw new Error("A4 question cannot be empty");
  }

  if (writeIntent.test(question)) {
    return a4QuestionRouteV1Schema.parse({
      schemaVersion: 1,
      policyAction: "REFUSE_WRITE",
      tools: [],
      reasonCode: "WRITE_INTENT",
    });
  }

  if (reportWorkflowIntent.test(question)) {
    return a4QuestionRouteV1Schema.parse({
      schemaVersion: 1,
      policyAction: "REDIRECT_REPORT",
      tools: [],
      reasonCode: "DOCUMENT_WORKFLOW_INTENT",
    });
  }

  const tools = toolIntentPatterns
    .filter((candidate) => candidate.pattern.test(question))
    .map((candidate) => candidate.tool);

  if (tools.length === 0) {
    return a4QuestionRouteV1Schema.parse({
      schemaVersion: 1,
      policyAction: "INSUFFICIENT",
      tools: [],
      reasonCode: "OUT_OF_SCOPE",
    });
  }

  return a4QuestionRouteV1Schema.parse({
    schemaVersion: 1,
    policyAction: "ANSWER_READ_ONLY",
    tools: [...new Set(tools)],
    reasonCode: "READ_INTENT",
  });
}

function questionDate(question: string) {
  return question.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
}

function normalizeAsOf(asOf: string | undefined, question: string) {
  if (asOf !== undefined) {
    return asOf;
  }

  const date = questionDate(question);
  return date === undefined ? undefined : `${date}T23:59:59.999Z`;
}

function workItemCode(question: string) {
  return question.toLocaleUpperCase().match(/\b[A-Z]{1,10}-\d{1,8}\b/u)?.[0];
}

function directWorkItemId(question: string) {
  return question.match(/\bwork-item-[A-Za-z0-9._-]+\b/iu)?.[0];
}

function quotedSearchQuery(question: string) {
  const quoted =
    question.match(/["“”](.+?)["“”]/u)?.[1]?.trim() ?? question.match(/'(.+?)'/u)?.[1]?.trim();

  if (quoted) {
    return quoted.slice(0, 500);
  }

  const stopWords = new Set([
    "өдрийн",
    "тайлан",
    "тайлангаас",
    "дотор",
    "хай",
    "дурдсан",
    "эсэхийг",
    "daily",
    "report",
    "search",
    "find",
  ]);
  const candidate = question
    .split(/\s+/u)
    .map((token) => token.replace(/[.,?!:;()[\]{}]/gu, ""))
    .filter((token) => token.length >= 3 && !stopWords.has(token.toLocaleLowerCase()))
    .at(-1);

  return (candidate ?? question).slice(0, 500);
}

function safeSourceRefs(
  meta: ProductionToolMeta,
  options: {
    entityIds?: readonly string[];
    catalogs?: readonly AgentSourceRefV1["catalog"][];
  } = {},
) {
  const entityIds = new Set(options.entityIds ?? []);
  const catalogs = new Set(options.catalogs ?? []);
  const filtered = meta.sourceCatalog.filter(
    (source) =>
      (entityIds.size === 0 || entityIds.has(source.entityId) || entityIds.has(source.sourceId)) &&
      (catalogs.size === 0 || catalogs.has(source.catalog)),
  );
  const selected = filtered.length > 0 ? filtered : meta.sourceCatalog;

  return [...new Map(selected.map((source) => [source.sourceId, source])).values()].slice(0, 30);
}

type ClaimInput = {
  key: string;
  text: string;
  sourceValue: string | number | boolean | null;
  asOf: string;
  sourceRefs: readonly AgentSourceRefV1[];
};

function claim(input: ClaimInput): ReferenceClaimV1 | null {
  if (input.sourceRefs.length === 0) {
    return null;
  }

  return referenceClaimV1Schema.parse({
    claimId: stableId("a4-claim", `${input.key}:${input.asOf}:${String(input.sourceValue)}`),
    text: input.text,
    status: "SUPPORTED",
    sourceValue: input.sourceValue,
    asOf: input.asOf,
    sourceRefs: input.sourceRefs,
  });
}

function pushClaim(claims: ReferenceClaimV1[], input: ClaimInput) {
  const parsed = claim(input);

  if (parsed !== null) {
    claims.push(parsed);
  }
}

function nonAnsweredAnswer(input: {
  question: string;
  context: AuthorizationContext;
  projectId: string;
  generatedAt: string;
  status: "INSUFFICIENT_EVIDENCE" | "REFUSED_WRITE_ACTION" | "REDIRECT_REPORT_WORKFLOW";
  answer: string;
  suggestedRouteCode: string | null;
}) {
  return referenceAnswerV1Schema.parse({
    schemaVersion: 1,
    artifactType: "REFERENCE_ANSWER",
    answerId: stableId(
      "a4-answer",
      `${input.context.tenantId}:${input.projectId}:${input.question}:${input.status}`,
    ),
    tenantId: input.context.tenantId,
    projectId: input.projectId,
    snapshotId: stableId("a4-scope", `${input.context.tenantId}:${input.projectId}`),
    generatedAt: input.generatedAt,
    question: input.question,
    answer: input.answer,
    status: input.status,
    suggestedRouteCode: input.suggestedRouteCode,
    claims: [],
    inspectedTools: [],
    insufficientData: input.status === "INSUFFICIENT_EVIDENCE",
    readOnly: true,
  });
}

export type AskProductionA4Input = {
  repository: ProductionReadRepository;
  context: AuthorizationContext;
  projectId: string;
  question: string;
  asOf?: string;
  generatedAt?: string;
};

export async function askProductionA4(input: AskProductionA4Input): Promise<ReferenceAnswerV1> {
  const context = authorizationContextSchema.parse(input.context);
  const question = input.question.trim();
  const route = routeA4Question(question);
  const generatedAt = input.generatedAt ?? input.asOf ?? new Date().toISOString();

  if (route.policyAction === "REFUSE_WRITE") {
    return nonAnsweredAnswer({
      question,
      context,
      projectId: input.projectId,
      generatedAt,
      status: "REFUSED_WRITE_ACTION",
      answer: "A4 нь зөвхөн унших эрхтэй тул өгөгдөл өөрчлөх, батлах, устгах үйлдэл хийхгүй.",
      suggestedRouteCode: "AUTHORIZED_WRITE_WORKFLOW",
    });
  }

  if (route.policyAction === "REDIRECT_REPORT") {
    return nonAnsweredAnswer({
      question,
      context,
      projectId: input.projectId,
      generatedAt,
      status: "REDIRECT_REPORT_WORKFLOW",
      answer:
        "Тайлан болон албан баримтын нооргийг A3 баримт бичгийн workflow-оор үүсгэн хянуулна.",
      suggestedRouteCode: "A3_DOCUMENT_DRAFT",
    });
  }

  if (route.policyAction === "INSUFFICIENT") {
    return nonAnsweredAnswer({
      question,
      context,
      projectId: input.projectId,
      generatedAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: "Энэ асуулт A4-ийн зөвшөөрөгдсөн төслийн лавлагааны хүрээнд танигдсангүй.",
      suggestedRouteCode: "CLARIFY_PROJECT_QUESTION",
    });
  }

  let asOf = normalizeAsOf(input.asOf, question);
  const requestedDate = input.asOf === undefined ? questionDate(question) : undefined;

  if (requestedDate !== undefined) {
    const latest = await input.repository.findProjectSnapshot(context, input.projectId);

    if (latest !== null && latest.asOf.slice(0, 10) === requestedDate) {
      asOf = latest.asOf;
    }
  }
  const claims: ReferenceClaimV1[] = [];
  const inspectedTools: z.infer<typeof productionToolNameSchema>[] = [];
  let resolvedWorkItemId = directWorkItemId(question);
  const code = workItemCode(question);

  try {
    if (
      code !== undefined &&
      route.tools.some((tool) =>
        [
          "getProgressHistory",
          "getConsumptionVsNorm",
          "getAttendanceStats",
          "getBlockerHistory",
        ].includes(tool),
      )
    ) {
      const lookup = await getProductionWorkItemsCore(input.repository, context, {
        projectId: input.projectId,
        asOf,
        limit: 200,
      });
      inspectedTools.push("getWorkItems");
      resolvedWorkItemId = lookup.items.find(
        (item) => item.code.toLocaleUpperCase() === code,
      )?.workItemId;
    }

    for (const tool of route.tools) {
      if (tool === "getProjectSummary") {
        const result = await getProjectSummaryCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
        });
        inspectedTools.push(tool);
        const refs = safeSourceRefs(result.meta);
        pushClaim(claims, {
          key: `${tool}:projectName`,
          text: `Төслийн нэр ${result.summary.projectName}.`,
          sourceValue: result.summary.projectName,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:projectCode`,
          text: `Төслийн код ${result.summary.projectCode}.`,
          sourceValue: result.summary.projectCode,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:projectStatus`,
          text: `Төслийн төлөв ${result.summary.projectStatus}.`,
          sourceValue: result.summary.projectStatus,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:workItemCount`,
          text: `Төсөл нийт ${result.summary.workItemCount} ажилтай.`,
          sourceValue: result.summary.workItemCount,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:projectedEndDate`,
          text: `Тооцоолсон дуусах огноо ${result.summary.projectedEndDate}.`,
          sourceValue: result.summary.projectedEndDate,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:averageProgressPercent`,
          text: `Дундаж гүйцэтгэл ${result.summary.averageProgressPercent}%.`,
          sourceValue: result.summary.averageProgressPercent,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:plannedBudgetMnt`,
          text: `Нийт төлөвлөсөн төсөв ${result.summary.plannedBudgetMnt} ₮.`,
          sourceValue: result.summary.plannedBudgetMnt,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:actualCostMnt`,
          text: `Бодит зардал ${result.summary.actualCostMnt} ₮.`,
          sourceValue: result.summary.actualCostMnt,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:openAlertCount`,
          text: `Нээлттэй эрсдэлийн дохио ${result.summary.openAlertCount}.`,
          sourceValue: result.summary.openAlertCount,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
      } else if (tool === "getWorkItems") {
        const result = await getProductionWorkItemsCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          limit: 200,
        });
        inspectedTools.push(tool);
        const selected =
          code === undefined
            ? undefined
            : result.items.find((item) => item.code.toLocaleUpperCase() === code);

        if (selected === undefined) {
          pushClaim(claims, {
            key: `${tool}:count`,
            text: `Шүүлтэд ${result.meta.rowCount} ажил байна.`,
            sourceValue: result.meta.rowCount,
            asOf: result.meta.asOf,
            sourceRefs: safeSourceRefs(result.meta, {
              catalogs: ["WORK_ITEM"],
            }),
          });
        } else {
          resolvedWorkItemId = selected.workItemId;
          const refs = safeSourceRefs(result.meta, {
            entityIds: [selected.workItemId],
          });
          pushClaim(claims, {
            key: `${tool}:${selected.workItemId}:status`,
            text: `${selected.code} ажлын төлөв ${selected.status}.`,
            sourceValue: selected.status,
            asOf: result.meta.asOf,
            sourceRefs: refs,
          });
          pushClaim(claims, {
            key: `${tool}:${selected.workItemId}:progress`,
            text: `${selected.code} ажлын гүйцэтгэл ${selected.progressPercent}%.`,
            sourceValue: selected.progressPercent,
            asOf: result.meta.asOf,
            sourceRefs: refs,
          });
        }
      } else if (tool === "getProgressHistory") {
        const result = await getProductionProgressHistoryCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          workItemIds: resolvedWorkItemId === undefined ? undefined : [resolvedWorkItemId],
          limit: 50,
        });
        inspectedTools.push(tool);
        const latest = result.items[0];

        if (latest !== undefined) {
          pushClaim(claims, {
            key: `${tool}:${latest.progressEntryId}`,
            text: `Сүүлийн баталгаажсан явц ${latest.progressPercent}%.`,
            sourceValue: latest.progressPercent,
            asOf: result.meta.asOf,
            sourceRefs: safeSourceRefs(result.meta, {
              entityIds: [latest.progressEntryId],
            }),
          });
        }
      } else if (tool === "getStockStatus") {
        const result = await getStockStatusCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          limit: 50,
        });
        inspectedTools.push(tool);
        const critical = result.items.find((item) => item.status === "CRITICAL");
        pushClaim(claims, {
          key: `${tool}:criticalCount`,
          text: `${result.summary.criticalCount} материалын нөөц critical төлөвтэй.`,
          sourceValue: result.summary.criticalCount,
          asOf: result.meta.asOf,
          sourceRefs: safeSourceRefs(result.meta, {
            entityIds: critical === undefined ? [] : [critical.materialId],
            catalogs: ["STOCK"],
          }),
        });
      } else if (tool === "getConsumptionVsNorm") {
        const result = await getConsumptionVsNormCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          workItemIds: resolvedWorkItemId === undefined ? undefined : [resolvedWorkItemId],
          limit: 50,
        });
        inspectedTools.push(tool);
        pushClaim(claims, {
          key: `${tool}:overNormCount`,
          text: `${result.summary.overNormCount} материалын зарцуулалт нормоос хэтэрсэн.`,
          sourceValue: result.summary.overNormCount,
          asOf: result.meta.asOf,
          sourceRefs: safeSourceRefs(result.meta),
        });
      } else if (tool === "getAttendanceStats") {
        const result = await getAttendanceStatsCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          workItemIds: resolvedWorkItemId === undefined ? undefined : [resolvedWorkItemId],
          limit: 50,
        });
        inspectedTools.push(tool);
        pushClaim(claims, {
          key: `${tool}:totalHours`,
          text: `Баталгаажсан ирцийн нийт хэмжээ ${result.summary.totalHours} хүн-цаг.`,
          sourceValue: result.summary.totalHours,
          asOf: result.meta.asOf,
          sourceRefs: safeSourceRefs(result.meta, {
            catalogs: ["ATTENDANCE"],
          }),
        });
      } else if (tool === "getBlockerHistory") {
        const result = await getBlockerHistoryCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          workItemIds: resolvedWorkItemId === undefined ? undefined : [resolvedWorkItemId],
          limit: 50,
        });
        inspectedTools.push(tool);
        pushClaim(claims, {
          key: `${tool}:openCount`,
          text: `${result.summary.openCount} саад нээлттэй байна.`,
          sourceValue: result.summary.openCount,
          asOf: result.meta.asOf,
          sourceRefs: safeSourceRefs(result.meta, {
            catalogs: ["BLOCKER"],
          }),
        });
      } else if (tool === "getAlerts") {
        const result = await getAlertsCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          limit: 50,
        });
        inspectedTools.push(tool);
        pushClaim(claims, {
          key: `${tool}:openCount`,
          text: `${result.summary.openCount} эрсдэлийн дохио хаагдаагүй байна.`,
          sourceValue: result.summary.openCount,
          asOf: result.meta.asOf,
          sourceRefs: safeSourceRefs(result.meta, {
            catalogs: ["ALERT"],
          }),
        });
      } else if (tool === "getScheduleForecast") {
        const result = await getScheduleForecastCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          limit: 50,
        });
        inspectedTools.push(tool);
        const refs = safeSourceRefs(result.meta);
        pushClaim(claims, {
          key: `${tool}:projectedEndDate`,
          text: `Тооцоолсон дуусах огноо ${result.summary.projectedEndDate}.`,
          sourceValue: result.summary.projectedEndDate,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
        pushClaim(claims, {
          key: `${tool}:delayWorkingDays`,
          text: `Суурь төлөвлөгөөтэй харьцуулахад ${result.summary.delayWorkingDays} ажлын өдрийн зөрүүтэй.`,
          sourceValue: result.summary.delayWorkingDays,
          asOf: result.meta.asOf,
          sourceRefs: refs,
        });
      } else if (tool === "getSubcontractorPerformance") {
        const result = await getSubcontractorPerformanceCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          limit: 50,
        });
        inspectedTools.push(tool);
        const delayed = result.items.find((item) => item.performanceStatus === "DELAYED");

        if (delayed !== undefined) {
          pushClaim(claims, {
            key: `${tool}:${delayed.subcontractorId}`,
            text: `${delayed.name} туслан гүйцэтгэгчийн төлөв ${delayed.performanceStatus}.`,
            sourceValue: delayed.performanceStatus,
            asOf: result.meta.asOf,
            sourceRefs: safeSourceRefs(result.meta, {
              entityIds: [delayed.subcontractorId],
            }),
          });
        } else {
          pushClaim(claims, {
            key: `${tool}:delayedCount`,
            text: `${result.summary.delayedCount} туслан гүйцэтгэгч хоцролттой.`,
            sourceValue: result.summary.delayedCount,
            asOf: result.meta.asOf,
            sourceRefs: safeSourceRefs(result.meta),
          });
        }
      } else if (tool === "searchDailyReports") {
        const result = await searchDailyReportsCore(input.repository, context, {
          projectId: input.projectId,
          asOf,
          query: quotedSearchQuery(question),
          limit: 20,
        });
        inspectedTools.push(tool);
        pushClaim(claims, {
          key: `${tool}:matchedReportCount`,
          text: `Өдрийн тайлангийн хайлтаар ${result.summary.matchedReportCount} тайлан таарсан.`,
          sourceValue: result.summary.matchedReportCount,
          asOf: result.meta.asOf,
          sourceRefs: safeSourceRefs(result.meta, {
            catalogs: ["DAILY_REPORT"],
          }),
        });
      }
    }

    if (claims.length === 0) {
      return nonAnsweredAnswer({
        question,
        context,
        projectId: input.projectId,
        generatedAt,
        status: "INSUFFICIENT_EVIDENCE",
        answer: "Энэ асуултад эх сурвалжтай хариулах хангалттай зөвшөөрөгдсөн өгөгдөл олдсонгүй.",
        suggestedRouteCode: "REQUEST_MORE_PROJECT_DATA",
      });
    }

    const snapshot = await input.repository.findProjectSnapshot(context, input.projectId, asOf);

    if (snapshot === null) {
      throw new Error("Authorized snapshot disappeared");
    }

    return referenceAnswerV1Schema.parse({
      schemaVersion: 1,
      artifactType: "REFERENCE_ANSWER",
      answerId: stableId(
        "a4-answer",
        `${context.tenantId}:${input.projectId}:${question}:${snapshot.snapshotId}`,
      ),
      tenantId: context.tenantId,
      projectId: input.projectId,
      snapshotId: snapshot.snapshotId,
      generatedAt,
      question,
      answer: claims.map((item) => item.text).join("\n"),
      status: "ANSWERED",
      suggestedRouteCode: null,
      claims,
      inspectedTools: [...new Set(inspectedTools)],
      insufficientData: false,
      readOnly: true,
    });
  } catch {
    return nonAnsweredAnswer({
      question,
      context,
      projectId: input.projectId,
      generatedAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: "Энэ төсөл эсвэл шаардлагатай мэдээлэл таны зөвшөөрөгдсөн унших хүрээнд олдсонгүй.",
      suggestedRouteCode: "VERIFY_ACCESS_OR_DATA",
    });
  }
}
