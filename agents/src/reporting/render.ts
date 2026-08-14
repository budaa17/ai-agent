import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { projectReportSchema, type ProjectReport } from "./schema.js";

const defaultTemplatePath = fileURLToPath(
  new URL("./templates/project-report.hbs", import.meta.url),
);
const defaultFontPath = fileURLToPath(
  new URL("../../assets/fonts/NotoSans-Variable.ttf", import.meta.url),
);

const issueTypeLabels: Record<string, string> = {
  OVERDUE_WORK_ITEM: "Хугацаа хэтэрсэн ажил",
  STALLED_PROGRESS: "Ахиц зогссон",
  DEPENDENCY_VIOLATION: "Хамаарлын зөрчил",
  BUDGET_OVERRUN: "Төсөв хэтэрсэн",
  LEDGER_MISMATCH: "Ledger зөрүү",
};

const severityLabels: Record<string, string> = {
  LOW: "Бага",
  MEDIUM: "Дунд",
  HIGH: "Өндөр",
  CRITICAL: "Ноцтой",
};

export interface RenderProjectReportHtmlOptions {
  templatePath?: string;
  fontPath?: string;
  fontBase64?: string;
}

function formatDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return new Intl.DateTimeFormat("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatPercentage(value: unknown) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "N/A";
}

function formatMetricDays(value: unknown) {
  return typeof value === "number" ? value.toFixed(2) : "N/A";
}

function formatNumber(value: unknown) {
  return typeof value === "number"
    ? new Intl.NumberFormat("mn-MN").format(value)
    : String(value ?? "");
}

function createTemplateEngine() {
  const handlebars = Handlebars.create();

  handlebars.registerHelper("formatDate", formatDate);
  handlebars.registerHelper("formatPercentage", formatPercentage);
  handlebars.registerHelper("formatMetricDays", formatMetricDays);
  handlebars.registerHelper("formatNumber", formatNumber);
  handlebars.registerHelper("formatEvidence", (value: unknown) => JSON.stringify(value, null, 2));
  return handlebars;
}

function reportView(report: ProjectReport, fontBase64: string) {
  const taskCodes = new Map(report.analysis.cpm.tasks.map((task) => [task.workItemId, task.code]));

  return {
    ...report,
    fontBase64,
    asOfDisplay: formatDate(report.project.asOf),
    generatedAtDisplay: formatDate(report.generatedAt),
    issueTypeLabels,
    severityLabels,
    hasRecommendations: report.recommendations.recommendations.length > 0,
    criticalPathDisplay: report.analysis.cpm.criticalPaths[0]
      ?.map((workItemId) => taskCodes.get(workItemId) ?? workItemId)
      .join(" → "),
    issues: report.analysis.issues.map((issue) => ({
      ...issue,
      typeLabel: issueTypeLabels[issue.type] ?? issue.type,
      severityLabel: severityLabels[issue.severity] ?? issue.severity,
      workItemCode: taskCodes.get(issue.workItemId) ?? issue.workItemId,
    })),
    recommendationItems: report.recommendations.recommendations.map((recommendation) => ({
      ...recommendation,
      priorityLabel: severityLabels[recommendation.priority] ?? recommendation.priority,
    })),
  };
}

export async function renderProjectReportHtml(
  reportInput: ProjectReport,
  options: RenderProjectReportHtmlOptions = {},
) {
  const report = projectReportSchema.parse(reportInput);
  const [template, fontBase64] = await Promise.all([
    readFile(options.templatePath ?? defaultTemplatePath, "utf8"),
    options.fontBase64
      ? Promise.resolve(options.fontBase64)
      : readFile(options.fontPath ?? defaultFontPath).then((font) => font.toString("base64")),
  ]);
  const compile = createTemplateEngine().compile(template);

  return compile(reportView(report, fontBase64));
}

export const PROJECT_REPORT_TEMPLATE_PATH = defaultTemplatePath;
export const PROJECT_REPORT_FONT_PATH = defaultFontPath;
