import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runPnpm } from "./process-runner.mjs";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const agentsDirectory = path.resolve(consoleRoot, "..", "agents");
const consoleDataDirectory = path.join(consoleRoot, "data");
const a1ReviewDirectory = path.join(consoleDataDirectory, "a1-review");
const a1ProjectDirectory = path.join(consoleDataDirectory, "a1-projects");

const imageTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

let modulesPromise;
let simulationCache;
let environmentPromise;

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(agentsDirectory, "dist", relativePath)).href;
}

async function loadModules() {
  await loadAgentEnvironment();
  modulesPromise ??= Promise.all([
    import(moduleUrl("simulation/index.js")),
    import(moduleUrl("phase2/a2-observer.js")),
    import(moduleUrl("phase2/a3-documents.js")),
    import(moduleUrl("phase2/a3-artifacts.js")),
    import(moduleUrl("phase2/a4-assistant.js")),
    import(moduleUrl("production-tools/repository.js")),
    import(moduleUrl("contracts/index.js")),
    import(moduleUrl("structuring/index.js")),
  ]).then(([simulation, a2, a3, a3Artifacts, a4, repository, contracts, structuring]) => ({
    simulation,
    a2,
    a3,
    a3Artifacts,
    a4,
    repository,
    contracts,
    structuring,
  }));

  return await modulesPromise;
}

async function getSimulation() {
  if (simulationCache === undefined) {
    const { simulation } = await loadModules();
    simulationCache = simulation.buildBuildWatchSimulation();
  }

  return simulationCache;
}

function stableLocalId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function a1ProjectKey(snapshot) {
  return `${snapshot.tenantId}::${snapshot.projectId}`;
}

function projectFileName(prefix, projectKey) {
  return `${prefix}-${createHash("sha256").update(projectKey).digest("hex").slice(0, 24)}.json`;
}

function projectSourceFromFileName(name) {
  if (name.startsWith("created-")) {
    return "LOCAL_PROJECT_BUILDER";
  }

  if (name.startsWith("imported-")) {
    return "IMPORTED_SNAPSHOT";
  }

  return "LOCAL_WORKING_COPY";
}

async function parseProjectSnapshot(value) {
  const { contracts } = await loadModules();
  return contracts.projectAnalysisSnapshotV1Schema.parse(value);
}

async function readProjectSnapshot(filePath) {
  return await parseProjectSnapshot(JSON.parse(await readFile(filePath, "utf8")));
}

async function writeProjectSnapshot(filePath, snapshotInput) {
  const snapshot = await parseProjectSnapshot(snapshotInput);
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;

  if (Buffer.byteLength(content) > 25 * 1024 * 1024) {
    throw new Error("Project snapshot 25 MB-аас их байж болохгүй");
  }

  await mkdir(a1ProjectDirectory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rm(filePath, { force: true });
  await rename(temporaryPath, filePath);
  return snapshot;
}

function describeA1Project(snapshot, source, filePath = null) {
  return {
    projectKey: a1ProjectKey(snapshot),
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    projectCode: snapshot.projectCode,
    projectName: snapshot.projectName,
    projectStatus: snapshot.projectStatus,
    source,
    asOf: snapshot.asOf,
    plannedStart: snapshot.activeBaseline.plannedStart,
    plannedEnd: snapshot.activeBaseline.plannedEnd,
    budgetMnt: snapshot.activeBaseline.budgetMnt,
    counts: {
      workItems: snapshot.workItems.length,
      materials: snapshot.materials.length,
      dailyReports: snapshot.dailyReports.length,
    },
    canDelete: source === "LOCAL_PROJECT_BUILDER" || source === "IMPORTED_SNAPSHOT",
    filePath,
    snapshot,
  };
}

async function builtInA1Project() {
  const fixture = await getSimulation();
  const projectKey = a1ProjectKey(fixture.snapshot);
  const workingPath = path.join(a1ProjectDirectory, projectFileName("working", projectKey));

  try {
    const snapshot = await readProjectSnapshot(workingPath);

    if (a1ProjectKey(snapshot) !== projectKey) {
      throw new Error("Built-in A1 working snapshot scope зөрүүтэй");
    }

    return describeA1Project(snapshot, "LOCAL_WORKING_COPY", workingPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return describeA1Project(fixture.snapshot, "BUILT_IN_SIMULATION", workingPath);
}

async function importedA1Projects() {
  await mkdir(a1ProjectDirectory, { recursive: true });
  const names = (await readdir(a1ProjectDirectory))
    .filter((name) => /^(?:created|imported)-[a-f0-9]{24}\.json$/u.test(name))
    .sort();

  return await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(a1ProjectDirectory, name);
      const snapshot = await readProjectSnapshot(filePath);
      return describeA1Project(snapshot, projectSourceFromFileName(name), filePath);
    }),
  );
}

function publicA1Project(project) {
  const { filePath, snapshot, ...metadata } = project;
  return metadata;
}

export async function listA1Projects() {
  const projects = [await builtInA1Project(), ...(await importedA1Projects())];

  return projects
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode))
    .map(publicA1Project);
}

async function resolveA1Project(projectKeyInput) {
  if (typeof projectKeyInput !== "string" || !projectKeyInput.trim()) {
    throw new Error("A1 project сонгоогүй байна");
  }

  const projectKey = projectKeyInput.trim();
  const projects = [await builtInA1Project(), ...(await importedA1Projects())];
  const project = projects.find((candidate) => candidate.projectKey === projectKey);

  if (!project) {
    throw new Error("Сонгосон A1 project registry-д олдсонгүй");
  }

  return project;
}

function requireText(value, name, maxLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${name} хоосон биш, ${maxLength} тэмдэгтээс бага байна`);
  }

  return value.trim();
}

function requireDate(value, name) {
  const parsed = requireText(value, name, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(parsed)) {
    throw new Error(`${name} YYYY-MM-DD форматтай байх ёстой`);
  }

  return parsed;
}

function decimalString(value, name) {
  const parsed = requireText(String(value ?? ""), name, 50);

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(parsed)) {
    throw new Error(`${name} эерэг decimal тоо байна`);
  }

  return parsed;
}

function moneyString(value, name) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${name} 0-ээс багагүй мөнгөн дүн байна`);
  }

  return numeric.toFixed(2);
}

function createLocalProjectSnapshot(input) {
  const tenantId = requireText(input?.tenantId, "Tenant ID", 200);
  const projectId = requireText(input?.projectId, "Project ID", 200);
  const projectCode = requireText(input?.projectCode, "Project code", 200);
  const projectName = requireText(input?.projectName, "Project name", 500);
  const plannedStart = requireDate(input?.plannedStart, "Эхлэх огноо");
  const plannedEnd = requireDate(input?.plannedEnd, "Дуусах огноо");
  const asOfDate = requireDate(input?.asOfDate, "As-of огноо");

  if (Date.parse(plannedStart) > Date.parse(plannedEnd)) {
    throw new Error("Төслийн эхлэх огноо дуусах огнооноос хойш байна");
  }

  if (!Array.isArray(input?.workItems) || input.workItems.length === 0) {
    throw new Error("Шинэ project дор хаяж нэг work item-тай байна");
  }

  if (input.workItems.length > 500) {
    throw new Error("Local project builder 500 хүртэл work item хүлээн авна");
  }

  const workItems = input.workItems.map((item, index) => {
    const code = requireText(item?.code, `${index + 1}-р ажлын code`, 200);
    const itemStart = item?.plannedStart
      ? requireDate(item.plannedStart, `${code} эхлэх огноо`)
      : plannedStart;
    const itemEnd = item?.plannedEnd
      ? requireDate(item.plannedEnd, `${code} дуусах огноо`)
      : plannedEnd;

    if (Date.parse(itemStart) > Date.parse(itemEnd)) {
      throw new Error(`${code} ажлын огнооны дараалал буруу`);
    }

    return {
      workItemId: stableLocalId("work-item", `${tenantId}:${projectId}:${code}`),
      parentWorkItemId: null,
      code,
      name: requireText(item?.name, `${code} ажлын нэр`, 500),
      stage: null,
      location: null,
      unit: requireText(item?.unit, `${code} нэгж`, 100),
      plannedQuantity: decimalString(item?.plannedQuantity, `${code} төлөвлөсөн тоо хэмжээ`),
      unitCostMnt: moneyString(item?.unitCostMnt, `${code} нэгж өртөг`),
      plannedStart: itemStart,
      plannedEnd: itemEnd,
      status: "PLANNED",
      priority: "MEDIUM",
      assigneeType: "UNASSIGNED",
      assigneeRef: null,
      subcontractorId: null,
      isCritical: false,
      displayOrder: index,
    };
  });

  if (new Set(workItems.map((item) => item.code)).size !== workItems.length) {
    throw new Error("Work item code давхардаж болохгүй");
  }

  return {
    schemaVersion: 1,
    snapshotType: "PROJECT_ANALYSIS",
    snapshotId: stableLocalId("snapshot", `${tenantId}:${projectId}:${asOfDate}`),
    tenantId,
    projectId,
    projectCode,
    projectName,
    projectStatus: "ACTIVE",
    asOf: `${asOfDate}T23:59:59.999Z`,
    activeBaseline: {
      baselineVersionId: stableLocalId("baseline", `${tenantId}:${projectId}:1`),
      version: 1,
      approvedBy: "agent-console-project-builder",
      approvedAt: `${plannedStart}T00:00:00.000Z`,
      changeReason: "Agent Console local A1 project setup",
      plannedStart,
      plannedEnd,
      budgetMnt: moneyString(input?.budgetMnt ?? 0, "Төслийн төсөв"),
      calendar: {
        timezone: "Asia/Ulaanbaatar",
        workingWeekdays: [1, 2, 3, 4, 5],
        workHoursPerDay: 8,
        holidays: [],
      },
    },
    workItems,
    dependencies: [],
    materials: [],
    materialNorms: [],
    subcontractors: [],
    dailyReports: [],
    progressEntries: [],
    attendanceEntries: [],
    stockMovements: [],
    costEntries: [],
    blockers: [],
    alerts: [],
    forecasts: [],
    recommendationDecisions: [],
    tenantProfile: {
      displayName: tenantId,
      terminology: {},
      blockerCategories: [
        "MATERIAL",
        "WEATHER",
        "LABOR",
        "EQUIPMENT",
        "DESIGN",
        "APPROVAL",
        "ACCESS",
        "SAFETY",
        "SUBCONTRACTOR",
        "QUALITY",
        "OTHER",
      ],
      reportingStyle: null,
    },
  };
}

async function ensureUniqueA1Project(snapshot, replace) {
  const key = a1ProjectKey(snapshot);
  const builtIn = await builtInA1Project();

  if (builtIn.projectKey === key) {
    throw new Error("Built-in BW-SIM project-ийг дарж бичих боломжгүй");
  }

  const existing = (await importedA1Projects()).find((project) => project.projectKey === key);

  if (existing && replace !== true) {
    throw new Error("Ижил tenant/project ID бүртгэлтэй байна. Replace сонголт шаардлагатай");
  }

  return existing;
}

export async function createA1Project({ project, replace }) {
  const snapshot = await parseProjectSnapshot(createLocalProjectSnapshot(project));
  const existing = await ensureUniqueA1Project(snapshot, replace);
  const target = path.join(a1ProjectDirectory, projectFileName("created", a1ProjectKey(snapshot)));
  const saved = await writeProjectSnapshot(target, snapshot);

  if (existing?.filePath && existing.filePath !== target) {
    await rm(existing.filePath, { force: true });
  }

  return publicA1Project(describeA1Project(saved, "LOCAL_PROJECT_BUILDER", target));
}

export async function importA1Project({ snapshot: snapshotInput, replace }) {
  const snapshot = await parseProjectSnapshot(snapshotInput);
  const existing = await ensureUniqueA1Project(snapshot, replace);
  const target = path.join(a1ProjectDirectory, projectFileName("imported", a1ProjectKey(snapshot)));
  const saved = await writeProjectSnapshot(target, snapshot);

  if (existing?.filePath && existing.filePath !== target) {
    await rm(existing.filePath, { force: true });
  }

  return publicA1Project(describeA1Project(saved, "IMPORTED_SNAPSHOT", target));
}

export async function deleteA1Project({ projectKey }) {
  const project = await resolveA1Project(projectKey);

  if (!project.canDelete || project.filePath === null) {
    throw new Error("Built-in/working project устгах боломжгүй");
  }

  await rm(project.filePath, { force: true });
  return { deleted: true, projectKey: project.projectKey };
}

export async function getA1ProjectSnapshot({ projectKey }) {
  const project = await resolveA1Project(projectKey);
  return project.snapshot;
}

function parseEnvironment(content) {
  const values = new Map();

  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#]*?))\s*(?:#.*)?$/u,
    );

    if (match) {
      values.set(match[1], (match[2] ?? match[3] ?? match[4] ?? "").trim());
    }
  }

  return values;
}

async function loadAgentEnvironment() {
  environmentPromise ??= readFile(path.join(agentsDirectory, ".env"), "utf8")
    .then((content) => {
      for (const [name, value] of parseEnvironment(content)) {
        if (process.env[name] === undefined) {
          process.env[name] = value;
        }
      }
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });

  await environmentPromise;
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export async function getSystemStatus() {
  let environment = new Map();
  let envExists = true;

  try {
    environment = parseEnvironment(await readFile(path.join(agentsDirectory, ".env"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    envExists = false;
  }

  let packageJson;

  try {
    packageJson = JSON.parse(await readFile(path.join(agentsDirectory, "package.json"), "utf8"));
  } catch {
    packageJson = {};
  }

  const nodeMajor = Number(process.versions.node.split(".")[0]);

  return {
    console: {
      status: "OK",
      uptimeSeconds: Math.floor(process.uptime()),
      host: "127.0.0.1",
    },
    agents: {
      package: packageJson.name ?? "diplom-agents",
      version: packageJson.version ?? "unknown",
      buildReady: true,
      directory: agentsDirectory,
    },
    runtime: {
      nodeVersion: process.version,
      expectedNode: packageJson.engines?.node ?? ">=22 <23",
      nodeRecommended: nodeMajor === 22,
    },
    configuration: {
      envExists,
      openAIKeyConfigured: Boolean(environment.get("OPENAI_API_KEY")?.trim()),
      a1Model: environment.get("A1_OPENAI_MODEL") || environment.get("OPENAI_MODEL") || "default",
      inputPricingConfigured: positiveNumber(
        environment.get("AGENT_INPUT_COST_MICRO_USD_PER_MILLION_TOKENS"),
      ),
      outputPricingConfigured: positiveNumber(
        environment.get("AGENT_OUTPUT_COST_MICRO_USD_PER_MILLION_TOKENS"),
      ),
      databaseConfigured: Boolean(environment.get("DATABASE_URL")?.trim()),
    },
  };
}

export async function getDemoMetadata() {
  const { simulation } = await loadModules();
  const fixture = await getSimulation();

  return {
    tenantId: fixture.snapshot.tenantId,
    projectId: fixture.snapshot.projectId,
    projectCode: fixture.snapshot.projectCode,
    projectName: fixture.snapshot.projectName,
    dataSource: "SIMULATION_SNAPSHOT",
    asOf: fixture.snapshot.asOf,
    weekEndDates: simulation.simulationWeekEndDates(),
    counts: {
      workItems: fixture.snapshot.workItems.length,
      progressEntries: fixture.snapshot.progressEntries.length,
      dailyReports: fixture.snapshot.dailyReports.length,
      alerts: fixture.snapshot.alerts.length,
    },
  };
}

const knownProjectMentions = [
  {
    code: "ATLAS",
    pattern: /\b(?:project-atlas|atlas)\b/iu,
  },
];

function foreignProjectMention(question, snapshot) {
  return knownProjectMentions.find(
    (candidate) =>
      candidate.code !== snapshot.projectCode.toLocaleUpperCase() &&
      candidate.pattern.test(question),
  );
}

function assertIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Огноо YYYY-MM-DD форматтай байх ёстой");
  }

  return value;
}

async function snapshotAsOf(asOf) {
  const { simulation } = await loadModules();
  const fixture = await getSimulation();

  return asOf
    ? simulation.replayBuildWatchSimulation(fixture, assertIsoDate(asOf))
    : fixture.snapshot;
}

export async function runA2Demo({ asOf }) {
  const { a2 } = await loadModules();
  const snapshot = await snapshotAsOf(asOf);

  return await a2.runProductionA2({
    snapshot,
    requestId: `console-a2-${randomUUID()}`,
    trigger: "MANUAL",
  });
}

export async function runA3Demo({ asOf }) {
  const { a3, a3Artifacts } = await loadModules();
  const snapshot = await snapshotAsOf(asOf);
  const result = await a3.runProductionA3({
    snapshot,
    requestId: `console-a3-${randomUUID()}`,
  });

  return {
    ...result,
    previews: Object.fromEntries(
      result.bundle.documents.map((document) => [
        document.documentId,
        a3Artifacts.renderA3DocumentHtml(document),
      ]),
    ),
  };
}

export async function askA4Demo({ question, asOf }) {
  if (typeof question !== "string" || !question.trim()) {
    throw new Error("A4 асуулт хоосон байж болохгүй");
  }

  if (question.length > 4_000) {
    throw new Error("A4 асуулт 4000 тэмдэгтээс их байж болохгүй");
  }

  const { a4, repository } = await loadModules();
  const fixture = await getSimulation();
  const readRepository = new repository.InMemoryProductionReadRepository([
    fixture.snapshot,
    fixture.privateSnapshot,
  ]);
  const context = {
    principalId: "agent-console-manager",
    tenantId: fixture.snapshot.tenantId,
    allowedProjectIds: [fixture.snapshot.projectId],
    permissions: ["AGENT_READ", "COST_READ", "REPORT_TEXT_READ"],
  };
  const requestedDate = asOf ? assertIsoDate(asOf) : null;
  const normalizedAsOf =
    requestedDate === null
      ? fixture.snapshot.asOf
      : requestedDate === fixture.snapshot.asOf.slice(0, 10)
        ? fixture.snapshot.asOf
        : `${requestedDate}T23:59:59.999Z`;
  const requestedProject = foreignProjectMention(question, fixture.snapshot);

  if (requestedProject) {
    return {
      schemaVersion: 1,
      artifactType: "REFERENCE_ANSWER",
      answerId: `console-a4-context-${randomUUID()}`,
      tenantId: fixture.snapshot.tenantId,
      projectId: fixture.snapshot.projectId,
      snapshotId: fixture.snapshot.snapshotId,
      generatedAt: normalizedAsOf,
      question: question.trim(),
      answer:
        `Идэвхтэй A4 source нь ${fixture.snapshot.projectName} ` +
        `(${fixture.snapshot.projectCode}) simulation байна. ` +
        `${requestedProject.code} энэ console-ийн source-д сонгогдоогүй тул ` +
        "буруу төслийн мэдээлэл өгөхгүй.",
      status: "INSUFFICIENT_EVIDENCE",
      suggestedRouteCode: "SELECT_PROJECT_CONTEXT",
      claims: [],
      inspectedTools: [],
      insufficientData: true,
      readOnly: true,
    };
  }

  return await a4.askProductionA4({
    repository: readRepository,
    context,
    projectId: fixture.snapshot.projectId,
    question: question.trim(),
    asOf: normalizedAsOf,
  });
}

function parseLeadingJson(output) {
  const start = output.indexOf("{");

  if (start < 0) {
    throw new Error("A1 JSON output олдсонгүй");
  }

  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = start; index < output.length; index += 1) {
    const character = output[index];

    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return {
          value: JSON.parse(output.slice(start, index + 1)),
          remainder: output.slice(index + 1).trim(),
        };
      }
    }
  }

  throw new Error("A1 JSON output бүрэн биш байна");
}

async function saveUploadedImages(images, directory) {
  if (!Array.isArray(images) || images.length > 5) {
    throw new Error("A1 intake 0–5 зураг хүлээн авна");
  }

  const paths = [];

  for (const [index, image] of images.entries()) {
    const match =
      typeof image?.dataUrl === "string"
        ? image.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/iu)
        : null;

    if (!match || !imageTypes.has(match[1].toLowerCase())) {
      throw new Error(`${index + 1}-р зураг PNG, JPEG, WEBP эсвэл GIF байх ёстой`);
    }

    const data = Buffer.from(match[2], "base64");

    if (data.byteLength === 0 || data.byteLength > 10 * 1024 * 1024) {
      throw new Error(`${index + 1}-р зургийн хэмжээ 1 byte–10 MB байх ёстой`);
    }

    const extension = imageTypes.get(match[1].toLowerCase());
    const filePath = path.join(
      directory,
      `source-${String(index + 1).padStart(2, "0")}${extension}`,
    );
    await writeFile(filePath, data, { flag: "wx" });
    paths.push(filePath);
  }

  return paths;
}

export async function runA1Live({
  text,
  referenceDate,
  images,
  confirmPaid,
  projectKey,
  requestId,
}) {
  if (confirmPaid !== true) {
    throw new Error("A1 live intake ажиллуулахын өмнө API quota/төлбөрийн зөвшөөрөл өгнө");
  }

  const normalizedText = typeof text === "string" && text.trim() ? text.trim() : null;

  if (normalizedText && normalizedText.length > 20_000) {
    throw new Error("A1 текст 20000 тэмдэгтээс их байж болохгүй");
  }

  if (!normalizedText && (!Array.isArray(images) || images.length === 0)) {
    throw new Error("A1-д текст эсвэл дор хаяж нэг зураг оруулна");
  }

  const project = await resolveA1Project(projectKey);
  const status = await getSystemStatus();

  if (!status.configuration.openAIKeyConfigured) {
    throw new Error("agents/.env дотор OPENAI_API_KEY тохируулаагүй");
  }

  await mkdir(a1ReviewDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-console-a1-"));

  try {
    const imagePaths = await saveUploadedImages(images ?? [], temporaryDirectory);
    const args = ["exec", "--", "tsx", "src/scripts/a1-daily-intake.ts"];

    if (normalizedText) {
      args.push("--text", normalizedText);
    }

    args.push(
      "--reference-date",
      assertIsoDate(referenceDate),
      "--request-id",
      requestId ? requireText(requestId, "Request ID", 200) : `console-a1-${randomUUID()}`,
      "--tenant",
      project.tenantId,
      "--project",
      project.projectId,
      "--store",
      a1ReviewDirectory,
    );

    if (project.source !== "BUILT_IN_SIMULATION" && project.filePath !== null) {
      args.push("--snapshot", project.filePath);
    }

    for (const imagePath of imagePaths) {
      args.push("--image", imagePath);
    }

    const result = await runPnpm(args, agentsDirectory, {
      timeoutMs: 300_000,
    });

    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout || "A1 intake failed").trim());
    }

    const parsed = parseLeadingJson(result.stdout);
    const { structuring } = await loadModules();
    const store = new structuring.FileDailyReportReviewStore(a1ReviewDirectory);
    const record = await store.get(parsed.value.draftId);

    return {
      draft: record.draft,
      record,
      project: publicA1Project(project),
      execution: parsed.remainder,
      durationMs: result.durationMs,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function getA1ReviewStore() {
  const { structuring } = await loadModules();
  return new structuring.FileDailyReportReviewStore(a1ReviewDirectory);
}

function a1DraftSummary(record) {
  return {
    draftId: record.draftId,
    requestId: record.requestId,
    tenantId: record.tenantId,
    projectId: record.projectId,
    reportDate: record.draft.reportDate,
    status: record.status,
    confidence: record.draft.overallConfidence,
    confidenceLevel: record.draft.confidenceLevel,
    validationErrors: record.draft.validationIssues.filter((issue) => issue.severity === "ERROR")
      .length,
    validationWarnings: record.draft.validationIssues.filter(
      (issue) => issue.severity === "WARNING",
    ).length,
    clarificationQuestions: record.draft.clarificationQuestions.length,
    requiredClarifications: record.draft.clarificationQuestions.filter(
      (question) => question.requiredForApproval,
    ).length,
    duplicateCandidates: record.draft.duplicateCandidates.length,
    imageCount: record.draft.sourceArtifacts.filter((artifact) => artifact.kind === "SOURCE_IMAGE")
      .length,
    humanEditCount: record.humanEditedFieldPaths.length,
    updatedAt: record.updatedAt,
  };
}

async function scopedA1Draft(projectKey, draftId) {
  const project = await resolveA1Project(projectKey);
  const store = await getA1ReviewStore();
  const record = await store.get(requireText(draftId, "Draft ID", 200));

  if (record.tenantId !== project.tenantId || record.projectId !== project.projectId) {
    throw new Error("Draft сонгосон project scope-д хамаарахгүй");
  }

  return { project, record, store };
}

export async function listA1Drafts({ projectKey, status }) {
  const project = await resolveA1Project(projectKey);
  const store = await getA1ReviewStore();
  const allowedStatuses = new Set([
    "DRAFT",
    "READY_FOR_REVIEW",
    "NEEDS_CORRECTION",
    "APPROVED",
    "REJECTED",
  ]);
  const selectedStatus = typeof status === "string" && status !== "ALL" ? status : null;

  if (selectedStatus !== null && !allowedStatuses.has(selectedStatus)) {
    throw new Error("Draft status filter буруу байна");
  }

  const records = (await store.list()).filter(
    (record) =>
      record.tenantId === project.tenantId &&
      record.projectId === project.projectId &&
      (selectedStatus === null || record.status === selectedStatus),
  );

  return {
    project: publicA1Project(project),
    drafts: records.map(a1DraftSummary),
  };
}

export async function getA1Draft({ projectKey, draftId }) {
  const { project, record } = await scopedA1Draft(projectKey, draftId);
  return {
    project: publicA1Project(project),
    record,
  };
}

export async function editA1Draft({ projectKey, draftId, draft }) {
  const { project, store } = await scopedA1Draft(projectKey, draftId);

  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("Зассан DailyReportDraftV1 JSON шаардлагатай");
  }

  const record = await store.replaceDraft(draftId, draft);
  return {
    project: publicA1Project(project),
    record,
  };
}

export async function approveA1Draft({ projectKey, draftId, reviewer, note }) {
  const { project, store } = await scopedA1Draft(projectKey, draftId);
  const record = await store.approve(
    draftId,
    requireText(reviewer, "Reviewer", 200),
    typeof note === "string" && note.trim() ? note.trim() : null,
  );
  return {
    project: publicA1Project(project),
    record,
  };
}

export async function rejectA1Draft({ projectKey, draftId, reviewer, reason }) {
  const { project, store } = await scopedA1Draft(projectKey, draftId);
  const record = await store.reject(
    draftId,
    requireText(reviewer, "Reviewer", 200),
    requireText(reason, "Татгалзах шалтгаан", 2_000),
  );
  return {
    project: publicA1Project(project),
    record,
  };
}

function normalizedApplyTime(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return `${value}T23:59:59.999Z`;
  }

  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Apply as-of ISO date эсвэл datetime байна");
  }

  return new Date(value).toISOString();
}

export async function applyA1Draft({ projectKey, draftId, applyAsOf }) {
  const { contracts, structuring } = await loadModules();
  const { project, record } = await scopedA1Draft(projectKey, draftId);

  if (record.approvedCommand === null) {
    throw new Error("Draft apply хийхийн өмнө APPROVED болсон байна");
  }

  const command = contracts.approvedDailyReportCommandV1Schema.parse({
    ...record.approvedCommand,
    reviewedAt: normalizedApplyTime(applyAsOf, project.snapshot.asOf),
  });
  const result = structuring.applyApprovedDailyReportToSnapshot(project.snapshot, command);

  if (result.applied) {
    await writeProjectSnapshot(project.filePath, result.snapshot);
  }

  const source = project.source === "BUILT_IN_SIMULATION" ? "LOCAL_WORKING_COPY" : project.source;
  const updatedProject = describeA1Project(result.snapshot, source, project.filePath);

  return {
    applied: result.applied,
    dailyReportId: result.dailyReportId,
    snapshotId: result.snapshot.snapshotId,
    project: publicA1Project(updatedProject),
  };
}

export async function getA1Artifact({ projectKey, draftId, artifactId }) {
  const { record } = await scopedA1Draft(projectKey, draftId);
  const artifact = record.draft.sourceArtifacts.find(
    (candidate) => candidate.artifactId === artifactId && candidate.kind === "SOURCE_IMAGE",
  );

  if (!artifact) {
    throw new Error("A1 source image artifact олдсонгүй");
  }

  const filePath = path.resolve(a1ReviewDirectory, artifact.storageKey);
  const allowedPrefix = `${path.resolve(a1ReviewDirectory)}${path.sep}`;

  if (!filePath.startsWith(allowedPrefix)) {
    throw new Error("A1 artifact path scope зөрүүтэй");
  }

  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error("A1 artifact файл биш байна");
  }

  return {
    filePath,
    mediaType: artifact.mediaType,
    sizeBytes: fileStat.size,
    sha256: artifact.sha256,
  };
}

export const checkSuites = {
  quick: {
    label: "A1–A4 хурдан шалгалт",
    paid: false,
    commands: [
      {
        label: "Runtime health",
        args: ["run", "health"],
        timeoutMs: 60_000,
      },
      {
        label: "A1–A4 targeted regression",
        args: [
          "exec",
          "vitest",
          "run",
          "tests/structuring/daily-report-extract.test.ts",
          "tests/phase2/a2-observer.test.ts",
          "tests/phase2/a3-documents.test.ts",
          "tests/phase2/a4-assistant.test.ts",
        ],
        timeoutMs: 180_000,
      },
    ],
  },
  full: {
    label: "Бүх deterministic шалгалт",
    paid: false,
    commands: [
      {
        label: "Full regression",
        args: ["run", "test"],
        timeoutMs: 600_000,
      },
      {
        label: "Phase 2 smoke",
        args: ["run", "smoke:phase2"],
        timeoutMs: 300_000,
      },
    ],
  },
  phase2: {
    label: "Phase 2 production gate",
    paid: false,
    commands: [
      {
        label: "Technical production gate",
        args: ["run", "phase2:gate"],
        timeoutMs: 180_000,
      },
    ],
  },
  infrastructure: {
    label: "DB ба queue readiness",
    paid: false,
    commands: [
      {
        label: "Infrastructure readiness",
        args: ["run", "health:ready"],
        timeoutMs: 120_000,
      },
    ],
  },
  live: {
    label: "OpenAI live smoke",
    paid: true,
    commands: [
      {
        label: "A1 live case",
        args: [
          "run",
          "eval:a1",
          "--",
          "--limit",
          "1",
          "--output",
          "data/evaluations/console-a1-live.json",
        ],
        timeoutMs: 300_000,
      },
      {
        label: "A2 live case",
        args: [
          "run",
          "eval:a2",
          "--",
          "--live",
          "--cases",
          "a2-atlas-risk-observation",
          "--output",
          "data/evaluations/console-a2-live.json",
        ],
        timeoutMs: 300_000,
      },
      {
        label: "A3 deterministic evaluator",
        args: ["run", "eval:a3", "--", "--output", "data/evaluations/console-a3.json"],
        timeoutMs: 180_000,
      },
      {
        label: "A4 live case",
        args: [
          "run",
          "eval:a4",
          "--",
          "--live",
          "--cases",
          "a4-atlas-work-item-count",
          "--output",
          "data/evaluations/console-a4-live.json",
        ],
        timeoutMs: 300_000,
      },
    ],
  },
};

export async function runCheckCommand(command, onOutput) {
  return await runPnpm(command.args, agentsDirectory, {
    timeoutMs: command.timeoutMs,
    onOutput,
  });
}
