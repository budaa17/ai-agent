import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentRunStatus, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { answerKeySchema } from "../answer-key.js";
import { prisma } from "../prisma.js";
import {
  deriveRecommendationRiskPosture,
  parseRecommendationReport,
} from "../recommendations/index.js";
import { composeProjectReport, createAnalysisOnlyRecommendationReport } from "./compose.js";
import { createA3DocumentBundle, renderA3DocumentMarkdown } from "./document.js";
import { formatProjectMetricsMarkdown } from "./metrics.js";
import { createDeterministicReportNarrative } from "./narrative.js";
import { renderHtmlToPdf } from "./pdf.js";
import { persistA3DocumentBundle } from "./persistence.js";
import { renderProjectReportHtml } from "./render.js";
import { collectA3ReportEvidenceCore } from "./tools.js";

const automatedA3DocumentsInputSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectRef: z.string().trim().min(1),
    asOf: z.string().datetime(),
    answerKeyPath: z.string().trim().min(1),
    requestId: z.string().trim().min(1).max(200),
    trigger: z.enum(["REQUEST", "SCHEDULED"]),
    outputDirectory: z.string().trim().min(1).optional(),
    noPdf: z.boolean().default(false),
    analysisOnly: z.boolean().default(false),
    allowAnalysisOnlyFallback: z.boolean().default(true),
  })
  .strict();

function safePathSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 120);
}

export async function runAutomatedA3Documents(
  input: z.input<typeof automatedA3DocumentsInputSchema>,
  client: PrismaClient = prisma,
) {
  const params = automatedA3DocumentsInputSchema.parse(input);
  const evidence = await collectA3ReportEvidenceCore(
    {
      tenantId: params.tenantId,
      projectIds: [params.projectRef],
    },
    {
      projectRef: params.projectRef,
      asOf: params.asOf,
    },
    client,
  );
  const evaluationAnswerKey = answerKeySchema.parse(
    JSON.parse(await readFile(resolve(process.cwd(), params.answerKeyPath), "utf8")),
  );
  const answerKey = {
    ...evaluationAnswerKey,
    asOf: evidence.data.asOf,
  };
  const a2Run = params.analysisOnly
    ? null
    : await client.agentRun.findFirst({
        where: {
          tenantId: evidence.data.tenantId,
          projectId: evidence.data.projectId,
          agentType: "A2_RECOMMENDATION",
          status: AgentRunStatus.COMPLETED,
          asOf: new Date(evidence.data.asOf),
          output: { not: Prisma.DbNull },
        },
        orderBy: { startedAt: "desc" },
      });

  if (!params.analysisOnly && !a2Run?.output && !params.allowAnalysisOnlyFallback) {
    throw new Error("No completed A2 run found for automated A3 documents");
  }

  const recommendations = a2Run?.output
    ? parseRecommendationReport(
        a2Run.output,
        deriveRecommendationRiskPosture(evidence.analysis.issues.map((issue) => issue.severity)),
      )
    : createAnalysisOnlyRecommendationReport(evidence.data, evidence.analysis);
  const report = composeProjectReport({
    data: evidence.data,
    analysis: evidence.analysis,
    recommendations,
    narrative: createDeterministicReportNarrative(false),
    answerKey,
    narrativeMode: "DETERMINISTIC",
    recommendationSource: a2Run ? "AGENT_RUN" : "ANALYSIS_ONLY",
    a2RunId: a2Run?.id ?? null,
    a2TraceId: a2Run?.langfuseTraceId ?? null,
  });
  const bundle = createA3DocumentBundle(report, {
    requestId: params.requestId,
  });
  const outputDirectory = resolve(
    process.cwd(),
    params.outputDirectory ??
      `data/reports/automated/${safePathSegment(report.project.projectId)}-${report.project.asOf.slice(0, 10)}-${safePathSegment(params.requestId)}`,
  );
  const html = await renderProjectReportHtml(report);
  const markdown = new Map(
    bundle.documents.map((document) => [document.type, renderA3DocumentMarkdown(document)]),
  );
  const jsonPath = resolve(outputDirectory, "a3-document-bundle.json");
  const htmlPath = resolve(outputDirectory, "project-report.html");
  const pdfPath = resolve(outputDirectory, "project-report.pdf");

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(htmlPath, html, "utf8"),
    writeFile(
      resolve(outputDirectory, "project-report.md"),
      markdown.get("PROJECT_REPORT")!,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, "executive-conclusion.md"),
      markdown.get("EXECUTIVE_CONCLUSION")!,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, "official-letter.md"),
      markdown.get("OFFICIAL_LETTER")!,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, "metrics.md"),
      formatProjectMetricsMarkdown([report.metrics]),
      "utf8",
    ),
  ]);
  const pdf = params.noPdf ? null : await renderHtmlToPdf(html, pdfPath);
  const persisted = await persistA3DocumentBundle(
    bundle,
    {
      trigger: params.trigger,
      provider: "deterministic",
      modelId: "handlebars-v1",
      artifactDirectory: outputDirectory,
    },
    client,
  );

  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        report,
        documentBundle: bundle,
        documentDrafts: persisted,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    report,
    bundle,
    persisted,
    recommendationSource: a2Run ? "AGENT_RUN" : "ANALYSIS_ONLY",
    paths: {
      outputDirectory,
      json: jsonPath,
      html: htmlPath,
      pdf: pdf?.path ?? null,
    },
  };
}
