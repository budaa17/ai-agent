import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = path.resolve(consoleRoot, "..", "agents");
const requireFromAgents = createRequire(path.join(agentsRoot, "package.json"));
const puppeteer = requireFromAgents("puppeteer");

const baseUrl = (process.env.BUILDWATCH_AUDIT_URL ?? "http://127.0.0.1:4173").replace(/\/$/u, "");
const preferredProjectCode = process.env.BUILDWATCH_AUDIT_PROJECT_CODE ?? "KHUD-A1";
const outputRoot = path.join(consoleRoot, "data", "role-audit");
const screenshotRoot = path.join(outputRoot, "screenshots");
const tokenStorageKey = "buildwatch.auth.v1";
const captureDashboards = process.env.BUILDWATCH_AUDIT_CAPTURE_DASHBOARDS === "1";

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

const roles = [
  {
    role: "SUPER_ADMIN",
    email: "super.admin@buildwatch.demo",
    password: "BuildWatch-SuperAdmin-2026!",
  },
  {
    role: "COMPANY_ADMIN",
    email: "company.admin@buildwatch.demo",
    password: "BuildWatch-CompanyAdmin-2026!",
  },
  {
    role: "PROJECT_MANAGER",
    email: "project.manager@buildwatch.demo",
    password: "BuildWatch-ProjectManager-2026!",
  },
  {
    role: "ENGINEER",
    email: "engineer@buildwatch.demo",
    password: "BuildWatch-Engineer-2026!",
  },
  {
    role: "SITE_SUPERVISOR",
    email: "site.supervisor@buildwatch.demo",
    password: "BuildWatch-SiteSupervisor-2026!",
  },
  {
    role: "STOREKEEPER",
    email: "storekeeper@buildwatch.demo",
    password: "BuildWatch-Storekeeper-2026!",
  },
  {
    role: "OBSERVER",
    email: "observer@buildwatch.demo",
    password: "BuildWatch-Observer-2026!",
  },
];

const permissionByRole = {
  SUPER_ADMIN: new Set([
    "TENANT_ADMIN",
    "RULES_MANAGE",
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "FORECAST_READ",
    "CHAT_READ",
  ]),
  COMPANY_ADMIN: new Set([
    "TENANT_ADMIN",
    "RULES_MANAGE",
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "FORECAST_READ",
    "CHAT_READ",
  ]),
  PROJECT_MANAGER: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "FORECAST_READ",
    "CHAT_READ",
  ]),
  ENGINEER: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "FORECAST_READ",
    "CHAT_READ",
  ]),
  SITE_SUPERVISOR: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "CHAT_READ",
  ]),
  STOREKEEPER: new Set(["PROJECT_READ", "PLAN_READ", "REPORT_READ", "INVENTORY_READ"]),
  OBSERVER: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "FORECAST_READ",
    "CHAT_READ",
  ]),
};

const projectRoutes = [
  { name: "Нүүр / dashboard", suffix: "", permission: "PROJECT_READ" },
  { name: "Шийдвэрийн inbox", suffix: "inbox", permission: "PROJECT_READ" },
  { name: "A0 зураг төсөл ба төсөв", suffix: "a0", permission: "DESIGN_READ" },
  { name: "Талбайн өнөөдрийн ажил", suffix: "field", permission: "PLAN_READ" },
  { name: "Offline sync queue", suffix: "sync", permission: "REPORT_SUBMIT" },
  { name: "Материал", suffix: "materials", permission: "INVENTORY_READ" },
  { name: "A1 тайлан", suffix: "a1", permission: "REPORT_READ" },
  { name: "A2 эрсдэл ба прогноз", suffix: "a2", permission: "FORECAST_READ" },
  { name: "A3 баримт бичиг", suffix: "a3", permission: "REPORT_READ" },
  { name: "A4 лавлагаа", suffix: "a4", permission: "CHAT_READ" },
  { name: "A5 төслийн явц", suffix: "a5", permission: "PLAN_READ" },
  { name: "Анхааруулга", suffix: "alerts", permission: "PROJECT_READ" },
];

const ignoredConsoleMessages = ["Download the React DevTools", "favicon.ico"];

function unique(values) {
  return [...new Set(values.filter((value) => value !== ""))];
}

function cleanText(value, maxLength = 600) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function sanitizeFileName(value) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9_-]+/gu, "-");
}

function routePath(projectId, suffix) {
  return `/projects/${projectId}${suffix === "" ? "" : `/${suffix}`}`;
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

async function waitForSettledPage(page) {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 12_000 }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function inspectRenderedPage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = globalThis.window.getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rectangle.height > 0;
    };
    const alerts = [
      ...globalThis.document.querySelectorAll('[role="alert"], .state-error, .toast-error'),
    ]
      .filter(visible)
      .map((element) => (element.textContent ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean);
    const main = globalThis.document.querySelector("main.page");
    const headings = [...globalThis.document.querySelectorAll("main.page h1, main.page h2")]
      .map((element) => (element.textContent ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean)
      .slice(0, 4);
    return {
      pathname: globalThis.window.location.pathname,
      title: globalThis.document.title,
      headings,
      alerts,
      mainTextLength: (main?.textContent ?? "").trim().length,
      horizontalOverflow: Math.max(
        0,
        globalThis.document.documentElement.scrollWidth - globalThis.window.innerWidth,
      ),
    };
  });
}

async function fetchWorkspacePlanItem(page, projectId) {
  return page.evaluate(
    async ({ id, storageKey }) => {
      const raw = globalThis.window.sessionStorage.getItem(storageKey);
      if (raw === null) return { planItemId: null, error: "Authentication token missing" };
      const tokens = JSON.parse(raw);
      const response = await fetch(`/api/v1/projects/${id}/workspace`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) return { planItemId: null, error: `Workspace HTTP ${response.status}` };
      const body = await response.json();
      const planItems = body?.operations?.planItems;
      const first = Array.isArray(planItems) ? planItems[0] : undefined;
      return {
        planItemId: typeof first?.id === "string" && first.id.length > 0 ? first.id : null,
        error: null,
      };
    },
    { id: projectId, storageKey: tokenStorageKey },
  );
}

async function auditRoute(page, roleName, descriptor) {
  const eventErrors = [];
  const eventWarnings = [];
  const responseErrors = [];
  const requestFailures = [];

  const onConsole = (message) => {
    const text = cleanText(message.text());
    if (ignoredConsoleMessages.some((fragment) => text.includes(fragment))) return;
    if (message.type() === "error") eventErrors.push(`console: ${text}`);
    if (message.type() === "warning" || message.type() === "warn") {
      eventWarnings.push(`console: ${text}`);
    }
  };
  const onPageError = (error) => eventErrors.push(`runtime: ${cleanText(error.message)}`);
  const onResponse = (response) => {
    const url = response.url();
    if (
      response.status() >= 400 &&
      (url.includes("/api/") || response.request().isNavigationRequest())
    ) {
      responseErrors.push(`HTTP ${response.status()} ${url.replace(baseUrl, "")}`);
    }
  };
  const onRequestFailed = (request) => {
    const url = request.url();
    if (url.includes("/api/") || request.isNavigationRequest()) {
      requestFailures.push(
        `${request.failure()?.errorText ?? "request failed"} ${url.replace(baseUrl, "")}`,
      );
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  let navigationError = null;
  try {
    await page.goto(`${baseUrl}${descriptor.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitForSettledPage(page);
  } catch (error) {
    navigationError = cleanText(error instanceof Error ? error.message : String(error));
  }

  const rendered = await inspectRenderedPage(page).catch((error) => ({
    pathname: new URL(page.url()).pathname,
    title: "",
    headings: [],
    alerts: [],
    mainTextLength: 0,
    horizontalOverflow: 0,
    inspectionError: cleanText(error instanceof Error ? error.message : String(error)),
  }));

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponse);
  page.off("requestfailed", onRequestFailed);

  const errors = [
    ...(navigationError === null ? [] : [`navigation: ${navigationError}`]),
    ...("inspectionError" in rendered ? [`inspection: ${rendered.inspectionError}`] : []),
    ...eventErrors,
    ...responseErrors.map((error) => `api: ${error}`),
    ...requestFailures.map((error) => `network: ${error}`),
    ...rendered.alerts.map((error) => `ui: ${cleanText(error)}`),
  ];
  if (rendered.pathname !== descriptor.path) {
    errors.push(`redirect: expected ${descriptor.path}, opened ${rendered.pathname}`);
  }
  if (rendered.mainTextLength < 8) errors.push("ui: main content is blank");
  if (rendered.horizontalOverflow > 2) {
    errors.push(`layout: horizontal overflow ${rendered.horizontalOverflow}px`);
  }

  const result = {
    name: descriptor.name,
    path: descriptor.path,
    actualPath: rendered.pathname,
    status: errors.length === 0 ? "PASS" : "FAIL",
    headings: rendered.headings,
    errors: unique(errors),
    warnings: unique(eventWarnings),
  };

  if (result.status === "FAIL" || (captureDashboards && descriptor.name === "Нүүр / dashboard")) {
    const fileName = `${sanitizeFileName(roleName)}-${sanitizeFileName(descriptor.name)}.png`;
    await page
      .screenshot({ path: path.join(screenshotRoot, fileName), fullPage: true })
      .then(() => {
        result.screenshot = `data/role-audit/screenshots/${fileName}`;
      })
      .catch(() => undefined);
  }
  return result;
}

async function login(page, account) {
  const errors = [];
  const responses = [];
  const onConsole = (message) => {
    if (message.type() === "error") errors.push(`console: ${cleanText(message.text())}`);
  };
  const onPageError = (error) => errors.push(`runtime: ${cleanText(error.message)}`);
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      responses.push(`HTTP ${response.status()} ${response.url().replace(baseUrl, "")}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
    await page.type('input[type="email"]', account.email);
    await page.type('input[type="password"]', account.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () =>
        globalThis.window.location.pathname === "/projects" ||
        globalThis.document.querySelector('[role="alert"]'),
      { timeout: 30_000 },
    );
    await waitForSettledPage(page);
    const state = await page.evaluate(() => ({
      pathname: globalThis.window.location.pathname,
      alert: globalThis.document
        .querySelector('[role="alert"]')
        ?.textContent?.replace(/\s+/gu, " ")
        .trim(),
      hasTokens: globalThis.window.sessionStorage.getItem("buildwatch.auth.v1") !== null,
    }));
    if (state.pathname !== "/projects") errors.push(`redirected to ${state.pathname}`);
    if (!state.hasTokens) errors.push("authentication tokens were not stored");
    if (state.alert) errors.push(`ui: ${state.alert}`);
  } catch (error) {
    errors.push(cleanText(error instanceof Error ? error.message : String(error)));
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
  return {
    status: errors.length === 0 && responses.length === 0 ? "PASS" : "FAIL",
    errors: unique([...errors, ...responses]),
  };
}

async function selectProject(page) {
  await page.waitForFunction(
    () =>
      globalThis.document.querySelectorAll("a.project-card").length > 0 ||
      globalThis.document.querySelector(".state-error, [role='alert'], .empty-state") !== null,
    { timeout: 30_000 },
  );
  return page.evaluate((projectCode) => {
    const cards = [...globalThis.document.querySelectorAll("a.project-card")].map((card) => ({
      href: card.getAttribute("href") ?? "",
      code: card.querySelector(".project-code")?.textContent?.trim() ?? "",
      name: card.querySelector("h2")?.textContent?.trim() ?? "",
    }));
    const selected =
      cards.find(
        (card) => card.code.toLocaleUpperCase("en-US") === projectCode.toLocaleUpperCase("en-US"),
      ) ?? cards[0];
    if (selected === undefined) return null;
    const projectId = selected.href.split("/")[2] ?? "";
    return { ...selected, projectId };
  }, preferredProjectCode);
}

async function logout(page) {
  await page
    .evaluate(async (storageKey) => {
      const raw = globalThis.window.sessionStorage.getItem(storageKey);
      if (raw === null) return;
      const tokens = JSON.parse(raw);
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => undefined);
      globalThis.window.sessionStorage.removeItem(storageKey);
    }, tokenStorageKey)
    .catch(() => undefined);
}

async function auditRole(browser, account) {
  process.stdout.write(`\n[${account.role}] login\n`);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const roleResult = {
    role: account.role,
    email: account.email,
    login: { status: "FAIL", errors: [] },
    project: null,
    pages: [],
    skipped: [],
  };
  try {
    roleResult.login = await login(page, account);
    if (roleResult.login.status === "FAIL") {
      process.stdout.write(`  login FAIL: ${roleResult.login.errors.join(" | ")}\n`);
      return roleResult;
    }
    process.stdout.write("  login PASS\n");

    roleResult.pages.push(
      await auditRoute(page, account.role, { name: "Төслийн жагсаалт", path: "/projects" }),
    );
    let project = null;
    try {
      project = await selectProject(page);
    } catch (error) {
      roleResult.login.errors.push(
        `Project selection failed: ${cleanText(error instanceof Error ? error.message : String(error))}`,
      );
    }
    if (project === null || project.projectId === "") {
      roleResult.login.status = "FAIL";
      roleResult.login.errors.push("No accessible project card was found");
      return roleResult;
    }
    roleResult.project = project;
    process.stdout.write(`  project ${project.code} (${project.projectId})\n`);

    const permissions = permissionByRole[account.role];
    for (const route of projectRoutes) {
      if (!permissions.has(route.permission)) continue;
      const descriptor = {
        name: route.name,
        path: routePath(project.projectId, route.suffix),
      };
      const result = await auditRoute(page, account.role, descriptor);
      roleResult.pages.push(result);
      process.stdout.write(`  ${result.status.padEnd(4)} ${descriptor.path}\n`);
    }

    if (permissions.has("REPORT_SUBMIT")) {
      const planItem = await fetchWorkspacePlanItem(page, project.projectId);
      if (planItem.planItemId === null) {
        roleResult.skipped.push({
          name: "Өдрийн тайлан оруулах",
          reason: planItem.error ?? "Project workspace has no plan item",
        });
      } else {
        const result = await auditRoute(page, account.role, {
          name: "Өдрийн тайлан оруулах",
          path: `/projects/${project.projectId}/field/${planItem.planItemId}`,
        });
        roleResult.pages.push(result);
        process.stdout.write(`  ${result.status.padEnd(4)} field/${planItem.planItemId}\n`);
      }
    }

    if (permissions.has("TENANT_ADMIN")) {
      for (const descriptor of [
        { name: "Tenant удирдлага", path: "/admin" },
        { name: "Дүрмийн удирдлага", path: "/admin/rules" },
      ]) {
        const result = await auditRoute(page, account.role, descriptor);
        roleResult.pages.push(result);
        process.stdout.write(`  ${result.status.padEnd(4)} ${descriptor.path}\n`);
      }
    }
    return roleResult;
  } finally {
    await logout(page);
    await context.close();
  }
}

function markdownReport(report) {
  const lines = [
    "# BuildWatch role browser audit",
    "",
    `- Огноо: ${report.generatedAt}`,
    `- URL: ${report.baseUrl}`,
    `- Role: ${report.summary.roles}`,
    `- Login FAIL: ${report.summary.loginFailed}`,
    `- Page: ${report.summary.pages}`,
    `- PASS: ${report.summary.passed}`,
    `- FAIL: ${report.summary.failed}`,
    `- Warning: ${report.summary.warnings}`,
    "",
  ];
  for (const role of report.roles) {
    const failed = role.pages.filter((page) => page.status === "FAIL").length;
    lines.push(`## ${role.role}`, "");
    lines.push(`- Login: ${role.login.status}`);
    lines.push(
      `- Project: ${role.project === null ? "—" : `${role.project.code} · ${role.project.name} · ${role.project.projectId}`}`,
    );
    lines.push(`- Pages: ${role.pages.length}, failed: ${failed}`, "");
    if (role.login.errors.length > 0) {
      lines.push("### Login errors", "", ...role.login.errors.map((error) => `- ${error}`), "");
    }
    lines.push("| Page | Path | Status | Error |", "|---|---|---:|---|");
    for (const page of role.pages) {
      const detail = page.errors.length === 0 ? "—" : page.errors.join("; ").replaceAll("|", "\\|");
      lines.push(`| ${page.name} | \`${page.path}\` | ${page.status} | ${detail} |`);
    }
    lines.push("");
    const warnings = role.pages.flatMap((page) =>
      page.warnings.map((warning) => `${page.name}: ${warning}`),
    );
    if (warnings.length > 0) {
      lines.push("### Warnings", "", ...unique(warnings).map((warning) => `- ${warning}`), "");
    }
    if (role.skipped.length > 0) {
      lines.push(
        "### Skipped",
        "",
        ...role.skipped.map((item) => `- ${item.name}: ${item.reason}`),
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

await mkdir(screenshotRoot, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  executablePath: await firstExistingPath(executableCandidates),
  args: ["--disable-dev-shm-usage"],
});

try {
  const roleResults = [];
  for (const account of roles) roleResults.push(await auditRole(browser, account));
  const pages = roleResults.flatMap((role) => role.pages);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl,
    summary: {
      roles: roleResults.length,
      loginFailed: roleResults.filter((role) => role.login.status === "FAIL").length,
      pages: pages.length,
      passed: pages.filter((page) => page.status === "PASS").length,
      failed: pages.filter((page) => page.status === "FAIL").length,
      warnings: pages.reduce((count, page) => count + page.warnings.length, 0),
    },
    roles: roleResults,
  };
  await writeFile(
    path.join(outputRoot, "role-audit-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(path.join(outputRoot, "role-audit-latest.md"), markdownReport(report));
  process.stdout.write(
    `\nRole audit complete: ${report.summary.passed}/${report.summary.pages} PASS, ${report.summary.failed} page FAIL, ${report.summary.loginFailed} login FAIL, ${report.summary.warnings} warnings\n`,
  );
  process.stdout.write(
    "Reports: data/role-audit/role-audit-latest.json | data/role-audit/role-audit-latest.md\n",
  );
} finally {
  await browser.close();
}
