import { describe, expect, it } from "vitest";
import {
  compareDrafts,
  formatDraftComparisonMarkdown,
  reportNarrativeToMarkdown,
} from "../../src/reporting/draft.js";
import { buildProjectReportFixture } from "./fixtures.js";

describe("AI draft comparison", () => {
  it("measures human edits with word diff and Levenshtein distance", () => {
    const fixture = buildProjectReportFixture();
    const aiDraft = reportNarrativeToMarkdown(fixture.narrative);
    const editedDraft = aiDraft.replace("анхаарал шаардаж байна", "шуурхай хяналт шаардаж байна");
    const comparison = compareDrafts(aiDraft, editedDraft);

    expect(comparison.editDistance).toBeGreaterThan(0);
    expect(comparison.similarity).toBeGreaterThan(0.9);
    expect(comparison.addedTokenCount).toBeGreaterThan(0);
    expect(comparison.removedTokenCount).toBeGreaterThan(0);
    expect(formatDraftComparisonMarkdown(comparison)).toContain("AI Draft Edit Comparison");
  });

  it("reports identical drafts as fully similar", () => {
    const comparison = compareDrafts("ижил", "ижил");

    expect(comparison.editDistance).toBe(0);
    expect(comparison.similarity).toBe(1);
  });
});
