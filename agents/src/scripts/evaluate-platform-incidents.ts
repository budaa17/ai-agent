import "dotenv/config";
import { prisma } from "../prisma.js";
import { PlatformAlertEvaluator } from "../backend/platform-alert-evaluator.js";
import { PrismaPlatformIncidentStore } from "../backend/platform-incident-store.js";
import { PrismaPlatformOverviewReadModel } from "../backend/platform-overview-read-model.js";
import { PlatformOverviewService } from "../backend/platform-overview-service.js";

/**
 * Turns the current derived signals into persistent incidents. This is the only
 * write path for incident creation, so the read-only overview endpoint never
 * mutates state while serving a GET. Safe to run on a schedule: it deduplicates
 * by signal identity and refuses to auto-resolve while any source is unreadable.
 */
async function main(): Promise<void> {
  const incidents = new PrismaPlatformIncidentStore(prisma);
  const evaluator = new PlatformAlertEvaluator({
    overview: new PlatformOverviewService(
      new PrismaPlatformOverviewReadModel(prisma),
      undefined,
      incidents,
    ),
    incidents,
  });

  const result = await evaluator.evaluate({ window: "24h" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Platform incident evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
