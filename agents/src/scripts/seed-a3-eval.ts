import "dotenv/config";

import { prisma } from "../prisma.js";
import { A3_GOLDEN_CASES, A3_GOLDEN_SUITE } from "../reporting/golden-cases.js";

async function main() {
  await prisma.$transaction(async (transaction) => {
    await transaction.evalCase.deleteMany({
      where: { suite: A3_GOLDEN_SUITE },
    });
    await transaction.evalCase.createMany({
      data: A3_GOLDEN_CASES.map((goldenCase) => ({
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

  console.log(`Seeded ${A3_GOLDEN_CASES.length} A3 golden evaluation cases.`);
}

void main()
  .catch((error) => {
    console.error(
      `A3 evaluation seed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
