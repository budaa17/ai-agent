import "dotenv/config";
import { prisma } from "../prisma.js";
import { PrismaPlatformOverviewReadModel } from "../backend/platform-overview-read-model.js";
import { PlatformOverviewService } from "../backend/platform-overview-service.js";

async function main(): Promise<void> {
  const overview = await new PlatformOverviewService(
    new PrismaPlatformOverviewReadModel(prisma),
  ).overview({ window: "24h" });

  const summary = {
    schemaVersion: overview.schemaVersion,
    partial: overview.partial,
    problems: overview.problems,
    platformStatus: overview.platformStatus.state,
    tenantTotal: overview.kpis.tenantHealth.total,
    agentTerminal: overview.kpis.agentCompletion.terminal,
    attentionTotal: overview.attention.total,
    components: overview.systemHealth.components.map(({ component, state }) => ({
      component,
      state,
    })),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (overview.partial) {
    const sections = [...new Set(overview.problems.map(({ section }) => section))].join(", ");
    throw new Error(`Platform overview smoke returned partial data: ${sections}`);
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Platform overview smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
