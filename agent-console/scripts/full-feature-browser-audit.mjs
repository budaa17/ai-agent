import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = path.resolve(consoleRoot, "..", "agents");
const requireFromAgents = createRequire(path.join(agentsRoot, "package.json"));
const puppeteer = requireFromAgents("puppeteer");
const baseUrl = (process.env.BUILDWATCH_AUDIT_URL ?? "http://127.0.0.1:4173").replace(/\/$/u, "");
const outputRoot = path.join(consoleRoot, "data", "full-feature-audit");
const inputFiles = [
  {
    path: "C:\\Users\\user\\Downloads\\Two-storey-Single-Country-House-AutoCAD-Plan.dwg",
    expectedRole: "DRAWING_REFERENCE",
  },
  {
    path: "C:\\Users\\user\\Downloads\\01_material_price_catalog.xlsx",
    expectedRole: "MATERIAL_PRICE_CATALOG",
  },
  {
    path: "C:\\Users\\user\\Downloads\\02_material_norms.xlsx",
    expectedRole: "MATERIAL_NORMS",
  },
  {
    path: "C:\\Users\\user\\Downloads\\03_boq_work_items.xlsx",
    expectedRole: "BOQ_WORK_ITEMS",
  },
  {
    path: "C:\\Users\\user\\Downloads\\04_wbs_dependencies.xlsx",
    expectedRole: "WBS_DEPENDENCIES",
  },
];
const executableCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  path.join(
    process.env.USERPROFILE ?? "",
    ".cache",
    "puppeteer",
    "chrome",
    "win64-151.0.7922.47",
    "chrome-win64",
    "chrome.exe",
  ),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

function cleanText(value, maxLength = 800) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function waitForSettled(page) {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function setValue(page, selector, value) {
  await page.$eval(
    selector,
    (element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

async function clickButton(page, text) {
  await page.waitForFunction(
    (label) =>
      [...globalThis.document.querySelectorAll("button")].some(
        (button) =>
          !button.disabled && (button.textContent ?? "").replace(/\s+/gu, " ").includes(label),
      ),
    { timeout: 30_000 },
    text,
  );
  await page.evaluate((label) => {
    const button = [...globalThis.document.querySelectorAll("button")].find(
      (candidate) =>
        !candidate.disabled && (candidate.textContent ?? "").replace(/\s+/gu, " ").includes(label),
    );
    if (button === undefined) throw new Error(`Button not found: ${label}`);
    button.click();
  }, text);
}

async function login(page, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () =>
      globalThis.window.location.pathname === "/projects" ||
      globalThis.document.querySelector('[role="alert"]') !== null,
    { timeout: 30_000 },
  );
  await waitForSettled(page);
  const result = await page.evaluate(() => ({
    path: globalThis.window.location.pathname,
    alert: globalThis.document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  }));
  if (result.path !== "/projects") throw new Error(result.alert ?? `Login opened ${result.path}`);
}

async function captureAction(page, input, run) {
  const errors = [];
  const warnings = [];
  const failedResponses = [];
  const onConsole = (message) => {
    const text = cleanText(message.text());
    if (text.includes("Download the React DevTools")) return;
    if (message.type() === "error") errors.push(`console: ${text}`);
    if (message.type() === "warn" || message.type() === "warning")
      warnings.push(`console: ${text}`);
  };
  const onPageError = (error) => errors.push(`runtime: ${cleanText(error.message)}`);
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      failedResponses.push(`HTTP ${response.status()} ${response.url().replace(baseUrl, "")}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  let output = null;
  let thrown = null;
  try {
    output = await run();
  } catch (error) {
    thrown = cleanText(error instanceof Error ? error.message : String(error));
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
  const allErrors = unique([
    ...(thrown === null ? [] : [`action: ${thrown}`]),
    ...errors,
    ...failedResponses.map((error) => `api: ${error}`),
  ]);
  return {
    ...input,
    status: allErrors.length === 0 ? "PASS" : "FAIL",
    errors: allErrors,
    warnings: unique(warnings),
    output,
  };
}

async function createProject(page, report) {
  const suffix = new Date().toISOString().replace(/\D/gu, "").slice(2, 14);
  const code = `E2E-HOUSE-${suffix}`;
  const action = await captureAction(
    page,
    { role: "COMPANY_ADMIN", feature: "Project", action: "UI create project" },
    async () => {
      await clickButton(page, "Шинэ төсөл");
      await page.waitForSelector('form input[name="code"]');
      await setValue(page, 'input[name="code"]', code);
      await setValue(page, 'input[name="name"]', "Хоёр давхар амины орон сууц E2E");
      await setValue(page, 'input[name="location"]', "Улаанбаатар");
      await setValue(page, 'input[name="budgetMnt"]', "750000000");
      await setValue(page, 'input[name="plannedStart"]', "2026-08-10");
      await setValue(page, 'input[name="plannedEnd"]', "2027-08-10");
      await setValue(
        page,
        'textarea[name="description"]',
        "DWG зураг болон BOQ, материалын норм, үнэ, WBS dependency ашигласан full-feature E2E төсөл",
      );
      await page.click('form button[type="submit"]');
      await page.waitForFunction(
        () => /^\/projects\/[^/]+\/a0$/u.test(globalThis.window.location.pathname),
        { timeout: 30_000 },
      );
      await waitForSettled(page);
      const projectId = await page.evaluate(
        () => globalThis.window.location.pathname.split("/")[2] ?? "",
      );
      return { projectId, code };
    },
  );
  report.actions.push(action);
  if (action.status === "FAIL" || action.output === null) {
    throw new Error(`Project creation failed: ${action.errors.join(" | ")}`);
  }
  report.project = action.output;
}

async function uploadFile(page, file, report) {
  const fileName = path.basename(file.path);
  const action = await captureAction(
    page,
    { role: "COMPANY_ADMIN", feature: "A0", action: `Upload ${fileName}` },
    async () => {
      const input = await page.$('.split-grid input[type="file"]');
      if (input === null) throw new Error("A0 upload input not found");
      await page.evaluate(() =>
        globalThis.document.querySelectorAll(".toast").forEach((toast) => toast.remove()),
      );
      const before = await page.$$eval(".a0-artifact-row", (rows) => rows.length);
      await input.uploadFile(file.path);
      await page.waitForFunction(
        (name, previousCount) => {
          const rows = [...globalThis.document.querySelectorAll(".a0-artifact-row")];
          const uploaded = rows.some((row) => (row.textContent ?? "").includes(name));
          const toast = globalThis.document.querySelector(".toast:last-child")?.textContent ?? "";
          return uploaded || rows.length > previousCount || toast.trim().length > 0;
        },
        { timeout: 30_000 },
        fileName,
        before,
      );
      await waitForSettled(page);
      return page.evaluate((name) => {
        const row = [...globalThis.document.querySelectorAll(".a0-artifact-row")].find(
          (candidate) => (candidate.textContent ?? "").includes(name),
        );
        const toast =
          globalThis.document.querySelector(".toast:last-child")?.textContent?.trim() ?? null;
        return { uploaded: row !== undefined, toast };
      }, fileName);
    },
  );
  if (action.output?.uploaded !== true && action.errors.length === 0) {
    action.status = "FAIL";
    action.errors.push(`ui: file was not added; ${action.output?.toast ?? "no toast"}`);
  }
  report.actions.push(action);
}

async function assignArtifactRoles(page, report) {
  const action = await captureAction(
    page,
    { role: "COMPANY_ADMIN", feature: "A0", action: "Assign artifact roles" },
    async () =>
      page.evaluate((files) => {
        const assignments = [];
        for (const file of files) {
          const name = file.path.split("\\").pop();
          const row = [...globalThis.document.querySelectorAll(".a0-artifact-row")].find(
            (candidate) => (candidate.textContent ?? "").includes(name),
          );
          if (row === undefined) {
            assignments.push({ name, expected: file.expectedRole, actual: null });
            continue;
          }
          const select = row.querySelector("select");
          if (select === null) throw new Error(`Role select missing for ${name}`);
          select.value = file.expectedRole;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          assignments.push({ name, expected: file.expectedRole, actual: select.value });
        }
        return assignments;
      }, inputFiles),
  );
  report.actions.push(action);
}

async function processA0(page, report) {
  const action = await captureAction(
    page,
    { role: "COMPANY_ADMIN", feature: "A0", action: "Process intake package" },
    async () => {
      await page.evaluate(() =>
        globalThis.document.querySelectorAll(".toast").forEach((toast) => toast.remove()),
      );
      await page.waitForFunction(
        () =>
          [...globalThis.document.querySelectorAll("button")].some(
            (button) =>
              !button.disabled &&
              (button.textContent ?? "").includes("A0 багцыг боловсруулж review draft үүсгэх"),
          ),
        { timeout: 30_000 },
      );
      await clickButton(page, "A0 багцыг боловсруулж review draft үүсгэх");
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector(".a0-result-summary") !== null ||
          (globalThis.document.querySelector(".toast-error")?.textContent ?? "").trim().length > 0,
        { timeout: 120_000 },
      );
      await waitForSettled(page);
      return page.evaluate(() => ({
        result:
          globalThis.document
            .querySelector(".a0-result-summary")
            ?.textContent?.replace(/\s+/gu, " ")
            .trim() ?? null,
        error:
          globalThis.document
            .querySelector(".toast-error")
            ?.textContent?.replace(/\s+/gu, " ")
            .trim() ?? null,
      }));
    },
  );
  if (action.output?.result === null && action.errors.length === 0) {
    action.status = "FAIL";
    action.errors.push(`ui: ${action.output?.error ?? "A0 result was not rendered"}`);
  }
  report.actions.push(action);
}

for (const file of inputFiles) await access(file.path);
await mkdir(outputRoot, { recursive: true });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl,
  project: null,
  inputFiles,
  actions: [],
};
const browser = await puppeteer.launch({
  headless: true,
  executablePath: await firstExistingPath(executableCandidates),
  args: ["--disable-dev-shm-usage"],
});
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await login(page, "company.admin@buildwatch.demo", "BuildWatch-CompanyAdmin-2026!");
  await createProject(page, report);
  for (const file of inputFiles) await uploadFile(page, file, report);
  await assignArtifactRoles(page, report);
  await processA0(page, report);
  await page.screenshot({ path: path.join(outputRoot, "a0-after-processing.png"), fullPage: true });
  await context.close();
} finally {
  await browser.close();
  report.generatedAt = new Date().toISOString();
  await writeFile(
    path.join(outputRoot, "setup-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

for (const action of report.actions) {
  process.stdout.write(
    `${action.status.padEnd(4)} ${action.role} · ${action.feature} · ${action.action}\n`,
  );
  for (const error of action.errors) process.stdout.write(`     ${error}\n`);
}
process.stdout.write(
  `Project: ${report.project?.code ?? "—"} · ${report.project?.projectId ?? "—"}\n`,
);
process.stdout.write("Report: data/full-feature-audit/setup-latest.json\n");
