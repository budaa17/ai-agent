import "dotenv/config";

import { A4_GOLDEN_CASES, A4_GOLDEN_SUITE } from "../agent/index.js";
import { prisma } from "../prisma.js";

async function main() {
  await prisma.$transaction(async (transaction) => {
    await transaction.evalCase.deleteMany({
      where: { suite: A4_GOLDEN_SUITE },
    });
    await transaction.evalCase.createMany({
      data: A4_GOLDEN_CASES.map((goldenCase) => ({
        id: goldenCase.id,
        suite: goldenCase.suite,
        locale: goldenCase.locale,
        inputText: goldenCase.inputText,
        referenceDate: new Date(`${goldenCase.referenceDate}T00:00:00.000Z`),
        expectedOutput: goldenCase.expected,
        scoredFields: goldenCase.scoredFields,
        tags: goldenCase.tags,
      })),
    });
  });

  console.log(`Seeded ${A4_GOLDEN_CASES.length} A4 golden evaluation cases.`);
}

void main()
  .catch((error) => {
    console.error(
      `A4 evaluation seed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
