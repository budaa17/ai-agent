import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { Phase9ApiError, type Phase9AuthenticatedPrincipal } from "./contracts.js";
import { requireTenantPermission } from "./authorization.js";
import {
  DEFAULT_RULE_GRAPHS,
  invalidateTenantRuleGraphs,
  type ThresholdRuleId,
} from "../production-analysis/rule-engine.js";

const RULE_IDS = Object.keys(DEFAULT_RULE_GRAPHS) as ThresholdRuleId[];

const jdmRuleGraphSchema = z
  .object({
    nodes: z.array(z.record(z.string(), z.unknown())).min(3),
    edges: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

function requireKnownRule(ruleId: string): asserts ruleId is ThresholdRuleId {
  if (!RULE_IDS.includes(ruleId as ThresholdRuleId)) {
    throw new Phase9ApiError("VALIDATION_FAILED", 400, `Unknown ruleId: ${ruleId}`);
  }
}

/**
 * Manages the tenant-scoped GoRules JDM decision tables backing the 7
 * DET-14 threshold rules (see production-analysis/rule-graphs.ts and
 * rule-engine.ts). Every rule always has a usable graph: tenants that have
 * never published a version fall back to DEFAULT_RULE_GRAPHS, so `list`
 * always returns all 7 rule ids.
 */
export class Phase9RulesService {
  constructor(private readonly client: PrismaClient) {}

  async list(principal: Phase9AuthenticatedPrincipal) {
    requireTenantPermission(principal, "RULES_MANAGE");
    const catalogs = await this.client.ruleCatalog.findMany({
      where: { tenantId: principal.tenantId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const byRuleId = new Map(catalogs.map((catalog) => [catalog.ruleId, catalog]));

    return RULE_IDS.map((ruleId) => {
      const catalog = byRuleId.get(ruleId);
      const latest = catalog?.versions[0] ?? null;
      return {
        ruleId,
        source: latest === null ? ("DEFAULT" as const) : ("TENANT" as const),
        latestVersion:
          latest === null
            ? null
            : {
                id: latest.id,
                versionNumber: latest.versionNumber,
                status: latest.status,
              },
      };
    });
  }

  async listVersions(principal: Phase9AuthenticatedPrincipal, ruleId: string) {
    requireTenantPermission(principal, "RULES_MANAGE");
    requireKnownRule(ruleId);
    const catalog = await this.client.ruleCatalog.findUnique({
      where: { tenantId_ruleId: { tenantId: principal.tenantId, ruleId } },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    return {
      ruleId,
      defaultGraph: DEFAULT_RULE_GRAPHS[ruleId],
      versions: catalog?.versions ?? [],
    };
  }

  async saveDraft(principal: Phase9AuthenticatedPrincipal, ruleId: string, jdmGraphInput: unknown) {
    requireTenantPermission(principal, "RULES_MANAGE");
    requireKnownRule(ruleId);
    const jdmGraph = jdmRuleGraphSchema.parse(jdmGraphInput);

    return this.client.$transaction(async (tx) => {
      const catalog = await tx.ruleCatalog.upsert({
        where: {
          tenantId_ruleId: { tenantId: principal.tenantId, ruleId },
        },
        create: { tenantId: principal.tenantId, ruleId, name: ruleId },
        update: {},
      });
      const lastVersion = await tx.ruleCatalogVersion.findFirst({
        where: { catalogId: catalog.id },
        orderBy: { versionNumber: "desc" },
      });
      const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;
      return tx.ruleCatalogVersion.create({
        data: {
          tenantId: principal.tenantId,
          catalogId: catalog.id,
          versionNumber,
          status: "DRAFT",
          jdmGraph: jdmGraph as unknown as Prisma.InputJsonValue,
          createdByUserId: principal.userId,
        },
      });
    });
  }

  async publish(principal: Phase9AuthenticatedPrincipal, ruleId: string, versionId: string) {
    requireTenantPermission(principal, "RULES_MANAGE");
    requireKnownRule(ruleId);

    const published = await this.client.$transaction(async (tx) => {
      const version = await tx.ruleCatalogVersion.findFirst({
        where: { id: versionId, tenantId: principal.tenantId },
        include: { catalog: true },
      });
      if (version === null || version.catalog.ruleId !== ruleId) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Rule version not found");
      }
      await tx.ruleCatalogVersion.updateMany({
        where: {
          tenantId: principal.tenantId,
          catalogId: version.catalogId,
          status: "APPLIED",
        },
        data: { status: "SUPERSEDED" },
      });
      return tx.ruleCatalogVersion.update({
        where: { id: version.id },
        data: {
          status: "APPLIED",
          approvedByUserId: principal.userId,
          approvedAt: new Date(),
        },
      });
    });
    invalidateTenantRuleGraphs(principal.tenantId);
    return published;
  }
}
