import { z } from "zod";

export const a4ToolNameSchema = z.enum([
  "lookupWorkItems",
  "lookupDependencies",
  "lookupProgressHistory",
  "lookupCostLedger",
]);

export const a4AnswerStatusSchema = z.enum(["ANSWERED", "INSUFFICIENT_EVIDENCE"]);

export const a4SourceReferenceSchema = z
  .object({
    toolName: a4ToolNameSchema,
    sourceId: z.string().trim().min(1).max(200),
    field: z.string().trim().min(1).max(200),
  })
  .strict();

export const a4AnswerClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(2_000),
    sources: z.array(a4SourceReferenceSchema).max(12),
  })
  .strict();

export const a4AnswerSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.literal("mn"),
    status: a4AnswerStatusSchema,
    claims: z.array(a4AnswerClaimSchema).min(1).max(12),
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.status !== "ANSWERED") {
      return;
    }

    answer.claims.forEach((claim, claimIndex) => {
      if (claim.sources.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Every answered claim requires at least one source",
          path: ["claims", claimIndex, "sources"],
        });
      }
    });
  });

export type A4ToolName = z.infer<typeof a4ToolNameSchema>;
export type A4AnswerStatus = z.infer<typeof a4AnswerStatusSchema>;
export type A4SourceReference = z.infer<typeof a4SourceReferenceSchema>;
export type A4Answer = z.infer<typeof a4AnswerSchema>;

export function formatA4Answer(answerInput: A4Answer) {
  const answer = a4AnswerSchema.parse(answerInput);
  return answer.claims.map((claim) => claim.text).join("\n");
}

export function collectA4SourceReferences(answerInput: A4Answer) {
  const answer = a4AnswerSchema.parse(answerInput);
  const unique = new Map<string, A4SourceReference>();

  for (const claim of answer.claims) {
    for (const source of claim.sources) {
      const key = [source.toolName, source.sourceId, source.field].join("\u0000");
      unique.set(key, source);
    }
  }

  return [...unique.values()];
}
