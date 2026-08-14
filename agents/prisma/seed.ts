import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildSeedData } from "./seed-data.js";
import { prisma } from "../src/prisma.js";
import { assertProductionSeedAllowed } from "../src/runtime/seed-guard.js";
import { A4_GOLDEN_CASES, A4_GOLDEN_SUITE } from "../src/agent/golden-cases.js";
import { A2_GOLDEN_CASES, A2_GOLDEN_SUITE } from "../src/recommendations/golden-cases.js";
import { A3_GOLDEN_CASES, A3_GOLDEN_SUITE } from "../src/reporting/golden-cases.js";
import { A1_GOLDEN_CASES, A1_GOLDEN_SUITE } from "../src/structuring/golden-cases.js";

async function main() {
  assertProductionSeedAllowed();
  const seedData = buildSeedData();

  await prisma.$transaction(async (transaction) => {
    await transaction.tenant.deleteMany({
      where: {
        id: {
          in: seedData.tenants.map((tenant) => tenant.id),
        },
      },
    });
    await transaction.evalCase.deleteMany({
      where: {
        suite: {
          in: [A1_GOLDEN_SUITE, A2_GOLDEN_SUITE, A3_GOLDEN_SUITE, A4_GOLDEN_SUITE],
        },
      },
    });

    await transaction.tenant.createMany({ data: seedData.tenants });
    await transaction.project.createMany({ data: seedData.projects });
    await transaction.workItem.createMany({ data: seedData.workItems });
    await transaction.workItemDependency.createMany({ data: seedData.dependencies });
    await transaction.workItemSnapshot.createMany({ data: seedData.snapshots });
    await transaction.costEntry.createMany({ data: seedData.costEntries });
    await transaction.evalCase.createMany({
      data: [...A1_GOLDEN_CASES, ...A2_GOLDEN_CASES, ...A3_GOLDEN_CASES, ...A4_GOLDEN_CASES].map(
        (goldenCase) => ({
          id: goldenCase.id,
          suite: goldenCase.suite,
          locale: goldenCase.locale,
          inputText: goldenCase.inputText,
          referenceDate: new Date(`${goldenCase.referenceDate}T00:00:00.000Z`),
          expectedOutput: goldenCase.expected,
          scoredFields: goldenCase.scoredFields,
          tags: goldenCase.tags,
        }),
      ),
    });
  });

  const answerKeyPath = resolve(process.cwd(), "data", "answer-key.json");
  await mkdir(dirname(answerKeyPath), { recursive: true });
  await writeFile(answerKeyPath, `${JSON.stringify(seedData.answerKey, null, 2)}\n`, "utf8");

  console.log(
    `Seeded ${seedData.tenants.length} tenants, ${seedData.projects.length} projects, ` +
      `${seedData.workItems.length} work items, ${seedData.answerKey.issues.length} known issues, ` +
      `and ${A1_GOLDEN_CASES.length} A1, ${A2_GOLDEN_CASES.length} A2, ` +
      `${A3_GOLDEN_CASES.length} A3, plus ${A4_GOLDEN_CASES.length} A4 evaluation cases.`,
  );
  console.log(`Answer key written to ${answerKeyPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
