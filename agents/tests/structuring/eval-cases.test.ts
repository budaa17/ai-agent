import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import {
  A1_GOLDEN_CASES,
  A1_GOLDEN_SUITE,
  a1GoldenCaseSchema,
} from "../../src/structuring/golden-cases.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seeded A1 evaluation cases", () => {
  it("stores every golden case in PostgreSQL", async () => {
    const rows = await prisma.evalCase.findMany({
      where: { suite: A1_GOLDEN_SUITE, enabled: true },
      orderBy: { id: "asc" },
    });

    expect(rows).toHaveLength(A1_GOLDEN_CASES.length);

    for (const row of rows) {
      expect(() =>
        a1GoldenCaseSchema.parse({
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
