import { faker } from "@faker-js/faker";
import {
  CostCategory,
  DependencyType,
  ProjectStatus,
  WorkItemPriority,
  WorkItemStatus,
} from "@prisma/client";
import { addDays } from "date-fns";
import seedrandom from "seedrandom";
import { answerKeySchema, type AnswerKey } from "../src/answer-key.js";

export const SEED_NAME = "diplom-agents-v1";
export const SEED_AS_OF = new Date("2026-03-01T00:00:00.000Z");

type Money = string;

export interface TenantSeed {
  id: string;
  slug: string;
  name: string;
}

export interface ProjectSeed {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  location: string;
  status: ProjectStatus;
  plannedStart: Date;
  plannedEnd: Date;
  budget: Money;
  actualCost: Money;
}

export interface WorkItemSeed {
  id: string;
  tenantId: string;
  projectId: string;
  code: string;
  name: string;
  description: string;
  assigneeName: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  plannedStart: Date;
  plannedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  progressPercent: number;
  budget: Money;
  actualCost: Money;
  isCritical: boolean;
}

export interface DependencySeed {
  id: string;
  tenantId: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export interface SnapshotSeed {
  id: string;
  tenantId: string;
  projectId: string;
  workItemId: string;
  capturedAt: Date;
  status: WorkItemStatus;
  progressPercent: number;
  actualCost: Money;
  note: string;
}

export interface CostEntrySeed {
  id: string;
  tenantId: string;
  projectId: string;
  workItemId: string;
  reference: string;
  occurredAt: Date;
  category: CostCategory;
  amount: Money;
  description: string;
}

export interface SeedData {
  tenants: TenantSeed[];
  projects: ProjectSeed[];
  workItems: WorkItemSeed[];
  dependencies: DependencySeed[];
  snapshots: SnapshotSeed[];
  costEntries: CostEntrySeed[];
  answerKey: AnswerKey;
}

const baseDate = new Date("2026-01-01T00:00:00.000Z");

function onDay(offset: number) {
  return addDays(baseDate, offset);
}

export function buildSeedData(): SeedData {
  faker.seed(20260725);
  const random = seedrandom(SEED_NAME);
  const assignees = Array.from({ length: 8 }, () => faker.person.fullName());
  const healthyProgress = 60 + Math.floor(random() * 21);

  const tenants: TenantSeed[] = [
    {
      id: "tenant-demo",
      slug: "nomad-build",
      name: "Nomad Build LLC",
    },
    {
      id: "tenant-isolation",
      slug: "steppe-labs",
      name: "Steppe Labs LLC",
    },
  ];

  const projects: ProjectSeed[] = [
    {
      id: "project-atlas",
      tenantId: "tenant-demo",
      code: "ATLAS",
      name: "ERP шинэчлэлийн төсөл",
      description: "Төлөвлөгөө, өртөг, хамаарлын асуудал агуулсан үндсэн үнэлгээний төсөл.",
      location: "Улаанбаатар",
      status: ProjectStatus.ACTIVE,
      plannedStart: onDay(4),
      plannedEnd: onDay(119),
      budget: "500000000.00",
      actualCost: "216000000.00",
    },
    {
      id: "project-river",
      tenantId: "tenant-demo",
      code: "RIVER",
      name: "Агуулахын шинэчлэл",
      description: "Хэвийн явцтай харьцуулах зориулалттай төсөл.",
      location: "Дархан",
      status: ProjectStatus.ACTIVE,
      plannedStart: onDay(50),
      plannedEnd: onDay(180),
      budget: "150000000.00",
      actualCost: "12000000.00",
    },
    {
      id: "project-private",
      tenantId: "tenant-isolation",
      code: "PRIVATE",
      name: "Нууц дотоод төсөл",
      description: "Tenant тусгаарлалтын тестэд ашиглах өөр байгууллагын төсөл.",
      location: "Эрдэнэт",
      status: ProjectStatus.ACTIVE,
      plannedStart: onDay(20),
      plannedEnd: onDay(150),
      budget: "400000000.00",
      actualCost: "40000000.00",
    },
  ];

  const workItems: WorkItemSeed[] = [
    {
      id: "wi-atlas-discovery",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-001",
      name: "Шаардлага тодорхойлох",
      description: "Одоогийн процесс болон системийн шаардлагыг нэгтгэх.",
      assigneeName: assignees[0],
      status: WorkItemStatus.COMPLETED,
      priority: WorkItemPriority.HIGH,
      plannedStart: onDay(4),
      plannedEnd: onDay(14),
      actualStart: onDay(4),
      actualEnd: onDay(13),
      progressPercent: 100,
      budget: "10000000.00",
      actualCost: "9000000.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-design",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-002",
      name: "Шийдлийн архитектур",
      description: "Интеграц болон өгөгдлийн архитектур батлах.",
      assigneeName: assignees[1],
      status: WorkItemStatus.COMPLETED,
      priority: WorkItemPriority.CRITICAL,
      plannedStart: onDay(15),
      plannedEnd: onDay(31),
      actualStart: onDay(15),
      actualEnd: onDay(31),
      progressPercent: 100,
      budget: "25000000.00",
      actualCost: "23000000.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-license",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-003",
      name: "Програмын лиценз худалдан авах",
      description: "Үндсэн болон туршилтын орчны лицензүүдийг худалдан авах.",
      assigneeName: assignees[2],
      status: WorkItemStatus.COMPLETED,
      priority: WorkItemPriority.HIGH,
      plannedStart: onDay(19),
      plannedEnd: onDay(30),
      actualStart: onDay(19),
      actualEnd: onDay(30),
      progressPercent: 100,
      budget: "20000000.00",
      actualCost: "27000000.00",
      isCritical: false,
    },
    {
      id: "wi-atlas-procurement",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-004",
      name: "Дэд бүтэц нийлүүлэх",
      description: "Сервер болон сүлжээний тоног төхөөрөмж нийлүүлэх.",
      assigneeName: assignees[3],
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.CRITICAL,
      plannedStart: onDay(32),
      plannedEnd: onDay(50),
      actualStart: onDay(32),
      actualEnd: null,
      progressPercent: 75,
      budget: "80000000.00",
      actualCost: "72000000.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-integration",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-005",
      name: "Системийн интеграц хөгжүүлэх",
      description: "Санхүү болон хүний нөөцийн системтэй холбох.",
      assigneeName: assignees[4],
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.CRITICAL,
      plannedStart: onDay(32),
      plannedEnd: onDay(68),
      actualStart: onDay(32),
      actualEnd: null,
      progressPercent: 45,
      budget: "120000000.00",
      actualCost: "70000000.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-migration",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-006",
      name: "Өгөгдөл шилжүүлэх",
      description: "Хуучин системийн өгөгдлийг цэвэрлэж шинэ системд шилжүүлэх.",
      assigneeName: assignees[5],
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.CRITICAL,
      plannedStart: onDay(60),
      plannedEnd: onDay(79),
      actualStart: onDay(48),
      actualEnd: null,
      progressPercent: 20,
      budget: "60000000.00",
      actualCost: "15000000.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-training",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-007",
      name: "Хэрэглэгчийн сургалт",
      description: "Түлхүүр хэрэглэгчдэд шинэ системийн сургалт хийх.",
      assigneeName: assignees[6],
      status: WorkItemStatus.PLANNED,
      priority: WorkItemPriority.HIGH,
      plannedStart: onDay(80),
      plannedEnd: onDay(94),
      actualStart: null,
      actualEnd: null,
      progressPercent: 0,
      budget: "35000000.00",
      actualCost: "0.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-pilot",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-008",
      name: "Пилот нэвтрүүлэлт",
      description: "Сонгосон нэгжид хязгаарлагдмал хүрээнд нэвтрүүлэх.",
      assigneeName: assignees[7],
      status: WorkItemStatus.PLANNED,
      priority: WorkItemPriority.CRITICAL,
      plannedStart: onDay(95),
      plannedEnd: onDay(104),
      actualStart: null,
      actualEnd: null,
      progressPercent: 0,
      budget: "50000000.00",
      actualCost: "0.00",
      isCritical: true,
    },
    {
      id: "wi-atlas-rollout",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      code: "AT-009",
      name: "Үндсэн нэвтрүүлэлт",
      description: "Бүх нэгжид системийг ашиглалтад оруулах.",
      assigneeName: assignees[0],
      status: WorkItemStatus.PLANNED,
      priority: WorkItemPriority.CRITICAL,
      plannedStart: onDay(105),
      plannedEnd: onDay(119),
      actualStart: null,
      actualEnd: null,
      progressPercent: 0,
      budget: "80000000.00",
      actualCost: "0.00",
      isCritical: true,
    },
    {
      id: "wi-river-survey",
      tenantId: "tenant-demo",
      projectId: "project-river",
      code: "RV-001",
      name: "Талбайн хэмжилт",
      description: "Агуулахын талбайн бодит хэмжилт хийх.",
      assigneeName: assignees[1],
      status: WorkItemStatus.COMPLETED,
      priority: WorkItemPriority.MEDIUM,
      plannedStart: onDay(50),
      plannedEnd: onDay(55),
      actualStart: onDay(50),
      actualEnd: onDay(54),
      progressPercent: 100,
      budget: "8000000.00",
      actualCost: "5000000.00",
      isCritical: true,
    },
    {
      id: "wi-river-foundation",
      tenantId: "tenant-demo",
      projectId: "project-river",
      code: "RV-002",
      name: "Суурийн засвар",
      description: "Шал болон суурийн эвдрэлийг засварлах.",
      assigneeName: assignees[2],
      status: WorkItemStatus.IN_PROGRESS,
      priority: WorkItemPriority.HIGH,
      plannedStart: onDay(56),
      plannedEnd: onDay(90),
      actualStart: onDay(56),
      actualEnd: null,
      progressPercent: healthyProgress,
      budget: "30000000.00",
      actualCost: "7000000.00",
      isCritical: true,
    },
    {
      id: "wi-private-analysis",
      tenantId: "tenant-isolation",
      projectId: "project-private",
      code: "PR-001",
      name: "Дотоод судалгаа",
      description: "Өөр tenant-д харагдах ёсгүй нууц ажлын өгөгдөл.",
      assigneeName: assignees[3],
      status: WorkItemStatus.COMPLETED,
      priority: WorkItemPriority.HIGH,
      plannedStart: onDay(20),
      plannedEnd: onDay(45),
      actualStart: onDay(20),
      actualEnd: onDay(44),
      progressPercent: 100,
      budget: "50000000.00",
      actualCost: "40000000.00",
      isCritical: true,
    },
  ];

  const dependencies: DependencySeed[] = [
    ["dep-atlas-001", "wi-atlas-discovery", "wi-atlas-design"],
    ["dep-atlas-002", "wi-atlas-design", "wi-atlas-license"],
    ["dep-atlas-003", "wi-atlas-design", "wi-atlas-procurement"],
    ["dep-atlas-004", "wi-atlas-design", "wi-atlas-integration"],
    ["dep-atlas-005", "wi-atlas-procurement", "wi-atlas-migration"],
    ["dep-atlas-006", "wi-atlas-integration", "wi-atlas-migration"],
    ["dep-atlas-007", "wi-atlas-migration", "wi-atlas-training"],
    ["dep-atlas-008", "wi-atlas-training", "wi-atlas-pilot"],
    ["dep-atlas-009", "wi-atlas-pilot", "wi-atlas-rollout"],
  ].map(([id, predecessorId, successorId]) => ({
    id,
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    predecessorId,
    successorId,
    type: DependencyType.FINISH_TO_START,
    lagDays: 0,
  }));

  dependencies.push({
    id: "dep-river-001",
    tenantId: "tenant-demo",
    projectId: "project-river",
    predecessorId: "wi-river-survey",
    successorId: "wi-river-foundation",
    type: DependencyType.FINISH_TO_START,
    lagDays: 1,
  });

  const snapshots: SnapshotSeed[] = [
    {
      id: "snapshot-procurement-01",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-procurement",
      capturedAt: onDay(40),
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 35,
      actualCost: "30000000.00",
      note: "Эхний нийлүүлэлт хийгдсэн.",
    },
    {
      id: "snapshot-procurement-02",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-procurement",
      capturedAt: onDay(50),
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 60,
      actualCost: "55000000.00",
      note: "Гаалийн бүрдүүлэлт үргэлжилж байна.",
    },
    {
      id: "snapshot-procurement-03",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-procurement",
      capturedAt: SEED_AS_OF,
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 75,
      actualCost: "72000000.00",
      note: "Хугацаа хэтэрсэн боловч ахиц үргэлжилж байна.",
    },
    {
      id: "snapshot-integration-01",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-integration",
      capturedAt: onDay(40),
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 25,
      actualCost: "35000000.00",
      note: "Санхүүгийн API холболт эхэлсэн.",
    },
    {
      id: "snapshot-integration-02",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-integration",
      capturedAt: onDay(50),
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 45,
      actualCost: "60000000.00",
      note: "Тестийн орчны эрх хүлээгдэж байна.",
    },
    {
      id: "snapshot-integration-03",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-integration",
      capturedAt: SEED_AS_OF,
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 45,
      actualCost: "70000000.00",
      note: "Есөн хоногийн турш ахиц өөрчлөгдөөгүй.",
    },
    {
      id: "snapshot-migration-01",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-migration",
      capturedAt: onDay(48),
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 5,
      actualCost: "5000000.00",
      note: "Өмнөх ажлууд дуусаагүй байхад эхэлсэн.",
    },
    {
      id: "snapshot-migration-02",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      workItemId: "wi-atlas-migration",
      capturedAt: SEED_AS_OF,
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 20,
      actualCost: "15000000.00",
      note: "Туршилтын өгөгдлийн шилжүүлэлт үргэлжилж байна.",
    },
    {
      id: "snapshot-river-foundation-01",
      tenantId: "tenant-demo",
      projectId: "project-river",
      workItemId: "wi-river-foundation",
      capturedAt: onDay(56),
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: 10,
      actualCost: "2000000.00",
      note: "Ажил төлөвлөгөөний дагуу эхэлсэн.",
    },
    {
      id: "snapshot-river-foundation-02",
      tenantId: "tenant-demo",
      projectId: "project-river",
      workItemId: "wi-river-foundation",
      capturedAt: SEED_AS_OF,
      status: WorkItemStatus.IN_PROGRESS,
      progressPercent: healthyProgress,
      actualCost: "7000000.00",
      note: "Ахиц хэвийн нэмэгдсэн.",
    },
    {
      id: "snapshot-private-analysis-01",
      tenantId: "tenant-isolation",
      projectId: "project-private",
      workItemId: "wi-private-analysis",
      capturedAt: onDay(44),
      status: WorkItemStatus.COMPLETED,
      progressPercent: 100,
      actualCost: "40000000.00",
      note: "Өөр tenant-ийн тусгаарлагдсан progress snapshot.",
    },
  ];

  const costEntries: CostEntrySeed[] = [
    [
      "cost-atlas-001",
      "wi-atlas-discovery",
      "ATLAS-0001",
      10,
      CostCategory.LABOR,
      "9000000.00",
      "Шаардлага тодорхойлох хөдөлмөрийн зардал",
    ],
    [
      "cost-atlas-002",
      "wi-atlas-design",
      "ATLAS-0002",
      22,
      CostCategory.LABOR,
      "18000000.00",
      "Архитектурын зөвлөх үйлчилгээ",
    ],
    [
      "cost-atlas-003",
      "wi-atlas-design",
      "ATLAS-0003",
      30,
      CostCategory.SOFTWARE,
      "5000000.00",
      "Загварчлалын хэрэгслийн лиценз",
    ],
    [
      "cost-atlas-004",
      "wi-atlas-license",
      "ATLAS-0004",
      25,
      CostCategory.SOFTWARE,
      "27000000.00",
      "ERP лицензийн төлбөр",
    ],
    [
      "cost-atlas-005",
      "wi-atlas-procurement",
      "ATLAS-0005",
      42,
      CostCategory.EQUIPMENT,
      "60000000.00",
      "Серверийн тоног төхөөрөмж",
    ],
    [
      "cost-atlas-006",
      "wi-atlas-procurement",
      "ATLAS-0006",
      55,
      CostCategory.MATERIAL,
      "10000000.00",
      "Сүлжээний дагалдах материал",
    ],
    [
      "cost-atlas-007",
      "wi-atlas-integration",
      "ATLAS-0007",
      45,
      CostCategory.LABOR,
      "60000000.00",
      "Интеграц хөгжүүлэлтийн хөдөлмөр",
    ],
    [
      "cost-atlas-008",
      "wi-atlas-integration",
      "ATLAS-0008",
      54,
      CostCategory.SOFTWARE,
      "10000000.00",
      "Тестийн орчны үйлчилгээ",
    ],
    [
      "cost-atlas-009",
      "wi-atlas-migration",
      "ATLAS-0009",
      58,
      CostCategory.LABOR,
      "15000000.00",
      "Өгөгдөл цэвэрлэгээ ба туршилт",
    ],
  ].map(([id, workItemId, reference, occurredDay, category, amount, description]) => ({
    id: String(id),
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    workItemId: String(workItemId),
    reference: String(reference),
    occurredAt: onDay(Number(occurredDay)),
    category: category as CostCategory,
    amount: String(amount),
    description: String(description),
  }));

  costEntries.push(
    {
      id: "cost-river-001",
      tenantId: "tenant-demo",
      projectId: "project-river",
      workItemId: "wi-river-survey",
      reference: "RIVER-0001",
      occurredAt: onDay(54),
      category: CostCategory.LABOR,
      amount: "5000000.00",
      description: "Талбайн хэмжилтийн үйлчилгээ",
    },
    {
      id: "cost-river-002",
      tenantId: "tenant-demo",
      projectId: "project-river",
      workItemId: "wi-river-foundation",
      reference: "RIVER-0002",
      occurredAt: onDay(58),
      category: CostCategory.MATERIAL,
      amount: "7000000.00",
      description: "Суурийн засварын материал",
    },
    {
      id: "cost-private-001",
      tenantId: "tenant-isolation",
      projectId: "project-private",
      workItemId: "wi-private-analysis",
      reference: "PRIVATE-0001",
      occurredAt: onDay(44),
      category: CostCategory.LABOR,
      amount: "40000000.00",
      description: "Дотоод судалгааны үйлчилгээ",
    },
  );

  const answerKey = answerKeySchema.parse({
    version: 1,
    seed: SEED_NAME,
    asOf: SEED_AS_OF.toISOString(),
    projectOutcomes: [
      {
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        actualFinish: onDay(131).toISOString(),
      },
    ],
    issues: [
      {
        id: "issue-atlas-overdue-procurement",
        type: "OVERDUE_WORK_ITEM",
        severity: "HIGH",
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        workItemId: "wi-atlas-procurement",
        effectiveFrom: onDay(51).toISOString(),
        summary: "Дэд бүтэц нийлүүлэх ажил төлөвлөсөн хугацаандаа дуусаагүй.",
        expectedEvidence: {
          plannedEnd: onDay(50).toISOString(),
          status: WorkItemStatus.IN_PROGRESS,
          progressPercent: 75,
        },
      },
      {
        id: "issue-atlas-stalled-integration",
        type: "STALLED_PROGRESS",
        severity: "HIGH",
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        workItemId: "wi-atlas-integration",
        effectiveFrom: onDay(57).toISOString(),
        summary: "Интеграц хөгжүүлэлтийн ахиц есөн хоног өөрчлөгдөөгүй.",
        expectedEvidence: {
          previousProgressPercent: 45,
          currentProgressPercent: 45,
          daysWithoutProgress: 9,
        },
      },
      {
        id: "issue-atlas-dependency-migration",
        type: "DEPENDENCY_VIOLATION",
        severity: "CRITICAL",
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        workItemId: "wi-atlas-migration",
        effectiveFrom: onDay(48).toISOString(),
        summary: "Өгөгдөл шилжүүлэх ажил өмнөх хоёр critical ажил дуусаагүй байхад эхэлсэн.",
        expectedEvidence: {
          predecessorId: "wi-atlas-integration",
          successorActualStart: onDay(48).toISOString(),
          predecessorStatus: WorkItemStatus.IN_PROGRESS,
        },
      },
      {
        id: "issue-atlas-budget-license",
        type: "BUDGET_OVERRUN",
        severity: "MEDIUM",
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        workItemId: "wi-atlas-license",
        effectiveFrom: onDay(30).toISOString(),
        summary: "Програмын лицензийн бодит зардал төсвөөс долоон сая төгрөгөөр хэтэрсэн.",
        expectedEvidence: {
          budget: "20000000.00",
          actualCost: "27000000.00",
          variance: "7000000.00",
        },
      },
      {
        id: "issue-atlas-ledger-procurement",
        type: "LEDGER_MISMATCH",
        severity: "HIGH",
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        workItemId: "wi-atlas-procurement",
        effectiveFrom: SEED_AS_OF.toISOString(),
        summary: "Ажлын бодит зардал ledger-ийн нийлбэрээс хоёр сая төгрөгөөр зөрсөн.",
        expectedEvidence: {
          recordedActualCost: "72000000.00",
          ledgerTotal: "70000000.00",
          variance: "2000000.00",
        },
      },
    ],
  });

  return {
    tenants,
    projects,
    workItems,
    dependencies,
    snapshots,
    costEntries,
    answerKey,
  };
}
