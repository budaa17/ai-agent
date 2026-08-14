import { prisma } from "../prisma.js";
import { PrismaPhase9Store } from "../backend/prisma-store.js";

async function main() {
  const projectId = process.argv.slice(2).find((value) => value !== "--")?.trim();
  if (projectId === undefined || projectId.length === 0) {
    throw new Error("Usage: pnpm backfill:applied-baselines -- <projectId>");
  }
  const baseline = await prisma.baselineVersion.findFirst({
    where: { projectId, status: "APPLIED" },
    orderBy: { versionNumber: "desc" },
  });
  if (baseline === null) throw new Error(`Applied baseline not found for project: ${projectId}`);

  const store = new PrismaPhase9Store(prisma);
  await store.transaction(async (transaction) => {
    const snapshot = await transaction.getVersionSnapshot(
      baseline.tenantId,
      baseline.projectId,
      baseline.id,
    );
    if (snapshot === null) throw new Error(`Baseline snapshot not found: ${baseline.id}`);
    await transaction.materializeAppliedVersion(
      baseline.tenantId,
      baseline.projectId,
      snapshot,
      (baseline.appliedAt ?? new Date()).toISOString(),
    );
  });
  const workItemCount = await prisma.workItem.count({
    where: { tenantId: baseline.tenantId, projectId: baseline.projectId },
  });

  process.stdout.write(
    `Applied baseline backfill: project=${projectId} workItems=${workItemCount}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Applied baseline backfill failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
