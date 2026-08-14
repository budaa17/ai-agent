export type EngineeringWorkbookColumnKind =
  "TEXT" | "DECIMAL" | "INTEGER" | "BOOLEAN" | "DATE" | "TIME";

export type EngineeringWorkbookColumnDefinition = {
  name: string;
  kind: EngineeringWorkbookColumnKind;
  required: boolean;
  aliases?: readonly string[];
};

export type EngineeringWorkbookSheetDefinition = {
  name: string;
  keyColumn: string;
  columns: readonly EngineeringWorkbookColumnDefinition[];
};

const column = (
  name: string,
  kind: EngineeringWorkbookColumnKind = "TEXT",
  required = true,
  aliases?: readonly string[],
): EngineeringWorkbookColumnDefinition => ({
  name,
  kind,
  required,
  aliases,
});

export const engineeringWorkbookSheetDefinitions = [
  {
    name: "01_Project",
    keyColumn: "ProjectCode",
    columns: [
      column("ProjectCode"),
      column("ProjectName"),
      column("Timezone"),
      column("Currency"),
      column("PlannedStart", "DATE"),
      column("PlannedFinish", "DATE"),
    ],
  },
  {
    name: "02_Drawing_Register",
    keyColumn: "DrawingCode",
    columns: [
      column("DrawingCode"),
      column("RevisionCode"),
      column("Discipline"),
      column("FileName"),
      column("IssuedOn", "DATE"),
      column("EffectiveStatus"),
      column("SupersedesDrawingCode", "TEXT", false),
    ],
  },
  {
    name: "03_Floors_Zones",
    keyColumn: "ZoneCode",
    columns: [
      column("FloorCode"),
      column("ZoneCode"),
      column("Name"),
      column("ElevationM", "DECIMAL", false),
    ],
  },
  {
    name: "04_Construction_Assumptions",
    keyColumn: "AssumptionCode",
    columns: [
      column("AssumptionCode"),
      column("Description"),
      column("Value"),
      column("Unit", "TEXT", false),
      column("ApprovedBy", "TEXT", false),
    ],
  },
  {
    name: "05_Material_Catalog",
    keyColumn: "MaterialCode",
    columns: [
      column("MaterialCode"),
      column("MaterialName"),
      column("Unit"),
      column("WastePercent", "DECIMAL", false),
    ],
  },
  {
    name: "06_Work_Norms",
    keyColumn: "NormCode",
    columns: [
      column("NormCode"),
      column("WorkCode"),
      column("MaterialCode"),
      column("QuantityPerWorkUnit", "DECIMAL"),
      column("WorkUnit"),
      column("EffectiveFrom", "DATE"),
      column("ApprovedBy"),
    ],
  },
  {
    name: "07_Prices",
    keyColumn: "PriceCode",
    columns: [
      column("PriceCode"),
      column("ItemCode"),
      column("UnitPriceMnt", "DECIMAL"),
      column("EffectiveFrom", "DATE"),
      column("EffectiveTo", "DATE", false),
      column("ApprovedBy"),
    ],
  },
  {
    name: "08_Productivity",
    keyColumn: "ProductivityCode",
    columns: [
      column("ProductivityCode"),
      column("WorkCode"),
      column("CrewType"),
      column("Unit"),
      column("QuantityPerDay", "DECIMAL"),
      column("EffectiveFrom", "DATE"),
      column("ApprovedBy"),
    ],
  },
  {
    name: "09_Resources",
    keyColumn: "ResourceCode",
    columns: [
      column("ResourceCode"),
      column("ResourceType"),
      column("Capacity", "DECIMAL"),
      column("Unit"),
      column("AvailableFrom", "DATE"),
      column("AvailableTo", "DATE"),
    ],
  },
  {
    name: "10_Dependencies",
    keyColumn: "DependencyCode",
    columns: [
      column("DependencyCode"),
      column("PredecessorWorkCode"),
      column("SuccessorWorkCode"),
      column("DependencyType"),
      column("LagDays", "INTEGER"),
    ],
  },
  {
    name: "11_Calendar",
    keyColumn: "Date",
    columns: [
      column("CalendarCode"),
      column("Date", "DATE"),
      column("IsWorkingDay", "BOOLEAN"),
      column("WorkingHours", "DECIMAL"),
    ],
  },
  {
    name: "12_Risk_Allowances",
    keyColumn: "RiskCode",
    columns: [
      column("RiskCode"),
      column("WorkCode"),
      column("AllowancePercent", "DECIMAL"),
      column("Reason"),
    ],
  },
  {
    name: "13_Daily_Planning_Rules",
    keyColumn: "RuleCode",
    columns: [
      column("RuleCode"),
      column("WorkCode"),
      column("MinimumDailyQty", "DECIMAL"),
      column("TargetDailyQty", "DECIMAL"),
      column("MaximumDailyQty", "DECIMAL"),
      column("MinCrewSize", "INTEGER"),
      column("RequiredEquipment", "TEXT", false),
      column("RequiredMaterialCoverageDays", "INTEGER"),
      column("CanOverlapWith", "TEXT", false),
      column("CannotOverlapWith", "TEXT", false),
      column("WeatherRestriction", "TEXT", false),
      column("PriorityRule"),
    ],
  },
  {
    name: "14_Crews_Shifts",
    keyColumn: "CrewCode",
    columns: [
      column("CrewCode"),
      column("CrewType"),
      column("Headcount", "INTEGER"),
      column("ShiftStart", "TIME"),
      column("ShiftEnd", "TIME"),
      column("BreakMinutes", "INTEGER"),
      column("ProductivityFactor", "DECIMAL"),
      column("AvailableFrom", "DATE"),
      column("AvailableTo", "DATE"),
      column("AssignedProject"),
      column("CostPerDay", "DECIMAL"),
    ],
  },
  {
    name: "15_Photo_Evidence_Rules",
    keyColumn: "WorkCode",
    columns: [
      column("WorkCode"),
      column("MinPhotoCount", "INTEGER"),
      column("RequiredAngles"),
      column("RequireTimestamp", "BOOLEAN"),
      column("RequireLocation"),
      column("RequireReferenceMarker", "BOOLEAN"),
      column("RequireBeforeAfter", "BOOLEAN"),
      column("MaxPhotoAgeMinutes", "INTEGER"),
      column("BlurThreshold", "DECIMAL"),
      column("DuplicateCheck", "BOOLEAN"),
    ],
  },
  {
    name: "16_Progress_Measurement",
    keyColumn: "WorkCode",
    columns: [
      column("WorkCode"),
      column("MeasurementMethod"),
      column("Unit"),
      column("CompletionRule"),
    ],
  },
  {
    name: "17_Weather_Logistics",
    keyColumn: "Date",
    columns: [
      column("Date", "DATE"),
      column("WeatherCode"),
      column("TemperatureMin", "DECIMAL"),
      column("TemperatureMax", "DECIMAL"),
      column("WindKmh", "DECIMAL"),
      column("RestrictedWorkCodes", "TEXT", false),
      column("DeliveryWindow", "TEXT", false),
      column("SiteAccessStatus"),
      column("Notes", "TEXT", false),
    ],
  },
  {
    name: "18_Approval_Matrix",
    keyColumn: "TargetType",
    columns: [column("TargetType"), column("DraftBy"), column("ReviewBy"), column("ApproveBy")],
  },
] as const satisfies readonly EngineeringWorkbookSheetDefinition[];

export const engineeringWorkbookSheetNames = engineeringWorkbookSheetDefinitions.map(
  (sheet) => sheet.name,
);

export function normalizeWorkbookName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/gu, "");
}
