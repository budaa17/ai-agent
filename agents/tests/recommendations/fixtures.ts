import { analyzeProjectData } from "../../src/analysis/analyze.js";
import { buildRecommendationGroundingContext } from "../../src/recommendations/grounding.js";
import {
  recommendationReportSchema,
  type RecommendationReport,
} from "../../src/recommendations/schema.js";
import { buildProjectAnalysisFixture } from "../analysis/fixtures.js";

export function buildRecommendationFixture() {
  const data = buildProjectAnalysisFixture("project-atlas");
  const analysis = analyzeProjectData(data);
  const grounding = buildRecommendationGroundingContext(data, analysis);
  const issue = analysis.issues[0]!;
  const workItem = data.workItems.find((candidate) => candidate.id === issue.workItemId)!;
  const issueSource = grounding.facts.find(
    (source) =>
      source.sourceType === "ISSUE" && source.sourceId === issue.id && source.field === "type",
  )!;
  const issueSources = analysis.issues.map((candidate) =>
    grounding.facts.find(
      (source) =>
        source.sourceType === "ISSUE" &&
        source.sourceId === candidate.id &&
        source.field === "type",
    )!,
  );
  const rootCauseIssue = analysis.issues.find(
    (candidate) => candidate.type === "DEPENDENCY_VIOLATION",
  )!;
  const rootCauseIssueSource = grounding.facts.find(
    (source) =>
      source.sourceType === "ISSUE" &&
      source.sourceId === rootCauseIssue.id &&
      source.field === "type",
  )!;
  const dependencySource = grounding.facts.find(
    (source) =>
      source.sourceType === "DEPENDENCY" &&
      source.field === "successorId" &&
      source.value === rootCauseIssue.workItemId,
  )!;
  const trendIssue = analysis.issues.find((candidate) => candidate.type === "STALLED_PROGRESS")!;
  const trendIssueSource = grounding.facts.find(
    (source) =>
      source.sourceType === "ISSUE" && source.sourceId === trendIssue.id && source.field === "type",
  )!;
  const trendSnapshotIds = grounding.facts
    .filter(
      (source) =>
        source.sourceType === "PROGRESS_SNAPSHOT" &&
        source.field === "workItemId" &&
        source.value === trendIssue.workItemId,
    )
    .map((source) => source.sourceId)
    .slice(-2);
  const trendSources = trendSnapshotIds.map((sourceId) =>
    grounding.facts.find(
      (source) =>
        source.sourceType === "PROGRESS_SNAPSHOT" &&
        source.sourceId === sourceId &&
        source.field === "progressPercent",
    )!,
  );
  const report = recommendationReportSchema.parse({
    schemaVersion: 1,
    language: "mn",
    tenantId: data.tenantId,
    projectId: data.projectId,
    projectCode: data.projectCode,
    projectName: data.projectName,
    asOf: data.asOf,
    executiveSummary: "Нэн тэргүүний эрсдэлүүдэд нотолгоонд суурилсан арга хэмжээ шаардлагатай.",
    riskBrief: {
      posture: "CRITICAL",
      summary: "Төслийн хамаарал, ахиц болон зардлын эрсдэлүүд харилцан нөлөөлж байна.",
      observations: [
        {
          id: "obs-atlas-pattern",
          kind: "PATTERN",
          priority: "CRITICAL",
          confidence: "HIGH",
          direction: null,
          title: "Олон төрлийн эрсдэл давхар илэрсэн",
          summary: "Хугацаа, хамаарал, ахиц болон зардлын асуудлууд нэг төсөлд зэрэг илэрсэн.",
          workItemIds: [...new Set(analysis.issues.map((candidate) => candidate.workItemId))],
          impactRefs: analysis.issues.map((candidate) => candidate.id),
          sources: issueSources,
        },
        {
          id: "obs-atlas-root-cause",
          kind: "ROOT_CAUSE",
          priority: rootCauseIssue.severity,
          confidence: "HIGH",
          direction: null,
          title: "Хамаарлын дараалал зөрчигдсөн",
          summary:
            "Өмнөх ажил дуусаагүй байхад дараагийн ажил эхэлсэн нь хамаарлын эрсдэлийг үүсгэсэн.",
          workItemIds: [rootCauseIssue.workItemId],
          impactRefs: [rootCauseIssue.id],
          sources: [rootCauseIssueSource, dependencySource],
        },
        {
          id: "obs-atlas-trend",
          kind: "TREND",
          priority: trendIssue.severity,
          confidence: "HIGH",
          direction: "STABLE",
          title: "Ахиц тогтвортой зогссон",
          summary: "Дараалсан явцын бүртгэлүүдэд ахиц өөрчлөгдөөгүй байна.",
          workItemIds: [trendIssue.workItemId],
          impactRefs: [trendIssue.id],
          sources: [trendIssueSource, ...trendSources],
        },
      ],
    },
    recommendations: [
      {
        id: "rec-overdue-procurement",
        priority: issue.severity,
        workItemId: workItem.id,
        workItemName: workItem.name,
        title: "Хугацаа хоцорсон ажлыг сэргээх",
        action: "Хариуцагчтай гүйцэтгэлийн саадыг нягталж, үлдсэн ажлыг дахин зохион байгуул.",
        rationale: "Төлөвлөсөн хугацаа өнгөрсөн боловч ажил үргэлжилж байна.",
        impactRef: issue.id,
        sources: [issueSource],
      },
    ],
  }) satisfies RecommendationReport;

  return {
    data,
    analysis,
    grounding,
    issue,
    workItem,
    report,
  };
}
