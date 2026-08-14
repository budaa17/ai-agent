import { describe, expect, it } from "vitest";
import type { QuantityGenerationRequestV1 } from "../../src/baseline-generation/contracts.js";
import {
  buildPhase7Decision,
  buildPhase7QuantityRequest,
} from "../../src/baseline-generation/fixtures.js";
import {
  compareQuantityVersions,
  generateQuantityTakeoffDraft,
  phase7QuantityFormulaRegistry,
  approveQuantityTakeoff,
  reviewQuantityDraft,
} from "../../src/baseline-generation/quantity.js";
import {
  convertMeasurement,
  parseExactDecimal,
  roundExactDecimal,
  formatExactDecimal,
} from "../../src/baseline-generation/decimal.js";
import { phase7Hash } from "../../src/baseline-generation/deterministic.js";
import { runPhase7GoldenPipeline } from "../../src/baseline-generation/pipeline.js";

describe("Phase 7 exact decimal and unit policy", () => {
  it("converts canonical measurement families without binary floating point", () => {
    expect(convertMeasurement("1000", "mm", "m", 3)).toBe("1");
    expect(convertMeasurement("25000", "cm2", "m2", 2)).toBe("2.5");
    expect(convertMeasurement("1000000000", "mm3", "m3", 3)).toBe("1");
    expect(convertMeasurement("1.2345", "m", "mm", 1)).toBe("1234.5");
    expect(() => convertMeasurement("1", "m", "m2")).toThrow("Cannot convert");
  });

  it("uses ROUND_HALF_UP at positive, negative, and boundary values", () => {
    expect(
      formatExactDecimal(roundExactDecimal(parseExactDecimal("1.005"), 2), {
        fixedScale: 2,
        trimTrailingZeros: false,
      }),
    ).toBe("1.01");
    expect(
      formatExactDecimal(roundExactDecimal(parseExactDecimal("-1.005"), 2), {
        fixedScale: 2,
        trimTrailingZeros: false,
      }),
    ).toBe("-1.01");
    expect(formatExactDecimal(roundExactDecimal(parseExactDecimal("0"), 3))).toBe("0");
  });
});

describe("Phase 7 deterministic quantity takeoff", () => {
  it("registers and executes all five required formula families", () => {
    expect([...phase7QuantityFormulaRegistry.keys()].sort()).toEqual([
      "qty-area-net-openings-v1",
      "qty-area-rectangle-v1",
      "qty-count-v1",
      "qty-length-v1",
      "qty-volume-rectangular-v1",
    ]);
    const result = generateQuantityTakeoffDraft(buildPhase7QuantityRequest());
    expect(result.issues).toEqual([]);
    expect(result.traces).toHaveLength(5);
    expect(
      result.draft?.content.items.map((item) => [
        item.itemId,
        item.finalQuantity.value,
        item.finalQuantity.unit,
      ]),
    ).toEqual([
      ["item-beam", "8", "m"],
      ["item-door", "1", "pcs"],
      ["item-floor", "16.5", "m2"],
      ["item-slab", "3", "m3"],
      ["item-wall", "28", "m2"],
    ]);
    expect(
      result.draft?.content.items.every(
        (item) =>
          item.sourceRefs.length > 0 &&
          item.formula.roundingMode === "ROUND_HALF_UP" &&
          item.formula.reviewedBy === "user-engineer",
      ),
    ).toBe(true);
  });

  it("is stable when candidate and item input order changes", () => {
    const firstRequest = buildPhase7QuantityRequest();
    const secondRequest = buildPhase7QuantityRequest();
    secondRequest.candidates.reverse();
    secondRequest.items.reverse();
    const first = generateQuantityTakeoffDraft(firstRequest);
    const second = generateQuantityTakeoffDraft(secondRequest);
    expect(first.draft).not.toBeNull();
    expect(second.draft).not.toBeNull();
    expect(phase7Hash(first.draft?.content)).toBe(phase7Hash(second.draft?.content));
  });

  it("emits no final row for a source-less candidate", () => {
    const malformed = structuredClone(buildPhase7QuantityRequest());
    malformed.candidates[0]!.sourceRefs = [];
    const result = generateQuantityTakeoffDraft(
      malformed as unknown as QuantityGenerationRequestV1,
    );
    expect(result.draft).toBeNull();
    expect(result.issues.some((issue) => issue.code === "INVALID_QUANTITY_REQUEST")).toBe(true);
  });

  it("emits no metric quantity for a candidate using the wrong scale", () => {
    const request = buildPhase7QuantityRequest();
    request.candidates = [
      request.candidates.find((item) => item.candidateId === "candidate-floor")!,
    ];
    request.candidates[0]!.scaleId = "another-scale";
    request.items = [
      {
        itemId: "item-floor",
        elementCandidateId: "candidate-floor",
        workCode: "FLOOR-TILE",
        formulaId: "qty-area-rectangle-v1",
        dimensionInputIds: ["floor-length", "floor-width"],
        adjustment: null,
      },
    ];
    const result = generateQuantityTakeoffDraft(request);
    expect(result.draft).toBeNull();
    expect(result.issues.some((issue) => issue.code === "QUANTITY_SCALE_MISMATCH")).toBe(true);
  });

  it("rejects negative dimensions and opening deductions above gross area", () => {
    const negative = buildPhase7QuantityRequest();
    negative.candidates = [
      negative.candidates.find((item) => item.candidateId === "candidate-beam")!,
    ];
    negative.candidates[0]!.dimensions[0]!.quantity.value = "-1";
    negative.items = [negative.items.find((item) => item.itemId === "item-beam")!];
    expect(generateQuantityTakeoffDraft(negative).draft).toBeNull();

    const excessiveOpening = buildPhase7QuantityRequest();
    excessiveOpening.candidates
      .find((item) => item.candidateId === "candidate-door")!
      .dimensions.find((item) => item.dimensionId === "door-area")!.quantity.value = "40";
    excessiveOpening.items = [excessiveOpening.items.find((item) => item.itemId === "item-wall")!];
    const excessiveResult = generateQuantityTakeoffDraft(excessiveOpening);
    expect(excessiveResult.draft).toBeNull();
    expect(
      excessiveResult.issues.some(
        (issue) =>
          issue.code === "QUANTITY_FORMULA_EVALUATION_FAILED" &&
          issue.message.includes("cannot exceed"),
      ),
    ).toBe(true);
  });

  it("requires matching engineer review before estimator approval", () => {
    const result = generateQuantityTakeoffDraft(buildPhase7QuantityRequest());
    const draft = result.draft!;
    const review = reviewQuantityDraft({
      reviewId: "review-test",
      draft,
      decision: buildPhase7Decision("ENGINEER_REVIEW"),
    });
    const changedDraft = structuredClone(draft);
    changedDraft.content.items[0]!.finalQuantity.value = "999";
    expect(() =>
      approveQuantityTakeoff({
        commandId: "command-invalid",
        idempotencyKey: "idempotency-invalid",
        quantityTakeoffVersionId: "quantity-version-invalid",
        draft: changedDraft,
        engineerReview: review,
        decision: buildPhase7Decision("QUANTITY_APPROVAL"),
      }),
    ).toThrow("matching engineer approval");
  });

  it("creates immutable versions and compares an engineer-adjusted revision", () => {
    const initial = runPhase7GoldenPipeline().quantityCommand.approvedVersion;
    const request = buildPhase7QuantityRequest();
    request.draftId = "quantity-draft-phase7-v2";
    const floor = request.items.find((item) => item.itemId === "item-floor")!;
    floor.adjustment!.quantity.value = "1";
    const result = generateQuantityTakeoffDraft(request);
    const review = reviewQuantityDraft({
      reviewId: "quantity-review-v2",
      draft: result.draft!,
      decision: buildPhase7Decision("ENGINEER_REVIEW"),
    });
    const command = approveQuantityTakeoff({
      commandId: "quantity-command-v2",
      idempotencyKey: "quantity-idempotency-v2",
      quantityTakeoffVersionId: "quantity-version-phase7-v2",
      draft: result.draft!,
      engineerReview: review,
      decision: buildPhase7Decision("QUANTITY_APPROVAL"),
      previousVersion: initial,
    });
    const comparison = compareQuantityVersions(initial, command.approvedVersion);
    expect(command.approvedVersion.metadata).toMatchObject({
      version: 2,
      supersedesVersionId: "quantity-version-phase7",
    });
    expect(comparison.changes.filter((change) => change.changeType === "CHANGED")).toEqual([
      expect.objectContaining({
        itemId: "item-floor",
        previousValue: "16.5",
        currentValue: "17",
      }),
    ]);
    expect(Object.isFrozen(command.approvedVersion.content)).toBe(true);
  });
});
