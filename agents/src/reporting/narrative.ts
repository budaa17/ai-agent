import { generateObject, type LanguageModel } from "ai";
import { projectAnalysisResultSchema, type ProjectAnalysisResult } from "../analysis/analyze.js";
import {
  recommendationReportSchema,
  type RecommendationReport,
} from "../recommendations/schema.js";
import { REPORT_NARRATIVE_INSTRUCTIONS } from "./prompts.js";
import { reportNarrativeSchema, type ReportNarrative } from "./schema.js";

const numericWordPattern =
  /(?:^|[\s,.;:!?()])(?:тэг|нэг|хоёр|гурван?|дөрвөн?|тав|зургаа|долоо|найм|ес|арав|зуу|мянга|сая|тэрбум|zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)(?=$|[\s,.;:!?()])/iu;

export class ReportNarrativeGroundingError extends Error {
  readonly field: keyof Omit<ReportNarrative, "language">;

  constructor(field: keyof Omit<ReportNarrative, "language">) {
    super(`Report narrative field ${field} contains a numeric claim`);
    this.name = "ReportNarrativeGroundingError";
    this.field = field;
  }
}

export function assertReportNarrativeHasNoNumbers(narrativeInput: ReportNarrative) {
  const narrative = reportNarrativeSchema.parse(narrativeInput);

  for (const [field, text] of Object.entries(narrative)) {
    if (field === "language") {
      continue;
    }

    if (/\p{Number}/u.test(text) || numericWordPattern.test(text)) {
      throw new ReportNarrativeGroundingError(field as keyof Omit<ReportNarrative, "language">);
    }
  }

  return narrative;
}

export function createDeterministicReportNarrative(hasRecommendations: boolean): ReportNarrative {
  return reportNarrativeSchema.parse({
    language: "mn",
    executiveOverview:
      "Төслийн төлөвийг хугацаа, хамаарал, явц болон зардлын баталгаажсан мэдээлэлд тулгуурлан нэгтгэв.",
    riskNarrative:
      "Илэрсэн эрсдэлүүд нь ажлын уялдаа, хэрэгжилтийн дараалал болон санхүүгийн хяналтад анхаарал шаардаж байна.",
    recommendationNarrative: hasRecommendations
      ? "Баталгаажсан зөвлөмжүүдийг эх баримттай нь тулган, хариуцагч болон хэрэгжилтийн дарааллаар удирдах шаардлагатай."
      : "Баталгаажсан зөвлөмж ороогүй тул детерминистик шинжилгээний асуудлуудыг эх баримттай нь нягтлах шаардлагатай.",
    conclusion:
      "Шийдвэр бүрийг эх өгөгдөл, дүрмийн үр дүн болон баталгаажсан эх сурвалжтай холбоотой хэрэгжүүлэх нь зүйтэй.",
  });
}

export interface GenerateReportNarrativeOptions {
  model: LanguageModel;
  analysis: ProjectAnalysisResult;
  recommendations: RecommendationReport;
  telemetryEnabled?: boolean;
  recordTelemetryContent?: boolean;
  maxRetries?: number;
}

export async function generateReportNarrative(options: GenerateReportNarrativeOptions) {
  const analysis = projectAnalysisResultSchema.parse(options.analysis);
  const recommendations = recommendationReportSchema.parse(options.recommendations);
  const result = await generateObject({
    model: options.model,
    system: REPORT_NARRATIVE_INSTRUCTIONS,
    prompt: [
      "Deterministic analysis:",
      "<analysis>",
      JSON.stringify(analysis),
      "</analysis>",
      "Grounded recommendations:",
      "<recommendations>",
      JSON.stringify(recommendations),
      "</recommendations>",
    ].join("\n"),
    schema: reportNarrativeSchema,
    schemaName: "project_report_narrative",
    schemaDescription: "Qualitative Mongolian narrative paragraphs without numeric claims.",
    temperature: 0,
    maxOutputTokens: 1_600,
    maxRetries: options.maxRetries ?? 2,
    telemetry: {
      isEnabled: options.telemetryEnabled ?? true,
      functionId: "a3-report-narrative",
      recordInputs: options.recordTelemetryContent ?? false,
      recordOutputs: options.recordTelemetryContent ?? false,
    },
  });

  return {
    narrative: assertReportNarrativeHasNoNumbers(result.object),
    finishReason: result.finishReason,
    usage: result.usage,
  };
}
