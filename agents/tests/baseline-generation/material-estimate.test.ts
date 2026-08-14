import { describe, expect, it } from "vitest";
import {
  approveEstimate,
  calculateMaterialRequirements,
  generateEstimateDraft,
} from "../../src/baseline-generation/estimate.js";
import {
  buildPhase7Decision,
  buildPhase7EstimatePolicy,
  buildPhase7MaterialNorms,
  buildPhase7Prices,
  buildPhase7ProductivityRates,
  phase7FixtureTimes,
} from "../../src/baseline-generation/fixtures.js";
import { runPhase7GoldenPipeline } from "../../src/baseline-generation/pipeline.js";

describe("Phase 7 material and estimate", () => {
  it("calculates approved norm and waste requirements deterministically", () => {
    const pipeline = runPhase7GoldenPipeline();
    expect(pipeline.materialResult.complete).toBe(true);
    expect(
      Object.fromEntries(
        pipeline.materialResult.lines.map((line) => [
          line.materialCode,
          `${line.requiredQuantity.value} ${line.requiredQuantity.unit}`,
        ]),
      ),
    ).toEqual({
      "FORMWORK-TIMBER": "0.44 m3",
      "DOOR-UNIT": "1 pcs",
      "TILE-600": "73 pcs",
      "CONCRETE-C30": "3.09 m3",
      "AAC-BLOCK": "235 pcs",
    });
    expect(
      pipeline.materialResult.lines.every(
        (line) =>
          line.normVersion.catalogType === "MATERIAL_NORM" &&
          line.requiredQuantity.sourceRefs.length > 0,
      ),
    ).toBe(true);
  });

  it("blocks the missing norm item instead of fabricating a material row", () => {
    const quantity = runPhase7GoldenPipeline().quantityCommand.approvedVersion;
    const result = calculateMaterialRequirements({
      approvedQuantity: quantity,
      norms: buildPhase7MaterialNorms().filter((norm) => norm.workCode !== "WALL-AAC-200"),
      asOf: "2026-08-03",
      calculatedAt: phase7FixtureTimes.estimateCreated,
    });
    expect(result.complete).toBe(false);
    expect(result.lines.some((line) => line.takeoffItemId === "item-wall")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "MATERIAL_NORM_MISSING")).toBe(true);
  });

  it("does not convert a missing price into a zero-MNT line", () => {
    const pipeline = runPhase7GoldenPipeline();
    const result = generateEstimateDraft({
      draftId: "estimate-missing-price",
      approvedQuantity: pipeline.quantityCommand.approvedVersion,
      materialRequirements: pipeline.materialResult,
      prices: buildPhase7Prices().filter((price) => price.itemCode !== "AAC-BLOCK"),
      productivityRates: buildPhase7ProductivityRates(),
      policy: buildPhase7EstimatePolicy(),
      createdAt: phase7FixtureTimes.estimateCreated,
      createdBy: "A0",
    });
    expect(result.complete).toBe(false);
    expect(result.draft.status).toBe("NEEDS_CORRECTION");
    expect(result.draft.content.lines.some((line) => line.pricedItemCode === "AAC-BLOCK")).toBe(
      false,
    );
    expect(result.draft.content.lines.some((line) => line.unitPriceMnt.value === "0.00")).toBe(
      false,
    );
    expect(result.issues.some((issue) => issue.code === "MATERIAL_PRICE_MISSING")).toBe(true);
    expect(() =>
      approveEstimate({
        commandId: "approve-missing-price",
        idempotencyKey: "approve-missing-price",
        estimateVersionId: "estimate-version-missing-price",
        draft: result.draft,
        decision: buildPhase7Decision("ESTIMATE_APPROVAL"),
      }),
    ).toThrow("complete priced estimate");
  });

  it("selects only effective approved prices and blocks ambiguous precedence", () => {
    const pipeline = runPhase7GoldenPipeline();
    const prices = buildPhase7Prices();
    const aac = prices.find((price) => price.itemCode === "AAC-BLOCK")!;
    aac.version.effectiveFrom = "2026-09-01";
    const expired = generateEstimateDraft({
      draftId: "estimate-future-price",
      approvedQuantity: pipeline.quantityCommand.approvedVersion,
      materialRequirements: pipeline.materialResult,
      prices,
      productivityRates: buildPhase7ProductivityRates(),
      policy: buildPhase7EstimatePolicy(),
      createdAt: phase7FixtureTimes.estimateCreated,
      createdBy: "A0",
    });
    expect(expired.issues.some((issue) => issue.code === "MATERIAL_PRICE_MISSING")).toBe(true);

    const ambiguousPrices = buildPhase7Prices();
    const duplicate = structuredClone(
      ambiguousPrices.find((price) => price.itemCode === "AAC-BLOCK")!,
    );
    duplicate.priceId = "price-aac-conflict";
    duplicate.version.versionId = "version-price-aac-conflict";
    const ambiguous = generateEstimateDraft({
      draftId: "estimate-ambiguous-price",
      approvedQuantity: pipeline.quantityCommand.approvedVersion,
      materialRequirements: pipeline.materialResult,
      prices: [...ambiguousPrices, duplicate],
      productivityRates: buildPhase7ProductivityRates(),
      policy: buildPhase7EstimatePolicy(),
      createdAt: phase7FixtureTimes.estimateCreated,
      createdBy: "A0",
    });
    expect(ambiguous.issues.some((issue) => issue.code === "MATERIAL_PRICE_AMBIGUOUS")).toBe(true);
  });

  it("separates material, labor, equipment, VAT, and contingency", () => {
    const pipeline = runPhase7GoldenPipeline();
    const content = pipeline.estimateCommand.approvedVersion.content;
    expect(pipeline.estimateResult.complete).toBe(true);
    expect(content.lines).toHaveLength(11);
    expect(content.costBreakdownMnt).toMatchObject({
      material: { value: "4737300.00" },
      labor: { value: "1193200.00" },
      equipment: { value: "225000.00" },
    });
    expect(content.subtotalMnt.value).toBe("6155500.00");
    expect(content.taxMnt.value).toBe("615550.00");
    expect(content.contingencyMnt.value).toBe("307775.00");
    expect(content.totalMnt.value).toBe("7078825.00");
    expect(Object.isFrozen(pipeline.estimateCommand.approvedVersion.content)).toBe(true);
  });

  it("rejects approval when a deterministic line cost is altered", () => {
    const pipeline = runPhase7GoldenPipeline();
    const altered = structuredClone(pipeline.estimateResult.draft);
    altered.content.lines[0]!.lineCostMnt.value = "1.00";
    altered.content.subtotalMnt.value = altered.content.lines
      .reduce((sum, line) => sum + Number(line.lineCostMnt.value), 0)
      .toFixed(2);
    expect(() =>
      approveEstimate({
        commandId: "approve-altered-estimate",
        idempotencyKey: "approve-altered-estimate",
        estimateVersionId: "estimate-version-altered",
        draft: altered,
        decision: buildPhase7Decision("ESTIMATE_APPROVAL"),
      }),
    ).toThrow();
  });
});
