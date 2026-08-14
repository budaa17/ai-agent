import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, WorkItemStatus } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { answerKeySchema, type AnswerKeyIssue } from "../answer-key.js";
import { A4_GOLDEN_CASES, A4_GOLDEN_SUITE } from "../agent/golden-cases.js";
import { prisma } from "../prisma.js";
import { A2_GOLDEN_CASES, A2_GOLDEN_SUITE } from "../recommendations/golden-cases.js";
import { A3_GOLDEN_CASES, A3_GOLDEN_SUITE } from "../reporting/golden-cases.js";
import { A1_GOLDEN_CASES, A1_GOLDEN_SUITE } from "../structuring/golden-cases.js";

async function verifyIssue(issue: AnswerKeyIssue, asOf: Date) {
  const workItem = await prisma.workItem.findUnique({
    where: { id: issue.workItemId },
    include: {
      snapshots: {
        orderBy: { capturedAt: "asc" },
      },
      successorLinks: {
        include: { predecessor: true },
      },
      costEntries: true,
    },
  });

  assert(workItem, `Missing work item ${issue.workItemId}`);
  assert.equal(workItem.tenantId, issue.tenantId, `${issue.id} tenant mismatch`);
  assert.equal(workItem.projectId, issue.projectId, `${issue.id} project mismatch`);

  switch (issue.type) {
    case "OVERDUE_WORK_ITEM":
      assert(workItem.actualEnd === null, `${issue.id} is already complete`);
      assert(workItem.plannedEnd < asOf, `${issue.id} is not overdue`);
      assert.notEqual(
        workItem.status,
        WorkItemStatus.COMPLETED,
        `${issue.id} has completed status`,
      );
      break;
    case "STALLED_PROGRESS": {
      const previous = workItem.snapshots.at(-2);
      const current = workItem.snapshots.at(-1);
      assert(previous && current, `${issue.id} needs at least two snapshots`);
      assert.equal(
        previous.progressPercent,
        current.progressPercent,
        `${issue.id} progress changed`,
      );
      assert(
        differenceInCalendarDays(current.capturedAt, previous.capturedAt) >= 7,
        `${issue.id} has not been stalled for seven days`,
      );
      break;
    }
    case "DEPENDENCY_VIOLATION":
      assert(workItem.actualStart, `${issue.id} successor has not started`);
      assert(
        workItem.successorLinks.some(
          ({ predecessor }) =>
            predecessor.actualEnd === null || predecessor.actualEnd > workItem.actualStart!,
        ),
        `${issue.id} has no unfinished predecessor`,
      );
      break;
    case "BUDGET_OVERRUN":
      assert(workItem.actualCost.gt(workItem.budget), `${issue.id} is not over budget`);
      break;
    case "LEDGER_MISMATCH": {
      const ledgerTotal = workItem.costEntries.reduce(
        (total, entry) => total.add(entry.amount),
        new Prisma.Decimal(0),
      );
      assert(!ledgerTotal.equals(workItem.actualCost), `${issue.id} ledger already reconciles`);
      break;
    }
  }
}

async function main() {
  const answerKeyPath = resolve(process.cwd(), "data", "answer-key.json");
  const answerKey = answerKeySchema.parse(JSON.parse(await readFile(answerKeyPath, "utf8")));
  const asOf = new Date(answerKey.asOf);

  for (const issue of answerKey.issues) {
    await verifyIssue(issue, asOf);
  }

  const seededTenantIds = ["tenant-demo", "tenant-isolation"];
  const [
    tenantCount,
    projectCount,
    workItemCount,
    dependencyCount,
    snapshotCount,
    costEntryCount,
    a1EvalCaseCount,
    a2EvalCaseCount,
    a3EvalCaseCount,
    a4EvalCaseCount,
  ] = await Promise.all([
    prisma.tenant.count({ where: { id: { in: seededTenantIds } } }),
    prisma.project.count({ where: { tenantId: { in: seededTenantIds } } }),
    prisma.workItem.count({ where: { tenantId: { in: seededTenantIds } } }),
    prisma.workItemDependency.count({ where: { tenantId: { in: seededTenantIds } } }),
    prisma.workItemSnapshot.count({ where: { tenantId: { in: seededTenantIds } } }),
    prisma.costEntry.count({ where: { tenantId: { in: seededTenantIds } } }),
    prisma.evalCase.count({ where: { suite: A1_GOLDEN_SUITE, enabled: true } }),
    prisma.evalCase.count({ where: { suite: A2_GOLDEN_SUITE, enabled: true } }),
    prisma.evalCase.count({ where: { suite: A3_GOLDEN_SUITE, enabled: true } }),
    prisma.evalCase.count({ where: { suite: A4_GOLDEN_SUITE, enabled: true } }),
  ]);

  assert.equal(tenantCount, 2, "Expected both deterministic tenants");
  assert.equal(projectCount, 3, "Expected three deterministic projects");
  assert.equal(workItemCount, 12, "Expected twelve deterministic work items");
  assert.equal(dependencyCount, 10, "Expected ten deterministic dependencies");
  assert.equal(snapshotCount, 11, "Expected eleven deterministic snapshots");
  assert.equal(costEntryCount, 12, "Expected twelve deterministic cost entries");
  assert.equal(a1EvalCaseCount, A1_GOLDEN_CASES.length, "Expected every A1 golden evaluation case");
  assert.equal(a2EvalCaseCount, A2_GOLDEN_CASES.length, "Expected every A2 golden evaluation case");
  assert.equal(a3EvalCaseCount, A3_GOLDEN_CASES.length, "Expected every A3 golden evaluation case");
  assert.equal(a4EvalCaseCount, A4_GOLDEN_CASES.length, "Expected every A4 golden evaluation case");

  console.log(
    `Verified ${answerKey.issues.length} answer-key issues, ${workItemCount} work items, ` +
      `and ${a1EvalCaseCount} A1, ${a2EvalCaseCount} A2, ${a3EvalCaseCount} A3, plus ${a4EvalCaseCount} A4 evaluation cases against PostgreSQL.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
