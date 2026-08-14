import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateA4Cases } from "../../src/agent/evaluator.js";
import { A4_GOLDEN_CASES } from "../../src/agent/golden-cases.js";
import { prisma } from "../../src/prisma.js";
import { getWorkItemsCore } from "../../src/tools/work-items.js";

const goldenCase = A4_GOLDEN_CASES[0]!;

beforeAll(async () => {
  const count = await prisma.workItem.count({
    where: { tenantId: "tenant-demo" },
  });

  if (count === 0) {
    throw new Error("Seed data is missing. Run `pnpm.cmd run seed` before A4 evaluator tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function workItemEvidence() {
  return [
    {
      toolName: "lookupWorkItems",
      output: await getWorkItemsCore(
        {
          tenantId: goldenCase.expected.tenantId,
          projectIds: goldenCase.expected.projectIds,
        },
        { limit: 200 },
      ),
    },
  ];
}

describe("A4 evaluator", () => {
  it("passes an exact grounded answer", async () => {
    const report = await evaluateA4Cases({
      cases: [goldenCase],
      generatedAt: "2026-03-01T01:00:00.000Z",
      answer: async () => ({
        answer: {
          schemaVersion: 1,
          language: "mn",
          status: "ANSWERED",
          claims: [
            {
              text: "ATLAS төсөл нийт 9 ажилтай.",
              sources: [
                {
                  toolName: "lookupWorkItems",
                  sourceId: "lookupWorkItems:aggregate",
                  field: "total",
                },
              ],
            },
          ],
        },
        toolResults: await workItemEvidence(),
      }),
    });

    expect(report.passedCases).toBe(1);
    expect(report.groundedCases).toBe(1);
    expect(report.fieldAccuracy).toBe(1);
    expect(report.tools.precision).toBe(1);
    expect(report.sources.recall).toBe(1);
  });

  it("fails grounding and source recall for an invented count", async () => {
    const report = await evaluateA4Cases({
      cases: [goldenCase],
      answer: async () => ({
        answer: {
          schemaVersion: 1,
          language: "mn",
          status: "ANSWERED",
          claims: [
            {
              text: "ATLAS төсөл нийт 10 ажилтай.",
              sources: [
                {
                  toolName: "lookupWorkItems",
                  sourceId: "lookupWorkItems:aggregate",
                  field: "total",
                },
              ],
            },
          ],
        },
        toolResults: await workItemEvidence(),
      }),
    });

    expect(report.passedCases).toBe(0);
    expect(report.groundedCases).toBe(0);
    expect(report.cases[0]?.fields).toContainEqual(
      expect.objectContaining({
        field: "groundingValid",
        actual: false,
        matched: false,
      }),
    );
  });
});
