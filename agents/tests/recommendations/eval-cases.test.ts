import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import {
  A2_GOLDEN_CASES,
  A2_GOLDEN_SUITE,
  a2GoldenCaseSchema,
} from "../../src/recommendations/golden-cases.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("A2 evaluation cases in PostgreSQL", () => {
  it("stores every A2 golden case", async () => {
    const rows = await prisma.evalCase.findMany({
      where: { suite: A2_GOLDEN_SUITE, enabled: true },
      orderBy: { id: "asc" },
    });

    expect(rows).toHaveLength(A2_GOLDEN_CASES.length);

    for (const row of rows) {
      expect(() =>
        a2GoldenCaseSchema.parse({
          id: row.id,
          suite: row.suite,
          locale: row.locale,
          inputText: row.inputText,
          referenceDate: row.referenceDate.toISOString().slice(0, 10),
          expected: row.expectedOutput,
          scoredFields: row.scoredFields,
          tags: row.tags,
        }),
      ).not.toThrow();
    }
  });
});
