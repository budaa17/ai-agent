import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { SupabaseArtifactStorage } from "../backend/supabase-artifact-storage.js";
import { assertProductionSeedAllowed } from "../runtime/seed-guard.js";
import {
  buildArchitectureDrawing,
  buildBillOfQuantities,
  buildSitePhoto,
  buildSpecification,
  buildStructureDrawing,
  type DemoArtifact,
} from "../demo/khan-uul-artifacts.js";
import {
  CREWS,
  DEMO_PROJECT_CODE,
  DEMO_PROJECT_ID,
  DEMO_TENANT_SLUG,
  EQUIPMENT,
  FIXTURE_VERSION,
  MATERIALS,
  PROJECT_METADATA,
  WORK_DEPENDENCIES,
  WORK_PACKAGES,
  addDays,
  buildEstimateLines,
  dailyOperations,
  day,
  estimateTotals,
  forecasts,
  hash,
  isoDay,
  materialFactor,
  workStates,
} from "../demo/khan-uul-fixture.js";

/**
 * Fills every BuildWatch v2.2 stage for one realistic construction project so
 * the console can be demonstrated end to end: design intake, quantities,
 * estimate, schedule, baseline, daily planning, site reporting, verification,
 * forecasting and the review queue.
 *
 * Development and demonstration only. Re-running replaces the demo project.
 */

const HELP_TEXT = `
Usage:
  pnpm.cmd run seed:demo:project -- [options]

Options:
  --tenant <slug>   Tenant slug to seed into (default: ${DEMO_TENANT_SLUG})
  --as-of <date>    Treat this ISO date as "today" (default: current date)
  --days <count>    Working days of plans and reports to generate (default: 14)
  --keep-artifacts  Reuse the PDF/XLSX/photo files already on disk instead of
                    re-rendering them (Chromium startup dominates the runtime)
  --help            Show this help
`.trim();

const METHOD_VERSION = "buildwatch-v22-demo-1.0.0";
const CALENDAR_VERSION = "mn-6day-2026";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when PHASE9_ARTIFACT_STORAGE_PROVIDER=supabase`);
  return value;
}

/**
 * Stable, readable primary keys. Everything is lower-cased before the ASCII
 * filter runs, otherwise codes like `EW-01` would collapse into dashes and
 * collide with each other.
 */
function id(...parts: readonly string[]): string {
  return [DEMO_PROJECT_CODE, ...parts]
    .join("-")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]+/gu, "-");
}

/** Work item ids are referenced from plans, reports, variances and forecasts. */
function workItemId(code: string): string {
  return id("wi", code.toLocaleLowerCase("en-US"));
}

function decimal(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** Returns the artifact already on disk, or null when it has to be rendered. */
async function readArtifact(
  target: string,
  descriptor: { readonly key: string; readonly fileName: string; readonly mediaType: string },
): Promise<DemoArtifact | null> {
  try {
    const body = await readFile(target);
    return {
      key: descriptor.key,
      fileName: descriptor.fileName,
      mediaType: descriptor.mediaType,
      body,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  } catch {
    return null;
  }
}

/** The fixture returns plain readonly objects; Prisma wants its Json input type. */
function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Ledger and approved-version rows are protected by database triggers, so a
 * seeded demo project cannot be dropped with ordinary DELETEs. Re-seeding is a
 * development-only operation, so the guards are lifted for the reset and put
 * back immediately afterwards — production data never travels this path
 * because `assertProductionSeedAllowed` runs before it.
 */
const GUARD_TRIGGERS: readonly (readonly [table: string, trigger: string])[] = [
  ["AppliedCommand", "AppliedCommand_append_only"],
  ["AuditLog", "AuditLog_append_only"],
  ["ConsumedEvent", "ConsumedEvent_append_only"],
  ["CostEntry", "CostEntry_append_only"],
  ["ReviewDecision", "ReviewDecision_append_only"],
  ["StockMovement", "StockMovement_append_only"],
  ["BaselineVersion", "BaselineVersion_immutable_version"],
  ["DailyReport", "DailyReport_immutable_version"],
  ["DailyWorkPlan", "DailyWorkPlan_immutable_version"],
  ["DrawingRevision", "DrawingRevision_immutable_version"],
  ["EstimateVersion", "EstimateVersion_immutable_version"],
  ["MaterialCatalogVersion", "MaterialCatalogVersion_immutable_version"],
  ["NormCatalogVersion", "NormCatalogVersion_immutable_version"],
  ["PriceCatalogVersion", "PriceCatalogVersion_immutable_version"],
  ["ProgressVerification", "ProgressVerification_immutable_version"],
  ["QuantityTakeoffVersion", "QuantityTakeoffVersion_immutable_version"],
  ["RecoveryScenario", "RecoveryScenario_immutable_version"],
  ["ScheduleVersion", "ScheduleVersion_immutable_version"],
];

async function setGuards(enabled: boolean): Promise<void> {
  for (const [table, trigger] of GUARD_TRIGGERS) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ${enabled ? "ENABLE" : "DISABLE"} TRIGGER "${trigger}"`,
    );
  }
}

async function resetDemoProject(tenantId: string): Promise<void> {
  const scope = { tenantId, projectId: DEMO_PROJECT_ID };
  await setGuards(false);
  try {
    // Children first: several relations are ON DELETE RESTRICT, so relying on
    // the Project cascade alone would deadlock on its own dependency order.
    await prisma.elementSourceRef.deleteMany({ where: scope });
    await prisma.elementGeometry.deleteMany({ where: scope });
    await prisma.designElement.deleteMany({ where: scope });
    await prisma.drawingScale.deleteMany({ where: scope });
    await prisma.drawingPage.deleteMany({ where: scope });
    await prisma.drawingRevision.deleteMany({ where: scope });
    await prisma.designDocument.deleteMany({ where: scope });

    await prisma.photoDuplicateFinding.deleteMany({ where: scope });
    await prisma.photoQualityAssessment.deleteMany({ where: scope });
    await prisma.photoEvidenceLink.deleteMany({ where: scope });
    await prisma.photoEvidence.deleteMany({ where: scope });

    await prisma.progressEntry.deleteMany({ where: scope });
    await prisma.attendanceEntry.deleteMany({ where: scope });
    await prisma.dailyReport.deleteMany({ where: scope });

    await prisma.dailyPlanResource.deleteMany({ where: scope });
    await prisma.dailyPlanMaterial.deleteMany({ where: scope });
    await prisma.dailyPlanPrecondition.deleteMany({ where: scope });
    await prisma.dailyWorkPlanItem.deleteMany({ where: scope });
    await prisma.dailyWorkPlan.deleteMany({ where: scope });

    await prisma.stockMovement.deleteMany({ where: scope });
    await prisma.progressVerificationIssue.deleteMany({ where: scope });
    await prisma.progressVerification.deleteMany({ where: scope });
    await prisma.dailyVariance.deleteMany({ where: scope });

    await prisma.forecastWorkItem.deleteMany({ where: scope });
    await prisma.forecastDriver.deleteMany({ where: scope });
    await prisma.recoveryScenario.deleteMany({ where: scope });
    await prisma.forecastSnapshot.deleteMany({ where: scope });

    await prisma.reviewCorrection.deleteMany({ where: scope });
    await prisma.reviewDecision.deleteMany({ where: scope });
    await prisma.appliedCommand.deleteMany({ where: scope });
    await prisma.reviewTask.deleteMany({ where: scope });

    await prisma.baselineVersion.deleteMany({ where: scope });
    await prisma.scheduleDependency.deleteMany({ where: scope });
    await prisma.resourceRequirement.deleteMany({ where: scope });
    await prisma.scheduleActivity.deleteMany({ where: scope });
    await prisma.scheduleVersion.deleteMany({ where: scope });

    await prisma.estimateLine.deleteMany({ where: scope });
    await prisma.estimateAssumption.deleteMany({ where: scope });
    await prisma.estimateScenario.deleteMany({ where: scope });
    await prisma.estimateVersion.deleteMany({ where: scope });

    await prisma.takeoffAdjustment.deleteMany({ where: scope });
    await prisma.quantityTakeoffItem.deleteMany({ where: scope });
    await prisma.quantityTakeoffVersion.deleteMany({ where: scope });

    await prisma.crewAvailability.deleteMany({ where: scope });
    await prisma.crew.deleteMany({ where: scope });
    await prisma.equipmentAvailability.deleteMany({ where: scope });
    await prisma.equipment.deleteMany({ where: scope });

    await prisma.notification.deleteMany({ where: scope });
    await prisma.idempotencyRecord.deleteMany({ where: scope });
    await prisma.outboxEvent.deleteMany({ where: scope });
    await prisma.agentToolReadModel.deleteMany({ where: scope });

    await prisma.workItemSnapshot.deleteMany({ where: scope });
    await prisma.costEntry.deleteMany({ where: scope });
    await prisma.workItemDependency.deleteMany({ where: scope });
    await prisma.workItem.deleteMany({ where: scope });

    await prisma.artifactAccessGrant.deleteMany({ where: scope });
    await prisma.fileAsset.deleteMany({ where: scope });
    await prisma.projectMember.deleteMany({ where: scope });
    await prisma.auditLog.deleteMany({ where: scope });
    await prisma.project.deleteMany({ where: { tenantId, id: DEMO_PROJECT_ID } });

    // Catalog rows are tenant-scoped and may be shared by unrelated projects.
    // Delete only deterministic ids owned by this fixture.
    const materialIds = MATERIALS.map((material) => id("mat", material.code));
    const normIds = WORK_PACKAGES.filter((pkg) => pkg.norm !== undefined).map((pkg) =>
      id("norm", pkg.code),
    );
    const productivityIds = WORK_PACKAGES.filter((pkg) => pkg.productivity !== undefined).map(
      (pkg) => id("rate", pkg.code),
    );
    const priceIds = MATERIALS.map((material) => id("price", material.code));
    await prisma.workNorm.deleteMany({ where: { tenantId, id: { in: normIds } } });
    await prisma.productivityRate.deleteMany({
      where: { tenantId, id: { in: productivityIds } },
    });
    await prisma.priceCatalogEntry.deleteMany({ where: { tenantId, id: { in: priceIds } } });
    await prisma.materialAlias.deleteMany({
      where: { tenantId, materialItemId: { in: materialIds } },
    });
    await prisma.materialItem.deleteMany({ where: { tenantId, id: { in: materialIds } } });
    await prisma.normCatalog.deleteMany({ where: { tenantId, code: "NORM-MN" } });
    await prisma.priceCatalog.deleteMany({ where: { tenantId, code: "PRICE-UB" } });
    await prisma.materialCatalog.deleteMany({ where: { tenantId, code: "MAT-MN" } });
  } finally {
    await setGuards(true);
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }
  assertProductionSeedAllowed();

  const tenantSlug = (argument("--tenant") ?? DEMO_TENANT_SLUG).trim();
  const asOf = (argument("--as-of") ?? isoDay(new Date())).trim();
  const dayCount = Number(argument("--days") ?? "14");
  const keepArtifacts = process.argv.includes("--keep-artifacts");

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(asOf)) {
    throw new Error(`--as-of must be an ISO date, received "${asOf}"`);
  }
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 60) {
    throw new Error("--days must be an integer between 1 and 60");
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (tenant === null) {
    throw new Error(`Tenant ${tenantSlug} was not found; run "pnpm run seed" first`);
  }
  const tenantId = tenant.id;

  const users = await prisma.user.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { id: true, tenantRole: true, displayName: true },
    orderBy: { id: "asc" },
  });
  const byRole = (role: string): string => {
    const match = users.find((user) => user.tenantRole === role);
    if (match === undefined) {
      throw new Error(
        `Tenant ${tenantSlug} has no ${role}; run "pnpm run seed:demo:accounts" first`,
      );
    }
    return match.id;
  };
  const admin = byRole("COMPANY_ADMIN");
  const manager = byRole("PROJECT_MANAGER");
  const engineer = byRole("ENGINEER");
  const supervisor = byRole("SITE_SUPERVISOR");
  const storekeeper = byRole("STOREKEEPER");

  const artifactRoot = resolve(process.env.PHASE9_ARTIFACT_ROOT ?? "data/artifacts");
  const projectArtifactDir = resolve(artifactRoot, tenantId, DEMO_PROJECT_ID);
  const storageProvider = (process.env.PHASE9_ARTIFACT_STORAGE_PROVIDER ?? "local").trim();
  if (storageProvider !== "local" && storageProvider !== "supabase") {
    throw new Error(`Unsupported PHASE9_ARTIFACT_STORAGE_PROVIDER: ${storageProvider}`);
  }
  const remoteStorage =
    storageProvider === "supabase"
      ? new SupabaseArtifactStorage({
          projectUrl: requiredEnvironment("SUPABASE_URL"),
          serviceRoleKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
          bucket: requiredEnvironment("SUPABASE_STORAGE_BUCKET"),
          upsertWrites: true,
        })
      : null;

  // -- Reset ---------------------------------------------------------------
  await resetDemoProject(tenantId);
  if (!keepArtifacts) {
    await rm(projectArtifactDir, { recursive: true, force: true });
  }

  // -- Artifacts -----------------------------------------------------------
  const reports = dailyOperations(asOf, dayCount);
  const photoDays = reports.slice(-3).map((report) => report.date);
  // The key and file name are known without rendering, so `--keep-artifacts`
  // can find an existing file and skip the Chromium round trip entirely.
  const renderers: readonly {
    readonly key: string;
    readonly fileName: string;
    readonly mediaType: string;
    readonly render: () => Promise<DemoArtifact>;
  }[] = [
    {
      key: "architecture",
      fileName: "AR-01-arkhitektur-plan-Rev-C.pdf",
      mediaType: "application/pdf",
      render: buildArchitectureDrawing,
    },
    {
      key: "structure",
      fileName: "ST-01-butets-suuri-Rev-B.pdf",
      mediaType: "application/pdf",
      render: buildStructureDrawing,
    },
    {
      key: "specification",
      fileName: "SP-01-tekhnikiin-uzuulelt.pdf",
      mediaType: "application/pdf",
      render: buildSpecification,
    },
    {
      key: "boq",
      fileName: "BOQ-01-ajliin-too-khemjee.xlsx",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      render: buildBillOfQuantities,
    },
    ...photoDays.flatMap((date, dayIndex) =>
      [0, 1, 2, 3].map((slot) => {
        const index = dayIndex * 4 + slot;
        return {
          key: `photo-${index}`,
          fileName: `site-${date}-${index + 1}.jpg`,
          mediaType: "image/jpeg",
          render: async () => buildSitePhoto(index, date),
        };
      }),
    ),
  ];

  const artifacts: DemoArtifact[] = [];
  const artifactById = new Map<string, DemoArtifact>();
  const artifactLocationById = new Map<string, { bucket: string; objectKey: string }>();
  for (const descriptor of renderers) {
    const assetId = id("file", descriptor.key);
    const objectKey = [tenantId, DEMO_PROJECT_ID, assetId, descriptor.fileName].join("/");
    const target = resolve(artifactRoot, ...objectKey.split("/"));
    // Re-rendering produces equivalent but not byte-identical output (PDFs
    // embed a producer id), so a reused file's own bytes are the source of
    // truth for the size and digest the object store later verifies.
    const reused = keepArtifacts ? await readArtifact(target, descriptor) : null;
    let stored = reused;
    if (stored === null) {
      stored = await descriptor.render();
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, stored.body);
    }
    const location =
      remoteStorage === null
        ? { bucket: "local", objectKey }
        : await remoteStorage.put({
            tenantId,
            projectId: DEMO_PROJECT_ID,
            artifactId: assetId,
            originalFileName: stored.fileName,
            mediaType: stored.mediaType,
            body: stored.body,
          });
    artifacts.push(stored);
    artifactById.set(assetId, stored);
    artifactLocationById.set(assetId, {
      bucket: location.bucket,
      objectKey: location.objectKey,
    });
  }

  // -- Project, work items, dependencies ------------------------------------
  const lines = buildEstimateLines();
  const totals = estimateTotals(lines);
  const states = workStates(asOf);
  const actualCost = states.reduce((sum, state) => sum + state.actualCost, 0);

  await prisma.project.create({
    data: {
      id: DEMO_PROJECT_ID,
      tenantId,
      code: DEMO_PROJECT_CODE,
      name: PROJECT_METADATA.name,
      description: PROJECT_METADATA.description,
      location: PROJECT_METADATA.location,
      status: "ACTIVE",
      plannedStart: day(PROJECT_METADATA.plannedStart),
      plannedEnd: day(PROJECT_METADATA.plannedEnd),
      budget: decimal(totals.totalAmount),
      actualCost: decimal(actualCost),
    },
  });

  await prisma.projectMember.createMany({
    data: users.map((user) => ({
      id: randomUUID(),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      userId: user.id,
      role: user.tenantRole,
      active: true,
    })),
  });

  await prisma.workItem.createMany({
    data: states.map((state) => ({
      id: workItemId(state.pkg.code),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      code: state.pkg.code,
      name: state.pkg.name,
      description: state.pkg.description,
      assigneeName: state.pkg.assigneeName,
      status: state.status,
      priority: state.pkg.priority,
      plannedStart: day(state.pkg.plannedStart),
      plannedEnd: day(state.pkg.plannedEnd),
      actualStart: state.actualStart === null ? null : day(state.actualStart),
      actualEnd: state.actualEnd === null ? null : day(state.actualEnd),
      progressPercent: state.progressPercent,
      budget: decimal(state.budget),
      actualCost: decimal(state.actualCost),
      isCritical: state.pkg.isCritical,
    })),
  });

  await prisma.workItemDependency.createMany({
    data: WORK_DEPENDENCIES.map((link) => ({
      id: id("dep", link.predecessor, link.successor),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      predecessorId: workItemId(link.predecessor),
      successorId: workItemId(link.successor),
      type: "FINISH_TO_START" as const,
      lagDays: link.lagDays,
    })),
  });

  // Weekly progress snapshots for the burn-up chart.
  const snapshots: {
    id: string;
    tenantId: string;
    projectId: string;
    workItemId: string;
    capturedAt: Date;
    status: "PLANNED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED";
    progressPercent: number;
    actualCost: string;
    note: string;
  }[] = [];
  for (let week = 8; week >= 1; week -= 1) {
    const capturedIso = addDays(asOf, -week * 7);
    for (const state of workStates(capturedIso)) {
      if (state.progressPercent === 0) continue;
      snapshots.push({
        id: id("snap", state.pkg.code, capturedIso),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        workItemId: workItemId(state.pkg.code),
        capturedAt: day(capturedIso),
        status: state.status,
        progressPercent: state.progressPercent,
        actualCost: decimal(state.actualCost),
        note: `${capturedIso}-ны долоо хоногийн төлөв`,
      });
    }
  }
  await prisma.workItemSnapshot.createMany({ data: snapshots });

  await prisma.costEntry.createMany({
    data: states
      .filter((state) => state.actualCost > 0)
      .flatMap((state, index) => [
        {
          id: id("cost", state.pkg.code, "mat"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          workItemId: workItemId(state.pkg.code),
          reference: `INV-2026-${String(index * 2 + 1).padStart(4, "0")}`,
          occurredAt: day(addDays(asOf, -21 + index)),
          category:
            state.pkg.subcontractUnitPrice === undefined
              ? ("MATERIAL" as const)
              : ("OTHER" as const),
          amount: decimal(state.actualCost * 0.68),
          description: `${state.pkg.name} — материалын зардал`,
        },
        {
          id: id("cost", state.pkg.code, "lab"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          workItemId: workItemId(state.pkg.code),
          reference: `PAY-2026-${String(index * 2 + 2).padStart(4, "0")}`,
          occurredAt: day(addDays(asOf, -14 + index)),
          category: "LABOR" as const,
          amount: decimal(state.actualCost * 0.32),
          description: `${state.pkg.name} — ажиллах хүчний зардал`,
        },
      ]),
  });

  // -- Catalogs ------------------------------------------------------------
  const materialCatalogId = id("cat", "material");
  const materialVersionId = id("cat", "material", "v1");
  await prisma.materialCatalog.create({
    data: {
      id: materialCatalogId,
      tenantId,
      code: "MAT-MN",
      name: "Монголын барилгын материалын лавлах",
      description: "MNS стандартад суурилсан материалын нэгдсэн лавлах",
      versions: {
        create: {
          id: materialVersionId,
          versionNumber: 1,
          status: "APPLIED",
          effectiveFrom: day("2026-01-15"),
          sourceReference: "MNS каталог 2026-01 хэвлэл",
          sourceHash: hash("material-catalog", MATERIALS),
          approvedByUserId: admin,
          approvedAt: day("2026-01-20"),
        },
      },
    },
  });
  await prisma.materialItem.createMany({
    data: MATERIALS.map((material) => ({
      id: id("mat", material.code),
      tenantId,
      catalogVersionId: materialVersionId,
      code: material.code,
      canonicalName: material.canonicalName,
      unit: material.unit,
      specification: material.specification,
      active: true,
    })),
  });
  await prisma.materialAlias.createMany({
    data: MATERIALS.flatMap((material) =>
      material.aliases.map((alias, aliasIndex) => ({
        // Aliases are Cyrillic, so the id is keyed by position instead.
        id: id("alias", material.code, String(aliasIndex)),
        tenantId,
        materialItemId: id("mat", material.code),
        aliasNormalized: alias.toLocaleLowerCase("mn-MN"),
        language: /[а-яөүёА-ЯӨҮЁ]/u.test(alias) ? "mn" : "en",
      })),
    ),
  });

  const normCatalogId = id("cat", "norm");
  const normVersionId = id("cat", "norm", "v1");
  await prisma.normCatalog.create({
    data: {
      id: normCatalogId,
      tenantId,
      code: "NORM-MN",
      name: "Барилгын ажлын норм, бүтээмжийн лавлах",
      versions: {
        create: {
          id: normVersionId,
          versionNumber: 1,
          status: "APPLIED",
          effectiveFrom: day("2026-01-15"),
          sourceReference: "БНбД 81-02-06, компанийн дотоод норм 2026",
          sourceHash: hash("norm-catalog", WORK_PACKAGES),
          approvedByUserId: admin,
          approvedAt: day("2026-01-20"),
        },
      },
    },
  });
  await prisma.workNorm.createMany({
    data: WORK_PACKAGES.filter((pkg) => pkg.norm !== undefined).map((pkg) => ({
      id: id("norm", pkg.code),
      tenantId,
      normVersionId,
      workCode: pkg.code,
      materialItemId: id("mat", pkg.norm?.materialCode ?? ""),
      outputUnit: pkg.unit,
      materialUnit: MATERIALS.find((m) => m.code === pkg.norm?.materialCode)?.unit ?? pkg.unit,
      quantityPerOutput: decimal(pkg.norm?.quantityPerOutput ?? 0, 8),
      wastePercent: decimal(pkg.norm?.wastePercent ?? 0, 6),
      assumptions: { basis: "БНбД 81-02-06", reviewedBy: "ПТО хэлтэс" },
    })),
  });
  await prisma.productivityRate.createMany({
    data: WORK_PACKAGES.filter((pkg) => pkg.productivity !== undefined).map((pkg) => ({
      id: id("rate", pkg.code),
      tenantId,
      normVersionId,
      workCode: pkg.code,
      outputUnit: pkg.unit,
      crewType: pkg.crewType,
      outputPerCrewHour: decimal(pkg.productivity?.outputPerCrewHour ?? 0, 8),
      crewSize: pkg.productivity?.crewSize ?? 0,
      assumptions: { shiftHours: 8, basis: "Сүүлийн 3 төслийн дундаж" },
    })),
  });

  const priceCatalogId = id("cat", "price");
  const priceVersionId = id("cat", "price", "v1");
  await prisma.priceCatalog.create({
    data: {
      id: priceCatalogId,
      tenantId,
      code: "PRICE-UB",
      name: "Улаанбаатар — материалын үнийн лавлах",
      currency: PROJECT_METADATA.currency,
      versions: {
        create: {
          id: priceVersionId,
          versionNumber: 1,
          status: "APPLIED",
          effectiveFrom: day("2026-02-01"),
          sourceReference: "Нийлүүлэгчийн үнийн санал 2026-02",
          sourceHash: hash(
            "price-catalog",
            MATERIALS.map((m) => [m.code, m.unitPrice]),
          ),
          approvedByUserId: admin,
          approvedAt: day("2026-02-05"),
        },
      },
    },
  });
  await prisma.priceCatalogEntry.createMany({
    data: MATERIALS.map((material) => ({
      id: id("price", material.code),
      tenantId,
      catalogVersionId: priceVersionId,
      materialItemId: id("mat", material.code),
      unit: material.unit,
      unitPrice: decimal(material.unitPrice, 6),
      currency: PROJECT_METADATA.currency,
      supplierName: "Монгол Материал Трейд ХХК",
      quotationRef: `QT-2026-${material.code}`,
      validFrom: day("2026-02-01"),
      validTo: day("2026-12-31"),
    })),
  });

  // -- Design intake -------------------------------------------------------
  const fileAssetRows = [...artifactById.entries()].map(([assetId, item]) => {
    const location = artifactLocationById.get(assetId);
    if (location === undefined) throw new Error(`Artifact location missing for ${assetId}`);
    return {
      id: assetId,
      tenantId,
      projectId: DEMO_PROJECT_ID,
      bucket: location.bucket,
      objectKey: location.objectKey,
      originalFileName: item.fileName,
      mediaType: item.mediaType,
      sizeBytes: item.body.byteLength,
      sha256: item.sha256,
      status: "AVAILABLE" as const,
      uploadedByUserId: item.key.startsWith("photo") ? supervisor : engineer,
      retentionUntil: day("2030-12-31"),
    };
  });
  if (fileAssetRows.length > 0) {
    await prisma.fileAsset.createMany({ data: fileAssetRows });
  }

  const designDocuments = [
    {
      key: "architecture",
      code: "AR-01",
      title: "Архитектур — давхруудын план",
      type: "DRAWING" as const,
      revision: "Rev.C",
      revisionNumber: 3,
      pages: [
        "1-р давхрын план",
        "Ердийн давхрын план (2-11)",
        "12-р давхрын план",
        "Дээврийн план",
      ],
      discipline: "ARCHITECTURE",
    },
    {
      key: "structure",
      code: "ST-01",
      title: "Бүтэц — суурь ба каркас",
      type: "DRAWING" as const,
      revision: "Rev.B",
      revisionNumber: 2,
      pages: ["Суурийн план", "1-1 огтлол", "Каркасын угсралтын план"],
      discipline: "STRUCTURE",
    },
    {
      key: "specification",
      code: "SP-01",
      title: "Техникийн үзүүлэлт",
      type: "SPECIFICATION" as const,
      revision: "Rev.A",
      revisionNumber: 1,
      pages: ["Техникийн шаардлага"],
      discipline: "GENERAL",
    },
    {
      key: "boq",
      code: "BOQ-01",
      title: "Ажлын тоо хэмжээний жагсаалт",
      type: "BOQ" as const,
      revision: "Rev.A",
      revisionNumber: 1,
      pages: ["BOQ хүснэгт"],
      discipline: "GENERAL",
    },
  ].filter((document) => artifactById.has(id("file", document.key)));

  for (const document of designDocuments) {
    const assetId = id("file", document.key);
    const asset = artifactById.get(assetId);
    if (asset === undefined) continue;
    const documentId = id("doc", document.code);
    const revisionId = id("rev", document.code, document.revision);
    await prisma.designDocument.create({
      data: {
        id: documentId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        fileAssetId: assetId,
        documentCode: document.code,
        title: document.title,
        type: document.type,
        classification: { discipline: document.discipline, confidentiality: "INTERNAL" },
        status: "APPROVED",
        currentRevisionId: revisionId,
        createdByUserId: engineer,
      },
    });
    await prisma.drawingRevision.create({
      data: {
        id: revisionId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        documentId,
        revisionCode: document.revision,
        revisionNumber: document.revisionNumber,
        status: "APPROVED",
        issuedAt: day("2026-02-18"),
        effectiveFrom: day("2026-02-20"),
        sourceSha256: asset.sha256,
        approvedAt: day("2026-02-22"),
        approvedByUserId: manager,
      },
    });
    await prisma.drawingPage.createMany({
      data: document.pages.map((label, index) => ({
        id: id("page", document.code, String(index + 1)),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        revisionId,
        pageNumber: index + 1,
        pageLabel: label,
        widthPoints: decimal(1190.55, 6),
        heightPoints: decimal(841.89, 6),
      })),
    });
    if (document.type !== "DRAWING") continue;
    await prisma.drawingScale.createMany({
      data: document.pages.map((_, index) => ({
        id: id("scale", document.code, String(index + 1)),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        pageId: id("page", document.code, String(index + 1)),
        scaleText: "1:100",
        drawingDistance: decimal(36, 6),
        realDistance: decimal(3.6, 6),
        unit: "m",
        status: "VERIFIED" as const,
        verifiedByUserId: engineer,
        verifiedAt: day("2026-02-23"),
        sourceHash: hash("scale", document.code, index),
      })),
    });
  }

  // Elements extracted from the architectural and structural sheets.
  const elementSpecs = [
    { doc: "AR-01", page: 2, type: "ROOM", code: "R-201", label: "2 өрөө байр", area: 58.4 },
    { doc: "AR-01", page: 2, type: "ROOM", code: "R-202", label: "3 өрөө байр", area: 76.2 },
    { doc: "AR-01", page: 2, type: "ROOM", code: "R-203", label: "1 өрөө байр", area: 42.1 },
    {
      doc: "AR-01",
      page: 2,
      type: "WALL",
      code: "W-EXT-01",
      label: "Гадна хана 400мм",
      area: 214.8,
    },
    {
      doc: "AR-01",
      page: 2,
      type: "WALL",
      code: "W-INT-01",
      label: "Тусгаарлах хана 200мм",
      area: 168.2,
    },
    { doc: "AR-01", page: 4, type: "SLAB", code: "S-ROOF", label: "Дээврийн хавтан", area: 742.6 },
    {
      doc: "ST-01",
      page: 1,
      type: "FOUNDATION",
      code: "F-RAFT",
      label: "Суурийн хавтан 600мм",
      area: 742.6,
    },
    { doc: "ST-01", page: 3, type: "COLUMN", code: "C-400", label: "Багана 400x400", area: 0.16 },
    { doc: "ST-01", page: 3, type: "BEAM", code: "B-300", label: "Дам нуруу 300x600", area: 0.18 },
  ].filter((element) =>
    artifactById.has(id("file", element.doc === "AR-01" ? "architecture" : "structure")),
  );

  for (const element of elementSpecs) {
    const elementId = id("el", element.code);
    await prisma.designElement.create({
      data: {
        id: elementId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        pageId: id("page", element.doc, String(element.page)),
        elementType: element.type,
        elementCode: element.code,
        label: element.label,
        properties: { unit: "м2", extractedBy: "A0-design-intake", sheet: element.doc },
        confidence: decimal(0.94, 4),
        verificationStatus: "VERIFIED",
        reviewedByUserId: engineer,
        reviewedAt: day("2026-02-24"),
        geometry: {
          create: {
            id: id("geo", element.code),
            geometryType:
              element.type === "COLUMN" || element.type === "BEAM" ? "RECTANGLE" : "POLYGON",
            coordinates: {
              points: [
                [70, 60],
                [700, 60],
                [700, 420],
                [70, 420],
              ],
            },
            unit: "м",
            area: decimal(element.area, 6),
          },
        },
      },
    });
    const sourceAssetId = id("file", element.doc === "AR-01" ? "architecture" : "structure");
    const sourceAsset = artifactById.get(sourceAssetId);
    if (sourceAsset === undefined) continue;
    await prisma.elementSourceRef.create({
      data: {
        id: id("src", element.code),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        elementId,
        fileAssetId: sourceAssetId,
        pageNumber: element.page,
        region: { x: 70, y: 60, width: 630, height: 360 },
        sourceSha256: sourceAsset.sha256,
      },
    });
  }

  // -- Quantities ----------------------------------------------------------
  const quantityV1 = id("qty", "v1");
  const quantityV2 = id("qty", "v2");
  const revisionIds = designDocuments
    .filter((document) => document.type === "DRAWING")
    .map((document) => id("rev", document.code, document.revision));

  for (const [versionId, versionNumber, status] of [
    [quantityV1, 1, "APPLIED"],
    [quantityV2, 2, "REVIEW_REQUIRED"],
  ] as const) {
    await prisma.quantityTakeoffVersion.create({
      data: {
        id: versionId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        versionNumber,
        status,
        sourceRevisionIds: revisionIds,
        formulaVersion: "qto-formula-1.2.0",
        sourceHash: hash("qty", versionNumber, WORK_PACKAGES),
        totalQuantityHash: hash("qty-total", versionNumber),
        createdByUserId: engineer,
        approvedByUserId: status === "APPLIED" ? manager : null,
        approvedAt: status === "APPLIED" ? day("2026-02-26") : null,
        supersedesId: versionNumber === 2 ? quantityV1 : null,
      },
    });
    await prisma.quantityTakeoffItem.createMany({
      data: WORK_PACKAGES.map((pkg) => ({
        id: id("qti", String(versionNumber), pkg.code),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        versionId,
        workCode: pkg.code,
        description: pkg.name,
        unit: pkg.unit,
        // v2 carries the re-measured quantities that triggered the review.
        quantity: decimal(versionNumber === 2 ? pkg.quantity * 1.035 : pkg.quantity, 8),
        formulaCode: pkg.norm === undefined ? "DIRECT_INPUT" : "AREA_TIMES_FACTOR",
        formulaInputs: {
          baseQuantity: pkg.quantity,
          factor: pkg.norm === undefined ? 1 : materialFactor(pkg),
        },
        sourceRefs: revisionIds.map((revision) => ({ revisionId: revision, sheet: "AR-01" })),
        verificationStatus: versionNumber === 1 ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
      })),
    });
  }

  // -- Estimate ------------------------------------------------------------
  const estimateV1 = id("est", "v1");
  await prisma.estimateVersion.create({
    data: {
      id: estimateV1,
      tenantId,
      projectId: DEMO_PROJECT_ID,
      versionNumber: 1,
      quantityVersionId: quantityV1,
      normCatalogVersionId: normVersionId,
      priceCatalogVersionId: priceVersionId,
      status: "APPLIED",
      currency: PROJECT_METADATA.currency,
      subtotal: decimal(totals.subtotal),
      taxAmount: decimal(totals.taxAmount),
      contingencyAmount: decimal(totals.contingencyAmount),
      totalAmount: decimal(totals.totalAmount),
      sourceHash: hash("estimate", lines),
      createdByUserId: engineer,
      approvedByUserId: manager,
      approvedAt: day("2026-02-27"),
    },
  });
  await prisma.estimateLine.createMany({
    data: lines.map((line) => ({
      id: id("estl", line.lineCode),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      estimateVersionId: estimateV1,
      lineCode: line.lineCode,
      category: line.category,
      description: line.description,
      quantity: decimal(line.quantity, 8),
      unit: line.unit,
      unitPrice: decimal(line.unitPrice, 6),
      amount: decimal(line.amount),
      sourceRefs: { quantityVersionId: quantityV1, workCode: line.workCode },
    })),
  });
  await prisma.estimateAssumption.createMany({
    data: [
      { code: "VAT_PERCENT", value: 10, note: "НӨАТ-ын хувь" },
      { code: "CONTINGENCY_PERCENT", value: 5, note: "Урьдчилан тооцоолоогүй зардлын хувь" },
      { code: "LABOR_RATE_PER_HOUR", value: 9500, note: "Нэг ажилтны цагийн зардал (₮)" },
      { code: "CURRENCY", value: "MNT", note: "Тооцооны валют" },
    ].map((assumption) => ({
      id: id("esta", assumption.code),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      estimateVersionId: estimateV1,
      assumptionCode: assumption.code,
      value: assumption.value,
      sourceRef: { note: assumption.note, catalogVersionId: priceVersionId },
    })),
  });
  await prisma.estimateScenario.createMany({
    data: [
      { name: "Материалын үнэ +8%", factor: 1.08, categories: ["MATERIAL"] },
      { name: "Ажлын хөлс +12%", factor: 1.12, categories: ["LABOR"] },
      { name: "Хоёр ээлжийн горим", factor: 1.05, categories: ["LABOR", "EQUIPMENT"] },
    ].map((scenario, scenarioIndex) => {
      const affected = lines
        .filter((line) => scenario.categories.includes(line.category))
        .reduce((sum, line) => sum + line.amount, 0);
      const rest = totals.subtotal - affected;
      const newSubtotal = rest + affected * scenario.factor;
      return {
        id: id("ests", String(scenarioIndex)),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        estimateVersionId: estimateV1,
        name: scenario.name,
        parameters: { factor: scenario.factor, categories: scenario.categories },
        totalAmount: decimal(newSubtotal * 1.05 * 1.1),
      };
    }),
  });

  // -- Schedule ------------------------------------------------------------
  const scheduleV1 = id("sch", "v1");
  await prisma.scheduleVersion.create({
    data: {
      id: scheduleV1,
      tenantId,
      projectId: DEMO_PROJECT_ID,
      versionNumber: 1,
      status: "APPLIED",
      calendarVersion: CALENDAR_VERSION,
      timezone: PROJECT_METADATA.timezone,
      plannedStart: day(PROJECT_METADATA.plannedStart),
      plannedFinish: day(PROJECT_METADATA.plannedEnd),
      sourceHash: hash("schedule", WORK_PACKAGES, WORK_DEPENDENCIES),
      createdByUserId: manager,
      approvedByUserId: manager,
      approvedAt: day("2026-02-27"),
    },
  });
  await prisma.scheduleActivity.createMany({
    data: WORK_PACKAGES.map((pkg) => {
      const durationDays =
        (day(pkg.plannedEnd).getTime() - day(pkg.plannedStart).getTime()) / 86_400_000;
      return {
        id: id("act", pkg.code),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        scheduleVersionId: scheduleV1,
        workItemId: workItemId(pkg.code),
        code: pkg.code,
        name: pkg.name,
        plannedStart: day(pkg.plannedStart),
        plannedFinish: day(pkg.plannedEnd),
        durationMinutes: Math.round(durationDays * 8 * 60),
        totalFloatMinutes: pkg.isCritical ? 0 : 6 * 8 * 60,
        isCritical: pkg.isCritical,
        quantity: decimal(pkg.quantity, 8),
        unit: pkg.unit,
      };
    }),
  });
  await prisma.scheduleDependency.createMany({
    data: WORK_DEPENDENCIES.map((link) => ({
      id: id("sdep", link.predecessor, link.successor),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      scheduleVersionId: scheduleV1,
      predecessorId: id("act", link.predecessor),
      successorId: id("act", link.successor),
      type: "FINISH_TO_START" as const,
      lagMinutes: link.lagDays * 8 * 60,
    })),
  });
  await prisma.resourceRequirement.createMany({
    data: WORK_PACKAGES.filter((pkg) => pkg.productivity !== undefined).flatMap((pkg) => {
      const crew = CREWS.find((candidate) => candidate.trade === pkg.crewType);
      const rows = [] as {
        id: string;
        tenantId: string;
        projectId: string;
        activityId: string;
        resourceType: string;
        resourceCode: string;
        quantity: string;
        unit: string;
      }[];
      if (crew !== undefined) {
        rows.push({
          id: id("req", pkg.code, "crew"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          activityId: id("act", pkg.code),
          resourceType: "CREW",
          resourceCode: crew.code,
          quantity: decimal(crew.memberCount, 4),
          unit: "хүн",
        });
      }
      if (pkg.code === "CN-02" || pkg.code === "CN-01") {
        rows.push({
          id: id("req", pkg.code, "pump"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          activityId: id("act", pkg.code),
          resourceType: "EQUIPMENT",
          resourceCode: "EQP-PMP-01",
          quantity: decimal(1, 4),
          unit: "ш",
        });
      }
      if (pkg.code === "MS-01" || pkg.code === "CN-02") {
        rows.push({
          id: id("req", pkg.code, "crane"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          activityId: id("act", pkg.code),
          resourceType: "EQUIPMENT",
          resourceCode: "EQP-CRN-01",
          quantity: decimal(1, 4),
          unit: "ш",
        });
      }
      return rows;
    }),
  });

  // -- Baseline ------------------------------------------------------------
  const baselineV1 = id("base", "v1");
  await prisma.baselineVersion.create({
    data: {
      id: baselineV1,
      tenantId,
      projectId: DEMO_PROJECT_ID,
      versionNumber: 1,
      quantityVersionId: quantityV1,
      estimateVersionId: estimateV1,
      scheduleVersionId: scheduleV1,
      status: "APPLIED",
      sourceHash: hash("baseline", quantityV1, estimateV1, scheduleV1),
      reason: "Гэрээ байгуулсны дараах анхны суурь хувилбар",
      createdByUserId: manager,
      approvedByUserId: admin,
      approvedAt: day("2026-02-28"),
      appliedAt: day("2026-03-01"),
    },
  });

  // -- Resources -----------------------------------------------------------
  await prisma.crew.createMany({
    data: CREWS.map((crew) => ({
      id: id("crew", crew.code),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      code: crew.code,
      name: crew.name,
      trade: crew.trade,
      memberCount: crew.memberCount,
      active: true,
    })),
  });
  await prisma.equipment.createMany({
    data: EQUIPMENT.map((item) => ({
      id: id("eqp", item.code),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      code: item.code,
      name: item.name,
      equipmentType: item.equipmentType,
      capacity: decimal(item.capacity, 4),
      capacityUnit: item.capacityUnit,
      active: true,
    })),
  });
  await prisma.crewAvailability.createMany({
    data: reports.flatMap((report) =>
      CREWS.map((crew) => ({
        id: id("crwav", crew.code, report.date),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        crewId: id("crew", crew.code),
        availableDate: day(report.date),
        availableMinutes: report.disrupted ? 300 : 480,
        shiftCode: "DAY",
        reason: report.disrupted ? "Цаг агаар/нийлүүлэлтийн саатал" : null,
      })),
    ),
  });
  await prisma.equipmentAvailability.createMany({
    data: reports.flatMap((report) =>
      EQUIPMENT.map((item) => ({
        id: id("eqpav", item.code, report.date),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        equipmentId: id("eqp", item.code),
        availableDate: day(report.date),
        availableMinutes: item.code === "EQP-EXC-01" ? 0 : report.disrupted ? 300 : 480,
        status:
          item.code === "EQP-EXC-01" ? "DEMOBILIZED" : report.disrupted ? "LIMITED" : "AVAILABLE",
        reason: item.code === "EQP-EXC-01" ? "Газар шорооны ажил дууссан" : null,
      })),
    ),
  });

  // -- Daily plans and reports ---------------------------------------------
  const photoAssets = [...artifactById.entries()].filter(([key]) => key.includes("-file-photo-"));

  for (const [index, report] of reports.entries()) {
    const planId = id("plan", report.date);
    const isLatest = index === reports.length - 1;
    await prisma.dailyWorkPlan.create({
      data: {
        id: planId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        planDate: day(report.date),
        timezone: PROJECT_METADATA.timezone,
        status: isLatest ? "REVIEW_REQUIRED" : "APPLIED",
        baselineVersionId: baselineV1,
        scheduleVersionId: scheduleV1,
        sourceHash: hash("plan", report.date, report.items),
        idempotencyKey: `plan-${report.date}`,
        createdByUserId: supervisor,
        approvedByUserId: isLatest ? null : manager,
        approvedAt: isLatest ? null : day(report.date),
      },
    });
    await prisma.dailyWorkPlanItem.createMany({
      data: report.items.map((item) => ({
        id: id("pli", report.date, item.workCode),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        planId,
        workItemId: workItemId(item.workCode),
        activityId: id("act", item.workCode),
        sequence: item.sequence,
        plannedQuantity: decimal(item.plannedQuantity, 8),
        unit: item.unit,
        plannedStart: new Date(`${report.date}T00:00:00.000Z`),
        plannedFinish: new Date(`${report.date}T08:00:00.000Z`),
        locationCode: item.locationCode,
        decisionReason: item.decisionReason,
      })),
    });
    await prisma.dailyPlanResource.createMany({
      data: report.items
        .filter((item) => item.crewCode !== null)
        .map((item) => ({
          id: id("plr", report.date, item.workCode),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          planItemId: id("pli", report.date, item.workCode),
          resourceType: "CREW",
          resourceId: id("crew", item.crewCode ?? ""),
          quantity: decimal(CREWS.find((crew) => crew.code === item.crewCode)?.memberCount ?? 0, 4),
          unit: "хүн",
          startAt: new Date(`${report.date}T00:00:00.000Z`),
          finishAt: new Date(`${report.date}T08:00:00.000Z`),
        })),
    });
    await prisma.dailyPlanMaterial.createMany({
      data: report.items
        .filter((item) => item.materialCode !== null)
        .map((item) => ({
          id: id("plm", report.date, item.workCode),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          planItemId: id("pli", report.date, item.workCode),
          materialItemId: id("mat", item.materialCode ?? ""),
          requiredQuantity: decimal(item.requiredMaterial, 8),
          availableQuantity: decimal(item.availableMaterial, 8),
          unit: MATERIALS.find((m) => m.code === item.materialCode)?.unit ?? "ш",
          shortageQuantity: decimal(Math.max(0, item.requiredMaterial - item.availableMaterial), 8),
        })),
    });
    await prisma.dailyPlanPrecondition.createMany({
      data: report.items.flatMap((item) =>
        item.preconditions.map((precondition, order) => ({
          id: id("plp", report.date, item.workCode, String(order)),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          planItemId: id("pli", report.date, item.workCode),
          preconditionType: precondition.type,
          description: precondition.description,
          satisfied: precondition.satisfied,
          sourceRef: { checkedBy: "A5-daily-planner", planDate: report.date },
        })),
      ),
    });

    // Daily report
    const reportId = id("rep", report.date);
    await prisma.dailyReport.create({
      data: {
        id: reportId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        reportDate: day(report.date),
        timezone: PROJECT_METADATA.timezone,
        status: isLatest ? "REVIEW_REQUIRED" : "APPLIED",
        sourceHash: hash("report", report.date, report.items),
        idempotencyKey: `report-${report.date}`,
        narrative: report.narrative,
        weather: json(report.weather),
        submittedByUserId: supervisor,
        approvedByUserId: isLatest ? null : manager,
        approvedAt: isLatest ? null : day(addDays(report.date, 1)),
      },
    });
    await prisma.progressEntry.createMany({
      data: report.items.map((item) => ({
        id: id("pre", report.date, item.workCode),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        dailyReportId: reportId,
        planItemId: id("pli", report.date, item.workCode),
        workItemId: workItemId(item.workCode),
        quantity: decimal(item.actualQuantity, 8),
        unit: item.unit,
        progressPercent: decimal(
          Math.min(100, (item.actualQuantity / Math.max(item.plannedQuantity, 0.0001)) * 100),
          4,
        ),
        sourceRefs: { planItemId: id("pli", report.date, item.workCode), capturedBy: "A1" },
      })),
    });
    await prisma.attendanceEntry.createMany({
      data: report.attendance.map((entry) => ({
        id: id("att", report.date, entry.crewCode),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        dailyReportId: reportId,
        crewId: id("crew", entry.crewCode),
        trade: entry.trade,
        workerCount: entry.workerCount,
        hoursPerWorker: decimal(entry.hoursPerWorker, 2),
        laborRate: decimal(9500, 2),
        sourceRefs: { source: "SITE_TABLET", reportDate: report.date },
      })),
    });
  }

  // -- Photo evidence ------------------------------------------------------
  for (const [assetId, asset] of photoAssets) {
    const slot = Number(assetId.split("-").pop() ?? "0");
    const reportDate = photoDays[Math.floor(slot / 4)] ?? photoDays[photoDays.length - 1];
    if (reportDate === undefined) continue;
    const photoId = id("photo", String(slot));
    await prisma.photoEvidence.create({
      data: {
        id: photoId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        dailyReportId: id("rep", reportDate),
        fileAssetId: assetId,
        capturedAt: new Date(`${reportDate}T06:30:00.000Z`),
        latitude: decimal(47.8864 + slot * 0.0002, 7),
        longitude: decimal(106.8912 + slot * 0.0002, 7),
        orientation: 1,
        deviceMetadata: { make: "Samsung", model: "Galaxy A55", app: "BuildWatch Mobile" },
        status: "LINKED",
        sha256: asset.sha256,
        perceptualHash: asset.sha256.slice(0, 16),
        sourceHash: hash("photo", assetId),
        createdByUserId: supervisor,
        quality: {
          create: {
            id: id("phq", String(slot)),
            blurScore: decimal(slot % 4 === 3 ? 0.41 : 0.88, 4),
            exposureScore: decimal(0.91, 4),
            framingScore: decimal(0.86, 4),
            acceptable: slot % 4 !== 3,
            issues: slot % 4 === 3 ? [{ code: "BLUR", severity: "MEDIUM" }] : [],
            modelVersion: "photo-quality-1.1.0",
            evaluatedAt: new Date(`${reportDate}T07:00:00.000Z`),
          },
        },
      },
    });
    const dayReport = reports.find((entry) => entry.date === reportDate);
    const linkedItem = dayReport?.items[slot % Math.max(dayReport.items.length, 1)];
    if (linkedItem !== undefined) {
      await prisma.photoEvidenceLink.create({
        data: {
          id: id("phl", String(slot)),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          photoId,
          planItemId: id("pli", reportDate, linkedItem.workCode),
          linkType: "PROGRESS_EVIDENCE",
          sourceRegion: { x: 0, y: 0, width: 960, height: 640 },
        },
      });
    }
  }

  // -- Stock movements -----------------------------------------------------
  const stockRows: {
    id: string;
    tenantId: string;
    projectId: string;
    materialItemId: string;
    movementType: "RECEIPT" | "ISSUE";
    quantity: string;
    unit: string;
    occurredAt: Date;
    warehouseCode: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    reason: string;
    sourceRefs: Prisma.InputJsonValue;
    createdByUserId: string;
  }[] = [];
  for (const material of MATERIALS) {
    const consumed = reports.reduce((sum, report) => {
      const item = report.items.find((candidate) => candidate.materialCode === material.code);
      return sum + (item?.requiredMaterial ?? 0);
    }, 0);
    if (consumed <= 0) continue;
    stockRows.push({
      id: id("stk", material.code, "in"),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      materialItemId: id("mat", material.code),
      movementType: "RECEIPT",
      quantity: decimal(consumed * 1.4, 8),
      unit: material.unit,
      occurredAt: day(reports[0]?.date ?? asOf),
      warehouseCode: "WH-MAIN",
      referenceType: "PURCHASE_ORDER",
      referenceId: `PO-2026-${material.code}`,
      idempotencyKey: `stock-in-${material.code}`,
      reason: "Нийлүүлэгчээс хүлээн авсан",
      sourceRefs: { supplier: "Монгол Материал Трейд ХХК" },
      createdByUserId: storekeeper,
    });
  }
  for (const report of reports) {
    for (const item of report.items) {
      if (item.materialCode === null) continue;
      stockRows.push({
        id: id("stk", report.date, item.workCode),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        materialItemId: id("mat", item.materialCode),
        movementType: "ISSUE",
        quantity: decimal(item.availableMaterial, 8),
        unit: MATERIALS.find((m) => m.code === item.materialCode)?.unit ?? "ш",
        occurredAt: day(report.date),
        warehouseCode: "WH-MAIN",
        referenceType: "DAILY_WORK_PLAN",
        referenceId: id("plan", report.date),
        idempotencyKey: `stock-out-${report.date}-${item.workCode}`,
        reason: `${report.date} өдрийн даалгаварт олгов`,
        sourceRefs: { planItemId: id("pli", report.date, item.workCode) },
        createdByUserId: storekeeper,
      });
    }
  }
  await prisma.stockMovement.createMany({ data: stockRows });

  // -- Verification and variance -------------------------------------------
  const verifiedDays = reports.slice(-6);
  for (const report of verifiedDays) {
    const verificationId = id("ver", report.date);
    const claimed = report.items.reduce((sum, item) => sum + item.actualQuantity, 0);
    const planned = report.items.reduce((sum, item) => sum + item.plannedQuantity, 0);
    const claimedPercent = planned > 0 ? Math.min(100, (claimed / planned) * 100) : 0;
    const verifiedPercent = claimedPercent * (report.disrupted ? 0.92 : 0.98);
    const isLatest = report.date === verifiedDays[verifiedDays.length - 1]?.date;
    await prisma.progressVerification.create({
      data: {
        id: verificationId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        verificationDate: day(report.date),
        status: isLatest ? "REVIEW_REQUIRED" : "APPLIED",
        methodVersion: METHOD_VERSION,
        sourceHash: hash("verification", report.date),
        claimedPercent: decimal(claimedPercent, 4),
        verifiedPercent: decimal(verifiedPercent, 4),
        confidence: decimal(report.disrupted ? 0.71 : 0.93, 4),
        decision: report.disrupted ? "PARTIALLY_VERIFIED" : "VERIFIED",
        createdByUserId: engineer,
        approvedByUserId: isLatest ? null : manager,
        approvedAt: isLatest ? null : day(addDays(report.date, 1)),
      },
    });
    if (!report.disrupted) continue;
    await prisma.progressVerificationIssue.createMany({
      data: [
        {
          id: id("veri", report.date, "gap"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          verificationId,
          issueCode: "CLAIMED_ABOVE_EVIDENCE",
          severity: "HIGH",
          blocksApproval: true,
          details: {
            claimedPercent: Number(claimedPercent.toFixed(2)),
            verifiedPercent: Number(verifiedPercent.toFixed(2)),
          },
          sourceRefs: { reportId: id("rep", report.date) },
        },
        {
          id: id("veri", report.date, "photo"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          verificationId,
          issueCode: "PHOTO_EVIDENCE_INSUFFICIENT",
          severity: "MEDIUM",
          blocksApproval: false,
          details: { requiredPhotos: 3, providedPhotos: 1 },
          sourceRefs: { reportId: id("rep", report.date) },
        },
      ],
    });
  }

  await prisma.dailyVariance.createMany({
    data: reports.flatMap((report) =>
      report.items.map((item) => {
        const variance = item.actualQuantity - item.plannedQuantity;
        const pkg = WORK_PACKAGES.find((candidate) => candidate.code === item.workCode);
        const rate = pkg?.productivity?.outputPerCrewHour ?? 1;
        return {
          id: id("var", report.date, item.workCode),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          varianceDate: day(report.date),
          workItemId: workItemId(item.workCode),
          plannedQuantity: decimal(item.plannedQuantity, 8),
          actualQuantity: decimal(item.actualQuantity, 8),
          quantityVariance: decimal(variance, 8),
          scheduleVarianceMinutes: Math.round((-variance / Math.max(rate, 0.0001)) * 60),
          costVariance: decimal(-variance * 42_000),
          sourceRefs: { reportId: id("rep", report.date) },
        };
      }),
    ),
  });

  // -- Forecast ------------------------------------------------------------
  const snapshotsForecast = forecasts(asOf, 3);
  for (const [index, snapshot] of snapshotsForecast.entries()) {
    const forecastId = id("fc", snapshot.asOf);
    await prisma.forecastSnapshot.create({
      data: {
        id: forecastId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        asOf: day(snapshot.asOf),
        methodVersion: METHOD_VERSION,
        thresholdVersion: "threshold-1.3.0",
        status: snapshot.delayDays >= 7 ? "AT_RISK" : "ON_TRACK",
        projectedFinish: day(snapshot.projectedFinish),
        delayDays: decimal(snapshot.delayDays, 4),
        confidence: decimal(snapshot.confidence, 4),
        sourceHash: hash("forecast", snapshot.asOf),
        baselineVersionId: baselineV1,
        scheduleVersionId: scheduleV1,
      },
    });
    await prisma.forecastWorkItem.createMany({
      data: snapshot.workItems.map((item) => ({
        id: id("fcw", snapshot.asOf, item.workCode),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        forecastId,
        workItemId: workItemId(item.workCode),
        remainingQuantity: decimal(item.remainingQuantity, 8),
        rollingProductivity: decimal(item.rollingProductivity, 8),
        projectedFinish: day(item.projectedFinish),
        delayDays: decimal(item.delayDays, 4),
        isCritical: item.isCritical,
        confidence: decimal(item.confidence, 4),
        method: "ROLLING_PRODUCTIVITY",
      })),
    });
    await prisma.forecastDriver.createMany({
      data: snapshot.drivers.map((driver) => ({
        id: id("fcd", snapshot.asOf, driver.driverCode),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        forecastId,
        driverCode: driver.driverCode,
        contribution: decimal(driver.contribution, 4),
        description: driver.description,
        sourceRefs: { asOf: snapshot.asOf, method: METHOD_VERSION },
      })),
    });
    if (index !== snapshotsForecast.length - 1) continue;
    await prisma.recoveryScenario.createMany({
      data: [
        {
          name: "Каркасын багийг хоёр ээлжид шилжүүлэх",
          delayReduction: 8.5,
          costImpact: 142_000_000,
          changes: {
            crew: "CRW-CN",
            shifts: 2,
            fromDate: addDays(asOf, 7),
            affectedWorkCodes: ["CN-02", "RB-01"],
          },
        },
        {
          name: "Өрлөгийн туслан гүйцэтгэгч нэмэх",
          delayReduction: 5.2,
          costImpact: 96_500_000,
          changes: {
            subcontractor: "Өрлөг Мастер ХХК",
            crewCount: 2,
            fromDate: addDays(asOf, 14),
            affectedWorkCodes: ["MS-01"],
          },
        },
      ].map((scenario, scenarioIndex) => ({
        id: id("rec", String(scenarioIndex)),
        tenantId,
        projectId: DEMO_PROJECT_ID,
        forecastId,
        name: scenario.name,
        status: scenarioIndex === 0 ? ("REVIEW_REQUIRED" as const) : ("DRAFT" as const),
        changes: scenario.changes,
        projectedFinish: day(
          addDays(snapshot.projectedFinish, -Math.round(scenario.delayReduction)),
        ),
        delayReductionDays: decimal(scenario.delayReduction, 4),
        costImpact: decimal(scenario.costImpact),
        baselineChanged: false,
        sourceHash: hash("recovery", scenario.name),
        createdByUserId: manager,
      })),
    });
  }

  // -- Approval matrix and review queue ------------------------------------
  const targetTypes = [
    "QUANTITY_TAKEOFF",
    "ESTIMATE",
    "SCHEDULE",
    "BASELINE",
    "DAILY_WORK_PLAN",
    "DAILY_REPORT",
    "PROGRESS_VERIFICATION",
    "RECOVERY_SCENARIO",
  ] as const;
  await prisma.approvalMatrix.deleteMany({ where: { tenantId } });
  await prisma.approvalMatrix.createMany({
    data: targetTypes.map((targetType) => ({
      id: id("apm", targetType),
      tenantId,
      targetType,
      submitterRoles: ["SITE_SUPERVISOR", "ENGINEER"] as const,
      reviewerRoles: ["ENGINEER", "PROJECT_MANAGER"] as const,
      approverRoles:
        targetType === "QUANTITY_TAKEOFF"
          ? (["ENGINEER", "PROJECT_MANAGER", "COMPANY_ADMIN"] as const)
          : (["PROJECT_MANAGER", "COMPANY_ADMIN"] as const),
      applyRoles: ["PROJECT_MANAGER", "COMPANY_ADMIN"] as const,
      prohibitSelfApproval: true,
      emergencyOverrideRoles: ["COMPANY_ADMIN", "SUPER_ADMIN"] as const,
      version: 1,
      active: true,
    })),
  });

  const latestReportDate = reports[reports.length - 1]?.date ?? asOf;
  const latestVerificationDate = verifiedDays[verifiedDays.length - 1]?.date ?? asOf;
  /**
   * `applyApprovedCommand` refuses a command whose `sourceHash` differs from
   * the approved artefact's. In the live flow both come from one request hash,
   * so the seed has to reproduce that: look the hash up from the target row
   * rather than inventing a separate one.
   */
  const targetHash = async (targetType: string, targetId: string): Promise<string> => {
    const scope = { tenantId, projectId: DEMO_PROJECT_ID, id: targetId };
    const select = { sourceHash: true } as const;
    const row =
      targetType === "QUANTITY_TAKEOFF"
        ? await prisma.quantityTakeoffVersion.findFirst({ where: scope, select })
        : targetType === "ESTIMATE"
          ? await prisma.estimateVersion.findFirst({ where: scope, select })
          : targetType === "SCHEDULE"
            ? await prisma.scheduleVersion.findFirst({ where: scope, select })
            : targetType === "BASELINE"
              ? await prisma.baselineVersion.findFirst({ where: scope, select })
              : targetType === "DAILY_WORK_PLAN"
                ? await prisma.dailyWorkPlan.findFirst({ where: scope, select })
                : targetType === "DAILY_REPORT"
                  ? await prisma.dailyReport.findFirst({ where: scope, select })
                  : targetType === "PROGRESS_VERIFICATION"
                    ? await prisma.progressVerification.findFirst({ where: scope, select })
                    : await prisma.recoveryScenario.findFirst({ where: scope, select });
    if (row === null) throw new Error(`Review target ${targetType} ${targetId} was not found`);
    return row.sourceHash;
  };

  const reviewTasks = [
    {
      key: "qty2",
      targetType: "QUANTITY_TAKEOFF" as const,
      targetId: quantityV2,
      targetVersion: 2,
      assignedRole: "ENGINEER" as const,
      status: "REVIEW_REQUIRED" as const,
      note: "Дахин хэмжилтээр тоо хэмжээ 3.5% нэмэгдсэн",
    },
    {
      key: "plan",
      targetType: "DAILY_WORK_PLAN" as const,
      targetId: id("plan", latestReportDate),
      targetVersion: 1,
      assignedRole: "SITE_SUPERVISOR" as const,
      status: "REVIEW_REQUIRED" as const,
      note: "Маргаашийн өдрийн даалгавар хянагдахыг хүлээж байна",
    },
    {
      key: "report",
      targetType: "DAILY_REPORT" as const,
      targetId: id("rep", latestReportDate),
      targetVersion: 1,
      assignedRole: "PROJECT_MANAGER" as const,
      status: "REVIEW_REQUIRED" as const,
      note: "Өдрийн тайлан батлагдахыг хүлээж байна",
    },
    {
      key: "verification",
      targetType: "PROGRESS_VERIFICATION" as const,
      targetId: id("ver", latestVerificationDate),
      targetVersion: 1,
      assignedRole: "PROJECT_MANAGER" as const,
      status: "REVIEW_REQUIRED" as const,
      note: "Мэдүүлсэн гүйцэтгэл нотолгооноос давсан",
    },
    {
      key: "recovery",
      targetType: "RECOVERY_SCENARIO" as const,
      targetId: id("rec", "0"),
      targetVersion: 1,
      assignedRole: "PROJECT_MANAGER" as const,
      status: "REVIEW_REQUIRED" as const,
      note: "Хоёр ээлжийн горимын санал",
    },
    {
      key: "baseline",
      targetType: "BASELINE" as const,
      targetId: baselineV1,
      targetVersion: 1,
      assignedRole: "PROJECT_MANAGER" as const,
      status: "APPLIED" as const,
      note: "Анхны суурь хувилбар хэрэгжсэн",
    },
    {
      key: "estimate",
      targetType: "ESTIMATE" as const,
      targetId: estimateV1,
      targetVersion: 1,
      assignedRole: "PROJECT_MANAGER" as const,
      status: "APPLIED" as const,
      note: "Гэрээний төсөв хэрэгжсэн",
    },
  ];

  for (const task of reviewTasks) {
    const taskId = id("rt", task.key);
    await prisma.reviewTask.create({
      data: {
        id: taskId,
        tenantId,
        projectId: DEMO_PROJECT_ID,
        targetType: task.targetType,
        targetId: task.targetId,
        targetVersion: task.targetVersion,
        status: task.status,
        sourceHash: await targetHash(task.targetType, task.targetId),
        createdByUserId: task.assignedRole === "SITE_SUPERVISOR" ? engineer : supervisor,
        assignedRole: task.assignedRole,
        dueAt: day(addDays(asOf, 2)),
      },
    });
    if (task.status !== "APPLIED") continue;
    await prisma.reviewDecision.createMany({
      data: [
        {
          id: id("rd", task.key, "submit"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          reviewTaskId: taskId,
          decision: "SUBMIT" as const,
          fromStatus: "DRAFT" as const,
          toStatus: "REVIEW_REQUIRED" as const,
          actorUserId: engineer,
          actorRole: "ENGINEER" as const,
          reason: "Хяналтад илгээв",
          sourceHash: hash("decision", task.key, "submit"),
          decidedAt: day("2026-02-27"),
        },
        {
          id: id("rd", task.key, "approve"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          reviewTaskId: taskId,
          decision: "APPROVE" as const,
          fromStatus: "REVIEW_REQUIRED" as const,
          toStatus: "APPROVED" as const,
          actorUserId: manager,
          actorRole: "PROJECT_MANAGER" as const,
          reason: task.note,
          sourceHash: hash("decision", task.key, "approve"),
          decidedAt: day("2026-02-28"),
        },
        {
          id: id("rd", task.key, "apply"),
          tenantId,
          projectId: DEMO_PROJECT_ID,
          reviewTaskId: taskId,
          decision: "APPLY" as const,
          fromStatus: "APPROVED" as const,
          toStatus: "APPLIED" as const,
          actorUserId: admin,
          actorRole: "COMPANY_ADMIN" as const,
          reason: "Суурь хувилбарт хэрэгжүүлэв",
          sourceHash: hash("decision", task.key, "apply"),
          decidedAt: day("2026-03-01"),
        },
      ],
    });
  }

  // -- Notifications and audit ---------------------------------------------
  await prisma.notification.createMany({
    data: [
      { code: "REVIEW_ASSIGNED", user: manager, title: "Өдрийн тайлан хянахыг хүлээж байна" },
      { code: "FORECAST_DELAY", user: manager, title: "Прогнозын хоцрогдол 12 хоног давлаа" },
      {
        code: "MATERIAL_SHORTAGE",
        user: storekeeper,
        title: "Керамзитбетон блокны нөөц дуусах дөхлөө",
      },
      {
        code: "VERIFICATION_BLOCKED",
        user: engineer,
        title: "Гүйцэтгэлийн баталгаажуулалт хаагдсан",
      },
    ].map((notification, index) => ({
      id: id("ntf", String(index)),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      userId: notification.user,
      eventId: id("evt", String(index)),
      channel: "IN_APP",
      templateCode: notification.code,
      payload: { title: notification.title, projectCode: DEMO_PROJECT_CODE },
      // Persisting an IN_APP row is the delivery step; only transports such as
      // email/SMS need an asynchronous PENDING state.
      status: "SENT" as const,
      sentAt: day(asOf),
    })),
  });

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      tenantId,
      projectId: DEMO_PROJECT_ID,
      actorUserId: admin,
      actorRole: "COMPANY_ADMIN",
      action: "DEMO_PROJECT_SEEDED",
      entityType: "PROJECT",
      entityId: DEMO_PROJECT_ID,
      reason: "Explicit demo project seed command",
      correlationId: randomUUID(),
      sourceVersion: FIXTURE_VERSION,
      metadata: {
        tenantSlug,
        asOf,
        dayCount,
        workPackages: WORK_PACKAGES.length,
        artifacts: artifacts.length,
      },
    },
  });

  const counts = await prisma.$transaction([
    prisma.workItem.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.designElement.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.quantityTakeoffItem.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.estimateLine.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.scheduleActivity.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.dailyWorkPlanItem.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.progressEntry.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.photoEvidence.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.stockMovement.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.forecastWorkItem.count({ where: { projectId: DEMO_PROJECT_ID } }),
    prisma.reviewTask.count({ where: { projectId: DEMO_PROJECT_ID, status: "REVIEW_REQUIRED" } }),
  ]);

  process.stdout.write(
    `Seeded demo project ${DEMO_PROJECT_CODE} into ${tenantSlug} (as of ${asOf})\n\n` +
      `  contract sum       ${totals.totalAmount.toLocaleString("en-US")} ₮\n` +
      `  work items         ${counts[0]}\n` +
      `  design elements    ${counts[1]}\n` +
      `  takeoff items      ${counts[2]}\n` +
      `  estimate lines     ${counts[3]}\n` +
      `  schedule tasks     ${counts[4]}\n` +
      `  daily plan items   ${counts[5]}\n` +
      `  progress entries   ${counts[6]}\n` +
      `  site photos        ${counts[7]}\n` +
      `  stock movements    ${counts[8]}\n` +
      `  forecast items     ${counts[9]}\n` +
      `  open reviews       ${counts[10]}\n` +
      `  artifact files     ${artifacts.length}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Demo project seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
