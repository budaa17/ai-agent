import { z } from "zod";

export const issueTypeSchema = z.enum([
  "OVERDUE_WORK_ITEM",
  "STALLED_PROGRESS",
  "DEPENDENCY_VIOLATION",
  "BUDGET_OVERRUN",
  "LEDGER_MISMATCH",
]);

export const issueSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const evidenceValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const answerKeyIssueSchema = z.object({
  id: z.string().min(1),
  type: issueTypeSchema,
  severity: issueSeveritySchema,
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  workItemId: z.string().min(1),
  effectiveFrom: z.string().datetime(),
  summary: z.string().min(1),
  expectedEvidence: z.record(z.string(), evidenceValueSchema),
});

export const answerKeyProjectOutcomeSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  actualFinish: z.string().datetime(),
});

export const answerKeySchema = z.object({
  version: z.literal(1),
  seed: z.string().min(1),
  asOf: z.string().datetime(),
  issues: z.array(answerKeyIssueSchema).min(1),
  projectOutcomes: z.array(answerKeyProjectOutcomeSchema).default([]),
});

export type AnswerKey = z.infer<typeof answerKeySchema>;
export type AnswerKeyIssue = z.infer<typeof answerKeyIssueSchema>;
export type AnswerKeyProjectOutcome = z.infer<typeof answerKeyProjectOutcomeSchema>;
