import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentRunStatus, Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { createChatModel } from "../agent/index.js";
import { analyzeProjectData, loadProjectAnalysisData } from "../analysis/index.js";
import { answerKeySchema } from "../answer-key.js";
import { prisma } from "../prisma.js";
import {
  deriveRecommendationRiskPosture,
  parseRecommendationReport,
  type RecommendationReport,
} from "../recommendations/index.js";
import {
  compareDrafts,
  composeProjectReport,
  createA3DocumentBundle,
  createAnalysisOnlyRecommendationReport,
  createDeterministicReportNarrative,
  formatDraftComparisonMarkdown,
  formatProjectMetricsMarkdown,
  generateReportNarrative,
  judgeProjectReport,
  parseReportCliArguments,
  persistA3DocumentBundle,
  renderA3DocumentMarkdown,
  renderHtmlToPdf,
  renderProjectReportHtml,
  reportNarrativeToMarkdown,
  resolveA3ModelRuntimeConfig,
  resolveReportRuntimeConfig,
  type ReportRecommendationSource,
} from "../reporting/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd report -- --project <id-or-code> [options]

Recommendation input:
  --agent-run <id>                  Use one completed A2 AgentRun
  --recommendations <path>          Use A2 JSON artifact
  --analysis-only                   Generate without A2 recommendations
  (default)                         Use latest completed A2 run in scope

Options:
  --tenant <id>                     Tenant ID
  --project <id-or-code>            Project ID or code
  --as-of <ISO-or-date>             Analysis cutoff
  --answer-key <path>               Evaluation answer key
  --narrative <deterministic|llm>   Paragraph source (default: deterministic)
  --judge                           Run LLM-as-judge
  --edited-draft <path>             Compare a human-edited draft
  --output-dir <path>               Artifact directory
  --no-pdf                          Skip Puppeteer PDF
  --model <id>                      OpenAI model ID
  --record-telemetry-content        Send prompts/outputs to telemetry
  --help                            Show this help
`.trim();

interface LoadedRecommendations {
  report: RecommendationReport;
  source: ReportRecommendationSource;
  runId: string | null;
  traceId: string | null;
}

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}

async function loadArtifactRecommendations(
  path: string,
  riskPosture: ReturnType<typeof deriveRecommendationRiskPosture>,
): Promise<LoadedRecommendations> {
  const artifact = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as {
    report?: unknown;
    runId?: unknown;
    langfuseTraceId?: unknown;
  };

  return {
    report: parseRecommendationReport(artifact.report ?? artifact, riskPosture),
    source: "ARTIFACT",
    runId: typeof artifact.runId === "string" ? artifact.runId : null,
    traceId: typeof artifact.langfuseTraceId === "string" ? artifact.langfuseTraceId : null,
  };
}

async function loadAgentRunRecommendations(input: {
  tenantId: string;
  projectId: string;
  asOf: string;
  agentRunId?: string;
  riskPosture: ReturnType<typeof deriveRecommendationRiskPosture>;
}): Promise<LoadedRecommendations> {
  const run = await prisma.agentRun.findFirst({
    where: {
      id: input.agentRunId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      agentType: "A2_RECOMMENDATION",
      status: AgentRunStatus.COMPLETED,
      asOf: new Date(input.asOf),
      output: { not: Prisma.DbNull },
    },
    orderBy: { startedAt: "desc" },
  });

  if (!run?.output) {
    throw new Error(
      input.agentRunId
        ? "Completed A2 AgentRun was not found in the requested scope"
        : "No completed A2 run found. Run `pnpm.cmd recommend` or use --analysis-only.",
    );
  }

  return {
    report: parseRecommendationReport(run.output, input.riskPosture),
    source: "AGENT_RUN",
    runId: run.id,
    traceId: run.langfuseTraceId,
  };
}

async function main() {
  const arguments_ = parseReportCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const config = resolveReportRuntimeConfig(process.env, arguments_);
  const data = await loadProjectAnalysisData({
    tenantId: config.tenantId,
    projectRef: config.projectRef,
    asOf: config.asOf,
  });
  const analysis = analyzeProjectData(data);
  const riskPosture = deriveRecommendationRiskPosture(
    analysis.issues.map((issue) => issue.severity),
  );
  const answerKey = answerKeySchema.parse(
    JSON.parse(await readFile(resolve(process.cwd(), config.answerKeyPath), "utf8")),
  );
  const loadedRecommendations = config.analysisOnly
    ? {
        report: createAnalysisOnlyRecommendationReport(data, analysis),
        source: "ANALYSIS_ONLY" as const,
        runId: null,
        traceId: null,
      }
    : config.recommendationsPath
      ? await loadArtifactRecommendations(config.recommendationsPath, riskPosture)
      : await loadAgentRunRecommendations({
          tenantId: data.tenantId,
          projectId: data.projectId,
          asOf: data.asOf,
          agentRunId: config.agentRunId,
          riskPosture,
        });
  const needsModel = config.narrativeMode === "llm" || config.judge;
  const modelConfig = needsModel ? resolveA3ModelRuntimeConfig(process.env, arguments_) : null;
  const model = modelConfig ? createChatModel(modelConfig) : null;
  const telemetry = startLangfuseTelemetry(process.env);
  const requestId = randomUUID();

  try {
    const generated = await telemetry.runWithTrace("a3-project-report", async (traceId) => {
      const narrativeResult =
        config.narrativeMode === "llm"
          ? await generateReportNarrative({
              model: model!,
              analysis,
              recommendations: loadedRecommendations.report,
              recordTelemetryContent: config.recordTelemetryContent,
            })
          : {
              narrative: createDeterministicReportNarrative(
                loadedRecommendations.report.recommendations.length > 0,
              ),
              finishReason: null,
              usage: null,
            };
      const report = composeProjectReport({
        data,
        analysis,
        recommendations: loadedRecommendations.report,
        narrative: narrativeResult.narrative,
        answerKey,
        narrativeMode: config.narrativeMode === "llm" ? "LLM" : "DETERMINISTIC",
        recommendationSource: loadedRecommendations.source,
        a2RunId: loadedRecommendations.runId,
        a2TraceId: loadedRecommendations.traceId,
        a3TraceId: traceId,
      });
      const judgeResult = config.judge
        ? await judgeProjectReport({
            model: model!,
            report,
            recordTelemetryContent: config.recordTelemetryContent,
          })
        : null;

      return {
        report,
        narrativeResult,
        judgeResult,
      };
    });
    const outputDirectory = resolve(
      process.cwd(),
      config.outputDir ?? `data/reports/${data.projectId}-${data.asOf.slice(0, 10)}`,
    );
    const baseName = `${data.projectId}-${data.asOf.slice(0, 10)}`;
    const jsonPath = resolve(outputDirectory, `${baseName}.json`);
    const htmlPath = resolve(outputDirectory, `${baseName}.html`);
    const pdfPath = resolve(outputDirectory, `${baseName}.pdf`);
    const draftPath = resolve(outputDirectory, "ai-draft.md");
    const metricsPath = resolve(outputDirectory, "metrics.md");
    const html = await renderProjectReportHtml(generated.report);
    const aiDraft = reportNarrativeToMarkdown(generated.report.narrative);
    const documentBundle = createA3DocumentBundle(generated.report, { requestId });
    const documentMarkdown = new Map(
      documentBundle.documents.map((document) => [
        document.type,
        renderA3DocumentMarkdown(document),
      ]),
    );
    const draftComparison = config.editedDraftPath
      ? compareDrafts(
          aiDraft,
          await readFile(resolve(process.cwd(), config.editedDraftPath), "utf8"),
        )
      : null;
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(htmlPath, html, "utf8"),
      writeFile(draftPath, aiDraft, "utf8"),
      writeFile(
        resolve(outputDirectory, "project-report.md"),
        documentMarkdown.get("PROJECT_REPORT")!,
        "utf8",
      ),
      writeFile(
        resolve(outputDirectory, "executive-conclusion.md"),
        documentMarkdown.get("EXECUTIVE_CONCLUSION")!,
        "utf8",
      ),
      writeFile(
        resolve(outputDirectory, "official-letter.md"),
        documentMarkdown.get("OFFICIAL_LETTER")!,
        "utf8",
      ),
      writeFile(metricsPath, formatProjectMetricsMarkdown([generated.report.metrics]), "utf8"),
      ...(draftComparison
        ? [
            writeFile(
              resolve(outputDirectory, "draft-diff.json"),
              `${JSON.stringify(draftComparison, null, 2)}\n`,
              "utf8",
            ),
            writeFile(
              resolve(outputDirectory, "draft-diff.md"),
              formatDraftComparisonMarkdown(draftComparison),
              "utf8",
            ),
          ]
        : []),
      ...(generated.judgeResult
        ? [
            writeFile(
              resolve(outputDirectory, "judge.json"),
              `${JSON.stringify(generated.judgeResult, null, 2)}\n`,
              "utf8",
            ),
          ]
        : []),
    ]);
    const pdf = config.noPdf ? null : await renderHtmlToPdf(html, pdfPath);
    const persisted = await persistA3DocumentBundle(documentBundle, {
      trigger: "ON_DEMAND",
      provider: modelConfig?.provider ?? "deterministic",
      modelId: modelConfig?.modelId ?? "handlebars-v1",
      langfuseTraceId: generated.report.provenance.a3TraceId ?? undefined,
      artifactDirectory: outputDirectory,
    });
    const artifact = {
      report: generated.report,
      documentBundle,
      documentDrafts: persisted,
      narrativeGeneration: {
        provider: modelConfig?.provider ?? null,
        modelId: modelConfig?.modelId ?? null,
        finishReason: generated.narrativeResult.finishReason,
        usage: generated.narrativeResult.usage,
      },
      judge: generated.judgeResult,
      draftComparison,
    };

    await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    console.log(`A3 report complete: ${data.projectCode} (${data.projectId})`);
    console.log(
      `narrative=${config.narrativeMode} recommendations=${loadedRecommendations.report.recommendations.length} judge=${config.judge ? "yes" : "no"}`,
    );
    console.log(
      `precision=${(generated.report.metrics.issueDetection.precision * 100).toFixed(2)}% recall=${(generated.report.metrics.issueDetection.recall * 100).toFixed(2)}% forecastError=${generated.report.metrics.forecastErrorDays ?? "N/A"} days`,
    );
    console.log(`a3RunId=${persisted.runId} drafts=${persisted.draftIds.join(",")}`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`HTML: ${htmlPath}`);
    console.log(`PDF: ${pdf?.path ?? "skipped"}`);
  } finally {
    await prisma.$disconnect();
    await telemetry.shutdown();
  }
}

void main().catch(async (error) => {
  console.error(`Report failed: ${formatError(error)}`);
  process.exitCode = 1;
  await prisma.$disconnect();
});
