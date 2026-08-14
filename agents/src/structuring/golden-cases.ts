import { z } from "zod";
import {
  isoDateSchema,
  makeProjectUpdate,
  projectUpdateExtractionSchema,
  projectUpdateFieldSchema,
  type ProjectUpdateExtraction,
  type ProjectUpdateField,
} from "./schema.js";

export const A1_GOLDEN_SUITE = "a1-project-update-v1";

export const a1GoldenCaseSchema = z
  .object({
    id: z.string().regex(/^a1-[a-z0-9-]+$/),
    suite: z.literal(A1_GOLDEN_SUITE),
    locale: z.enum(["mn", "en", "mixed"]),
    inputText: z.string().trim().min(10),
    referenceDate: isoDateSchema,
    expected: projectUpdateExtractionSchema,
    scoredFields: z.array(projectUpdateFieldSchema).min(1),
    tags: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type A1GoldenCase = z.infer<typeof a1GoldenCaseSchema>;

function scored(...fieldNames: ProjectUpdateField[]) {
  return fieldNames;
}

function goldenCase(options: {
  id: string;
  locale?: A1GoldenCase["locale"];
  inputText: string;
  referenceDate?: string;
  expected: Partial<ProjectUpdateExtraction>;
  scoredFields: ProjectUpdateField[];
  tags: string[];
}): A1GoldenCase {
  return a1GoldenCaseSchema.parse({
    id: options.id,
    suite: A1_GOLDEN_SUITE,
    locale: options.locale ?? "mn",
    inputText: options.inputText,
    referenceDate: options.referenceDate ?? "2026-03-01",
    expected: makeProjectUpdate({
      language: options.locale ?? "mn",
      ...options.expected,
    }),
    scoredFields: options.scoredFields,
    tags: options.tags,
  });
}

export const A1_GOLDEN_CASES: A1GoldenCase[] = [
  goldenCase({
    id: "a1-overdue-procurement",
    inputText:
      '2026 оны 3-р сарын 1-ний байдлаар ATLAS төслийн AT-004 "Дэд бүтэц нийлүүлэх" ажил 75%-ийн гүйцэтгэлтэй, явж байгаа. Төлөвлөсөн дуусах өдөр 2026-02-20 байсан тул хугацаа хэтэрсэн.',
    expected: {
      projectCode: "ATLAS",
      workItemCode: "AT-004",
      workItemName: "Дэд бүтэц нийлүүлэх",
      reportDate: "2026-03-01",
      status: "IN_PROGRESS",
      progressPercent: 75,
      plannedEndDate: "2026-02-20",
      issueTypes: ["OVERDUE_WORK_ITEM"],
    },
    scoredFields: scored(
      "language",
      "projectCode",
      "workItemCode",
      "workItemName",
      "reportDate",
      "status",
      "progressPercent",
      "plannedEndDate",
      "issueTypes",
    ),
    tags: ["overdue", "status", "progress", "date"],
  }),
  goldenCase({
    id: "a1-stalled-integration",
    inputText:
      "ATLAS-ийн AT-005 Интеграц хөгжүүлэлт өмнөх тайланд 45%, одоо мөн 45%. Есөн хоног ахиц өөрчлөгдөөгүй, ажил үргэлжилж байна.",
    expected: {
      projectCode: "ATLAS",
      workItemCode: "AT-005",
      workItemName: "Интеграц хөгжүүлэлт",
      status: "IN_PROGRESS",
      progressPercent: 45,
      previousProgressPercent: 45,
      daysWithoutProgress: 9,
      issueTypes: ["STALLED_PROGRESS"],
    },
    scoredFields: scored(
      "projectCode",
      "workItemCode",
      "workItemName",
      "status",
      "progressPercent",
      "previousProgressPercent",
      "daysWithoutProgress",
      "issueTypes",
    ),
    tags: ["stalled", "progress"],
  }),
  goldenCase({
    id: "a1-dependency-violation",
    inputText:
      "AT-006 Өгөгдөл шилжүүлэх ажил 2026-02-18-нд бодитоор эхэлсэн. Өмнөх AT-005 ажил IN_PROGRESS буюу дуусаагүй байсан тул хамаарлын дараалал зөрчигдсөн.",
    expected: {
      workItemCode: "AT-006",
      workItemName: "Өгөгдөл шилжүүлэх",
      actualStartDate: "2026-02-18",
      predecessorWorkItemCode: "AT-005",
      predecessorStatus: "IN_PROGRESS",
      issueTypes: ["DEPENDENCY_VIOLATION"],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "actualStartDate",
      "predecessorWorkItemCode",
      "predecessorStatus",
      "issueTypes",
    ),
    tags: ["dependency", "date"],
  }),
  goldenCase({
    id: "a1-budget-overrun",
    inputText:
      "AT-003 Програмын лиценз худалдан авах ажлын батлагдсан төсөв 20 сая төгрөг, бодит зардал 27 сая төгрөг болсон. Төсөв хэтэрсэн.",
    expected: {
      workItemCode: "AT-003",
      workItemName: "Програмын лиценз худалдан авах",
      budgetMnt: "20000000.00",
      actualCostMnt: "27000000.00",
      issueTypes: ["BUDGET_OVERRUN"],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "budgetMnt",
      "actualCostMnt",
      "issueTypes",
    ),
    tags: ["budget", "money"],
  }),
  goldenCase({
    id: "a1-ledger-mismatch",
    inputText:
      "AT-004 ажлын системд бүртгэсэн бодит зардал 72,000,000₮, харин ledger-ийн нийлбэр 70,000,000₮ байна. Хоёр дүн зөрүүтэй.",
    expected: {
      workItemCode: "AT-004",
      actualCostMnt: "72000000.00",
      ledgerTotalMnt: "70000000.00",
      issueTypes: ["LEDGER_MISMATCH"],
    },
    scoredFields: scored("workItemCode", "actualCostMnt", "ledgerTotalMnt", "issueTypes"),
    tags: ["ledger", "money"],
  }),
  goldenCase({
    id: "a1-completed-healthy",
    inputText: "AT-001 Шаардлага тодорхойлох ажил 100 хувьтай, 2026-01-14-нд бүрэн дууссан.",
    expected: {
      workItemCode: "AT-001",
      workItemName: "Шаардлага тодорхойлох",
      status: "COMPLETED",
      progressPercent: 100,
      actualEndDate: "2026-01-14",
      issueTypes: [],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "status",
      "progressPercent",
      "actualEndDate",
      "issueTypes",
    ),
    tags: ["healthy", "completed"],
  }),
  goldenCase({
    id: "a1-planned-start",
    inputText:
      "RIVER төслийн RV-002 Суурийн засвар ажлыг 2026-02-20-ноос эхлүүлэхээр төлөвлөсөн, одоогоор эхлээгүй.",
    expected: {
      projectCode: "RIVER",
      workItemCode: "RV-002",
      workItemName: "Суурийн засвар",
      status: "PLANNED",
      plannedStartDate: "2026-02-20",
      issueTypes: [],
    },
    scoredFields: scored(
      "projectCode",
      "workItemCode",
      "workItemName",
      "status",
      "plannedStartDate",
      "issueTypes",
    ),
    tags: ["planned", "date"],
  }),
  goldenCase({
    id: "a1-blocked-critical",
    inputText:
      "AT-007 Сургалт ба нэвтрүүлэлт 30%-тай. Нийлүүлэгчийн баталгаажуулалт хүлээж байгаа тул BLOCKED, priority нь CRITICAL.",
    expected: {
      workItemCode: "AT-007",
      workItemName: "Сургалт ба нэвтрүүлэлт",
      status: "BLOCKED",
      priority: "CRITICAL",
      progressPercent: 30,
    },
    scoredFields: scored("workItemCode", "workItemName", "status", "priority", "progressPercent"),
    tags: ["blocked", "priority"],
  }),
  goldenCase({
    id: "a1-high-priority",
    inputText:
      "ATLAS / AT-008 Аюулгүй байдлын шалгалт: өндөр ач холбогдолтой, гүйцэтгэл 10%, ажил явагдаж байна.",
    expected: {
      projectCode: "ATLAS",
      workItemCode: "AT-008",
      workItemName: "Аюулгүй байдлын шалгалт",
      status: "IN_PROGRESS",
      priority: "HIGH",
      progressPercent: 10,
    },
    scoredFields: scored(
      "projectCode",
      "workItemCode",
      "workItemName",
      "status",
      "priority",
      "progressPercent",
    ),
    tags: ["priority", "progress"],
  }),
  goldenCase({
    id: "a1-mixed-language",
    locale: "mixed",
    inputText:
      "ATLAS project, work item AT-009 Data cleanup нь 60% complete, status нь IN_PROGRESS, forecast end 2026-03-20.",
    expected: {
      projectCode: "ATLAS",
      workItemCode: "AT-009",
      workItemName: "Data cleanup",
      status: "IN_PROGRESS",
      progressPercent: 60,
      forecastEndDate: "2026-03-20",
    },
    scoredFields: scored(
      "language",
      "projectCode",
      "workItemCode",
      "workItemName",
      "status",
      "progressPercent",
      "forecastEndDate",
    ),
    tags: ["mixed-language", "forecast"],
  }),
  goldenCase({
    id: "a1-decimal-million",
    inputText:
      "RV-001 Талбайн хэмжилтийн бодит зардал 12.5 сая төгрөг болсон, төсөв нь 15 сая төгрөг.",
    expected: {
      workItemCode: "RV-001",
      workItemName: "Талбайн хэмжилт",
      budgetMnt: "15000000.00",
      actualCostMnt: "12500000.00",
      issueTypes: [],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "budgetMnt",
      "actualCostMnt",
      "issueTypes",
    ),
    tags: ["money", "decimal"],
  }),
  goldenCase({
    id: "a1-name-only",
    inputText: '"Хэрэглэгчийн хүлээн авах туршилт" ажил талдаа орсон, гүйцэтгэл 50 хувь байна.',
    expected: {
      workItemName: "Хэрэглэгчийн хүлээн авах туршилт",
      progressPercent: 50,
      status: "IN_PROGRESS",
    },
    scoredFields: scored("workItemName", "progressPercent", "status"),
    tags: ["missing-code", "progress"],
  }),
  goldenCase({
    id: "a1-forecast-delay",
    inputText:
      "AT-010 Тайлангийн модуль төлөвлөгөөгөөр 2026-03-10-нд дуусах байсан ч шинэ таамаг 2026-03-18 болсон.",
    expected: {
      workItemCode: "AT-010",
      workItemName: "Тайлангийн модуль",
      plannedEndDate: "2026-03-10",
      forecastEndDate: "2026-03-18",
    },
    scoredFields: scored("workItemCode", "workItemName", "plannedEndDate", "forecastEndDate"),
    tags: ["forecast", "date"],
  }),
  goldenCase({
    id: "a1-progress-improved",
    inputText: "AT-011-ийн өмнөх гүйцэтгэл 40% байсан, өнөөдрийн байдлаар 55% болж өссөн.",
    expected: {
      workItemCode: "AT-011",
      reportDate: "2026-03-01",
      status: "IN_PROGRESS",
      progressPercent: 55,
      previousProgressPercent: 40,
      issueTypes: [],
    },
    scoredFields: scored(
      "workItemCode",
      "reportDate",
      "status",
      "progressPercent",
      "previousProgressPercent",
      "issueTypes",
    ),
    tags: ["progress", "relative-date"],
  }),
  goldenCase({
    id: "a1-cancelled",
    inputText:
      "RV-004 Хуучин агуулах буулгах ажлыг захиалагчийн шийдвэрээр цуцалсан. Төлөв CANCELLED.",
    expected: {
      workItemCode: "RV-004",
      workItemName: "Хуучин агуулах буулгах",
      status: "CANCELLED",
    },
    scoredFields: scored("workItemCode", "workItemName", "status"),
    tags: ["cancelled", "status"],
  }),
  goldenCase({
    id: "a1-multiple-issues",
    inputText:
      "AT-012 Сервер суурилуулах ажил 2026-02-25-нд дуусах ёстой байсан ч 80%-тай үргэлжилж байна. Төсөв 30 сая, бодит зардал 35 сая болсон.",
    expected: {
      workItemCode: "AT-012",
      workItemName: "Сервер суурилуулах",
      status: "IN_PROGRESS",
      progressPercent: 80,
      plannedEndDate: "2026-02-25",
      budgetMnt: "30000000.00",
      actualCostMnt: "35000000.00",
      issueTypes: ["OVERDUE_WORK_ITEM", "BUDGET_OVERRUN"],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "status",
      "progressPercent",
      "plannedEndDate",
      "budgetMnt",
      "actualCostMnt",
      "issueTypes",
    ),
    tags: ["multiple-issues", "overdue", "budget"],
  }),
  goldenCase({
    id: "a1-yesterday-report",
    inputText: "Өчигдрийн тайлангаар AT-013 Тест автоматжуулалт 65 хувьтай, үргэлжилж байсан.",
    expected: {
      workItemCode: "AT-013",
      workItemName: "Тест автоматжуулалт",
      reportDate: "2026-02-28",
      status: "IN_PROGRESS",
      progressPercent: 65,
    },
    scoredFields: scored("workItemCode", "workItemName", "reportDate", "status", "progressPercent"),
    tags: ["relative-date", "progress"],
  }),
  goldenCase({
    id: "a1-sparse-project-note",
    inputText: "ATLAS төслийн долоо хоногийн уулзалт амжилттай болж, дараагийн уулзалтаа товлов.",
    expected: {
      projectCode: "ATLAS",
      issueTypes: [],
    },
    scoredFields: scored("projectCode", "workItemCode", "progressPercent", "issueTypes"),
    tags: ["sparse", "null-handling"],
  }),
  goldenCase({
    id: "a1-currency-symbol",
    inputText: "AT-014 Сүлжээний төхөөрөмжийн төсөв ₮45,000,000, зарцуулалт ₮42,750,000 байна.",
    expected: {
      workItemCode: "AT-014",
      workItemName: "Сүлжээний төхөөрөмж",
      budgetMnt: "45000000.00",
      actualCostMnt: "42750000.00",
      issueTypes: [],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "budgetMnt",
      "actualCostMnt",
      "issueTypes",
    ),
    tags: ["money", "currency-symbol"],
  }),
  goldenCase({
    id: "a1-not-started-synonym",
    inputText: "AT-015 Нөөц сервер тохируулах ажил хараахан эхлээгүй, төлөвлөгдсөн хэвээр.",
    expected: {
      workItemCode: "AT-015",
      workItemName: "Нөөц сервер тохируулах",
      status: "PLANNED",
      progressPercent: null,
    },
    scoredFields: scored("workItemCode", "workItemName", "status", "progressPercent"),
    tags: ["status-synonym", "null-handling"],
  }),
  goldenCase({
    id: "a1-english-stalled",
    locale: "en",
    inputText:
      "Work item AT-016 API gateway remains at 35% and has made no progress for 7 days. Status is in progress.",
    expected: {
      workItemCode: "AT-016",
      workItemName: "API gateway",
      status: "IN_PROGRESS",
      progressPercent: 35,
      daysWithoutProgress: 7,
      issueTypes: ["STALLED_PROGRESS"],
    },
    scoredFields: scored(
      "language",
      "workItemCode",
      "workItemName",
      "status",
      "progressPercent",
      "daysWithoutProgress",
      "issueTypes",
    ),
    tags: ["english", "stalled"],
  }),
  goldenCase({
    id: "a1-dependency-english-status",
    locale: "mixed",
    inputText:
      "AT-018 Deployment 2026-02-27-нд эхэлсэн боловч predecessor AT-017 status нь BLOCKED байсан. Dependency violation үүссэн.",
    expected: {
      workItemCode: "AT-018",
      workItemName: "Deployment",
      actualStartDate: "2026-02-27",
      predecessorWorkItemCode: "AT-017",
      predecessorStatus: "BLOCKED",
      issueTypes: ["DEPENDENCY_VIOLATION"],
    },
    scoredFields: scored(
      "language",
      "workItemCode",
      "workItemName",
      "actualStartDate",
      "predecessorWorkItemCode",
      "predecessorStatus",
      "issueTypes",
    ),
    tags: ["mixed-language", "dependency"],
  }),
  goldenCase({
    id: "a1-ledger-reconciled",
    inputText:
      "AT-019 ажлын бодит зардал 18 сая төгрөг, ledger нийт дүн мөн 18 сая төгрөг тул зөрүү байхгүй.",
    expected: {
      workItemCode: "AT-019",
      actualCostMnt: "18000000.00",
      ledgerTotalMnt: "18000000.00",
      issueTypes: [],
    },
    scoredFields: scored("workItemCode", "actualCostMnt", "ledgerTotalMnt", "issueTypes"),
    tags: ["ledger", "healthy"],
  }),
  goldenCase({
    id: "a1-under-budget",
    inputText:
      "AT-020 Мэдээлэл шилжүүлэх туршилтын төсөв 10,000,000 төгрөг. Одоогийн бодит зардал 8,200,000 төгрөг байна.",
    expected: {
      workItemCode: "AT-020",
      workItemName: "Мэдээлэл шилжүүлэх туршилт",
      budgetMnt: "10000000.00",
      actualCostMnt: "8200000.00",
      issueTypes: [],
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "budgetMnt",
      "actualCostMnt",
      "issueTypes",
    ),
    tags: ["budget", "healthy"],
  }),
  goldenCase({
    id: "a1-actual-start-end",
    inputText:
      "RV-005 Кабель татах ажил 2026-02-12-нд эхэлж, 2026-02-24-нд дууссан. Гүйцэтгэл 100%.",
    expected: {
      workItemCode: "RV-005",
      workItemName: "Кабель татах",
      status: "COMPLETED",
      progressPercent: 100,
      actualStartDate: "2026-02-12",
      actualEndDate: "2026-02-24",
    },
    scoredFields: scored(
      "workItemCode",
      "workItemName",
      "status",
      "progressPercent",
      "actualStartDate",
      "actualEndDate",
    ),
    tags: ["completed", "date"],
  }),
];

export function parseA1GoldenCases(cases: readonly unknown[] = A1_GOLDEN_CASES) {
  return cases.map((golden) => a1GoldenCaseSchema.parse(golden));
}
