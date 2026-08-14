import "dotenv/config";
import { prisma } from "../prisma.js";
import { PrismaPlatformDrilldownReadModel } from "../backend/platform-drilldown-read-model.js";
import { PlatformDrilldownService } from "../backend/platform-drilldown-service.js";
import { PrismaPlatformOverviewReadModel } from "../backend/platform-overview-read-model.js";

/**
 * Runs every Phase 5 drill-down query against the local PostgreSQL so raw SQL
 * regressions surface before a browser ever sees them. Repeatable: it only
 * reads, and it follows the same summary → list → detail path an operator does.
 */
async function main(): Promise<void> {
  const service = new PlatformDrilldownService({
    drilldown: new PrismaPlatformDrilldownReadModel(prisma),
    overview: new PrismaPlatformOverviewReadModel(prisma),
  });

  const tenants = await service.tenants({ window: "24h", limit: "5" });
  const agents = await service.agents({ window: "24h", limit: "5" });
  const runs = await service.agentRuns({ window: "30d", limit: "5" });
  const reviewSummary = await service.reviewSummary({ window: "30d" });
  const reviewBacklog = await service.reviewBacklog({ window: "30d", limit: "5" });
  const usage = await service.usage({ window: "30d", groupBy: "TENANT" });
  const systemHealth = await service.systemHealth({});
  const auditLogs = await service.auditLogs({ window: "30d", limit: "5" });
  const tenantAuditLogs = await service.auditLogs({
    window: "30d",
    limit: "25",
    source: "TENANT",
  });
  const platformAuditLogs = await service.auditLogs({
    window: "30d",
    limit: "25",
    source: "PLATFORM",
  });

  const firstTenant = tenants.items.at(0);
  const tenantHealth =
    firstTenant === undefined
      ? null
      : await service.tenantHealth(firstTenant.tenantId, { window: "24h" });
  const firstAgent = agents.items.at(0);
  const agentDetail =
    firstAgent === undefined
      ? null
      : await service.agentDetail(firstAgent.agentType, { window: "24h" });
  const firstRun = runs.items.at(0);
  const diagnostics =
    firstRun === undefined ? null : await service.agentRunDiagnostics(firstRun.runId);

  const responses = {
    tenants,
    agents,
    runs,
    reviewSummary,
    reviewBacklog,
    usage,
    systemHealth,
    auditLogs,
    tenantAuditLogs,
    platformAuditLogs,
    ...(tenantHealth === null ? {} : { tenantHealth }),
    ...(agentDetail === null ? {} : { agentDetail }),
    ...(diagnostics === null ? {} : { diagnostics }),
  };

  const summary = {
    tenants: { matched: tenants.totals.matched, returned: tenants.items.length },
    agents: { matched: agents.totals.matched, degraded: agents.totals.degraded },
    runs: { returned: runs.items.length, hasMore: runs.page.hasMore },
    review: {
      waiting: reviewSummary.backlog.waiting,
      breached: reviewSummary.backlog.breached,
      backlogRows: reviewBacklog.items.length,
    },
    usage: { runs: usage.totals.runs, costMicroUsd: usage.totals.costMicroUsd },
    systemHealth: {
      state: systemHealth.state,
      components: systemHealth.components.map(({ component, state }) => ({ component, state })),
    },
    audit: {
      unifiedReturned: auditLogs.items.length,
      tenantEvents: tenantAuditLogs.items.length,
      platformEvents: platformAuditLogs.items.length,
      tenantRoles: [
        ...new Set(tenantAuditLogs.items.map((item) => item.actorRole).filter(Boolean)),
      ],
      platformRoles: [
        ...new Set(platformAuditLogs.items.map((item) => item.actorRole).filter(Boolean)),
      ],
    },
    tenantHealth: tenantHealth === null ? null : tenantHealth.tenant.health,
    agentDetail: agentDetail === null ? null : agentDetail.agent.state,
    diagnostics: diagnostics === null ? null : diagnostics.redaction.policy,
    partialSections: Object.entries(responses)
      .filter(([, value]) => value.partial)
      .map(([name]) => name),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.partialSections.length > 0) {
    throw new Error(
      `Drill-down smoke returned partial data: ${summary.partialSections.join(", ")}`,
    );
  }

  // Diagnostics must never carry run content. The redaction block legitimately
  // names the withheld fields, so it is excluded before the payload is scanned.
  if (diagnostics !== null) {
    const { redaction: _redaction, ...payload } = diagnostics;
    const serialized = JSON.stringify(payload);
    for (const field of ["researchText", "request", "output", "errorMessage", "validationDetail"]) {
      if (serialized.includes(`"${field}"`)) {
        throw new Error(`Diagnostics leaked a redacted field: ${field}`);
      }
    }
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Platform drill-down smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
