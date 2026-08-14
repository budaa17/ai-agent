import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ArtifactRetentionV1, ArtifactStore, MalwareScanner } from "../artifacts/index.js";
import {
  documentBundleV1Schema,
  documentDraftV1Schema,
  type DocumentBundleV1,
  type DocumentDraftV1,
  type RecommendationDraftV1,
} from "../contracts/agent-outputs.js";
import { contractIdentifierSchema, contractIsoDateTimeSchema } from "../contracts/common.js";
import {
  agentSourceRefV1Schema,
  deterministicAnalysisV1Schema,
  type AgentSourceRefV1,
  type DeterministicAnalysisV1,
} from "../contracts/deterministic-analysis.js";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";
import {
  analyzeProjectSnapshot,
  centsToMoney,
  moneyToCents,
} from "../production-analysis/index.js";
import { compareDrafts, draftComparisonSchema } from "../reporting/draft.js";

const deterministicFactValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const a3DeterministicFactV1Schema = z
  .object({
    factId: contractIdentifierSchema,
    category: z.enum([
      "PERIOD",
      "WORK",
      "SCHEDULE",
      "MATERIAL",
      "ATTENDANCE",
      "COST",
      "RISK",
      "NEXT_PLAN",
    ]),
    label: z.string().trim().min(1).max(300),
    value: deterministicFactValueSchema,
    rendered: z.string().trim().min(1).max(2_000),
    sourceRefs: z.array(agentSourceRefV1Schema).min(1).max(500),
  })
  .strict();

export const a3ProductionResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: contractIdentifierSchema,
    requestId: contractIdentifierSchema,
    snapshotId: contractIdentifierSchema,
    analysisId: contractIdentifierSchema,
    generatedAt: contractIsoDateTimeSchema,
    facts: z.array(a3DeterministicFactV1Schema).min(1).max(10_000),
    bundle: documentBundleV1Schema,
    aiStatus: z.enum(["NOT_REQUESTED", "COMPLETED", "AI_UNAVAILABLE"]),
    aiError: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.bundle.snapshotId !== result.snapshotId) {
      context.addIssue({
        code: "custom",
        message: "A3 bundle must use the production result snapshot",
        path: ["bundle", "snapshotId"],
      });
    }

    if (result.bundle.analysisId !== result.analysisId) {
      context.addIssue({
        code: "custom",
        message: "A3 bundle must use the production result analysis",
        path: ["bundle", "analysisId"],
      });
    }
  });

export type A3DeterministicFactV1 = z.infer<typeof a3DeterministicFactV1Schema>;
export type A3ProductionResultV1 = z.infer<typeof a3ProductionResultV1Schema>;

export interface A3NarrativeGateway {
  enrich(input: {
    snapshot: ProjectAnalysisSnapshotV1;
    analysis: DeterministicAnalysisV1;
    facts: readonly A3DeterministicFactV1[];
    documents: readonly DocumentDraftV1[];
    styleMemory: A3StyleMemoryV1 | null;
  }): Promise<Readonly<Record<string, string>>>;
}

export type RunProductionA3Input = {
  snapshot: ProjectAnalysisSnapshotV1;
  analysis?: DeterministicAnalysisV1;
  recommendations?: readonly RecommendationDraftV1[];
  requestId: string;
  generatedAt?: string;
  periodFrom?: string;
  periodTo?: string;
  language?: "mn" | "en" | "mixed";
  styleMemory?: A3StyleMemoryV1;
  narrativeGateway?: A3NarrativeGateway;
};

export const a3StyleMemoryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    styleProfileId: contractIdentifierSchema,
    companyName: z.string().trim().min(1).max(500),
    reportTemplateName: z.string().trim().min(1).max(200),
    terminology: z.record(z.string().trim().min(1).max(200), z.string().trim().min(1).max(500)),
    approvedPatternSnippets: z.array(z.string().trim().min(1).max(2_000)).max(20),
    logoPlaceholder: z.string().trim().min(1).max(200),
    signaturePlaceholder: z.string().trim().min(1).max(200),
    recipientStyle: z.string().trim().min(1).max(1_000),
    prohibitedClaims: z.array(z.string().trim().min(2).max(500)).max(100),
  })
  .strict();

export type A3StyleMemoryV1 = z.infer<typeof a3StyleMemoryV1Schema>;

export function assertA3ProhibitedClaims(
  documents: readonly DocumentDraftV1[],
  styleMemory: A3StyleMemoryV1,
) {
  const style = a3StyleMemoryV1Schema.parse(styleMemory);

  for (const document of documents) {
    const normalized = document.markdown.toLocaleLowerCase("mn-MN");
    const matched = style.prohibitedClaims.find((claim) =>
      normalized.includes(claim.toLocaleLowerCase("mn-MN")),
    );

    if (matched !== undefined) {
      throw new Error(`A3 prohibited claim detected in ${document.documentId}: ${matched}`);
    }
  }
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function uniqueSources(sources: readonly AgentSourceRefV1[]) {
  return [...new Map(sources.map((source) => [source.sourceId, source])).values()]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    .slice(0, 500);
}

function selectSources(
  analysis: DeterministicAnalysisV1,
  catalogs: readonly AgentSourceRefV1["catalog"][],
  sourceIds: readonly string[] = [],
) {
  const catalogSet = new Set(catalogs);
  const sourceIdSet = new Set(sourceIds);
  const selected = analysis.sourceCatalog.filter(
    (source) =>
      catalogSet.has(source.catalog) ||
      sourceIdSet.has(source.sourceId) ||
      sourceIdSet.has(source.entityId),
  );

  if (selected.length > 0) {
    return uniqueSources(selected);
  }

  return uniqueSources(
    analysis.sourceCatalog.filter(
      (source) => source.catalog === "BASELINE" || source.catalog === "WORK_ITEM",
    ),
  );
}

function dateDaysBefore(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function latestProgressByWorkItem(snapshot: ProjectAnalysisSnapshotV1) {
  const latest = new Map<string, ProjectAnalysisSnapshotV1["progressEntries"][number]>();

  for (const entry of snapshot.progressEntries) {
    const current = latest.get(entry.workItemId);

    if (current === undefined || Date.parse(entry.capturedAt) > Date.parse(current.capturedAt)) {
      latest.set(entry.workItemId, entry);
    }
  }

  return latest;
}

function formatMoney(value: string) {
  const [whole, decimal] = value.split(".");
  return `${BigInt(whole!).toLocaleString("en-US")}.${decimal} ₮`;
}

function sumMoney(values: readonly string[]) {
  return centsToMoney(values.reduce((total, value) => total + moneyToCents(value), 0n));
}

function fact(
  snapshot: ProjectAnalysisSnapshotV1,
  category: A3DeterministicFactV1["category"],
  label: string,
  value: A3DeterministicFactV1["value"],
  rendered: string,
  sources: readonly AgentSourceRefV1[],
) {
  return a3DeterministicFactV1Schema.parse({
    factId: stableId("a3-fact", `${snapshot.snapshotId}:${category}:${label}:${String(value)}`),
    category,
    label,
    value,
    rendered,
    sourceRefs: uniqueSources(sources),
  });
}

export function buildA3DeterministicFacts(
  snapshotInput: ProjectAnalysisSnapshotV1,
  analysisInput?: DeterministicAnalysisV1,
): A3DeterministicFactV1[] {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const analysis = deterministicAnalysisV1Schema.parse(
    analysisInput ?? analyzeProjectSnapshot(snapshot),
  );

  if (
    analysis.tenantId !== snapshot.tenantId ||
    analysis.projectId !== snapshot.projectId ||
    analysis.snapshotId !== snapshot.snapshotId
  ) {
    throw new Error("A3 analysis scope does not match the snapshot");
  }

  const baselineSources = selectSources(analysis, ["BASELINE"]);
  const workSources = selectSources(analysis, ["WORK_ITEM"]);
  const progressSources = selectSources(analysis, ["WORK_ITEM", "PROGRESS", "DAILY_REPORT"]);
  const scheduleSources = selectSources(analysis, [
    "BASELINE",
    "WORK_ITEM",
    "DEPENDENCY",
    "PROGRESS",
    "FORECAST",
  ]);
  const materialSources = selectSources(analysis, ["STOCK"]);
  const attendanceSources = selectSources(analysis, ["ATTENDANCE", "DAILY_REPORT"]);
  const costSources = selectSources(analysis, ["COST", "BASELINE"]);
  const riskSourceIds = analysis.deviations.flatMap((deviation) => deviation.sourceIds);
  const riskSources = selectSources(analysis, ["ALERT", "BLOCKER"], riskSourceIds);
  const latestProgress = latestProgressByWorkItem(snapshot);
  const completedCount = snapshot.workItems.filter(
    (workItem) => workItem.status === "COMPLETED",
  ).length;
  const activeCount = snapshot.workItems.filter((workItem) =>
    ["IN_PROGRESS", "BLOCKED"].includes(workItem.status),
  ).length;
  const averageProgress =
    latestProgress.size === 0
      ? 0
      : [...latestProgress.values()].reduce((total, entry) => total + entry.progressPercent, 0) /
        latestProgress.size;
  const totalAttendanceHours = snapshot.attendanceEntries.reduce(
    (total, entry) => total + entry.totalHours,
    0,
  );
  const actualCost = sumMoney(snapshot.costEntries.map((entry) => entry.amountMnt));
  const issuedMovements = snapshot.stockMovements.filter((movement) => movement.kind === "ISSUE");
  const openBlockers = snapshot.blockers.filter((blocker) => blocker.resolvedAt === null);
  const openAlerts = snapshot.alerts.filter((alert) => alert.status !== "CLOSED");
  const nextItems = snapshot.workItems
    .filter((workItem) => workItem.status !== "COMPLETED" && workItem.status !== "CANCELLED")
    .sort(
      (left, right) =>
        left.plannedStart.localeCompare(right.plannedStart) ||
        left.displayOrder - right.displayOrder,
    )
    .slice(0, 5);

  return [
    fact(
      snapshot,
      "PERIOD",
      "Тайлангийн огноо",
      snapshot.asOf.slice(0, 10),
      `Тайлангийн огноо: ${snapshot.asOf.slice(0, 10)}.`,
      baselineSources,
    ),
    fact(
      snapshot,
      "WORK",
      "Нийт ажлын тоо",
      snapshot.workItems.length,
      `Нийт ${snapshot.workItems.length} ажил бүртгэлтэй.`,
      workSources,
    ),
    fact(
      snapshot,
      "WORK",
      "Дууссан ажлын тоо",
      completedCount,
      `${completedCount} ажил дууссан.`,
      workSources,
    ),
    fact(
      snapshot,
      "WORK",
      "Идэвхтэй ажлын тоо",
      activeCount,
      `${activeCount} ажил гүйцэтгэлтэй эсвэл саатсан төлөвтэй.`,
      workSources,
    ),
    fact(
      snapshot,
      "WORK",
      "Дундаж баталгаажсан гүйцэтгэл",
      Number(averageProgress.toFixed(2)),
      `Сүүлийн баталгаажсан бичлэгүүдийн дундаж гүйцэтгэл ${averageProgress.toFixed(2)}%.`,
      progressSources,
    ),
    fact(
      snapshot,
      "SCHEDULE",
      "Суурь дуусах огноо",
      analysis.forecast.baselineEndDate,
      `Суурь төлөвлөгөөний дуусах огноо ${analysis.forecast.baselineEndDate}.`,
      scheduleSources,
    ),
    fact(
      snapshot,
      "SCHEDULE",
      "Тооцоолсон дуусах огноо",
      analysis.forecast.projectedEndDate,
      `Тооцоолсон дуусах огноо ${analysis.forecast.projectedEndDate}.`,
      scheduleSources,
    ),
    fact(
      snapshot,
      "SCHEDULE",
      "Ажлын өдрийн зөрүү",
      analysis.forecast.delayWorkingDays,
      `Хуваарийн тооцоолсон зөрүү ${analysis.forecast.delayWorkingDays} ажлын өдөр.`,
      scheduleSources,
    ),
    fact(
      snapshot,
      "MATERIAL",
      "Материалын зарлагын бичлэг",
      issuedMovements.length,
      `Материалын ${issuedMovements.length} зарлагын бичлэг байна.`,
      materialSources,
    ),
    fact(
      snapshot,
      "ATTENDANCE",
      "Нийт хүн-цаг",
      Number(totalAttendanceHours.toFixed(2)),
      `Баталгаажсан ирцийн нийт хэмжээ ${totalAttendanceHours.toFixed(2)} хүн-цаг.`,
      attendanceSources,
    ),
    fact(
      snapshot,
      "COST",
      "Бодит зардал",
      actualCost,
      `Бүртгэгдсэн бодит зардал ${formatMoney(actualCost)}.`,
      costSources,
    ),
    fact(
      snapshot,
      "COST",
      "Батлагдсан төсөв",
      snapshot.activeBaseline.budgetMnt,
      `Батлагдсан төсөв ${formatMoney(snapshot.activeBaseline.budgetMnt)}.`,
      baselineSources,
    ),
    fact(
      snapshot,
      "RISK",
      "Илэрсэн зөрчил",
      analysis.deviations.length,
      `Детерминистик шинжилгээгээр ${analysis.deviations.length} зөрчил илэрсэн.`,
      riskSources,
    ),
    fact(
      snapshot,
      "RISK",
      "Нээлттэй саад",
      openBlockers.length,
      `${openBlockers.length} саад шийдэгдээгүй байна.`,
      selectSources(analysis, ["BLOCKER"]),
    ),
    fact(
      snapshot,
      "RISK",
      "Нээлттэй дохио",
      openAlerts.length,
      `${openAlerts.length} дохио хаагдаагүй байна.`,
      selectSources(analysis, ["ALERT"]),
    ),
    fact(
      snapshot,
      "NEXT_PLAN",
      "Дараагийн ажлууд",
      nextItems.map((workItem) => workItem.code).join(", ") || "NONE",
      nextItems.length === 0
        ? "Дараагийн нээлттэй ажил бүртгэгдээгүй."
        : `Дараагийн хяналтын ажлууд: ${nextItems
            .map((workItem) => `${workItem.code} ${workItem.name} (${workItem.plannedStart})`)
            .join("; ")}.`,
      selectSources(
        analysis,
        ["WORK_ITEM"],
        nextItems.map((workItem) => workItem.workItemId),
      ),
    ),
  ];
}

function section(title: string, facts: readonly A3DeterministicFactV1[]) {
  return [`## ${title}`, "", ...facts.map((item) => `- ${item.rendered}`), ""].join("\n");
}

function factsByCategory(
  facts: readonly A3DeterministicFactV1[],
  categories: readonly A3DeterministicFactV1["category"][],
) {
  const allowed = new Set(categories);
  return facts.filter((item) => allowed.has(item.category));
}

function sourceRefsForFacts(facts: readonly A3DeterministicFactV1[]) {
  return uniqueSources(facts.flatMap((item) => item.sourceRefs));
}

function recommendationLines(recommendations: readonly RecommendationDraftV1[]) {
  if (recommendations.length === 0) {
    return ["- Батлуулахаар хүлээгдэж буй зөвлөмж алга."];
  }

  return recommendations.map(
    (recommendation) =>
      `- ${recommendation.title}: ${recommendation.actions
        .map((action) => action.title)
        .join("; ")} (хүний хяналт шаардлагатай).`,
  );
}

function document(
  input: Omit<
    DocumentDraftV1,
    "sourceRefs" | "deterministicFactCount" | "unsupportedClaimCount" | "outputArtifact" | "status"
  > & {
    facts: readonly A3DeterministicFactV1[];
    extraSources?: readonly AgentSourceRefV1[];
  },
) {
  return documentDraftV1Schema.parse({
    documentId: input.documentId,
    documentType: input.documentType,
    title: input.title,
    language: input.language,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    markdown: input.markdown,
    sourceRefs: uniqueSources([...sourceRefsForFacts(input.facts), ...(input.extraSources ?? [])]),
    deterministicFactCount: input.facts.length,
    styleProfileRef: input.styleProfileRef,
    unsupportedClaimCount: 0,
    outputArtifact: null,
    status: "PENDING_REVIEW",
  });
}

function composeDocuments(input: {
  snapshot: ProjectAnalysisSnapshotV1;
  analysis: DeterministicAnalysisV1;
  facts: readonly A3DeterministicFactV1[];
  recommendations: readonly RecommendationDraftV1[];
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  language: "mn" | "en" | "mixed";
  styleProfileRef: string | null;
}) {
  const {
    snapshot,
    analysis,
    facts,
    recommendations,
    periodFrom,
    periodTo,
    language,
    styleProfileRef,
  } = input;
  const base = `${snapshot.snapshotId}:${periodFrom}:${periodTo}`;
  const periodFacts = factsByCategory(facts, ["PERIOD"]);
  const workFacts = factsByCategory(facts, ["WORK"]);
  const scheduleFacts = factsByCategory(facts, ["SCHEDULE"]);
  const materialFacts = factsByCategory(facts, ["MATERIAL"]);
  const attendanceFacts = factsByCategory(facts, ["ATTENDANCE"]);
  const costFacts = factsByCategory(facts, ["COST"]);
  const riskFacts = factsByCategory(facts, ["RISK"]);
  const nextFacts = factsByCategory(facts, ["NEXT_PLAN"]);
  const reportFacts = [
    ...periodFacts,
    ...workFacts,
    ...scheduleFacts,
    ...materialFacts,
    ...attendanceFacts,
    ...costFacts,
    ...riskFacts,
    ...nextFacts,
  ];
  const deviations = analysis.deviations;
  const deviationLines =
    deviations.length === 0
      ? ["- Баталгаажсан зөрчил илрээгүй."]
      : deviations.map(
          (deviation) => `- [${deviation.severity}] ${deviation.title}: ${deviation.explanation}`,
        );
  const subcontractorDeviationIds = deviations
    .filter((deviation) => deviation.subcontractorId !== null)
    .flatMap((deviation) => deviation.sourceIds);
  const supplierDeviationIds = deviations
    .filter((deviation) => ["STOCK_SHORTAGE", "MATERIAL_OVERUSE"].includes(deviation.ruleId))
    .flatMap((deviation) => deviation.sourceIds);

  return [
    document({
      documentId: stableId("a3-weekly", base),
      documentType: "WEEKLY_REPORT",
      title: `${snapshot.projectName} — долоо хоногийн тайлан`,
      language,
      periodFrom,
      periodTo,
      styleProfileRef,
      facts: reportFacts,
      markdown: [
        `# ${snapshot.projectName} — долоо хоногийн тайлан`,
        "",
        `Тайлант хугацаа: ${periodFrom} — ${periodTo}`,
        "",
        section("Ажлын гүйцэтгэл", [...periodFacts, ...workFacts]),
        section("Хуваарь", scheduleFacts),
        section("Материал, ирц ба зардал", [...materialFacts, ...attendanceFacts, ...costFacts]),
        section("Эрсдэл", riskFacts),
        "## Зөвлөмжийн ноорог",
        "",
        ...recommendationLines(recommendations),
        "",
        section("Дараагийн хяналт", nextFacts),
        "_Энэ нь хүний хяналт, баталгаажуулалт шаардлагатай ноорог._",
        "",
      ].join("\n"),
    }),
    document({
      documentId: stableId("a3-monthly", base),
      documentType: "MONTHLY_REPORT",
      title: `${snapshot.projectName} — сарын тайлан`,
      language,
      periodFrom,
      periodTo,
      styleProfileRef,
      facts: reportFacts,
      markdown: [
        `# ${snapshot.projectName} — сарын тайлан`,
        "",
        `Тайлант хугацаа: ${periodFrom} — ${periodTo}`,
        "",
        section("Ерөнхий гүйцэтгэл", [...periodFacts, ...workFacts]),
        section("Хуваарь ба таамаг", scheduleFacts),
        section("Нөөц ба санхүү", [...materialFacts, ...attendanceFacts, ...costFacts]),
        section("Хяналтын үр дүн", riskFacts),
        section("Дараагийн хугацааны төлөвлөгөө", nextFacts),
        "_Энэ нь хүний хяналт, баталгаажуулалт шаардлагатай ноорог._",
        "",
      ].join("\n"),
    }),
    document({
      documentId: stableId("a3-deviation", base),
      documentType: "DEVIATION_CONCLUSION",
      title: `${snapshot.projectName} — зөрчлийн дүгнэлт`,
      language,
      periodFrom,
      periodTo,
      styleProfileRef,
      facts: [...scheduleFacts, ...riskFacts],
      extraSources: selectSources(
        analysis,
        ["ALERT", "BLOCKER"],
        deviations.flatMap((deviation) => deviation.sourceIds),
      ),
      markdown: [
        `# ${snapshot.projectName} — зөрчлийн дүгнэлт`,
        "",
        section("Хуваарийн баталгаажсан тооцоо", scheduleFacts),
        section("Эрсдэлийн тоон нэгтгэл", riskFacts),
        "## Илэрсэн зөрчлүүд",
        "",
        ...deviationLines,
        "",
        "_Энэ дүгнэлт нь deterministic дүрмийн үр дүн бөгөөд удирдлагын баталгаажуулалт шаардлагатай._",
        "",
      ].join("\n"),
    }),
    document({
      documentId: stableId("a3-subcontractor", base),
      documentType: "SUBCONTRACTOR_REMINDER",
      title: `${snapshot.projectName} — туслан гүйцэтгэгчид хүргүүлэх санамж`,
      language,
      periodFrom,
      periodTo,
      styleProfileRef,
      facts: [...workFacts, ...scheduleFacts, ...riskFacts],
      extraSources: selectSources(
        analysis,
        ["SUBCONTRACTOR", "WORK_ITEM"],
        subcontractorDeviationIds,
      ),
      markdown: [
        `# ${snapshot.projectName} — туслан гүйцэтгэгчид хүргүүлэх санамж`,
        "",
        "Хүндэт туслан гүйцэтгэгчийн төлөөлөлд,",
        "",
        section("Баталгаажсан төслийн төлөв", [...workFacts, ...scheduleFacts, ...riskFacts]),
        subcontractorDeviationIds.length === 0
          ? "Туслан гүйцэтгэгчтэй шууд холбогдсон баталгаажсан зөрчил илрээгүй."
          : "Холбогдох ажлын нөхөн төлөвлөгөө, хариу арга хэмжээг эх өгөгдөлтэй тулган ирүүлнэ үү.",
        "",
        "_Илгээхийн өмнө хариуцсан ажилтан хянан батална._",
        "",
      ].join("\n"),
    }),
    document({
      documentId: stableId("a3-supplier", base),
      documentType: "SUPPLIER_DEMAND",
      title: `${snapshot.projectName} — нийлүүлэгчид хүргүүлэх шаардлага`,
      language,
      periodFrom,
      periodTo,
      styleProfileRef,
      facts: [...materialFacts, ...riskFacts],
      extraSources: selectSources(analysis, ["STOCK", "BLOCKER"], supplierDeviationIds),
      markdown: [
        `# ${snapshot.projectName} — нийлүүлэгчид хүргүүлэх шаардлага`,
        "",
        "Хүндэт нийлүүлэгчийн төлөөлөлд,",
        "",
        section("Баталгаажсан материалын мэдээлэл", materialFacts),
        section("Холбогдох эрсдэл", riskFacts),
        supplierDeviationIds.length === 0
          ? "Нийлүүлэлттэй шууд холбогдсон баталгаажсан зөрчил илрээгүй."
          : "Нийлүүлэлтийн хугацаа, тоо хэмжээ, залруулах арга хэмжээний баталгааг ирүүлнэ үү.",
        "",
        "_Илгээхийн өмнө хариуцсан ажилтан хянан батална._",
        "",
      ].join("\n"),
    }),
    document({
      documentId: stableId("a3-client", base),
      documentType: "CLIENT_NOTICE",
      title: `${snapshot.projectName} — захиалагчид хүргүүлэх мэдэгдэл`,
      language,
      periodFrom,
      periodTo,
      styleProfileRef,
      facts: [...workFacts, ...scheduleFacts, ...riskFacts, ...nextFacts],
      markdown: [
        `# ${snapshot.projectName} — захиалагчид хүргүүлэх мэдэгдэл`,
        "",
        "Хүндэт захиалагчийн төлөөлөлд,",
        "",
        section("Төслийн баталгаажсан төлөв", [...workFacts, ...scheduleFacts, ...riskFacts]),
        section("Дараагийн хяналтын чиглэл", nextFacts),
        "Энэхүү мэдэгдлийн агуулгыг гэрээ, талбайн бодит нөхцөлтэй тулган баталгаажуулсны дараа илгээнэ.",
        "",
        "_Энэ нь илгээгдээгүй ноорог._",
        "",
      ].join("\n"),
    }),
  ];
}

function numericTokens(value: string) {
  return new Set(
    value.match(/-?\d+(?:[.,]\d+)*/gu)?.map((token) => token.replaceAll(",", "")) ?? [],
  );
}

function assertNoNovelNumbers(
  documents: readonly DocumentDraftV1[],
  enrichments: Readonly<Record<string, string>>,
) {
  const allowed = numericTokens(documents.map((document) => document.markdown).join("\n"));

  for (const [documentId, narrative] of Object.entries(enrichments)) {
    const novel = [...numericTokens(narrative)].filter((token) => !allowed.has(token));

    if (novel.length > 0) {
      throw new Error(
        `A3 narrative contains unsupported numeric claims for ${documentId}: ${novel.join(", ")}`,
      );
    }
  }
}

function applyNarratives(
  documents: readonly DocumentDraftV1[],
  enrichments: Readonly<Record<string, string>>,
) {
  return documents.map((document) => {
    const narrative = enrichments[document.documentId]?.trim();

    if (!narrative) {
      return document;
    }

    return documentDraftV1Schema.parse({
      ...document,
      markdown: [
        document.markdown.trimEnd(),
        "",
        "## AI-аар найруулсан чанарын тайлбар",
        "",
        narrative,
        "",
        "_Тоон мэдээллийг дээрх deterministic баримтаас авсан._",
        "",
      ].join("\n"),
    });
  });
}

export async function runProductionA3(input: RunProductionA3Input): Promise<A3ProductionResultV1> {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(input.snapshot);
  const analysis = deterministicAnalysisV1Schema.parse(
    input.analysis ?? analyzeProjectSnapshot(snapshot),
  );

  if (
    analysis.tenantId !== snapshot.tenantId ||
    analysis.projectId !== snapshot.projectId ||
    analysis.snapshotId !== snapshot.snapshotId
  ) {
    throw new Error("A3 analysis scope does not match the snapshot");
  }

  const generatedAt = input.generatedAt ?? snapshot.asOf;
  const periodTo = input.periodTo ?? snapshot.asOf.slice(0, 10);
  const periodFrom = input.periodFrom ?? dateDaysBefore(periodTo, 6);
  const styleMemory =
    input.styleMemory === undefined ? null : a3StyleMemoryV1Schema.parse(input.styleMemory);
  const styleProfileRef =
    styleMemory?.styleProfileId ??
    (snapshot.tenantProfile.reportingStyle === null
      ? null
      : stableId("style", `${snapshot.tenantId}:${snapshot.tenantProfile.reportingStyle}`));
  const facts = buildA3DeterministicFacts(snapshot, analysis);
  let documents = composeDocuments({
    snapshot,
    analysis,
    facts,
    recommendations: input.recommendations ?? [],
    generatedAt,
    periodFrom,
    periodTo,
    language: input.language ?? "mn",
    styleProfileRef,
  });
  if (styleMemory !== null) {
    assertA3ProhibitedClaims(documents, styleMemory);
  }
  let aiStatus: A3ProductionResultV1["aiStatus"] = "NOT_REQUESTED";
  let aiError: string | null = null;

  if (input.narrativeGateway !== undefined) {
    try {
      const enrichments = await input.narrativeGateway.enrich({
        snapshot,
        analysis,
        facts,
        documents,
        styleMemory,
      });
      assertNoNovelNumbers(documents, enrichments);
      const enrichedDocuments = applyNarratives(documents, enrichments);
      if (styleMemory !== null) {
        assertA3ProhibitedClaims(enrichedDocuments, styleMemory);
      }
      documents = enrichedDocuments;
      aiStatus = "COMPLETED";
    } catch (error) {
      aiStatus = "AI_UNAVAILABLE";
      aiError =
        error instanceof Error ? error.message.slice(0, 1_000) : "Unknown A3 narrative failure";
    }
  }

  const bundle = documentBundleV1Schema.parse({
    schemaVersion: 1,
    artifactType: "DOCUMENT_BUNDLE",
    bundleId: stableId(
      "a3-bundle",
      `${input.requestId}:${snapshot.snapshotId}:${periodFrom}:${periodTo}`,
    ),
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    snapshotId: snapshot.snapshotId,
    analysisId: analysis.analysisId,
    generatedAt,
    documents,
    totalUnsupportedClaimCount: 0,
    status: "PENDING_REVIEW",
    requiresHumanReview: true,
  });

  return a3ProductionResultV1Schema.parse({
    schemaVersion: 1,
    runId: stableId("a3-run", `${input.requestId}:${snapshot.snapshotId}`),
    requestId: input.requestId,
    snapshotId: snapshot.snapshotId,
    analysisId: analysis.analysisId,
    generatedAt,
    facts,
    bundle,
    aiStatus,
    aiError,
  });
}

export async function persistA3DocumentArtifacts(input: {
  bundle: DocumentBundleV1;
  store: ArtifactStore;
  scanner: MalwareScanner;
  retention: ArtifactRetentionV1;
}) {
  const bundle = documentBundleV1Schema.parse(input.bundle);
  const documents: DocumentDraftV1[] = [];

  for (const document of bundle.documents) {
    const data = Buffer.from(document.markdown, "utf8");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const scan = await input.scanner.scan({
      data,
      sha256,
      mediaType: "text/markdown",
      fileName: `${document.documentId}.md`,
    });

    if (scan.status !== "CLEAN") {
      throw new Error(
        scan.status === "INFECTED"
          ? `A3 artifact rejected: ${scan.threatName}`
          : `A3 artifact scan failed: ${scan.errorMessage}`,
      );
    }

    const artifact = await input.store.put({
      artifactId: document.documentId,
      tenantId: bundle.tenantId,
      projectId: bundle.projectId,
      mediaType: "text/markdown",
      data,
      malwareScan: scan,
      retention: input.retention,
    });
    documents.push(
      documentDraftV1Schema.parse({
        ...document,
        outputArtifact: {
          artifactId: artifact.artifactId,
          kind: "REPORT_MARKDOWN",
          mediaType: artifact.mediaType,
          sha256: artifact.sha256,
          storageKey: artifact.storageKey,
          sizeBytes: artifact.sizeBytes,
        },
      }),
    );
  }

  return documentBundleV1Schema.parse({
    ...bundle,
    documents,
  });
}

export const documentReviewDecisionSchema = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "EDITED",
  "REJECTED",
]);

export const documentEditCategorySchema = z.enum([
  "NONE",
  "FACT_CORRECTION",
  "STYLE",
  "CLARITY",
  "SCOPE",
  "OTHER",
]);

export const documentReviewRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    reviewId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    documentId: contractIdentifierSchema,
    originalDraft: documentDraftV1Schema,
    originalDraftSha256: z.string().regex(/^[a-f0-9]{64}$/),
    decision: documentReviewDecisionSchema,
    editCategory: documentEditCategorySchema,
    finalMarkdown: z.string().trim().min(1).max(200_000).nullable(),
    finalSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    approvedVersion: z.number().int().positive().nullable(),
    reviewedBy: contractIdentifierSchema.nullable(),
    reviewedAt: contractIsoDateTimeSchema.nullable(),
    decisionReason: z.string().trim().min(1).max(2_000).nullable(),
    comparison: draftComparisonSchema.nullable(),
    createdAt: contractIsoDateTimeSchema,
    updatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const pending = record.decision === "PENDING_REVIEW";

    if (
      pending !==
      (record.reviewedBy === null && record.reviewedAt === null && record.decisionReason === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Document review metadata does not match its decision",
        path: ["decision"],
      });
    }

    const approved = ["APPROVED", "EDITED"].includes(record.decision);

    if (
      approved !==
      (record.finalMarkdown !== null &&
        record.finalSha256 !== null &&
        record.approvedVersion !== null &&
        record.comparison !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved document requires immutable final metadata",
        path: ["finalMarkdown"],
      });
    }

    if (record.decision === "EDITED" && record.editCategory === "NONE") {
      context.addIssue({
        code: "custom",
        message: "Edited documents require an edit category",
        path: ["editCategory"],
      });
    }
  });

export type DocumentReviewRecordV1 = z.infer<typeof documentReviewRecordV1Schema>;

export class FileDocumentReviewStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  #target(documentId: string) {
    if (!/^[A-Za-z0-9._-]+$/u.test(documentId)) {
      throw new Error("Unsafe A3 document ID");
    }

    return path.join(this.#directory, `${documentId}.json`);
  }

  async #write(record: DocumentReviewRecordV1) {
    await mkdir(this.#directory, { recursive: true });
    const target = this.#target(record.documentId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async save(
    tenantId: string,
    projectId: string,
    draftInput: DocumentDraftV1,
    createdAt = new Date().toISOString(),
  ) {
    const draft = documentDraftV1Schema.parse(draftInput);
    const target = this.#target(draft.documentId);

    try {
      return documentReviewRecordV1Schema.parse(JSON.parse(await readFile(target, "utf8")));
    } catch (error) {
      const missing =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";

      if (!missing) {
        throw error;
      }
    }

    const originalDraftSha256 = createHash("sha256").update(JSON.stringify(draft)).digest("hex");
    const record = documentReviewRecordV1Schema.parse({
      schemaVersion: 1,
      reviewId: stableId("a3-review", `${tenantId}:${projectId}:${draft.documentId}`),
      tenantId,
      projectId,
      documentId: draft.documentId,
      originalDraft: draft,
      originalDraftSha256,
      decision: "PENDING_REVIEW",
      editCategory: "NONE",
      finalMarkdown: null,
      finalSha256: null,
      approvedVersion: null,
      reviewedBy: null,
      reviewedAt: null,
      decisionReason: null,
      comparison: null,
      createdAt,
      updatedAt: createdAt,
    });
    await this.#write(record);
    return record;
  }

  async get(documentId: string): Promise<DocumentReviewRecordV1> {
    return documentReviewRecordV1Schema.parse(
      JSON.parse(await readFile(this.#target(documentId), "utf8")),
    );
  }

  async list(): Promise<DocumentReviewRecordV1[]> {
    await mkdir(this.#directory, { recursive: true });
    const names = (await readdir(this.#directory)).filter((name) => name.endsWith(".json")).sort();

    return Promise.all(
      names.map(async (name) =>
        documentReviewRecordV1Schema.parse(
          JSON.parse(await readFile(path.join(this.#directory, name), "utf8")),
        ),
      ),
    );
  }

  async decide(input: {
    documentId: string;
    decision: "APPROVED" | "EDITED" | "REJECTED";
    reviewedBy: string;
    reason: string;
    editCategory?: z.infer<typeof documentEditCategorySchema>;
    editedMarkdown?: string;
    reviewedAt?: string;
  }) {
    const existing = await this.get(input.documentId);

    if (existing.decision !== "PENDING_REVIEW") {
      return existing;
    }

    if (
      input.decision === "EDITED" &&
      (input.editedMarkdown === undefined ||
        input.editCategory === undefined ||
        input.editCategory === "NONE")
    ) {
      throw new Error("EDITED decision requires editedMarkdown and an edit category");
    }

    const reviewedAt = input.reviewedAt ?? new Date().toISOString();
    const finalMarkdown =
      input.decision === "REJECTED"
        ? null
        : (input.editedMarkdown ?? existing.originalDraft.markdown);
    const record = documentReviewRecordV1Schema.parse({
      ...existing,
      decision: input.decision,
      editCategory: input.decision === "EDITED" ? input.editCategory : "NONE",
      finalMarkdown,
      finalSha256:
        finalMarkdown === null ? null : createHash("sha256").update(finalMarkdown).digest("hex"),
      approvedVersion: finalMarkdown === null ? null : 1,
      reviewedBy: input.reviewedBy,
      reviewedAt,
      decisionReason: input.reason,
      comparison:
        finalMarkdown === null
          ? null
          : compareDrafts(existing.originalDraft.markdown, finalMarkdown),
      updatedAt: reviewedAt,
    });
    await this.#write(record);
    return record;
  }
}
