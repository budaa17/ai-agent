import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { REPORT_JUDGE_INSTRUCTIONS } from "./prompts.js";
import { projectReportSchema, type ProjectReport } from "./schema.js";

const judgeDimensionSchema = z
  .object({
    score: z.number().int().min(1).max(5),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const reportJudgeSchema = z
  .object({
    schemaVersion: z.literal(1),
    accuracy: judgeDimensionSchema,
    groundedness: judgeDimensionSchema,
    clarity: judgeDimensionSchema,
    actionability: judgeDimensionSchema,
    mongolianLanguageQuality: judgeDimensionSchema,
    verdict: z.enum(["PASS", "REVISE", "FAIL"]),
    summary: z.string().trim().min(1).max(1_500),
  })
  .strict();

export type ReportJudge = z.infer<typeof reportJudgeSchema>;

export interface JudgeProjectReportOptions {
  model: LanguageModel;
  report: ProjectReport;
  telemetryEnabled?: boolean;
  recordTelemetryContent?: boolean;
  maxRetries?: number;
}

export async function judgeProjectReport(options: JudgeProjectReportOptions) {
  const report = projectReportSchema.parse(options.report);
  const result = await generateObject({
    model: options.model,
    system: REPORT_JUDGE_INSTRUCTIONS,
    prompt: [
      "Candidate report:",
      "<report>",
      JSON.stringify(report),
      "</report>",
      "Evaluate factual consistency against report.analysis and report.recommendations.",
    ].join("\n"),
    schema: reportJudgeSchema,
    schemaName: "project_report_judge",
    schemaDescription: "Rubric scores and concise reasons for a grounded project report.",
    temperature: 0,
    maxOutputTokens: 1_600,
    maxRetries: options.maxRetries ?? 2,
    telemetry: {
      isEnabled: options.telemetryEnabled ?? true,
      functionId: "a3-report-judge",
      recordInputs: options.recordTelemetryContent ?? false,
      recordOutputs: options.recordTelemetryContent ?? false,
    },
  });
  const judge = result.object;
  const scores = [
    judge.accuracy.score,
    judge.groundedness.score,
    judge.clarity.score,
    judge.actionability.score,
    judge.mongolianLanguageQuality.score,
  ];

  return {
    judge,
    averageScore:
      Math.round((scores.reduce((total, score) => total + score, 0) / scores.length) * 100) / 100,
    finishReason: result.finishReason,
    usage: result.usage,
  };
}
