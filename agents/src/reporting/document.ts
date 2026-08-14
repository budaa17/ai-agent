import { z } from "zod";
import { projectReportSchema, type ProjectReport } from "./schema.js";

export const a3DocumentTypeSchema = z.enum([
  "PROJECT_REPORT",
  "EXECUTIVE_CONCLUSION",
  "OFFICIAL_LETTER",
]);

const a3ProjectReportDocumentSchema = z
  .object({
    type: z.literal("PROJECT_REPORT"),
    title: z.string().trim().min(1).max(500),
    report: projectReportSchema,
  })
  .strict();

const a3ExecutiveConclusionDocumentSchema = z
  .object({
    type: z.literal("EXECUTIVE_CONCLUSION"),
    title: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(10_000),
    decisionPoints: z.array(z.string().trim().min(1).max(2_000)).min(1),
    sourceIssueIds: z.array(z.string().trim().min(1)).max(100),
    sourceRecommendationIds: z.array(z.string().trim().min(1)).max(100),
  })
  .strict();

const a3OfficialLetterDocumentSchema = z
  .object({
    type: z.literal("OFFICIAL_LETTER"),
    title: z.string().trim().min(1).max(500),
    recipient: z.string().trim().min(1).max(500),
    subject: z.string().trim().min(1).max(500),
    salutation: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(10_000),
    requestedAction: z.string().trim().min(1).max(5_000),
    closing: z.string().trim().min(1).max(1_000),
    signatoryPlaceholder: z.string().trim().min(1).max(500),
    sourceIssueIds: z.array(z.string().trim().min(1)).max(100),
    sourceRecommendationIds: z.array(z.string().trim().min(1)).max(100),
  })
  .strict();

export const a3DocumentSchema = z.discriminatedUnion("type", [
  a3ProjectReportDocumentSchema,
  a3ExecutiveConclusionDocumentSchema,
  a3OfficialLetterDocumentSchema,
]);

export const a3DocumentBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().trim().min(1).max(200),
    generatedAt: z.string().datetime(),
    tenantId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    asOf: z.string().datetime(),
    documents: z.array(a3DocumentSchema).length(3),
  })
  .strict()
  .superRefine((bundle, context) => {
    const types = bundle.documents.map((document) => document.type);

    if (new Set(types).size !== types.length) {
      context.addIssue({
        code: "custom",
        message: "A3 document types must be unique",
        path: ["documents"],
      });
    }

    for (const requiredType of a3DocumentTypeSchema.options) {
      if (!types.includes(requiredType)) {
        context.addIssue({
          code: "custom",
          message: `Missing A3 document type: ${requiredType}`,
          path: ["documents"],
        });
      }
    }

    const projectDocument = bundle.documents.find((document) => document.type === "PROJECT_REPORT");

    if (
      projectDocument &&
      (projectDocument.report.project.tenantId !== bundle.tenantId ||
        projectDocument.report.project.projectId !== bundle.projectId ||
        projectDocument.report.project.asOf !== bundle.asOf)
    ) {
      context.addIssue({
        code: "custom",
        message: "A3 document bundle scope does not match project report",
        path: ["documents"],
      });
    }

    if (projectDocument) {
      const issueIds = new Set(projectDocument.report.analysis.issues.map((issue) => issue.id));
      const recommendationIds = new Set(
        projectDocument.report.recommendations.recommendations.map(
          (recommendation) => recommendation.id,
        ),
      );

      bundle.documents.forEach((document, documentIndex) => {
        if (document.type === "PROJECT_REPORT") {
          return;
        }

        document.sourceIssueIds.forEach((issueId, sourceIndex) => {
          if (!issueIds.has(issueId)) {
            context.addIssue({
              code: "custom",
              message: `Unknown A3 source issue: ${issueId}`,
              path: ["documents", documentIndex, "sourceIssueIds", sourceIndex],
            });
          }
        });
        document.sourceRecommendationIds.forEach((recommendationId, sourceIndex) => {
          if (!recommendationIds.has(recommendationId)) {
            context.addIssue({
              code: "custom",
              message: `Unknown A3 source recommendation: ${recommendationId}`,
              path: ["documents", documentIndex, "sourceRecommendationIds", sourceIndex],
            });
          }
        });
      });
    }
  });

export type A3DocumentType = z.infer<typeof a3DocumentTypeSchema>;
export type A3Document = z.infer<typeof a3DocumentSchema>;
export type A3DocumentBundle = z.infer<typeof a3DocumentBundleSchema>;

export interface CreateA3DocumentBundleOptions {
  requestId: string;
  recipient?: string;
  signatoryPlaceholder?: string;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function decisionPoints(report: ProjectReport) {
  if (report.recommendations.recommendations.length > 0) {
    return unique(
      report.recommendations.recommendations.map((recommendation) => recommendation.action),
    );
  }

  if (report.analysis.issues.length > 0) {
    return unique(report.analysis.issues.map((issue) => issue.summary));
  }

  return ["Төслийн баталгаажсан төлөвийг хэвийн хяналтын давтамжаар үргэлжлүүлэн хянах."];
}

export function createA3DocumentBundle(
  reportInput: ProjectReport,
  options: CreateA3DocumentBundleOptions,
): A3DocumentBundle {
  const report = projectReportSchema.parse(reportInput);
  const issueIds = report.analysis.issues.map((issue) => issue.id);
  const recommendationIds = report.recommendations.recommendations.map(
    (recommendation) => recommendation.id,
  );
  const points = decisionPoints(report);
  const issueSummary =
    report.analysis.summary.issueCount === 0
      ? "баталгаажсан асуудал илрээгүй"
      : `${report.analysis.summary.issueCount} баталгаажсан асуудал илэрсэн`;
  const recommendationSummary =
    report.recommendations.recommendations.length === 0
      ? "баталгаажсан зөвлөмж ороогүй"
      : `${report.recommendations.recommendations.length} зөвлөмжийн ноорог бэлтгэгдсэн`;

  return a3DocumentBundleSchema.parse({
    schemaVersion: 1,
    requestId: options.requestId,
    generatedAt: report.generatedAt,
    tenantId: report.project.tenantId,
    projectId: report.project.projectId,
    asOf: report.project.asOf,
    documents: [
      {
        type: "PROJECT_REPORT",
        title: `${report.project.projectName} төслийн хяналтын тайлан`,
        report,
      },
      {
        type: "EXECUTIVE_CONCLUSION",
        title: `${report.project.projectName} төслийн удирдлагын дүгнэлт`,
        body:
          `${report.project.projectName} төслийн ${report.project.asOf.slice(0, 10)}-ны байдлын шинжилгээгээр ${issueSummary}. ` +
          `Төслийн тооцоолсон үргэлжлэх хугацаа ${report.analysis.summary.projectDurationDays} хоног бөгөөд ${recommendationSummary}.`,
        decisionPoints: points,
        sourceIssueIds: issueIds,
        sourceRecommendationIds: recommendationIds,
      },
      {
        type: "OFFICIAL_LETTER",
        title: `${report.project.projectName} төслийн албан бичгийн ноорог`,
        recipient: options.recipient ?? "Төслийн удирдах зөвлөл",
        subject: `${report.project.projectName} төслийн хяналтын үр дүнгийн тухай`,
        salutation: "Хүндэт удирдлагын багт,",
        body:
          `${report.project.projectCode} кодтой төслийн ${report.project.asOf.slice(0, 10)}-ны байдлын хяналтын тайланг хүргүүлж байна. ` +
          `Шинжилгээгээр ${issueSummary} бөгөөд ${recommendationSummary}.`,
        requestedAction: points.join(" "),
        closing: "Энэхүү нооргийг эх өгөгдөлтэй тулган хянаж, батлах эсэхийг шийдвэрлэнэ үү.",
        signatoryPlaceholder: options.signatoryPlaceholder ?? "Баталгаажуулах албан тушаалтан",
        sourceIssueIds: issueIds,
        sourceRecommendationIds: recommendationIds,
      },
    ],
  });
}

export function renderA3DocumentMarkdown(documentInput: A3Document) {
  const document = a3DocumentSchema.parse(documentInput);

  if (document.type === "PROJECT_REPORT") {
    return [
      `# ${document.title}`,
      "",
      `- Төслийн код: ${document.report.project.projectCode}`,
      `- Тайлангийн огноо: ${document.report.project.asOf.slice(0, 10)}`,
      `- Нийт ажил: ${document.report.analysis.summary.workItemCount}`,
      `- Илэрсэн асуудал: ${document.report.analysis.summary.issueCount}`,
      `- Зөвлөмж: ${document.report.recommendations.recommendations.length}`,
      "",
      "## Удирдлагын хураангуй",
      "",
      document.report.narrative.executiveOverview,
      "",
      "## Дүгнэлт",
      "",
      document.report.narrative.conclusion,
      "",
    ].join("\n");
  }

  if (document.type === "EXECUTIVE_CONCLUSION") {
    return [
      `# ${document.title}`,
      "",
      document.body,
      "",
      "## Шийдвэрийн санал",
      "",
      ...document.decisionPoints.map((point) => `- ${point}`),
      "",
    ].join("\n");
  }

  return [
    `# ${document.title}`,
    "",
    `**Хэнд:** ${document.recipient}`,
    "",
    `**Сэдэв:** ${document.subject}`,
    "",
    document.salutation,
    "",
    document.body,
    "",
    `**Хүсэж буй шийдвэр:** ${document.requestedAction}`,
    "",
    document.closing,
    "",
    `**${document.signatoryPlaceholder}**`,
    "",
  ].join("\n");
}
