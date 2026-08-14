import "dotenv/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  buildPhase7EstimatePolicy,
  buildPhase7MaterialNorms,
  buildPhase7Prices,
  buildPhase7ProductivityRates,
  buildPhase7QuantityRequest,
  buildPhase7VerifiedScale,
  buildPhase7WorkTemplates,
} from "../baseline-generation/fixtures.js";
import {
  buildEngineeringWorkbookFixture,
  buildVectorArchitecturalPdfFixture,
} from "../design-intake/fixtures.js";
import { buildPhase8GoldenFixture } from "../orchestration/fixtures.js";
import { buildSitePhoto } from "../demo/khan-uul-artifacts.js";
import { MONGOLIAN_DAILY_REPORTS } from "../demo/daily-report-texts.js";

/**
 * Writes every input the agents and API accept into one folder, sorted by the
 * kind of thing it is, so the system can be exercised by hand instead of only
 * through the seed script.
 *
 * Everything here is produced by the same builders the tests use, so the files
 * satisfy the real contracts rather than approximating them.
 */

const ROOT = path.resolve("../test-data");

async function writeJson(relative: string, value: unknown): Promise<void> {
  const target = path.join(ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeBytes(relative: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function writeText(relative: string, text: string): Promise<void> {
  const target = path.join(ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

/** One sheet per record type, first row bold and frozen. */
async function writeWorkbook(
  relative: string,
  sheets: readonly {
    readonly name: string;
    readonly columns: readonly { header: string; key: string; width: number }[];
    readonly rows: readonly Record<string, unknown>[];
  }[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BuildWatch test data";
  workbook.created = new Date("2026-08-09T00:00:00.000Z");
  workbook.modified = workbook.created;
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = [...sheet.columns];
    for (const row of sheet.rows) worksheet.addRow(row);
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
  }
  const target = path.join(ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await workbook.xlsx.writeBuffer()));
}

async function exportCatalogues(): Promise<number> {
  const norms = buildPhase7MaterialNorms();
  const rates = buildPhase7ProductivityRates();
  const prices = buildPhase7Prices();
  const templates = buildPhase7WorkTemplates();
  const policy = buildPhase7EstimatePolicy();

  await writeWorkbook("01-lavlah/lavlah-ogogdol.xlsx", [
    {
      name: "Материалын норм",
      columns: [
        { header: "Ажлын код", key: "workCode", width: 16 },
        { header: "Ажлын нэгж", key: "workUnit", width: 12 },
        { header: "Материалын код", key: "materialCode", width: 20 },
        { header: "Материалын нэгж", key: "materialUnit", width: 16 },
        { header: "Нэгжид ногдох", key: "quantityPerWorkUnit", width: 16 },
        { header: "Хаягдал", key: "wasteFactor", width: 12 },
      ],
      rows: norms.map((norm) => ({
        workCode: norm.workCode,
        workUnit: norm.workUnit,
        materialCode: norm.materialCode,
        materialUnit: norm.materialUnit,
        quantityPerWorkUnit: norm.quantityPerWorkUnit,
        wasteFactor: norm.wasteFactor,
      })),
    },
    {
      name: "Бүтээмж",
      columns: [
        { header: "Ажлын код", key: "workCode", width: 16 },
        { header: "Ажлын нэгж", key: "workUnit", width: 12 },
        { header: "Өдрийн гүйцэтгэл (баг)", key: "quantityPerWorkingDay", width: 24 },
        { header: "Ажлын ангилал", key: "laborClassCode", width: 20 },
        { header: "Багийн хүн", key: "crewCount", width: 14 },
        { header: "Цаг / нэгж", key: "laborHoursPerWorkUnit", width: 14 },
      ],
      rows: rates.map((rate) => ({
        workCode: rate.workCode,
        workUnit: rate.workUnit,
        quantityPerWorkingDay: rate.quantityPerWorkingDay,
        laborClassCode: rate.laborClassCode,
        crewCount: rate.crewCount,
        laborHoursPerWorkUnit: rate.laborHoursPerWorkUnit,
      })),
    },
    {
      name: "Үнэ",
      columns: [
        { header: "Код", key: "itemCode", width: 22 },
        { header: "Зардлын төрөл", key: "costType", width: 16 },
        { header: "Нэгж", key: "unit", width: 10 },
        { header: "Нэгж үнэ (₮)", key: "unitPriceMnt", width: 18 },
        { header: "Нийлүүлэгчийн санал", key: "supplierQuotationId", width: 26 },
      ],
      rows: prices.map((price) => ({
        itemCode: price.itemCode,
        costType: price.costType,
        unit: price.unit,
        unitPriceMnt: price.unitPriceMnt.value,
        supplierQuotationId: price.supplierQuotationId ?? "",
      })),
    },
    {
      name: "Ажлын загвар",
      columns: [
        { header: "Ажлын код", key: "workCode", width: 16 },
        { header: "WBS", key: "wbsCode", width: 14 },
        { header: "Эцэг WBS", key: "parentWbsCode", width: 14 },
        { header: "Нэр", key: "name", width: 40 },
        { header: "Ач холбогдол", key: "priority", width: 14 },
        { header: "Өмнөх ажил", key: "predecessors", width: 30 },
      ],
      rows: templates.map((template) => ({
        workCode: template.workCode,
        wbsCode: template.wbsCode,
        parentWbsCode: template.parentWbsCode ?? "",
        name: template.name,
        priority: template.priority,
        predecessors: template.predecessors
          .map((link) => `${link.predecessorWorkCode} (${link.type}, +${link.lagWorkingDays}ө)`)
          .join(" · "),
      })),
    },
  ]);

  await writeJson("01-lavlah/materialiin-norm.json", norms);
  await writeJson("01-lavlah/buteemjiin-norm.json", rates);
  await writeJson("01-lavlah/uniin-katalog.json", prices);
  await writeJson("01-lavlah/ajliin-zagvar-wbs.json", templates);
  await writeJson("01-lavlah/tootsoonii-bodlogo.json", policy);
  return 6;
}

async function exportDesignInputs(): Promise<number> {
  // A clean vector sheet, plus two that must be rejected — the negative cases
  // are the point: P-04 says no scale means no quantity.
  await writeBytes(
    "02-zurag-tosol/AR-01-vektor-plan-4hh.pdf",
    buildVectorArchitecturalPdfFixture({ pages: 4 }),
  );
  await writeBytes(
    "02-zurag-tosol/AR-02-masshtabgui.pdf",
    buildVectorArchitecturalPdfFixture({ missingScale: true }),
  );
  await writeBytes(
    "02-zurag-tosol/AR-03-zovruutei-masshtab.pdf",
    buildVectorArchitecturalPdfFixture({ mixedScale: true }),
  );
  await writeBytes(
    "02-zurag-tosol/inzhenerin-workbook.xlsx",
    await buildEngineeringWorkbookFixture(),
  );
  await writeJson("02-zurag-tosol/masshtab-batalgaajuulalt.json", buildPhase7VerifiedScale());
  return 5;
}

async function exportAgentRequests(): Promise<number> {
  const quantityRequest = buildPhase7QuantityRequest();
  await writeJson("03-agent-oroltuud/a0-01-too-hemjee-request.json", quantityRequest);
  await writeJson("03-agent-oroltuud/a0-02-tosov-oroltuud.json", {
    materialNorms: buildPhase7MaterialNorms(),
    prices: buildPhase7Prices(),
    productivityRates: buildPhase7ProductivityRates(),
    policy: buildPhase7EstimatePolicy(),
  });
  await writeJson("03-agent-oroltuud/a0-03-huvaari-oroltuud.json", {
    workTemplates: buildPhase7WorkTemplates(),
    productivityRates: buildPhase7ProductivityRates(),
    note: "Хуваарийн request нь батлагдсан тоо хэмжээ, төсвийн ID шаарддаг тул тэдгээрийг эхлээд үүсгэнэ.",
  });

  const golden = buildPhase8GoldenFixture();
  await writeJson("03-agent-oroltuud/a0-orchestration-request.json", golden.a0Request);
  await writeJson("03-agent-oroltuud/a5-orchestration-request.json", golden.a5Request);
  return 5;
}

async function exportDailyReports(): Promise<number> {
  for (const [index, report] of MONGOLIAN_DAILY_REPORTS.entries()) {
    const name = `04-odriin-tailan/${String(index + 1).padStart(2, "0")}-${report.slug}.txt`;
    await writeText(name, `${report.text}\n`);
  }
  await writeJson(
    "04-odriin-tailan/huleegdeh-utguud.json",
    MONGOLIAN_DAILY_REPORTS.map((report) => ({
      slug: report.slug,
      text: report.text,
      expected: report.expected,
    })),
  );
  return MONGOLIAN_DAILY_REPORTS.length + 1;
}

async function exportPhotos(): Promise<number> {
  const dates = ["2026-08-05", "2026-08-06", "2026-08-07"];
  let count = 0;
  for (const [dayIndex, date] of dates.entries()) {
    for (const slot of [0, 1]) {
      const photo = await buildSitePhoto(dayIndex * 2 + slot, date);
      await writeBytes(`05-gerel-zurag/${photo.fileName}`, photo.body);
      count += 1;
    }
  }
  return count;
}

async function exportApiPayloads(): Promise<number> {
  await writeJson("06-api-huselt/01-tosol-uusgeh.json", {
    endpoint: "POST /v1/projects",
    headers: { "Idempotency-Key": "<санамсаргүй UUID>" },
    body: {
      code: "TEST-01",
      name: "Туршилтын барилга",
      description: "Гараар тест хийхэд зориулсан төсөл",
      location: "Улаанбаатар",
      plannedStart: "2026-09-01",
      plannedEnd: "2027-09-01",
      budgetMnt: 1_500_000_000,
      timezone: "Asia/Ulaanbaatar",
    },
  });
  await writeJson("06-api-huselt/02-hereglegch-urih.json", {
    endpoint: "POST /v1/invitations",
    note: "Хариу дахь invitationToken-ыг /register?token=… болгон урьсан хүнд өгнө.",
    body: {
      email: "shine.inzhener@example.mn",
      role: "ENGINEER",
      projectIds: ["project-khan-uul-a1"],
      expiresInHours: 72,
    },
  });
  await writeJson("06-api-huselt/03-urilga-huleen-avah.json", {
    endpoint: "POST /v1/invitations/accept",
    body: {
      invitationToken: "<өмнөх алхмын token>",
      displayName: "Ш. Батбаяр",
      password: "ShineNuutsUg-2026!",
    },
  });
  await writeJson("06-api-huselt/04-odriin-tailan-ilgeeh.json", {
    endpoint: "POST /v1/projects/{projectId}/daily-report-drafts",
    headers: { "Idempotency-Key": "<санамсаргүй UUID>" },
    note: "photos[].fileAssetId нь эхлээд POST .../artifacts-аар файл хуулж авсан ID.",
    body: {
      reportDate: "2026-08-09",
      timezone: "Asia/Ulaanbaatar",
      narrative: "Каркасын бетон цутгалт үргэлжлэв. Үдээс хойш бороо орсон.",
      weather: { conditionCode: "RAIN", temperatureCelsius: 18, windSpeedMs: 4.2 },
      sourceDraftId: null,
      progress: [
        {
          workItemId: "khud-a1-wi-cn-02",
          planItemId: null,
          quantity: "18.4",
          unit: "м3",
          progressPercent: 82,
          sourceRefs: [],
        },
      ],
      attendance: [
        {
          crewId: null,
          trade: "CONCRETE",
          workerCount: 7,
          hoursPerWorker: 8,
          laborRateMnt: "9500",
          sourceRefs: [],
        },
      ],
      photos: [],
    },
  });
  await writeJson("06-api-huselt/05-batlah-shiidver.json", {
    endpoint: "POST /v1/projects/{projectId}/reviews/{reviewTaskId}/decisions",
    headers: { "Idempotency-Key": "<санамсаргүй UUID>" },
    body: {
      decision: "APPROVE",
      expectedRowVersion: 1,
      reason: "Тоо хэмжээ зурагтай тулгаж шалгав",
      emergencyOverride: false,
    },
  });
  await writeJson("06-api-huselt/06-hereghjuuleh.json", {
    endpoint: "POST /v1/projects/{projectId}/approved-commands",
    headers: { "Idempotency-Key": "<санамсаргүй UUID>" },
    note: "expectedRowVersion нь батлах хүсэлтийн хариу дахь rowVersion. sourceHash нь артефактынх — review task-ынхтай ижил байх ёстой.",
    body: {
      schemaVersion: 1,
      commandType: "APPLY_APPROVED_ARTIFACT",
      reviewTaskId: "<review task id>",
      targetType: "RECOVERY_SCENARIO",
      targetId: "<artefact id>",
      targetVersion: 1,
      expectedRowVersion: 2,
      sourceHash: "<64 тэмдэгт sha256>",
      reason: "Хоёр ээлжийн горимыг хэрэгжүүлэв",
      payload: {},
    },
  });
  await writeJson("06-api-huselt/07-a4-asuult.json", {
    endpoint: "POST /v1/projects/{projectId}/chat",
    note: "Танигдах сэдвүүд: төсөв, явц, хугацаа/дуусах, ажлын тоо, эрсдэл, critical.",
    body: { question: "Төсөл хугацаандаа амжих уу?" },
  });
  return 7;
}

/**
 * Clears the category folders rather than the root: an editor or file browser
 * holding the root open makes removing it fail on Windows, and losing the run
 * over that would be silly.
 */
async function clearOutput(): Promise<void> {
  const folders = [
    "01-lavlah",
    "02-zurag-tosol",
    "03-agent-oroltuud",
    "04-odriin-tailan",
    "05-gerel-zurag",
    "06-api-huselt",
  ];
  for (const folder of folders) {
    await rm(path.join(ROOT, folder), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await clearOutput();
  const counts = {
    lavlah: await exportCatalogues(),
    zurag: await exportDesignInputs(),
    agent: await exportAgentRequests(),
    tailan: await exportDailyReports(),
    zuragUud: await exportPhotos(),
    api: await exportApiPayloads(),
  };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  process.stdout.write(
    `Тест өгөгдөл бэлэн: ${ROOT}\n\n` +
      `  01-lavlah          ${counts.lavlah} файл  · материал, норм, бүтээмж, үнэ, WBS, бодлого\n` +
      `  02-zurag-tosol     ${counts.zurag} файл  · вектор PDF ×3, инженерийн workbook, масштаб\n` +
      `  03-agent-oroltuud  ${counts.agent} файл  · A0/A5 агентын contract-той JSON\n` +
      `  04-odriin-tailan   ${counts.tailan} файл  · монгол чөлөөт бичвэр + хүлээгдэх утга\n` +
      `  05-gerel-zurag     ${counts.zuragUud} файл  · талбайн JPEG\n` +
      `  06-api-huselt      ${counts.api} файл  · REST endpoint бүрийн бэлэн body\n\n` +
      `  нийт               ${total} файл\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Тест өгөгдөл бэлдэхэд алдаа: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
