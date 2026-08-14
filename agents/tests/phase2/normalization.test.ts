import { describe, expect, it } from "vitest";
import {
  applyAi7Normalization,
  normalizeBlockerTaxonomy,
  normalizeMaterialAlias,
  normalizeTenantTerm,
  validateAi7Consistency,
  validateAiNormalizationSuggestion,
} from "../../src/phase2/index.js";
import { buildDailyReportDraft, buildProjectAnalysisSnapshot } from "../contracts/fixtures.js";

describe("Phase 2 AI-7 normalization", () => {
  it("normalizes material aliases with reversible provenance", () => {
    const result = normalizeMaterialAlias(
      buildProjectAnalysisSnapshot(),
      "улаан тоосго",
      "materialSignals.0.rawName",
    );

    expect(result).toMatchObject({
      domain: "MATERIAL",
      canonicalRef: "material-001",
      method: "ALIAS",
      confidenceLevel: "HIGH",
      reversible: true,
      requiresHumanReview: false,
    });
    expect(result.provenance.matchedPath).toContain("aliases");
  });

  it("requires review for fuzzy and unknown normalization", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const fuzzy = normalizeMaterialAlias(snapshot, "улаан тоосг", "materialSignals.0.rawName");
    const unknown = normalizeMaterialAlias(
      snapshot,
      "үл мэдэгдэх материал",
      "materialSignals.1.rawName",
    );

    expect(fuzzy.method).toBe("FUZZY");
    expect(fuzzy.requiresHumanReview).toBe(true);
    expect(unknown.method).toBe("NO_MATCH");
    expect(unknown.requiresHumanReview).toBe(true);
  });

  it("normalizes blocker taxonomy and tenant terminology", () => {
    const snapshot = buildProjectAnalysisSnapshot();

    expect(normalizeBlockerTaxonomy(snapshot, "Борооны улмаас ажил түр зогсов").canonicalRef).toBe(
      "WEATHER",
    );
    expect(normalizeTenantTerm(snapshot, "ажил").canonicalRef).toBe("workItem");
  });

  it("rejects an AI suggestion that deterministic data cannot verify", () => {
    const result = validateAiNormalizationSuggestion(buildProjectAnalysisSnapshot(), {
      schemaVersion: 1,
      domain: "MATERIAL",
      sourceValue: "улаан тоосго",
      suggestedCanonicalRef: "material-invented",
      confidenceScore: 0.99,
    });

    expect(result.method).toBe("NO_MATCH");
    expect(result.canonicalRef).toBeNull();
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects cross-domain consistency conflicts", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const draft = buildDailyReportDraft();
    draft.progressEntries[0]!.status = "COMPLETED";
    draft.progressEntries[0]!.quantityDone = "60";
    draft.progressEntries[0]!.progressPercent = 100;
    draft.attendanceEntries = [];

    const issues = validateAi7Consistency(draft, snapshot);

    expect(issues.map((validationIssue) => validationIssue.code)).toContain(
      "AI7_COMPLETED_WITH_UNFINISHED_QUANTITY",
    );
    expect(issues.map((validationIssue) => validationIssue.code)).toContain(
      "AI7_LABOR_COST_WITHOUT_ATTENDANCE",
    );
  });

  it("applies safe matches and preserves low-confidence review gates", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const draft = buildDailyReportDraft();
    draft.materialSignals = [
      {
        signalId: "material-signal-001",
        signalType: "CONSUMED",
        rawName: "улаан тоосго",
        normalizedName: null,
        materialRef: null,
        quantity: "100",
        unit: "ш",
        supplierName: null,
        workItemCodes: ["AT-001"],
        note: null,
        fieldConfidence: [],
      },
      {
        signalId: "material-signal-002",
        signalType: "REQUESTED",
        rawName: "үл мэдэгдэх материал",
        normalizedName: null,
        materialRef: null,
        quantity: null,
        unit: null,
        supplierName: null,
        workItemCodes: ["AT-001"],
        note: null,
        fieldConfidence: [],
      },
    ];

    const result = applyAi7Normalization(draft, snapshot);

    expect(result.draft.materialSignals[0]).toMatchObject({
      materialRef: "material-001",
      normalizedName: snapshot.materials[0]!.name,
    });
    expect(
      result.draft.clarificationQuestions.some(
        (question) => question.fieldPath === "materialSignals.1.rawName",
      ),
    ).toBe(true);
    expect(result.draft.status).toBe("NEEDS_CORRECTION");
  });
});
