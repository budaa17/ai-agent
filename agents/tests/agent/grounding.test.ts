import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildA4SourceCatalog, validateA4Grounding } from "../../src/agent/grounding.js";
import { prisma } from "../../src/prisma.js";
import { getWorkItemsCore } from "../../src/tools/work-items.js";

const context = {
  tenantId: "tenant-demo",
  projectIds: ["project-atlas"],
};

beforeAll(async () => {
  const count = await prisma.workItem.count({
    where: { tenantId: context.tenantId },
  });

  if (count === 0) {
    throw new Error("Seed data is missing. Run `pnpm.cmd run seed` before A4 tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("A4 source grounding", () => {
  it("builds exact aggregate and entity facts from tool output", async () => {
    const output = await getWorkItemsCore(context, { limit: 20 });
    const catalog = buildA4SourceCatalog([{ toolName: "lookupWorkItems", output }]);

    expect(catalog).toContainEqual({
      toolName: "lookupWorkItems",
      sourceType: "AGGREGATE",
      sourceId: "lookupWorkItems:aggregate",
      field: "total",
      value: 9,
    });
    expect(catalog).toContainEqual({
      toolName: "lookupWorkItems",
      sourceType: "WORK_ITEM",
      sourceId: "wi-atlas-procurement",
      field: "progressPercent",
      value: 75,
    });
  });

  it("accepts exact source-backed numbers, dates, and status", async () => {
    const output = await getWorkItemsCore(context, { limit: 20 });
    const validation = validateA4Grounding(
      {
        schemaVersion: 1,
        language: "mn",
        status: "ANSWERED",
        claims: [
          {
            text: "wi-atlas-procurement ажил IN_PROGRESS төлөвтэй, явц 75 хувь, төлөвлөсөн төгсгөл 2026-02-20.",
            sources: [
              {
                toolName: "lookupWorkItems",
                sourceId: "wi-atlas-procurement",
                field: "status",
              },
              {
                toolName: "lookupWorkItems",
                sourceId: "wi-atlas-procurement",
                field: "progressPercent",
              },
              {
                toolName: "lookupWorkItems",
                sourceId: "wi-atlas-procurement",
                field: "plannedEnd",
              },
            ],
          },
        ],
      },
      [{ toolName: "lookupWorkItems", output }],
    );

    expect(validation.valid).toBe(true);
    expect(validation.resolvedSources).toHaveLength(3);
  });

  it("rejects invented sources and unsupported values", async () => {
    const output = await getWorkItemsCore(context, { limit: 20 });
    const validation = validateA4Grounding(
      {
        schemaVersion: 1,
        language: "mn",
        status: "ANSWERED",
        claims: [
          {
            text: "Зохиомол ажил 88 хувьтай.",
            sources: [
              {
                toolName: "lookupWorkItems",
                sourceId: "wi-invented",
                field: "progressPercent",
              },
            ],
          },
        ],
      },
      [{ toolName: "lookupWorkItems", output }],
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("absent from authorized tool evidence"),
        expect.stringContaining("Numeric claim 88"),
      ]),
    );
  });
});
