import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import JSZip from "jszip";
import { z } from "zod";
import { calculateCpmSchedule } from "../baseline-generation/schedule.js";
import { addWorkingDays, nextWorkingDay } from "../production-analysis/calendar.js";
import { roleHasPermission } from "./authorization.js";
import {
  Phase9ApiError,
  phase9IdentifierSchema,
  type Phase9AuthenticatedPrincipal,
} from "./contracts.js";
import {
  phase10A0IntakeRequestSchema,
  phase10A0IntakeResultSchema,
  type Phase10A0ArtifactRole,
  type Phase10A0IntakeResult,
} from "./phase10-contracts.js";
import type { Phase9ProjectService } from "./project-service.js";
import { phase9Sha256 } from "./security.js";

const sourceVersion = "buildwatch-v22-a0-package-intake-v1";
const xlsxMediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const productionCalendar = { workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: [] } as const;

type ArtifactRecord = Readonly<{
  id: string;
  tenantId: string;
  projectId: string;
  objectKey: string;
  originalFileName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}>;

export interface Phase10A0ArtifactReader {
  read(asset: ArtifactRecord): Promise<{ body: Buffer }>;
}

type Cell = Readonly<{ value: string; formula: boolean }>;
type TableRow = Readonly<Record<string, Cell>>;

type BoqRow = Readonly<{
  boqCode: string;
  floor: string;
  workCode: string;
  workName: string;
  unit: string;
  quantity: Prisma.Decimal;
  unitCostMnt: Prisma.Decimal;
  totalCostMnt: Prisma.Decimal;
  quantitySource: string;
  reviewStatus: string;
  sourceRow: number;
}>;

type NormRow = Readonly<{
  normCode: string;
  workCode: string;
  workName: string;
  workUnit: string;
  materialCode: string;
  materialUnit: string;
  baseQuantity: Prisma.Decimal;
  wasteRate: Prisma.Decimal;
  sourceRow: number;
}>;

type PriceRow = Readonly<{
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  unitPriceMnt: Prisma.Decimal;
  vatIncluded: boolean;
  region: string;
  effectiveDate: Date;
  sourceType: string;
  sourceNote: string;
  active: boolean;
  sourceRow: number;
}>;

type WbsRow = Readonly<{
  taskId: string;
  taskGroup: string;
  taskName: string;
  floor: string;
  durationDays: number;
  predecessorIds: readonly string[];
  status: string;
  sourceRow: number;
}>;

type ParsedPackage = Readonly<{
  boq: readonly BoqRow[];
  norms: readonly NormRow[];
  prices: readonly PriceRow[];
  wbs: readonly WbsRow[];
}>;

const safeCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
const shortTextSchema = z.string().trim().min(1).max(500);
const unitSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9²³._-]+$/u);

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new Phase9ApiError("VALIDATION_FAILED", 422, message, details);
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&#38;")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#38;/gu, "&");
}

function xmlAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "u").exec(attributes);
  return match === null ? null : xmlDecode(match[1] ?? "");
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/u.exec(reference)?.[0];
  if (letters === undefined) invalid("Workbook contains an invalid cell reference");
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function sharedStrings(xml: string | null): readonly string[] {
  if (xml === null) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gu)].map((match) =>
    [...(match[1] ?? "").matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gu)]
      .map((text) => xmlDecode(text[1] ?? ""))
      .join(""),
  );
}

function parseSheet(xml: string, strings: readonly string[]): readonly TableRow[] {
  const rows: Cell[][] = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gu)) {
    const cells: Cell[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gu,
    )) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = xmlAttribute(attributes, "r");
      if (reference === null) invalid("Workbook cell is missing its reference");
      const type = xmlAttribute(attributes, "t") ?? "n";
      const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/u.exec(body)?.[1] ?? "";
      const inline = [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gu)]
        .map((match) => xmlDecode(match[1] ?? ""))
        .join("");
      const value =
        type === "s"
          ? (strings[Number(raw)] ?? "")
          : type === "inlineStr"
            ? inline
            : xmlDecode(raw);
      cells[columnIndex(reference)] = {
        value,
        formula: /<(?:\w+:)?f\b/u.test(body),
      };
    }
    rows.push(cells);
  }
  const header = rows[0];
  if (header === undefined) invalid("Workbook sheet is empty");
  const names = header.map((cell) => cell?.value.trim() ?? "");
  if (names.some((name) => name.length === 0) || new Set(names).size !== names.length) {
    invalid("Workbook header contains an empty or duplicate column");
  }
  return rows.slice(1).flatMap((cells) => {
    if (cells.every((cell) => cell === undefined || cell.value.trim() === "")) return [];
    return [
      Object.fromEntries(
        names.map((name, index) => [name, cells[index] ?? { value: "", formula: false }]),
      ),
    ];
  });
}

async function parseWorkbook(body: Buffer): Promise<ReadonlyMap<string, readonly TableRow[]>> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(body, { checkCRC32: true });
  } catch {
    invalid("Uploaded XLSX is corrupt or unreadable");
  }
  const entries = Object.keys(archive.files);
  if (
    entries.length > 2_000 ||
    entries.some((name) => /(?:^|\/)(?:vbaProject\.bin|externalLinks)(?:\/|$)/iu.test(name))
  ) {
    invalid("Workbook contains unsupported executable or external-link content");
  }
  const readXml = async (name: string, required = true): Promise<string | null> => {
    const entry = archive.file(name.replace(/^\//u, ""));
    if (entry === null) {
      if (required) invalid(`Workbook entry ${name} is missing`);
      return null;
    }
    const value = await entry.async("string");
    if (value.length > 10_000_000) invalid(`Workbook entry ${name} exceeds the safety limit`);
    return value;
  };
  const workbookXml = (await readXml("xl/workbook.xml"))!;
  const relationshipsXml = (await readXml("xl/_rels/workbook.xml.rels"))!;
  const strings = sharedStrings(await readXml("xl/sharedStrings.xml", false));
  const targetById = new Map(
    [...relationshipsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)(?:\/>|>)/gu)].flatMap(
      (match) => {
        const id = xmlAttribute(match[1] ?? "", "Id");
        const target = xmlAttribute(match[1] ?? "", "Target");
        if (id === null || target === null || !target.includes("worksheets/")) return [];
        const normalized = target.startsWith("/")
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//u, "")}`;
        return [[id, normalized] as const];
      },
    ),
  );
  const sheets = new Map<string, readonly TableRow[]>();
  const supportedTables = new Set(["BOQ", "Material_Norms", "Price_Catalog", "WBS"]);
  const foundSheetNames: string[] = [];
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)(?:\/>|>)/gu)) {
    const name = xmlAttribute(match[1] ?? "", "name");
    const relationshipId = xmlAttribute(match[1] ?? "", "r:id");
    const target = relationshipId === null ? null : targetById.get(relationshipId);
    if (name === null || target === null || target === undefined) {
      invalid("Workbook sheet relationship is invalid");
    }
    foundSheetNames.push(name);
    if (!supportedTables.has(name)) continue;
    sheets.set(name, parseSheet((await readXml(target))!, strings));
  }
  if (foundSheetNames.length === 0 || foundSheetNames.length > 20) {
    invalid("Workbook sheet count is invalid", { foundSheetCount: foundSheetNames.length });
  }
  if (sheets.size === 0) {
    invalid("Workbook does not contain a supported A0 sheet", {
      expectedSheets: [...supportedTables],
      foundSheets: foundSheetNames.slice(0, 20),
    });
  }
  return sheets;
}

function requiredSheet(
  workbook: ReadonlyMap<string, readonly TableRow[]>,
  name: string,
): readonly TableRow[] {
  const rows = workbook.get(name);
  if (rows === undefined) {
    invalid(`Required sheet ${name} is missing`, {
      expectedSheet: name,
      foundSheets: [...workbook.keys()].slice(0, 20),
    });
  }
  if (rows.length === 0 || rows.length > 5_000) invalid(`Sheet ${name} row count is invalid`);
  return rows;
}

function cell(row: TableRow, key: string, rowNumber: number, allowFormula = false): Cell {
  const value = row[key];
  if (value === undefined) invalid(`Required column ${key} is missing`, { row: rowNumber });
  if (value.formula && !allowFormula) {
    invalid(`Formula is not allowed in source column ${key}`, { row: rowNumber });
  }
  return value;
}

function textCell(
  row: TableRow,
  key: string,
  rowNumber: number,
  schema: z.ZodType<string> = shortTextSchema,
): string {
  const value = cell(row, key, rowNumber).value.trim();
  if (/^[=+@]/u.test(value)) invalid(`Unsafe formula-like text in ${key}`, { row: rowNumber });
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalid(`Invalid ${key}`, { row: rowNumber });
  return parsed.data;
}

function decimalCell(
  row: TableRow,
  key: string,
  rowNumber: number,
  options: Readonly<{ positive?: boolean; maximum?: number; allowFormula?: boolean }> = {},
): Prisma.Decimal {
  const raw = cell(row, key, rowNumber, options.allowFormula).value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(raw))
    invalid(`Invalid number in ${key}`, { row: rowNumber });
  const value = new Prisma.Decimal(raw);
  if (!value.isFinite() || (options.positive ? value.lte(0) : value.lt(0))) {
    invalid(`Out-of-range number in ${key}`, { row: rowNumber });
  }
  if (options.maximum !== undefined && value.gt(options.maximum)) {
    invalid(`Number in ${key} exceeds its limit`, { row: rowNumber });
  }
  return value;
}

function booleanCell(row: TableRow, key: string, rowNumber: number): boolean {
  const value = cell(row, key, rowNumber).value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  invalid(`Invalid boolean in ${key}`, { row: rowNumber });
}

function excelDateCell(row: TableRow, key: string, rowNumber: number): Date {
  const raw = cell(row, key, rowNumber).value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
  if (!/^\d+(?:\.\d+)?$/u.test(raw)) invalid(`Invalid date in ${key}`, { row: rowNumber });
  const milliseconds = Math.round((Number(raw) - 25_569) * 86_400_000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) invalid(`Invalid date in ${key}`, { row: rowNumber });
  return date;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`Duplicate ${label} value found`);
}

function parseBoq(rows: readonly TableRow[]): readonly BoqRow[] {
  const parsed = rows.map((row, index): BoqRow => {
    const sourceRow = index + 2;
    const quantity = decimalCell(row, "quantity", sourceRow, { positive: true, maximum: 1e12 });
    const unitCostMnt = decimalCell(row, "unit_cost_mnt", sourceRow, { maximum: 1e15 });
    const totalCostMnt = decimalCell(row, "total_cost_mnt", sourceRow, {
      maximum: 1e18,
      allowFormula: true,
    });
    const recomputed = quantity.mul(unitCostMnt).toDecimalPlaces(2);
    if (!recomputed.equals(totalCostMnt.toDecimalPlaces(2))) {
      invalid("BOQ total_cost_mnt does not equal quantity × unit_cost_mnt", { row: sourceRow });
    }
    return {
      boqCode: textCell(row, "boq_code", sourceRow, safeCodeSchema),
      floor: textCell(row, "floor", sourceRow),
      workCode: textCell(row, "work_code", sourceRow, safeCodeSchema),
      workName: textCell(row, "work_name", sourceRow),
      unit: textCell(row, "unit", sourceRow, unitSchema),
      quantity,
      unitCostMnt,
      totalCostMnt: recomputed,
      quantitySource: textCell(row, "quantity_source", sourceRow),
      reviewStatus: textCell(row, "review_status", sourceRow),
      sourceRow,
    };
  });
  assertUnique(
    parsed.map((row) => row.boqCode),
    "boq_code",
  );
  return parsed;
}

function parseNorms(rows: readonly TableRow[]): readonly NormRow[] {
  const parsed = rows.map((row, index): NormRow => {
    const sourceRow = index + 2;
    return {
      normCode: textCell(row, "norm_code", sourceRow, safeCodeSchema),
      workCode: textCell(row, "work_code", sourceRow, safeCodeSchema),
      workName: textCell(row, "work_name", sourceRow),
      workUnit: textCell(row, "work_unit", sourceRow, unitSchema),
      materialCode: textCell(row, "material_code", sourceRow, safeCodeSchema),
      materialUnit: textCell(row, "material_unit", sourceRow, unitSchema),
      baseQuantity: decimalCell(row, "base_qty_per_work_unit", sourceRow, {
        positive: true,
        maximum: 1e9,
      }),
      wasteRate: decimalCell(row, "waste_rate", sourceRow, { maximum: 1 }),
      sourceRow,
    };
  });
  assertUnique(
    parsed.map((row) => row.normCode),
    "norm_code",
  );
  return parsed;
}

function parsePrices(rows: readonly TableRow[]): readonly PriceRow[] {
  const parsed = rows.map((row, index): PriceRow => {
    const sourceRow = index + 2;
    return {
      materialCode: textCell(row, "material_code", sourceRow, safeCodeSchema),
      materialName: textCell(row, "material_name_mn", sourceRow),
      specification: textCell(row, "specification", sourceRow),
      unit: textCell(row, "unit", sourceRow, unitSchema),
      unitPriceMnt: decimalCell(row, "unit_price_mnt", sourceRow, {
        positive: true,
        maximum: 1e15,
      }),
      vatIncluded: booleanCell(row, "vat_included", sourceRow),
      region: textCell(row, "region", sourceRow),
      effectiveDate: excelDateCell(row, "effective_date", sourceRow),
      sourceType: textCell(row, "source_type", sourceRow),
      sourceNote: textCell(row, "source_note", sourceRow),
      active: textCell(row, "status", sourceRow).toUpperCase() === "ACTIVE",
      sourceRow,
    };
  });
  assertUnique(
    parsed.map((row) => row.materialCode),
    "material_code",
  );
  return parsed;
}

function parseWbs(rows: readonly TableRow[]): readonly WbsRow[] {
  const parsed = rows.map((row, index): WbsRow => {
    const sourceRow = index + 2;
    const predecessors = cell(row, "predecessor_ids", sourceRow)
      .value.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    predecessors.forEach((value) => {
      if (!safeCodeSchema.safeParse(value).success)
        invalid("Invalid predecessor_ids", { row: sourceRow });
    });
    const duration = decimalCell(row, "duration_days", sourceRow, {
      positive: true,
      maximum: 100_000,
    });
    if (!duration.isInteger()) invalid("duration_days must be an integer", { row: sourceRow });
    return {
      taskId: textCell(row, "task_id", sourceRow, safeCodeSchema),
      taskGroup: textCell(row, "task_group", sourceRow),
      taskName: textCell(row, "task_name_mn", sourceRow),
      floor: textCell(row, "floor", sourceRow),
      durationDays: duration.toNumber(),
      predecessorIds: [...new Set(predecessors)].sort(),
      status: textCell(row, "status", sourceRow),
      sourceRow,
    };
  });
  assertUnique(
    parsed.map((row) => row.taskId),
    "task_id",
  );
  const ids = new Set(parsed.map((row) => row.taskId));
  for (const row of parsed) {
    for (const predecessorId of row.predecessorIds) {
      if (!ids.has(predecessorId) || predecessorId === row.taskId) {
        invalid("WBS predecessor references an unknown or identical task", {
          row: row.sourceRow,
          predecessorId,
        });
      }
    }
  }
  return parsed;
}

export async function parsePhase10A0Package(
  bodyByRole: ReadonlyMap<Phase10A0ArtifactRole, Buffer>,
): Promise<ParsedPackage> {
  const workbookFor = async (role: Phase10A0ArtifactRole) => {
    const body = bodyByRole.get(role);
    if (body === undefined) invalid(`Required ${role} artifact is missing`);
    return parseWorkbook(body);
  };
  const [boqWorkbook, normWorkbook, priceWorkbook, wbsWorkbook] = await Promise.all([
    workbookFor("BOQ_WORK_ITEMS"),
    workbookFor("MATERIAL_NORMS"),
    workbookFor("MATERIAL_PRICE_CATALOG"),
    workbookFor("WBS_DEPENDENCIES"),
  ]);
  return {
    boq: parseBoq(requiredSheet(boqWorkbook, "BOQ")),
    norms: parseNorms(requiredSheet(normWorkbook, "Material_Norms")),
    prices: parsePrices(requiredSheet(priceWorkbook, "Price_Catalog")),
    wbs: parseWbs(requiredSheet(wbsWorkbook, "WBS")),
  };
}

function roleDocumentType(role: Phase10A0ArtifactRole) {
  if (role === "DRAWING_REFERENCE") return "DRAWING" as const;
  if (role === "BOQ_WORK_ITEMS") return "BOQ" as const;
  return "SPECIFICATION" as const;
}

function roleCode(role: Phase10A0ArtifactRole): string {
  return {
    MATERIAL_PRICE_CATALOG: "PRICE",
    MATERIAL_NORMS: "NORM",
    BOQ_WORK_ITEMS: "BOQ",
    WBS_DEPENDENCIES: "WBS",
    DRAWING_REFERENCE: "DRAWING",
  }[role];
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export class Phase10A0IntakeService {
  constructor(
    private readonly client: PrismaClient,
    private readonly projects: Phase9ProjectService,
    private readonly artifactReader: Phase10A0ArtifactReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    idempotencyKeyInput: string,
    input: unknown,
    correlationId: string,
  ): Promise<Phase10A0IntakeResult> {
    const request = phase10A0IntakeRequestSchema.parse(input);
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const authorized = await this.projects.requireProject(principal, projectId, "DESIGN_READ");
    if (
      !roleHasPermission(authorized.role, "ESTIMATE_READ") ||
      !roleHasPermission(authorized.role, "ARTIFACT_UPLOAD")
    ) {
      throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied");
    }
    const requestHash = phase9Sha256({ projectId, request });
    const existing = await this.client.idempotencyRecord.findUnique({
      where: { tenantId_key: { tenantId: principal.tenantId, key: idempotencyKey } },
    });
    if (existing !== null) {
      if (
        existing.projectId !== projectId ||
        existing.route !== "PHASE10_A0_INTAKE" ||
        existing.requestHash !== requestHash
      ) {
        throw new Phase9ApiError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "Idempotency key was reused with different content",
        );
      }
      return phase10A0IntakeResultSchema.parse({
        ...(existing.responseBody as Record<string, unknown>),
        replayed: true,
      });
    }

    const artifactIds = request.artifacts.map((artifact) => artifact.artifactId);
    const assets = await this.client.fileAsset.findMany({
      where: {
        tenantId: principal.tenantId,
        projectId,
        id: { in: artifactIds },
        status: "AVAILABLE",
        deletedAt: null,
      },
    });
    if (assets.length !== artifactIds.length) {
      throw new Phase9ApiError(
        "RESOURCE_NOT_FOUND",
        404,
        "One or more A0 artifacts were not found",
      );
    }
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const bodyByRole = new Map<Phase10A0ArtifactRole, Buffer>();
    for (const assignment of request.artifacts) {
      const asset = assetById.get(assignment.artifactId)!;
      if (assignment.role === "DRAWING_REFERENCE") {
        if (!asset.mediaType.startsWith("image/") && asset.mediaType !== "application/pdf") {
          invalid("DRAWING_REFERENCE must be a PDF or image", { artifactId: asset.id });
        }
      } else if (asset.mediaType !== xlsxMediaType) {
        invalid(`${assignment.role} must be an XLSX workbook`, { artifactId: asset.id });
      }
      const { body } = await this.artifactReader.read(asset);
      if (assignment.role !== "DRAWING_REFERENCE") bodyByRole.set(assignment.role, body);
    }
    const parsed = await parsePhase10A0Package(bodyByRole);
    const project = await this.client.project.findFirst({
      where: { id: projectId, tenantId: principal.tenantId },
    });
    if (project === null) throw new Phase9ApiError("PROJECT_NOT_FOUND", 404, "Project not found");

    const dependencies = parsed.wbs.flatMap((row) =>
      row.predecessorIds.map((predecessorId) => ({
        predecessorActivityId: predecessorId,
        successorActivityId: row.taskId,
        type: "FINISH_TO_START" as const,
        lagWorkingDays: 0,
      })),
    );
    let cpm: ReturnType<typeof calculateCpmSchedule>;
    try {
      cpm = calculateCpmSchedule(
        parsed.wbs.map((row) => ({
          activityId: row.taskId,
          durationWorkingDays: row.durationDays,
        })),
        dependencies,
      );
    } catch (error) {
      invalid(error instanceof Error ? error.message : "WBS CPM calculation failed");
    }

    const priceByMaterial = new Map(parsed.prices.map((price) => [price.materialCode, price]));
    const boqByWork = new Map<string, BoqRow[]>();
    parsed.boq.forEach((row) =>
      boqByWork.set(row.workCode, [...(boqByWork.get(row.workCode) ?? []), row]),
    );
    const warnings: string[] = [];
    const materialRequirements = parsed.norms.flatMap((norm) => {
      const price = priceByMaterial.get(norm.materialCode);
      const works = boqByWork.get(norm.workCode) ?? [];
      if (works.length === 0) {
        warnings.push(`Норм ${norm.normCode}: BOQ-д ${norm.workCode} ажил олдсонгүй.`);
        return [];
      }
      if (price === undefined || !price.active) {
        warnings.push(`Норм ${norm.normCode}: ${norm.materialCode} идэвхтэй үнэ олдсонгүй.`);
        return [];
      }
      if (price.unit !== norm.materialUnit) {
        invalid("Material norm and price units do not match", {
          normCode: norm.normCode,
          materialCode: norm.materialCode,
        });
      }
      return works.map((work) => {
        if (work.unit !== norm.workUnit) {
          invalid("BOQ and material norm work units do not match", {
            boqCode: work.boqCode,
            normCode: norm.normCode,
          });
        }
        const requiredQuantity = work.quantity
          .mul(norm.baseQuantity)
          .mul(new Prisma.Decimal(1).plus(norm.wasteRate))
          .toDecimalPlaces(8);
        return {
          boqCode: work.boqCode,
          workCode: work.workCode,
          normCode: norm.normCode,
          materialCode: norm.materialCode,
          materialName: price.materialName,
          quantity: requiredQuantity.toFixed(8),
          unit: norm.materialUnit,
          unitPriceMnt: price.unitPriceMnt.toFixed(6),
          amountMnt: requiredQuantity.mul(price.unitPriceMnt).toDecimalPlaces(2).toFixed(2),
          sourceRows: { boq: work.sourceRow, norm: norm.sourceRow, price: price.sourceRow },
        };
      });
    });
    for (const boq of parsed.boq) {
      if (!parsed.norms.some((norm) => norm.workCode === boq.workCode)) {
        warnings.push(`BOQ ${boq.boqCode}: ${boq.workCode} материалын нормгүй.`);
      }
    }
    const estimateTotal = parsed.boq
      .reduce((sum, row) => sum.plus(row.totalCostMnt), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    const requestedStart = request.effectiveDate;
    const scheduleStart = nextWorkingDay(requestedStart, productionCalendar, true);
    const cpmById = new Map(cpm.activities.map((activity) => [activity.activityId, activity]));
    const scheduleRows = parsed.wbs.map((row) => {
      const activity = cpmById.get(row.taskId)!;
      return {
        ...row,
        plannedStart: addWorkingDays(
          scheduleStart,
          activity.earliestStartOffset,
          productionCalendar,
        ),
        plannedFinish: addWorkingDays(
          scheduleStart,
          Math.max(0, activity.earliestFinishOffset - 1),
          productionCalendar,
        ),
        totalFloatWorkingDays: activity.totalFloatWorkingDays,
        isCritical: activity.isCritical,
      };
    });
    const plannedFinish = scheduleRows.reduce(
      (latest, row) => (row.plannedFinish > latest ? row.plannedFinish : latest),
      scheduleStart,
    );

    try {
      return await this.client.$transaction(
        async (transaction) => {
          const replay = await transaction.idempotencyRecord.findUnique({
            where: { tenantId_key: { tenantId: principal.tenantId, key: idempotencyKey } },
          });
          if (replay !== null) {
            if (
              replay.projectId !== projectId ||
              replay.route !== "PHASE10_A0_INTAKE" ||
              replay.requestHash !== requestHash
            ) {
              throw new Phase9ApiError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Idempotency key was reused with different content",
              );
            }
            return phase10A0IntakeResultSchema.parse({
              ...(replay.responseBody as Record<string, unknown>),
              replayed: true,
            });
          }

          const runId = randomUUID();
          const createdAt = this.now().toISOString();
          const revisions: string[] = [];
          const pageByRole = new Map<Phase10A0ArtifactRole, string>();
          for (const [index, assignment] of request.artifacts.entries()) {
            const asset = assetById.get(assignment.artifactId)!;
            const documentId = randomUUID();
            const revisionId = randomUUID();
            const pageId = randomUUID();
            revisions.push(revisionId);
            if (!pageByRole.has(assignment.role)) pageByRole.set(assignment.role, pageId);
            await transaction.designDocument.create({
              data: {
                id: documentId,
                tenantId: principal.tenantId,
                projectId,
                fileAssetId: asset.id,
                documentCode: `A0-${roleCode(assignment.role)}-${runId.slice(0, 8)}-${index + 1}`,
                title: asset.originalFileName,
                type: roleDocumentType(assignment.role),
                classification: json({
                  intakeRole: assignment.role,
                  requestId: request.requestId,
                  authoritative: assignment.role !== "DRAWING_REFERENCE",
                }),
                status: "REVIEW_REQUIRED",
                currentRevisionId: revisionId,
                createdByUserId: principal.userId,
              },
            });
            await transaction.drawingRevision.create({
              data: {
                id: revisionId,
                tenantId: principal.tenantId,
                projectId,
                documentId,
                revisionCode: request.revisionCode,
                revisionNumber: 1,
                status: "REVIEW_REQUIRED",
                issuedAt: new Date(`${request.effectiveDate}T00:00:00.000Z`),
                effectiveFrom: new Date(`${request.effectiveDate}T00:00:00.000Z`),
                sourceSha256: asset.sha256,
              },
            });
            await transaction.drawingPage.create({
              data: {
                id: pageId,
                tenantId: principal.tenantId,
                projectId,
                revisionId,
                pageNumber: 1,
                pageLabel: assignment.role,
                rasterObjectKey: asset.mediaType.startsWith("image/") ? asset.objectKey : null,
              },
            });
          }

          const boqAssignment = request.artifacts.find((item) => item.role === "BOQ_WORK_ITEMS")!;
          const boqAsset = assetById.get(boqAssignment.artifactId)!;
          const normAsset = assetById.get(
            request.artifacts.find((item) => item.role === "MATERIAL_NORMS")!.artifactId,
          )!;
          const priceAsset = assetById.get(
            request.artifacts.find((item) => item.role === "MATERIAL_PRICE_CATALOG")!.artifactId,
          )!;
          const boqPageId = pageByRole.get("BOQ_WORK_ITEMS")!;
          const elementIdByBoq = new Map<string, string>();
          for (const row of parsed.boq) {
            const elementId = randomUUID();
            elementIdByBoq.set(row.boqCode, elementId);
            await transaction.designElement.create({
              data: {
                id: elementId,
                tenantId: principal.tenantId,
                projectId,
                pageId: boqPageId,
                elementType: "BOQ_WORK_ITEM",
                elementCode: row.boqCode,
                label: row.workName,
                properties: json({
                  workCode: row.workCode,
                  floor: row.floor,
                  unit: row.unit,
                  quantity: row.quantity.toFixed(8),
                  sourceRow: row.sourceRow,
                }),
                confidence: "1.0000",
                verificationStatus: "UNVERIFIED",
              },
            });
            await transaction.elementSourceRef.create({
              data: {
                id: randomUUID(),
                tenantId: principal.tenantId,
                projectId,
                elementId,
                fileAssetId: boqAsset.id,
                pageNumber: 1,
                region: json({ sheet: "BOQ", row: row.sourceRow }),
                sourceSha256: boqAsset.sha256,
              },
            });
          }

          const catalogCode = project.code
            .normalize("NFC")
            .replace(/[^\p{L}0-9._-]/gu, "-")
            .slice(0, 60);
          const materialCatalog = await transaction.materialCatalog.upsert({
            where: {
              tenantId_code: { tenantId: principal.tenantId, code: `A0-${catalogCode}-MAT` },
            },
            update: {},
            create: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              code: `A0-${catalogCode}-MAT`,
              name: `${project.name} material catalog`,
              description: "A0 package import; review required",
            },
          });
          const materialVersionNumber =
            (
              await transaction.materialCatalogVersion.aggregate({
                where: { catalogId: materialCatalog.id },
                _max: { versionNumber: true },
              })
            )._max.versionNumber ?? 0;
          const materialVersionId = randomUUID();
          await transaction.materialCatalogVersion.create({
            data: {
              id: materialVersionId,
              tenantId: principal.tenantId,
              catalogId: materialCatalog.id,
              versionNumber: materialVersionNumber + 1,
              status: "REVIEW_REQUIRED",
              effectiveFrom: new Date(`${request.effectiveDate}T00:00:00.000Z`),
              sourceReference: priceAsset.originalFileName,
              sourceHash: phase9Sha256(
                parsed.prices.map((row) => ({ ...row, unitPriceMnt: row.unitPriceMnt.toString() })),
              ),
            },
          });
          const materialCodes = [
            ...new Set([
              ...parsed.prices.map((row) => row.materialCode),
              ...parsed.norms.map((row) => row.materialCode),
            ]),
          ].sort();
          const materialIdByCode = new Map(materialCodes.map((code) => [code, randomUUID()]));
          await transaction.materialItem.createMany({
            data: materialCodes.map((code) => {
              const price = priceByMaterial.get(code);
              const norm = parsed.norms.find((row) => row.materialCode === code);
              return {
                id: materialIdByCode.get(code)!,
                tenantId: principal.tenantId,
                catalogVersionId: materialVersionId,
                code,
                canonicalName: price?.materialName ?? code,
                unit: price?.unit ?? norm!.materialUnit,
                specification: json({
                  text: price?.specification ?? null,
                  region: price?.region ?? null,
                  sourceType: price?.sourceType ?? null,
                }),
                active: price?.active ?? true,
              };
            }),
          });

          const normCatalog = await transaction.normCatalog.upsert({
            where: {
              tenantId_code: { tenantId: principal.tenantId, code: `A0-${catalogCode}-NORM` },
            },
            update: {},
            create: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              code: `A0-${catalogCode}-NORM`,
              name: `${project.name} material norms`,
            },
          });
          const normVersionNumber =
            (
              await transaction.normCatalogVersion.aggregate({
                where: { catalogId: normCatalog.id },
                _max: { versionNumber: true },
              })
            )._max.versionNumber ?? 0;
          const normVersionId = randomUUID();
          await transaction.normCatalogVersion.create({
            data: {
              id: normVersionId,
              tenantId: principal.tenantId,
              catalogId: normCatalog.id,
              versionNumber: normVersionNumber + 1,
              status: "REVIEW_REQUIRED",
              effectiveFrom: new Date(`${request.effectiveDate}T00:00:00.000Z`),
              sourceReference: normAsset.originalFileName,
              sourceHash: phase9Sha256(
                parsed.norms.map((row) => ({
                  ...row,
                  baseQuantity: row.baseQuantity.toString(),
                  wasteRate: row.wasteRate.toString(),
                })),
              ),
            },
          });
          await transaction.workNorm.createMany({
            data: parsed.norms.map((row) => ({
              id: randomUUID(),
              tenantId: principal.tenantId,
              normVersionId,
              workCode: row.workCode,
              materialItemId: materialIdByCode.get(row.materialCode)!,
              outputUnit: row.workUnit,
              materialUnit: row.materialUnit,
              quantityPerOutput: row.baseQuantity.toFixed(8),
              wastePercent: row.wasteRate.toFixed(6),
              assumptions: json({ normCode: row.normCode, sourceRow: row.sourceRow }),
            })),
          });

          const priceCatalog = await transaction.priceCatalog.upsert({
            where: {
              tenantId_code: { tenantId: principal.tenantId, code: `A0-${catalogCode}-PRICE` },
            },
            update: {},
            create: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              code: `A0-${catalogCode}-PRICE`,
              name: `${project.name} material prices`,
              currency: "MNT",
            },
          });
          const priceVersionNumber =
            (
              await transaction.priceCatalogVersion.aggregate({
                where: { catalogId: priceCatalog.id },
                _max: { versionNumber: true },
              })
            )._max.versionNumber ?? 0;
          const priceVersionId = randomUUID();
          await transaction.priceCatalogVersion.create({
            data: {
              id: priceVersionId,
              tenantId: principal.tenantId,
              catalogId: priceCatalog.id,
              versionNumber: priceVersionNumber + 1,
              status: "REVIEW_REQUIRED",
              effectiveFrom: new Date(`${request.effectiveDate}T00:00:00.000Z`),
              sourceReference: priceAsset.originalFileName,
              sourceHash: phase9Sha256(
                parsed.prices.map((row) => ({
                  ...row,
                  unitPriceMnt: row.unitPriceMnt.toString(),
                  effectiveDate: row.effectiveDate.toISOString(),
                })),
              ),
            },
          });
          await transaction.priceCatalogEntry.createMany({
            data: parsed.prices
              .filter((row) => row.active)
              .map((row) => ({
                id: randomUUID(),
                tenantId: principal.tenantId,
                catalogVersionId: priceVersionId,
                materialItemId: materialIdByCode.get(row.materialCode)!,
                unit: row.unit,
                unitPrice: row.unitPriceMnt.toFixed(6),
                currency: "MNT",
                supplierName: null,
                quotationRef: `${row.sourceType}: ${row.sourceNote}`,
                validFrom: row.effectiveDate,
              })),
          });

          const latestQuantity = await transaction.quantityTakeoffVersion.findFirst({
            where: { tenantId: principal.tenantId, projectId },
            orderBy: { versionNumber: "desc" },
          });
          const quantityVersionId = randomUUID();
          const quantityVersionNumber = (latestQuantity?.versionNumber ?? 0) + 1;
          const quantityContent = parsed.boq.map((row) => ({
            boqCode: row.boqCode,
            workCode: row.workCode,
            quantity: row.quantity.toFixed(8),
            unit: row.unit,
            sourceRow: row.sourceRow,
          }));
          const quantitySourceHash = phase9Sha256({ revisions, quantityContent });
          await transaction.quantityTakeoffVersion.create({
            data: {
              id: quantityVersionId,
              tenantId: principal.tenantId,
              projectId,
              versionNumber: quantityVersionNumber,
              status: "REVIEW_REQUIRED",
              sourceRevisionIds: revisions,
              formulaVersion: "imported-boq-v1",
              sourceHash: quantitySourceHash,
              totalQuantityHash: phase9Sha256(quantityContent),
              createdByUserId: principal.userId,
              supersedesId: latestQuantity?.id ?? null,
            },
          });
          await transaction.quantityTakeoffItem.createMany({
            data: parsed.boq.map((row) => ({
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              versionId: quantityVersionId,
              designElementId: elementIdByBoq.get(row.boqCode),
              workCode: row.workCode,
              description: row.workName,
              unit: row.unit,
              quantity: row.quantity.toFixed(8),
              formulaCode: "IMPORTED_BOQ",
              formulaInputs: json({ boqCode: row.boqCode, sheet: "BOQ", row: row.sourceRow }),
              sourceRefs: json([
                {
                  artifactId: boqAsset.id,
                  sha256: boqAsset.sha256,
                  sheet: "BOQ",
                  row: row.sourceRow,
                  quantitySource: row.quantitySource,
                },
              ]),
              verificationStatus: "UNVERIFIED",
            })),
          });

          const latestEstimate = await transaction.estimateVersion.findFirst({
            where: { tenantId: principal.tenantId, projectId },
            orderBy: { versionNumber: "desc" },
          });
          const estimateVersionId = randomUUID();
          const estimateVersionNumber = (latestEstimate?.versionNumber ?? 0) + 1;
          const estimateSourceHash = phase9Sha256({
            quantitySourceHash,
            normVersionId,
            priceVersionId,
            lines: parsed.boq.map((row) => [row.boqCode, row.totalCostMnt.toFixed(2)]),
            materialRequirements,
          });
          await transaction.estimateVersion.create({
            data: {
              id: estimateVersionId,
              tenantId: principal.tenantId,
              projectId,
              versionNumber: estimateVersionNumber,
              quantityVersionId,
              normCatalogVersionId: normVersionId,
              priceCatalogVersionId: priceVersionId,
              status: "REVIEW_REQUIRED",
              currency: "MNT",
              subtotal: estimateTotal.toFixed(2),
              taxAmount: "0.00",
              contingencyAmount: "0.00",
              totalAmount: estimateTotal.toFixed(2),
              sourceHash: estimateSourceHash,
              createdByUserId: principal.userId,
              supersedesId: latestEstimate?.id ?? null,
            },
          });
          await transaction.estimateLine.createMany({
            data: parsed.boq.map((row) => ({
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              estimateVersionId,
              lineCode: row.boqCode,
              category: "DIRECT_WORK_BOQ",
              description: row.workName,
              quantity: row.quantity.toFixed(8),
              unit: row.unit,
              unitPrice: row.unitCostMnt.toFixed(6),
              amount: row.totalCostMnt.toFixed(2),
              sourceRefs: json([{ artifactId: boqAsset.id, sheet: "BOQ", row: row.sourceRow }]),
            })),
          });
          await transaction.estimateAssumption.createMany({
            data: [
              {
                id: randomUUID(),
                tenantId: principal.tenantId,
                projectId,
                estimateVersionId,
                assumptionCode: "MATERIAL_REQUIREMENTS",
                value: json(materialRequirements),
                sourceRef: json({
                  normArtifactId: normAsset.id,
                  priceArtifactId: priceAsset.id,
                  boqArtifactId: boqAsset.id,
                }),
              },
              {
                id: randomUUID(),
                tenantId: principal.tenantId,
                projectId,
                estimateVersionId,
                assumptionCode: "IMPORT_WARNINGS",
                value: json(warnings),
                sourceRef: json({ requestId: request.requestId }),
              },
            ],
          });

          const latestSchedule = await transaction.scheduleVersion.findFirst({
            where: { tenantId: principal.tenantId, projectId },
            orderBy: { versionNumber: "desc" },
          });
          const scheduleVersionId = randomUUID();
          const scheduleVersionNumber = (latestSchedule?.versionNumber ?? 0) + 1;
          const scheduleSourceHash = phase9Sha256({ scheduleRows, dependencies });
          await transaction.scheduleVersion.create({
            data: {
              id: scheduleVersionId,
              tenantId: principal.tenantId,
              projectId,
              versionNumber: scheduleVersionNumber,
              status: "REVIEW_REQUIRED",
              calendarVersion: "mn-six-day-week-v1",
              timezone: "Asia/Ulaanbaatar",
              plannedStart: new Date(`${scheduleStart}T00:00:00.000Z`),
              plannedFinish: new Date(`${plannedFinish}T00:00:00.000Z`),
              sourceHash: scheduleSourceHash,
              createdByUserId: principal.userId,
              supersedesId: latestSchedule?.id ?? null,
            },
          });
          const activityIdByCode = new Map(scheduleRows.map((row) => [row.taskId, randomUUID()]));
          await transaction.scheduleActivity.createMany({
            data: scheduleRows.map((row) => ({
              id: activityIdByCode.get(row.taskId)!,
              tenantId: principal.tenantId,
              projectId,
              scheduleVersionId,
              code: row.taskId,
              name: row.taskName,
              plannedStart: new Date(`${row.plannedStart}T00:00:00.000Z`),
              plannedFinish: new Date(`${row.plannedFinish}T00:00:00.000Z`),
              durationMinutes: row.durationDays * 8 * 60,
              totalFloatMinutes: row.totalFloatWorkingDays * 8 * 60,
              isCritical: row.isCritical,
            })),
          });
          await transaction.scheduleDependency.createMany({
            data: dependencies.map((dependency) => ({
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              scheduleVersionId,
              predecessorId: activityIdByCode.get(dependency.predecessorActivityId)!,
              successorId: activityIdByCode.get(dependency.successorActivityId)!,
              type: dependency.type,
              lagMinutes: dependency.lagWorkingDays * 8 * 60,
            })),
          });

          const latestBaseline = await transaction.baselineVersion.findFirst({
            where: { tenantId: principal.tenantId, projectId },
            orderBy: { versionNumber: "desc" },
          });
          const baselineVersionId = randomUUID();
          const baselineVersionNumber = (latestBaseline?.versionNumber ?? 0) + 1;
          const baselineSourceHash = phase9Sha256({
            quantityVersionId,
            estimateVersionId,
            scheduleVersionId,
          });
          await transaction.baselineVersion.create({
            data: {
              id: baselineVersionId,
              tenantId: principal.tenantId,
              projectId,
              versionNumber: baselineVersionNumber,
              quantityVersionId,
              estimateVersionId,
              scheduleVersionId,
              status: "REVIEW_REQUIRED",
              sourceHash: baselineSourceHash,
              reason: `A0 intake package ${request.requestId}`,
              createdByUserId: principal.userId,
              supersedesId: latestBaseline?.id ?? null,
            },
          });

          const reviewTaskIds = {
            quantity: randomUUID(),
            estimate: randomUUID(),
            schedule: randomUUID(),
            baseline: randomUUID(),
          };
          await transaction.reviewTask.createMany({
            data: [
              {
                id: reviewTaskIds.quantity,
                tenantId: principal.tenantId,
                projectId,
                targetType: "QUANTITY_TAKEOFF",
                targetId: quantityVersionId,
                targetVersion: quantityVersionNumber,
                status: "REVIEW_REQUIRED",
                sourceHash: quantitySourceHash,
                createdByUserId: principal.userId,
                assignedRole: "ENGINEER",
              },
              {
                id: reviewTaskIds.estimate,
                tenantId: principal.tenantId,
                projectId,
                targetType: "ESTIMATE",
                targetId: estimateVersionId,
                targetVersion: estimateVersionNumber,
                status: "REVIEW_REQUIRED",
                sourceHash: estimateSourceHash,
                createdByUserId: principal.userId,
                assignedRole: "PROJECT_MANAGER",
              },
              {
                id: reviewTaskIds.schedule,
                tenantId: principal.tenantId,
                projectId,
                targetType: "SCHEDULE",
                targetId: scheduleVersionId,
                targetVersion: scheduleVersionNumber,
                status: "REVIEW_REQUIRED",
                sourceHash: scheduleSourceHash,
                createdByUserId: principal.userId,
                assignedRole: "PROJECT_MANAGER",
              },
              {
                id: reviewTaskIds.baseline,
                tenantId: principal.tenantId,
                projectId,
                targetType: "BASELINE",
                targetId: baselineVersionId,
                targetVersion: baselineVersionNumber,
                status: "REVIEW_REQUIRED",
                sourceHash: baselineSourceHash,
                createdByUserId: principal.userId,
                assignedRole: "PROJECT_MANAGER",
              },
            ],
          });

          const eventId = randomUUID();
          const auditId = randomUUID();
          const result = phase10A0IntakeResultSchema.parse({
            schemaVersion: 1,
            runId,
            requestId: request.requestId,
            status: "REVIEW_REQUIRED",
            quantityVersionId,
            estimateVersionId,
            scheduleVersionId,
            baselineVersionId,
            reviewTaskIds,
            counts: {
              documents: request.artifacts.length,
              quantityItems: parsed.boq.length,
              materialRequirements: materialRequirements.length,
              estimateLines: parsed.boq.length,
              scheduleActivities: scheduleRows.length,
              scheduleDependencies: dependencies.length,
            },
            estimateTotalMnt: estimateTotal.toFixed(2),
            plannedStart: scheduleStart,
            plannedFinish,
            criticalActivityCodes: scheduleRows
              .filter((row) => row.isCritical)
              .map((row) => row.taskId),
            warnings,
            eventId,
            auditId,
            createdAt,
            replayed: false,
          });
          await transaction.agentRun.create({
            data: {
              id: runId,
              tenantId: principal.tenantId,
              projectId,
              agentType: "A0_DESIGN_INTAKE",
              status: "COMPLETED",
              trigger: "REQUEST",
              requestId: request.requestId,
              promptVersion: "deterministic",
              toolBundleVersion: sourceVersion,
              outputSchemaVersion: 1,
              provider: "deterministic",
              modelId: sourceVersion,
              asOf: new Date(`${request.effectiveDate}T00:00:00.000Z`),
              request: json(request),
              output: json(result),
              validation: json({ warnings, cpmComplete: true, formulasRecomputed: true }),
              outputSha256: phase9Sha256(result),
              latencyMs: 0,
              completedAt: new Date(createdAt),
            },
          });
          await transaction.auditLog.create({
            data: {
              id: auditId,
              tenantId: principal.tenantId,
              projectId,
              actorUserId: principal.userId,
              actorRole: authorized.role,
              action: "A0_INTAKE_PROCESSED",
              entityType: "AGENT_RUN",
              entityId: runId,
              reason: "Explicit A0 package processing",
              correlationId,
              sourceVersion,
              afterHash: phase9Sha256(result),
              metadata: json({ requestId: request.requestId, artifactIds, reviewTaskIds }),
            },
          });
          await transaction.outboxEvent.create({
            data: {
              id: eventId,
              tenantId: principal.tenantId,
              projectId,
              eventType: "A0_INTAKE_REVIEW_REQUIRED",
              aggregateType: "AGENT_RUN",
              aggregateId: runId,
              aggregateVersion: 1,
              idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
              payload: json({ runId, requestId: request.requestId, reviewTaskIds }),
              headers: json({ correlationId, schemaVersion: 1 }),
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              key: idempotencyKey,
              route: "PHASE10_A0_INTAKE",
              requestHash,
              responseStatus: 201,
              responseBody: json(result),
              actorUserId: principal.userId,
              expiresAt: new Date(Date.parse(createdAt) + 7 * 86_400_000),
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
      );
    } catch (error) {
      if (isConflict(error)) {
        throw new Phase9ApiError(
          "OPTIMISTIC_LOCK_CONFLICT",
          409,
          "Concurrent A0 intake conflicted; retry with the same idempotency key",
        );
      }
      throw error;
    }
  }
}
