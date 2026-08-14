import { z } from "zod";
import { answerKeySchema, type AnswerKey, type AnswerKeyIssue } from "../answer-key.js";
import { detectedIssueSchema, type DetectedIssue } from "./schema.js";

const issueIdentitySchema = z.string().min(1);

export const answerKeyEvaluationSchema = z
  .object({
    expectedCount: z.number().int().nonnegative(),
    detectedCount: z.number().int().nonnegative(),
    truePositiveCount: z.number().int().nonnegative(),
    falsePositiveCount: z.number().int().nonnegative(),
    falseNegativeCount: z.number().int().nonnegative(),
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
    f1: z.number().min(0).max(1),
    matched: z.array(issueIdentitySchema),
    missing: z.array(issueIdentitySchema),
    unexpected: z.array(issueIdentitySchema),
  })
  .strict();

export type AnswerKeyEvaluation = z.infer<typeof answerKeyEvaluationSchema>;

function issueIdentity(
  issue: Pick<AnswerKeyIssue | DetectedIssue, "type" | "projectId" | "workItemId">,
) {
  return `${issue.type}:${issue.projectId}:${issue.workItemId}`;
}

function ratio(numerator: number, denominator: number, emptyValue: number) {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

export function evaluateIssuesAgainstAnswerKey(
  detectedIssues: readonly DetectedIssue[],
  answerKey: AnswerKey,
  scope: { tenantId: string; projectId: string },
): AnswerKeyEvaluation {
  const parsedAnswerKey = answerKeySchema.parse(answerKey);
  const parsedDetectedIssues = z.array(detectedIssueSchema).parse(detectedIssues);
  const expectedIdentities = new Set(
    parsedAnswerKey.issues
      .filter((issue) => issue.tenantId === scope.tenantId && issue.projectId === scope.projectId)
      .map(issueIdentity),
  );
  const detectedIdentities = new Set(
    parsedDetectedIssues
      .filter((issue) => issue.tenantId === scope.tenantId && issue.projectId === scope.projectId)
      .map(issueIdentity),
  );
  const matched = [...expectedIdentities]
    .filter((identity) => detectedIdentities.has(identity))
    .sort();
  const missing = [...expectedIdentities]
    .filter((identity) => !detectedIdentities.has(identity))
    .sort();
  const unexpected = [...detectedIdentities]
    .filter((identity) => !expectedIdentities.has(identity))
    .sort();
  const precision = ratio(
    matched.length,
    detectedIdentities.size,
    expectedIdentities.size === 0 ? 1 : 0,
  );
  const recall = ratio(matched.length, expectedIdentities.size, 1);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return answerKeyEvaluationSchema.parse({
    expectedCount: expectedIdentities.size,
    detectedCount: detectedIdentities.size,
    truePositiveCount: matched.length,
    falsePositiveCount: unexpected.length,
    falseNegativeCount: missing.length,
    precision,
    recall,
    f1,
    matched,
    missing,
    unexpected,
  });
}
