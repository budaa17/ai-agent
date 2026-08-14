import { diffWordsWithSpace } from "diff";
import { distance } from "fastest-levenshtein";
import { z } from "zod";
import { reportNarrativeSchema, type ReportNarrative } from "./schema.js";

const draftChangeSchema = z
  .object({
    type: z.enum(["ADDED", "REMOVED", "UNCHANGED"]),
    value: z.string(),
    tokenCount: z.number().int().nonnegative(),
  })
  .strict();

export const draftComparisonSchema = z
  .object({
    aiCharacterCount: z.number().int().nonnegative(),
    editedCharacterCount: z.number().int().nonnegative(),
    editDistance: z.number().int().nonnegative(),
    similarity: z.number().min(0).max(1),
    addedTokenCount: z.number().int().nonnegative(),
    removedTokenCount: z.number().int().nonnegative(),
    changes: z.array(draftChangeSchema),
  })
  .strict();

export type DraftComparison = z.infer<typeof draftComparisonSchema>;

function tokenCount(value: string) {
  const tokens = value.trim().match(/\S+/gu);
  return tokens?.length ?? 0;
}

export function reportNarrativeToMarkdown(narrativeInput: ReportNarrative) {
  const narrative = reportNarrativeSchema.parse(narrativeInput);

  return [
    "# Удирдлагын хураангуй",
    "",
    narrative.executiveOverview,
    "",
    "## Эрсдэлийн тайлбар",
    "",
    narrative.riskNarrative,
    "",
    "## Зөвлөмжийн тайлбар",
    "",
    narrative.recommendationNarrative,
    "",
    "## Дүгнэлт",
    "",
    narrative.conclusion,
    "",
  ].join("\n");
}

export function compareDrafts(aiDraft: string, editedDraft: string): DraftComparison {
  const changes = diffWordsWithSpace(aiDraft, editedDraft).map((change) => ({
    type: change.added
      ? ("ADDED" as const)
      : change.removed
        ? ("REMOVED" as const)
        : ("UNCHANGED" as const),
    value: change.value,
    tokenCount: tokenCount(change.value),
  }));
  const editDistance = distance(aiDraft, editedDraft);
  const maximumLength = Math.max(aiDraft.length, editedDraft.length);

  return draftComparisonSchema.parse({
    aiCharacterCount: aiDraft.length,
    editedCharacterCount: editedDraft.length,
    editDistance,
    similarity: maximumLength === 0 ? 1 : Math.max(0, 1 - editDistance / maximumLength),
    addedTokenCount: changes
      .filter((change) => change.type === "ADDED")
      .reduce((total, change) => total + change.tokenCount, 0),
    removedTokenCount: changes
      .filter((change) => change.type === "REMOVED")
      .reduce((total, change) => total + change.tokenCount, 0),
    changes,
  });
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatDraftComparisonMarkdown(comparisonInput: DraftComparison) {
  const comparison = draftComparisonSchema.parse(comparisonInput);
  const changes = comparison.changes
    .map((change) => {
      if (change.type === "ADDED") {
        return `++${change.value}++`;
      }

      if (change.type === "REMOVED") {
        return `~~${change.value}~~`;
      }

      return change.value;
    })
    .join("");

  return [
    "# AI Draft Edit Comparison",
    "",
    `- Edit distance: ${comparison.editDistance}`,
    `- Similarity: ${percentage(comparison.similarity)}`,
    `- Added tokens: ${comparison.addedTokenCount}`,
    `- Removed tokens: ${comparison.removedTokenCount}`,
    "",
    "## Changes",
    "",
    changes,
    "",
  ].join("\n");
}
