import { createHash } from "node:crypto";
import seedrandom from "seedrandom";

/**
 * Deterministic demo dataset for a mid-flight Mongolian residential build.
 *
 * The fixture is pure: it derives every quantity, price and daily record from
 * the work breakdown below so the numbers stay internally consistent. Nothing
 * here touches Prisma — `seed-demo-project.ts` maps this shape onto the schema.
 */

export const DEMO_TENANT_SLUG = "nomad-build";
export const DEMO_PROJECT_ID = "project-khan-uul-a1";
export const DEMO_PROJECT_CODE = "KHUD-A1";
export const FIXTURE_VERSION = "buildwatch-v22-demo-project-v1";

const PROJECT_START = "2026-03-02";
const PROJECT_END = "2027-05-28";
const TIMEZONE = "Asia/Ulaanbaatar";
const CURRENCY = "MNT";

/** Hourly cost of one worker in MNT, used to turn productivity into a rate. */
const LABOR_RATE_PER_HOUR = 9_500;
const VAT_PERCENT = 10;
const CONTINGENCY_PERCENT = 5;

export function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(iso: string, count: number): string {
  const date = day(iso);
  date.setUTCDate(date.getUTCDate() + count);
  return isoDay(date);
}

export function hash(...parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Sunday is a rest day on this site; everything else is a working day. */
function isWorkingDay(iso: string): boolean {
  return day(iso).getUTCDay() !== 0;
}

function workingDaysBefore(asOf: string, count: number): string[] {
  const days: string[] = [];
  let cursor = addDays(asOf, -1);
  while (days.length < count) {
    if (isWorkingDay(cursor)) days.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return days.reverse();
}

function elapsedFraction(start: string, end: string, asOf: string): number {
  const from = day(start).getTime();
  const to = day(end).getTime();
  const now = day(asOf).getTime();
  if (now <= from) return 0;
  if (now >= to) return 1;
  return (now - from) / (to - from);
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

export type DemoMaterial = {
  readonly code: string;
  readonly canonicalName: string;
  readonly unit: string;
  readonly unitPrice: number;
  readonly aliases: readonly string[];
  readonly specification: Readonly<Record<string, string>>;
};

export const MATERIALS: readonly DemoMaterial[] = [
  {
    code: "MAT-CEM-425",
    canonicalName: "Портланд цемент М400 (CEM I 42.5N)",
    unit: "тн",
    unitPrice: 385_000,
    aliases: ["цемент м400", "portland cement 42.5", "цемент 42.5"],
    specification: { standard: "MNS 0974:2008", strengthClass: "42.5N" },
  },
  {
    code: "MAT-SAND-02",
    canonicalName: "Барилгын угаасан элс 0-5мм",
    unit: "м3",
    unitPrice: 46_000,
    aliases: ["элс", "барилгын элс", "washed sand"],
    specification: { standard: "MNS 2827:2007", fraction: "0-5mm" },
  },
  {
    code: "MAT-GRV-520",
    canonicalName: "Хайрга 5-20мм",
    unit: "м3",
    unitPrice: 58_000,
    aliases: ["хайрга", "gravel 5-20"],
    specification: { standard: "MNS 2825:2007", fraction: "5-20mm" },
  },
  {
    code: "MAT-RBR-A3",
    canonicalName: "Арматур A-III d12 (АТ400С)",
    unit: "тн",
    unitPrice: 2_750_000,
    aliases: ["арматур а3", "арматур d12", "rebar a-iii"],
    specification: { standard: "MNS 4235:2018", diameter: "12mm", grade: "A-III" },
  },
  {
    code: "MAT-BLK-390",
    canonicalName: "Керамзитбетон блок 390x190x188",
    unit: "ш",
    unitPrice: 3_400,
    aliases: ["блок", "керамзит блок", "хана блок"],
    specification: { standard: "MNS 5344:2011", size: "390x190x188" },
  },
  {
    code: "MAT-EPS-100",
    canonicalName: "Дулаалгын хавтан EPS-100 50мм",
    unit: "м2",
    unitPrice: 12_800,
    aliases: ["дулаалга", "пенопласт", "eps 100"],
    specification: { standard: "MNS 5877:2008", thickness: "50mm" },
  },
  {
    code: "MAT-WIN-PVC",
    canonicalName: "PVC цонх, 2 давхар шилтэй",
    unit: "м2",
    unitPrice: 268_000,
    aliases: ["цонх", "пвц цонх", "pvc window"],
    specification: { profile: "5 camera", glazing: "double" },
  },
  {
    code: "MAT-CNC-C25",
    canonicalName: "Бэлэн бетон C25/30 (B25)",
    unit: "м3",
    unitPrice: 243_000,
    aliases: ["бетон c25", "бетон b25", "бэлэн бетон 25"],
    specification: { standard: "MNS 3357:2018", class: "C25/30" },
  },
  {
    code: "MAT-CNC-C30",
    canonicalName: "Бэлэн бетон C30/37 (B30)",
    unit: "м3",
    unitPrice: 268_000,
    aliases: ["бетон c30", "бетон b30", "бэлэн бетон 30"],
    specification: { standard: "MNS 3357:2018", class: "C30/37" },
  },
  {
    code: "MAT-SCR-M150",
    canonicalName: "Шалны тэгшилгээний хуурай хольц М150",
    unit: "тн",
    unitPrice: 295_000,
    aliases: ["тэгшилгээ", "стяжка", "шалны хольц"],
    specification: { standard: "MNS 6060:2009", grade: "M150" },
  },
] as const;

// ---------------------------------------------------------------------------
// Work breakdown
// ---------------------------------------------------------------------------

export type DemoWorkPackage = {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly quantity: number;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly isCritical: boolean;
  readonly priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** >1 means the crew is beating the plan, <1 means it is falling behind. */
  readonly performanceFactor: number;
  readonly crewType: string;
  readonly assigneeName: string;
  /** Absent for packages priced as a subcontract lump sum. */
  readonly norm?: {
    readonly materialCode: string;
    readonly quantityPerOutput: number;
    readonly wastePercent: number;
  };
  /** Absent for subcontracted packages, which carry no in-house crew. */
  readonly productivity?: {
    readonly outputPerCrewHour: number;
    readonly crewSize: number;
  };
  /** Set for subcontract packages priced per unit instead of from norms. */
  readonly subcontractUnitPrice?: number;
  readonly blocked?: boolean;
};

export const WORK_PACKAGES: readonly DemoWorkPackage[] = [
  {
    code: "EW-01",
    name: "Газар шороо, суурийн нүх ухалт",
    description: "Хөрс ухалт, тээвэрлэлт, суурийн ул шороо тэгшилгээ",
    unit: "м3",
    quantity: 4_850,
    plannedStart: "2026-03-02",
    plannedEnd: "2026-04-10",
    isCritical: true,
    priority: "HIGH",
    performanceFactor: 1.04,
    crewType: "EARTHWORKS",
    assigneeName: "Б. Ганзориг",
    productivity: { outputPerCrewHour: 62, crewSize: 4 },
  },
  {
    code: "CN-01",
    name: "Суурийн монолит бетон C25/30",
    description: "Суурийн хавтан, бүслүүрийн бетон цутгалт",
    unit: "м3",
    quantity: 1_240,
    plannedStart: "2026-04-06",
    plannedEnd: "2026-05-22",
    isCritical: true,
    priority: "CRITICAL",
    performanceFactor: 1.0,
    crewType: "CONCRETE",
    assigneeName: "Д. Мөнхбат",
    norm: { materialCode: "MAT-CNC-C25", quantityPerOutput: 1.02, wastePercent: 2 },
    productivity: { outputPerCrewHour: 3.2, crewSize: 8 },
  },
  {
    code: "RB-01",
    name: "Суурь ба каркасын арматурын ажил",
    description: "Арматур бэлтгэх, угсрах, холбох",
    unit: "тн",
    quantity: 186,
    plannedStart: "2026-04-13",
    plannedEnd: "2026-09-30",
    isCritical: true,
    priority: "CRITICAL",
    performanceFactor: 0.93,
    crewType: "REBAR",
    assigneeName: "С. Отгонбаяр",
    norm: { materialCode: "MAT-RBR-A3", quantityPerOutput: 1.03, wastePercent: 1 },
    productivity: { outputPerCrewHour: 0.085, crewSize: 6 },
  },
  {
    code: "CN-02",
    name: "Каркасын монолит бетон C30/37",
    description: "Багана, дам нуруу, хучилтын хавтангийн бетон цутгалт (1-12 давхар)",
    unit: "м3",
    quantity: 3_180,
    plannedStart: "2026-05-18",
    plannedEnd: "2026-11-20",
    isCritical: true,
    priority: "CRITICAL",
    performanceFactor: 0.88,
    crewType: "CONCRETE",
    assigneeName: "Д. Мөнхбат",
    norm: { materialCode: "MAT-CNC-C30", quantityPerOutput: 1.02, wastePercent: 2 },
    productivity: { outputPerCrewHour: 2.8, crewSize: 8 },
  },
  {
    code: "MS-01",
    name: "Гадна ба дотор хананы өрлөг",
    description: "Керамзитбетон блокон өрлөг, тусгаарлах хана",
    unit: "м2",
    quantity: 9_420,
    plannedStart: "2026-07-06",
    plannedEnd: "2026-12-18",
    isCritical: true,
    priority: "HIGH",
    performanceFactor: 0.86,
    crewType: "MASONRY",
    assigneeName: "Ж. Энхтуяа",
    norm: { materialCode: "MAT-BLK-390", quantityPerOutput: 12.5, wastePercent: 3 },
    productivity: { outputPerCrewHour: 1.9, crewSize: 5 },
    blocked: true,
  },
  {
    code: "FN-01",
    name: "Гадна дулаалга ба фасадны ажил",
    description: "EPS дулаалга, шавардлага, будаг",
    unit: "м2",
    quantity: 6_180,
    plannedStart: "2026-09-14",
    plannedEnd: "2027-02-26",
    isCritical: true,
    priority: "HIGH",
    performanceFactor: 1.0,
    crewType: "FACADE",
    assigneeName: "Н. Батсайхан",
    norm: { materialCode: "MAT-EPS-100", quantityPerOutput: 1.05, wastePercent: 3 },
    productivity: { outputPerCrewHour: 2.4, crewSize: 5 },
  },
  {
    code: "WN-01",
    name: "Цонх, гадна хаалганы угсралт",
    description: "PVC цонх, гадна орцны хаалга суурилуулалт",
    unit: "м2",
    quantity: 2_340,
    plannedStart: "2026-10-05",
    plannedEnd: "2027-01-29",
    isCritical: false,
    priority: "MEDIUM",
    performanceFactor: 1.0,
    crewType: "GLAZING",
    assigneeName: "Н. Батсайхан",
    norm: { materialCode: "MAT-WIN-PVC", quantityPerOutput: 1.0, wastePercent: 2 },
    productivity: { outputPerCrewHour: 1.6, crewSize: 4 },
  },
  {
    code: "FL-01",
    name: "Шалны тэгшилгээ, цутгалт",
    description: "Дуу тусгаарлагч давхарга, тэгшилгээний цутгалт",
    unit: "м2",
    quantity: 11_650,
    plannedStart: "2026-11-02",
    plannedEnd: "2027-03-12",
    isCritical: false,
    priority: "MEDIUM",
    performanceFactor: 1.0,
    crewType: "FINISHING",
    assigneeName: "Ж. Энхтуяа",
    norm: { materialCode: "MAT-SCR-M150", quantityPerOutput: 0.045, wastePercent: 2 },
    productivity: { outputPerCrewHour: 6.5, crewSize: 5 },
  },
  {
    code: "EL-01",
    name: "Цахилгаан хангамжийн угсралт",
    description: "Дотор сүлжээ, самбар, гэрэлтүүлэг (туслан гүйцэтгэгч)",
    unit: "м",
    quantity: 24_800,
    plannedStart: "2026-09-01",
    plannedEnd: "2027-03-26",
    isCritical: false,
    priority: "MEDIUM",
    performanceFactor: 1.0,
    crewType: "SUBCONTRACT",
    assigneeName: "Цахим Монгол ХХК",
    subcontractUnitPrice: 18_500,
  },
  {
    code: "PL-01",
    name: "Ариун цэвэр, сантехникийн угсралт",
    description: "Ус хангамж, ариутгах татуурга, халаалтын шугам (туслан гүйцэтгэгч)",
    unit: "м",
    quantity: 8_600,
    plannedStart: "2026-09-01",
    plannedEnd: "2027-03-26",
    isCritical: false,
    priority: "MEDIUM",
    performanceFactor: 1.0,
    crewType: "SUBCONTRACT",
    assigneeName: "Ус Ундрага ХХК",
    subcontractUnitPrice: 42_000,
  },
  {
    code: "FI-01",
    name: "Дотор заслын ажил",
    description: "Шавардлага, будаг, шал, хаалга (туслан гүйцэтгэгч)",
    unit: "м2",
    quantity: 10_900,
    plannedStart: "2027-01-04",
    plannedEnd: "2027-04-30",
    isCritical: true,
    priority: "HIGH",
    performanceFactor: 1.0,
    crewType: "SUBCONTRACT",
    assigneeName: "Тансаг Засал ХХК",
    subcontractUnitPrice: 148_000,
  },
  {
    code: "LS-01",
    name: "Гадна тохижилт, ногоон байгууламж",
    description: "Явган зам, зогсоол, зүлэгжүүлэлт",
    unit: "м2",
    quantity: 3_400,
    plannedStart: "2027-03-02",
    plannedEnd: "2027-05-28",
    isCritical: false,
    priority: "LOW",
    performanceFactor: 1.0,
    crewType: "SUBCONTRACT",
    assigneeName: "Ногоон Хот ХХК",
    subcontractUnitPrice: 96_000,
  },
] as const;

/** Finish-to-start links between packages, with lag in days. */
export const WORK_DEPENDENCIES: readonly {
  readonly predecessor: string;
  readonly successor: string;
  readonly lagDays: number;
}[] = [
  { predecessor: "EW-01", successor: "CN-01", lagDays: 0 },
  { predecessor: "CN-01", successor: "RB-01", lagDays: 0 },
  { predecessor: "RB-01", successor: "CN-02", lagDays: 0 },
  { predecessor: "CN-02", successor: "MS-01", lagDays: 0 },
  { predecessor: "MS-01", successor: "FN-01", lagDays: 2 },
  { predecessor: "MS-01", successor: "WN-01", lagDays: 5 },
  { predecessor: "CN-02", successor: "FL-01", lagDays: 7 },
  { predecessor: "MS-01", successor: "EL-01", lagDays: 0 },
  { predecessor: "MS-01", successor: "PL-01", lagDays: 0 },
  { predecessor: "FL-01", successor: "FI-01", lagDays: 3 },
  { predecessor: "FN-01", successor: "LS-01", lagDays: 0 },
] as const;

export const CREWS: readonly {
  readonly code: string;
  readonly name: string;
  readonly trade: string;
  readonly memberCount: number;
}[] = [
  { code: "CRW-EW", name: "Газар шорооны баг", trade: "EARTHWORKS", memberCount: 4 },
  { code: "CRW-RB", name: "Арматурчин баг", trade: "REBAR", memberCount: 6 },
  { code: "CRW-CN", name: "Бетончин баг", trade: "CONCRETE", memberCount: 8 },
  { code: "CRW-MS", name: "Өрлөгчин баг", trade: "MASONRY", memberCount: 5 },
  { code: "CRW-FN", name: "Фасадчин баг", trade: "FACADE", memberCount: 5 },
] as const;

export const EQUIPMENT: readonly {
  readonly code: string;
  readonly name: string;
  readonly equipmentType: string;
  readonly capacity: number;
  readonly capacityUnit: string;
}[] = [
  {
    code: "EQP-EXC-01",
    name: "Хүрдэт ухагч Komatsu PC200",
    equipmentType: "EXCAVATOR",
    capacity: 1.0,
    capacityUnit: "м3",
  },
  {
    code: "EQP-CRN-01",
    name: "Цамхагт кран Potain MC-85",
    equipmentType: "TOWER_CRANE",
    capacity: 5,
    capacityUnit: "тн",
  },
  {
    code: "EQP-PMP-01",
    name: "Бетон насос Putzmeister BSF-36",
    equipmentType: "CONCRETE_PUMP",
    capacity: 60,
    capacityUnit: "м3/ц",
  },
  {
    code: "EQP-HST-01",
    name: "Барилгын ачааны өргүүр GJJ SC200",
    equipmentType: "HOIST",
    capacity: 1.5,
    capacityUnit: "тн",
  },
] as const;

const CREW_BY_TRADE = new Map(CREWS.map((crew) => [crew.trade, crew]));

// ---------------------------------------------------------------------------
// Derived commercial figures
// ---------------------------------------------------------------------------

export type DemoEstimateLine = {
  readonly lineCode: string;
  readonly workCode: string;
  readonly category: "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUBCONTRACT";
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: number;
  readonly amount: number;
};

function materialPrice(code: string): number {
  const material = MATERIALS.find((item) => item.code === code);
  if (material === undefined) throw new Error(`Unknown material ${code}`);
  return material.unitPrice;
}

function materialName(code: string): string {
  const material = MATERIALS.find((item) => item.code === code);
  if (material === undefined) throw new Error(`Unknown material ${code}`);
  return material.canonicalName;
}

/** Material required per unit of output, waste included. */
export function materialFactor(pkg: DemoWorkPackage): number {
  if (pkg.norm === undefined) return 0;
  return pkg.norm.quantityPerOutput * (1 + pkg.norm.wastePercent / 100);
}

function materialUnitPrice(pkg: DemoWorkPackage): number {
  if (pkg.norm === undefined) return 0;
  return round(materialFactor(pkg) * materialPrice(pkg.norm.materialCode), 6);
}

function laborUnitPrice(pkg: DemoWorkPackage): number {
  if (pkg.productivity === undefined) return 0;
  return round(
    (pkg.productivity.crewSize * LABOR_RATE_PER_HOUR) / pkg.productivity.outputPerCrewHour,
    6,
  );
}

const EQUIPMENT_LINES: readonly {
  readonly lineCode: string;
  readonly workCode: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: number;
}[] = [
  {
    lineCode: "EQ-EW-01",
    workCode: "EW-01",
    description: "Хүрдэт ухагч, самосвалын түрээс",
    quantity: 620,
    unit: "цаг",
    unitPrice: 96_000,
  },
  {
    lineCode: "EQ-CN-01",
    workCode: "CN-02",
    description: "Цамхагт краны түрээс, оператортой",
    quantity: 2_400,
    unit: "цаг",
    unitPrice: 78_000,
  },
  {
    lineCode: "EQ-CN-02",
    workCode: "CN-02",
    description: "Бетон насосны түрээс",
    quantity: 480,
    unit: "цаг",
    unitPrice: 145_000,
  },
] as const;

export function buildEstimateLines(): readonly DemoEstimateLine[] {
  const lines: DemoEstimateLine[] = [];
  for (const pkg of WORK_PACKAGES) {
    if (pkg.subcontractUnitPrice !== undefined) {
      lines.push({
        lineCode: `SC-${pkg.code}`,
        workCode: pkg.code,
        category: "SUBCONTRACT",
        description: `${pkg.name} — гэрээт нэгж үнэ`,
        quantity: pkg.quantity,
        unit: pkg.unit,
        unitPrice: pkg.subcontractUnitPrice,
        amount: round(pkg.quantity * pkg.subcontractUnitPrice),
      });
      continue;
    }
    if (pkg.norm !== undefined) {
      const unitPrice = materialUnitPrice(pkg);
      lines.push({
        lineCode: `MT-${pkg.code}`,
        workCode: pkg.code,
        category: "MATERIAL",
        description: `${materialName(pkg.norm.materialCode)} — ${pkg.name}`,
        quantity: pkg.quantity,
        unit: pkg.unit,
        unitPrice,
        amount: round(pkg.quantity * unitPrice),
      });
    }
    if (pkg.productivity !== undefined) {
      const unitPrice = laborUnitPrice(pkg);
      lines.push({
        lineCode: `LB-${pkg.code}`,
        workCode: pkg.code,
        category: "LABOR",
        description: `${pkg.name} — ажиллах хүчний зардал`,
        quantity: pkg.quantity,
        unit: pkg.unit,
        unitPrice,
        amount: round(pkg.quantity * unitPrice),
      });
    }
  }
  for (const line of EQUIPMENT_LINES) {
    lines.push({
      lineCode: line.lineCode,
      workCode: line.workCode,
      category: "EQUIPMENT",
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      amount: round(line.quantity * line.unitPrice),
    });
  }
  return lines;
}

export type DemoEstimateTotals = {
  readonly subtotal: number;
  readonly contingencyAmount: number;
  readonly taxAmount: number;
  readonly totalAmount: number;
};

export function estimateTotals(lines: readonly DemoEstimateLine[]): DemoEstimateTotals {
  const subtotal = round(lines.reduce((sum, line) => sum + line.amount, 0));
  const contingencyAmount = round((subtotal * CONTINGENCY_PERCENT) / 100);
  const taxAmount = round(((subtotal + contingencyAmount) * VAT_PERCENT) / 100);
  return {
    subtotal,
    contingencyAmount,
    taxAmount,
    totalAmount: round(subtotal + contingencyAmount + taxAmount),
  };
}

/** Budget share of one package, used to spread the contract sum across the WBS. */
export function packageBudgets(): ReadonlyMap<string, number> {
  const lines = buildEstimateLines();
  const totals = estimateTotals(lines);
  const uplift = totals.totalAmount / totals.subtotal;
  const budgets = new Map<string, number>();
  for (const line of lines) {
    budgets.set(line.workCode, round((budgets.get(line.workCode) ?? 0) + line.amount * uplift));
  }
  return budgets;
}

// ---------------------------------------------------------------------------
// Progress state as of a given date
// ---------------------------------------------------------------------------

export type DemoWorkState = {
  readonly pkg: DemoWorkPackage;
  readonly progressPercent: number;
  readonly status: "PLANNED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED";
  readonly completedQuantity: number;
  readonly budget: number;
  readonly actualCost: number;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
};

export function workStates(asOf: string): readonly DemoWorkState[] {
  const budgets = packageBudgets();
  return WORK_PACKAGES.map((pkg) => {
    const elapsed = elapsedFraction(pkg.plannedStart, pkg.plannedEnd, asOf);
    const progressPercent = Math.round(clamp(elapsed * pkg.performanceFactor, 0, 1) * 100);
    const budget = budgets.get(pkg.code) ?? 0;
    const status =
      progressPercent >= 100
        ? "COMPLETED"
        : progressPercent === 0
          ? "PLANNED"
          : pkg.blocked === true
            ? "BLOCKED"
            : "IN_PROGRESS";
    // Cost runs slightly ahead of physical progress on the packages that are
    // behind schedule; that is what makes the cost variance alert fire.
    const costRatio =
      progressPercent === 0 ? 0 : (progressPercent / 100) * (2 - pkg.performanceFactor);
    return {
      pkg,
      progressPercent,
      status,
      completedQuantity: round((pkg.quantity * progressPercent) / 100, 3),
      budget,
      actualCost: round(budget * clamp(costRatio, 0, 1.2)),
      actualStart: progressPercent > 0 ? pkg.plannedStart : null,
      actualEnd: progressPercent >= 100 ? pkg.plannedEnd : null,
    };
  });
}

export function activePackages(asOf: string): readonly DemoWorkPackage[] {
  return WORK_PACKAGES.filter(
    (pkg) =>
      pkg.productivity !== undefined &&
      day(pkg.plannedStart) <= day(asOf) &&
      day(pkg.plannedEnd) >= day(asOf),
  );
}

// ---------------------------------------------------------------------------
// Daily operations
// ---------------------------------------------------------------------------

export type DemoPlanItem = {
  readonly workCode: string;
  readonly sequence: number;
  readonly plannedQuantity: number;
  readonly actualQuantity: number;
  readonly unit: string;
  readonly locationCode: string;
  readonly decisionReason: string;
  readonly crewCode: string | null;
  readonly materialCode: string | null;
  readonly requiredMaterial: number;
  readonly availableMaterial: number;
  readonly preconditions: readonly {
    readonly type: string;
    readonly description: string;
    readonly satisfied: boolean;
  }[];
};

export type DemoDay = {
  readonly date: string;
  readonly items: readonly DemoPlanItem[];
  readonly weather: Readonly<Record<string, unknown>>;
  readonly narrative: string;
  readonly disrupted: boolean;
  readonly attendance: readonly {
    readonly crewCode: string;
    readonly trade: string;
    readonly workerCount: number;
    readonly hoursPerWorker: number;
  }[];
};

const LOCATIONS = ["A-1 тэнхлэг", "B-2 тэнхлэг", "C-3 тэнхлэг", "Гол шат", "Зүүн жигүүр"];

const DISRUPTIONS: readonly { readonly reason: string; readonly factor: number }[] = [
  { reason: "Өдрийн турш бороо орсон тул өндөрлөгийн ажил зогссон", factor: 0.35 },
  { reason: "Бетон нийлүүлэлт 4 цаг хоцорсон", factor: 0.55 },
  { reason: "Блокны нөөц дуусч, өрлөгийн ажил зогссон", factor: 0.2 },
];

/** Builds the last `dayCount` working days of plans and reports before `asOf`. */
export function dailyOperations(asOf: string, dayCount = 14): readonly DemoDay[] {
  const random = seedrandom(`${FIXTURE_VERSION}:${asOf}:${dayCount}`);
  const dates = workingDaysBefore(asOf, dayCount);
  return dates.map((date, dayIndex) => {
    const packages = activePackages(date);
    // Every third-from-last day hits a disruption so the demo always has one.
    const disruptionIndex = dayIndex % 5 === 3 ? dayIndex % DISRUPTIONS.length : -1;
    const disruption = disruptionIndex >= 0 ? DISRUPTIONS[disruptionIndex] : null;
    const items = packages.map((pkg, index) => {
      const productivity = pkg.productivity;
      if (productivity === undefined) throw new Error(`Package ${pkg.code} has no productivity`);
      const plannedQuantity = round(productivity.outputPerCrewHour * 8, 3);
      const variation = 0.88 + random() * 0.24;
      const factor = disruption === null ? variation : variation * disruption.factor;
      const actualQuantity = round(plannedQuantity * factor, 3);
      const requiredMaterial = round(plannedQuantity * materialFactor(pkg), 3);
      const shortage = disruption?.reason.includes("Блок") === true && pkg.code === "MS-01";
      const crew = CREW_BY_TRADE.get(pkg.crewType);
      return {
        workCode: pkg.code,
        sequence: index + 1,
        plannedQuantity,
        actualQuantity,
        unit: pkg.unit,
        locationCode: LOCATIONS[(dayIndex + index) % LOCATIONS.length],
        decisionReason:
          disruption === null
            ? `Хуваарийн дагуу ${pkg.name.toLocaleLowerCase("mn-MN")} үргэлжлүүлэв`
            : `${disruption.reason} — өдрийн даалгаврыг бууруулав`,
        crewCode: crew?.code ?? null,
        materialCode: pkg.norm?.materialCode ?? null,
        requiredMaterial,
        availableMaterial: shortage ? round(requiredMaterial * 0.4, 3) : requiredMaterial,
        preconditions: [
          {
            type: "DESIGN_RELEASED",
            description: "Ажлын зураг олгогдсон эсэх",
            satisfied: true,
          },
          {
            type: "MATERIAL_ON_SITE",
            description: "Шаардлагатай материал талбайд байгаа эсэх",
            satisfied: !shortage,
          },
          {
            type: "SAFETY_BRIEFING",
            description: "Өдрийн аюулгүй ажиллагааны зааварчилгаа өгсөн эсэх",
            satisfied: true,
          },
        ],
      };
    });
    const attendance = items
      .map((item) => {
        const pkg = WORK_PACKAGES.find((candidate) => candidate.code === item.workCode);
        const crew = pkg === undefined ? undefined : CREW_BY_TRADE.get(pkg.crewType);
        if (crew === undefined) return null;
        const absent = Math.round(random() * 1.4);
        return {
          crewCode: crew.code,
          trade: crew.trade,
          workerCount: Math.max(1, crew.memberCount - absent),
          hoursPerWorker: disruption === null ? 8 : round(8 * disruption.factor + 2, 1),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const temperature = Math.round(14 + random() * 12);
    return {
      date,
      items,
      weather: {
        conditionCode: disruption?.reason.includes("бороо") === true ? "RAIN" : "CLEAR",
        temperatureCelsius: temperature,
        windSpeedMs: round(1 + random() * 6, 1),
        source: "MANUAL_ENTRY",
      },
      narrative:
        disruption === null
          ? `Талбайн ажил хуваарийн дагуу явагдав. Нийт ${items.length} багц дээр ажиллав.`
          : `${disruption.reason}. Гүйцэтгэл төлөвлөснөөс доогуур гарав.`,
      disrupted: disruption !== null,
      attendance,
    };
  });
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export type DemoForecast = {
  readonly asOf: string;
  readonly delayDays: number;
  readonly projectedFinish: string;
  readonly confidence: number;
  readonly workItems: readonly {
    readonly workCode: string;
    readonly remainingQuantity: number;
    readonly rollingProductivity: number;
    readonly projectedFinish: string;
    readonly delayDays: number;
    readonly isCritical: boolean;
    readonly confidence: number;
  }[];
  readonly drivers: readonly {
    readonly driverCode: string;
    readonly contribution: number;
    readonly description: string;
  }[];
};

export function forecasts(asOf: string, count = 3): readonly DemoForecast[] {
  const states = workStates(asOf);
  const snapshots: DemoForecast[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const snapshotDate = addDays(asOf, -1 - index * 7);
    // The delay grows as the concrete and masonry packages keep slipping.
    const delayDays = round(7.5 + (count - 1 - index) * 2.6, 2);
    const workItems = states
      .filter((state) => state.pkg.productivity !== undefined && state.progressPercent < 100)
      .map((state) => {
        const remaining = round(state.pkg.quantity - state.completedQuantity, 3);
        const productivity = state.pkg.productivity;
        if (productivity === undefined) throw new Error("missing productivity");
        const rolling = round(productivity.outputPerCrewHour * 8 * state.pkg.performanceFactor, 4);
        const daysNeeded = rolling > 0 ? Math.ceil(remaining / rolling) : 0;
        const itemDelay = round(
          Math.max(
            0,
            daysNeeded -
              Math.max(
                0,
                (day(state.pkg.plannedEnd).getTime() - day(snapshotDate).getTime()) / 86_400_000,
              ),
          ),
          2,
        );
        return {
          workCode: state.pkg.code,
          remainingQuantity: remaining,
          rollingProductivity: rolling,
          projectedFinish: addDays(snapshotDate, daysNeeded),
          delayDays: itemDelay,
          isCritical: state.pkg.isCritical,
          confidence: round(0.72 + (index === 0 ? 0.14 : 0.05), 4),
        };
      });
    snapshots.push({
      asOf: snapshotDate,
      delayDays,
      projectedFinish: addDays(PROJECT_END, Math.round(delayDays)),
      confidence: round(0.74 + (count - 1 - index) * 0.04, 4),
      workItems,
      drivers: [
        {
          driverCode: "PRODUCTIVITY_SHORTFALL",
          contribution: round(delayDays * 0.46, 4),
          description: "Каркасын бетон, өрлөгийн багийн бүтээмж нормоос доогуур байна",
        },
        {
          driverCode: "MATERIAL_SHORTAGE",
          contribution: round(delayDays * 0.28, 4),
          description: "Керамзитбетон блокны нөөц тасалдсан өдрүүд",
        },
        {
          driverCode: "WEATHER_LOSS",
          contribution: round(delayDays * 0.18, 4),
          description: "Бороотой өдрүүдэд өндөрлөгийн ажил зогссон",
        },
        {
          driverCode: "CREW_ABSENCE",
          contribution: round(delayDays * 0.08, 4),
          description: "Багийн ирц бүрэн бус байсан өдрүүд",
        },
      ],
    });
  }
  return snapshots;
}

export const PROJECT_METADATA = {
  id: DEMO_PROJECT_ID,
  code: DEMO_PROJECT_CODE,
  name: "Хан-Уул 12 давхар орон сууцны хотхон — A блок",
  description:
    "Улаанбаатар хотын Хан-Уул дүүрэгт баригдаж буй 12 давхар, 96 айлын орон сууцны барилга. " +
    "Монолит төмөр бетон каркас, керамзитбетон блокон хана, EPS дулаалгатай фасад.",
  location: "Улаанбаатар, Хан-Уул дүүрэг, 15-р хороо, Их Монгол Улсын гудамж",
  plannedStart: PROJECT_START,
  plannedEnd: PROJECT_END,
  timezone: TIMEZONE,
  currency: CURRENCY,
} as const;
