import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import {
  A3_GOLDEN_CASES,
  A3_GOLDEN_SUITE,
  a3GoldenCaseSchema,
} from "../../src/reporting/golden-cases.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("A3 evaluation cases in PostgreSQL", () => {
  it("stores every A3 golden case", async () => {
    const rows = await prisma.evalCase.findMany({
      where: { suite: A3_GOLDEN_SUITE, enabled: true },
      orderBy: { id: "asc" },
    });

    expect(rows).toHaveLength(A3_GOLDEN_CASES.length);

    for (const row of rows) {
      expect(() =>
        a3GoldenCaseSchema.parse({
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
