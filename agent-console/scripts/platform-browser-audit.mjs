import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Read-only browser audit for the Platform Super Admin Control Tower.
 *
 * It deliberately never invokes incident, support-access, or billing mutations.
 * Usage:
 *   BUILDWATCH_PLATFORM_EMAIL=... BUILDWATCH_PLATFORM_PASSWORD=... \
 *     node scripts/platform-browser-audit.mjs [baseUrl]
 */

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = path.resolve(consoleRoot, "..", "agents");
const requireFromAgents = createRequire(path.join(agentsRoot, "package.json"));
const puppeteer = requireFromAgents("puppeteer");

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const email = process.env.BUILDWATCH_PLATFORM_EMAIL;
const password = process.env.BUILDWATCH_PLATFORM_PASSWORD;
const outputDirectory = path.join(consoleRoot, "data", "platform-browser-audit");
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

if (!email || !password) {
  throw new Error("BUILDWATCH_PLATFORM_EMAIL and BUILDWATCH_PLATFORM_PASSWORD are required");
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  principal: null,
  permissions: [],
  checks: [],
  routes: [],
  api: [],
  monitoring: null,
  finishedAt: null,
};

function check(area, name, passed, detail) {
  report.checks.push({ area, name, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  [${area}] ${name} — ${detail}\n`);
}

function safeApiSummary(body) {
  if (!body || typeof body !== "object") return null;
  const summary = {};
  for (const key of ["schemaVersion", "generatedAt", "asOf", "partial", "state"]) {
    if (key in body) summary[key] = body[key];
  }
  if (Array.isArray(body.data)) summary.dataLength = body.data.length;
  if (Array.isArray(body.items)) summary.itemsLength = body.items.length;
  if (Array.isArray(body.components)) summary.components = body.components.length;
  if (Array.isArray(body.problems)) {
    summary.problems = body.problems.map((problem) => problem?.code ?? "UNKNOWN").slice(0, 10);
  }
  if (body.platformStatus?.state) summary.platformStatus = body.platformStatus.state;
  return summary;
}

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: await firstExistingPath(executableCandidates),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  await mkdir(outputDirectory, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const apiTraffic = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ at: Date.now(), message: message.text().slice(0, 500) });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push({ at: Date.now(), message: String(error.message).slice(0, 500) });
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      at: Date.now(),
      method: request.method(),
      url: request.url(),
      detail: request.failure()?.errorText ?? "request failed",
    });
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/platform/v1/")) return;
    let body = null;
    try {
      body = await response.json();
    } catch {}
    apiTraffic.push({
      at: Date.now(),
      method: response.request().method(),
      status: response.status(),
      path: new URL(url).pathname + new URL(url).search,
      summary: safeApiSummary(body),
      body,
    });
  });

  // Platform login happens through the real React form, not an API shortcut.
  await page.goto(`${baseUrl}/platform/login`, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await page.click('form button[type="submit"]');
  await page.waitForFunction(() => location.pathname === "/platform", { timeout: 30_000 });
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 30_000 }).catch(() => undefined);

  const loginState = await page.evaluate(() => ({
    pathname: location.pathname,
    hasPlatformTokens: sessionStorage.getItem("buildwatch.platform.auth.v1") !== null,
    hasTenantTokens: sessionStorage.getItem("buildwatch.auth.v1") !== null,
    body: document.body.innerText,
  }));
  check(
    "Auth",
    "Platform login",
    loginState.pathname === "/platform" && loginState.hasPlatformTokens,
    loginState.pathname,
  );
  check(
    "Auth",
    "Platform/Tenant token isolation",
    loginState.hasPlatformTokens && !loginState.hasTenantTokens,
    `platform=${loginState.hasPlatformTokens}, tenant=${loginState.hasTenantTokens}`,
  );

  const authenticatedGet = async (apiPath) =>
    page.evaluate(async (pathName) => {
      const raw = sessionStorage.getItem("buildwatch.platform.auth.v1");
      if (!raw) return { status: 0, body: null };
      const tokens = JSON.parse(raw);
      const response = await fetch(pathName, {
        headers: { authorization: `${tokens.tokenType} ${tokens.accessToken}` },
      });
      let body = null;
      try {
        body = await response.json();
      } catch {}
      return { status: response.status, body };
    }, apiPath);

  const session = await authenticatedGet("/api/platform/v1/session");
  report.principal = session.body?.principal ?? null;
  report.permissions = session.body?.permissions ?? [];
  check(
    "Auth",
    "Session contract",
    session.status === 200 && session.body?.principal?.role === "PLATFORM_SUPER_ADMIN",
    `${session.status} ${session.body?.principal?.email ?? "principal алга"} ${session.body?.principal?.role ?? ""}`,
  );

  // Platform bearer must not open the tenant workspace API.
  const tenantBoundary = await authenticatedGet("/api/v1/projects");
  check(
    "Security",
    "Platform bearer tenant API-д орохгүй",
    tenantBoundary.status === 403,
    `HTTP ${tenantBoundary.status}`,
  );

  // An unauthenticated browser context must not open platform data.
  const anonymous = await browser.createBrowserContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(`${baseUrl}/platform/login`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const anonymousStatus = await anonymousPage.evaluate(async () => {
    const response = await fetch("/api/platform/v1/session");
    return response.status;
  });
  await anonymous.close();
  check(
    "Security",
    "Anonymous platform session denied",
    anonymousStatus === 401,
    `HTTP ${anonymousStatus}`,
  );

  // Legacy demo links still point at `/login`. The SUPER_ADMIN tenant identity
  // must be re-authenticated against the separate platform realm and land in
  // Control Tower without leaving a tenant token behind.
  const unified = await browser.createBrowserContext();
  const unifiedPage = await unified.newPage();
  await unifiedPage.goto(`${baseUrl}/login`, { waitUntil: "networkidle0", timeout: 30_000 });
  await unifiedPage.type('input[type="email"]', email);
  await unifiedPage.type('input[type="password"]', password);
  await unifiedPage.click('form button[type="submit"]');
  await unifiedPage.waitForFunction(() => location.pathname === "/platform", { timeout: 30_000 });
  const unifiedState = await unifiedPage.evaluate(() => ({
    pathname: location.pathname,
    hasPlatformTokens: sessionStorage.getItem("buildwatch.platform.auth.v1") !== null,
    hasTenantTokens: sessionStorage.getItem("buildwatch.auth.v1") !== null,
  }));
  await unified.close();
  check(
    "Auth",
    "Ердийн login Super Admin-ийг Control Tower руу оруулна",
    unifiedState.pathname === "/platform" &&
      unifiedState.hasPlatformTokens &&
      !unifiedState.hasTenantTokens,
    `${unifiedState.pathname}; platform=${unifiedState.hasPlatformTokens}, tenant=${unifiedState.hasTenantTokens}`,
  );

  const discovered = {
    tenantId: null,
    agentType: null,
    runId: null,
    incidentId: null,
    grantId: null,
  };

  async function visit(name, route, screenshotName) {
    const started = Date.now();
    let documentStatus = 0;
    try {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: "networkidle0",
        timeout: 30_000,
      });
      documentStatus = response?.status() ?? 0;
    } catch (error) {
      pageErrors.push({ at: started, message: String(error.message).slice(0, 500) });
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    const snapshot = await page.evaluate(() => ({
      pathname: location.pathname,
      title: document.title,
      heading: document.querySelector("main h1, main h2")?.textContent?.trim() ?? null,
      mainText: document.querySelector("main")?.innerText?.trim() ?? "",
      alerts: [...document.querySelectorAll('[role="alert"]')]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean),
      navItems: document.querySelectorAll("nav a").length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    }));
    const routeConsole = consoleErrors.filter((entry) => entry.at >= started);
    const routePageErrors = pageErrors.filter((entry) => entry.at >= started);
    const routeFailed = failedRequests.filter((entry) => entry.at >= started);
    const routeApi = apiTraffic.filter((entry) => entry.at >= started);
    const apiFailures = routeApi.filter((entry) => entry.status >= 400);
    const passed =
      documentStatus === 200 &&
      snapshot.pathname !== "/platform/login" &&
      snapshot.mainText.length > 20 &&
      snapshot.alerts.length === 0 &&
      routeConsole.length === 0 &&
      routePageErrors.length === 0 &&
      routeFailed.length === 0 &&
      apiFailures.length === 0;
    const result = {
      name,
      route,
      passed,
      documentStatus,
      ...snapshot,
      consoleErrors: routeConsole,
      pageErrors: routePageErrors,
      failedRequests: routeFailed,
      api: routeApi.map(({ body: _body, ...entry }) => entry),
    };
    report.routes.push(result);
    check(
      "Route",
      name,
      passed,
      `${snapshot.heading ?? "heading алга"}; API ${routeApi.map((item) => item.status).join(",") || "дуудлагагүй"}`,
    );
    await page.screenshot({
      path: path.join(outputDirectory, `${screenshotName}.png`),
      fullPage: true,
    });

    for (const entry of routeApi) {
      const pathName = entry.path.split("?")[0];
      if (pathName === "/api/platform/v1/tenants" && entry.body?.items?.[0]?.tenantId) {
        discovered.tenantId = entry.body.items[0].tenantId;
      }
      if (pathName === "/api/platform/v1/agents" && entry.body?.items?.[0]?.agentType) {
        discovered.agentType = entry.body.items[0].agentType;
      }
      if (pathName === "/api/platform/v1/agent-runs" && entry.body?.items?.[0]?.runId) {
        discovered.runId = entry.body.items[0].runId;
      }
      if (pathName === "/api/platform/v1/incidents" && entry.body?.items?.[0]?.incidentId) {
        discovered.incidentId = entry.body.items[0].incidentId;
      }
      if (pathName === "/api/platform/v1/support-access" && entry.body?.items?.[0]?.grantId) {
        discovered.grantId = entry.body.items[0].grantId;
      }
    }
  }

  await visit("Control Tower", "/platform", "01-control-tower");
  await visit("Компаниуд", "/platform/tenants", "02-tenants");
  if (discovered.tenantId) {
    await visit(
      "Tenant health detail",
      `/platform/tenants/${encodeURIComponent(discovered.tenantId)}/health`,
      "03-tenant-detail",
    );
  }
  await visit("Агентууд", "/platform/agents", "04-agents");
  if (discovered.agentType) {
    await visit(
      "Agent detail",
      `/platform/agents/${encodeURIComponent(discovered.agentType)}`,
      "05-agent-detail",
    );
  }
  await visit("Agent run-ууд", "/platform/agent-runs?window=30d", "06-agent-runs");
  if (discovered.runId) {
    await visit(
      "Run diagnostics",
      `/platform/agent-runs/${encodeURIComponent(discovered.runId)}/diagnostics`,
      "07-run-diagnostics",
    );
  }
  await visit("Инцидент", "/platform/incidents", "08-incidents");
  if (discovered.incidentId) {
    await visit(
      "Incident detail",
      `/platform/incidents/${encodeURIComponent(discovered.incidentId)}`,
      "09-incident-detail",
    );
  }
  await visit("Review summary", "/platform/review-quality", "10-review-summary");
  await visit("Review backlog", "/platform/review-quality?view=backlog", "11-review-backlog");
  await visit("AI чанар", "/platform/quality", "12-quality");
  await visit("Төлбөр", "/platform/billing", "13-billing");
  await visit("Ашиглалт ба зардал", "/platform/usage", "14-usage");
  await visit("Системийн төлөв", "/platform/system-health", "15-system-health");
  await visit("Дэмжлэгийн хандалт", "/platform/support-access", "16-support-access");
  if (discovered.grantId) {
    await visit(
      "Support access detail",
      `/platform/support-access/${encodeURIComponent(discovered.grantId)}`,
      "17-support-access-detail",
    );
  }
  await visit("Audit log", "/platform/audit", "18-audit");
  await visit("Компанийн role audit", "/platform/audit?source=TENANT", "19-tenant-audit");

  // Client route separation: platform auth alone must not unlock tenant UI.
  await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle0", timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const tenantUiPath = new URL(page.url()).pathname;
  check(
    "Security",
    "Platform session tenant UI-г нээхгүй",
    tenantUiPath !== "/projects" && tenantUiPath.startsWith("/platform"),
    tenantUiPath,
  );

  const overviewTraffic = apiTraffic
    .filter((entry) => entry.path.startsWith("/api/platform/v1/overview"))
    .at(-1);
  const systemTraffic = apiTraffic
    .filter((entry) => entry.path.startsWith("/api/platform/v1/system-health"))
    .at(-1);
  const agentRunTraffic = apiTraffic
    .filter((entry) => entry.path.startsWith("/api/platform/v1/agent-runs"))
    .find((entry) => Array.isArray(entry.body?.items));
  const tenantAuditTraffic = apiTraffic
    .filter((entry) => entry.path.includes("/api/platform/v1/audit-logs?"))
    .filter((entry) => entry.path.includes("source=TENANT"))
    .at(-1);
  const overview = overviewTraffic?.body;
  const system = systemTraffic?.body;
  report.monitoring = {
    overview: safeApiSummary(overview),
    platformStatus: overview?.platformStatus ?? null,
    kpis: overview?.kpis ?? null,
    attention: overview?.attention
      ? { state: overview.attention.context?.state, total: overview.attention.total }
      : null,
    tenantPreviewCount: overview?.tenantHealthPreview?.items?.length ?? null,
    agentPreviewCount: overview?.agentHealthPreview?.items?.length ?? null,
    recentAuditCount: overview?.recentAudit?.items?.length ?? null,
    agentRuns: agentRunTraffic?.body?.items?.length ?? null,
    tenantAuditRoles:
      tenantAuditTraffic?.body?.items?.map((item) => item.actorRole).filter(Boolean) ?? [],
    systemState: system?.state ?? null,
    components:
      system?.components?.map((component) => ({
        component: component.component,
        state: component.state,
        required: component.required,
        freshness: component.freshness?.state,
        checkedAt: component.freshness?.checkedAt,
      })) ?? [],
  };

  const generatedAt = Date.parse(overview?.generatedAt ?? "");
  const ageSeconds = Number.isFinite(generatedAt)
    ? Math.floor((Date.now() - generatedAt) / 1000)
    : null;
  check(
    "Monitoring",
    "Overview бодит timestamp-тэй",
    ageSeconds !== null && ageSeconds >= 0 && ageSeconds < 300,
    ageSeconds === null ? "generatedAt алга" : `${ageSeconds}s өмнө`,
  );
  check(
    "Monitoring",
    "System component probe-ууд",
    Array.isArray(system?.components) && system.components.length >= 5,
    (system?.components ?? [])
      .map((component) => `${component.component}:${component.state}`)
      .join(", ") || "component алга",
  );
  check(
    "Monitoring",
    "Tenant aggregate",
    typeof overview?.kpis?.tenantHealth?.total === "number",
    `tenant total=${overview?.kpis?.tenantHealth?.total ?? "UNKNOWN"}`,
  );
  check(
    "Monitoring",
    "Audit feed",
    Array.isArray(overview?.recentAudit?.items),
    `recent=${overview?.recentAudit?.items?.length ?? "UNKNOWN"}`,
  );
  check(
    "Monitoring",
    "AI agent run tenant scope-той",
    Array.isArray(agentRunTraffic?.body?.items) &&
      agentRunTraffic.body.items.length > 0 &&
      agentRunTraffic.body.items.every((item) => item.tenantId && item.runId),
    `runs=${agentRunTraffic?.body?.items?.length ?? "UNKNOWN"}`,
  );
  check(
    "Monitoring",
    "Компанийн role audit тусдаа шүүгдэнэ",
    Array.isArray(tenantAuditTraffic?.body?.items) &&
      tenantAuditTraffic.body.items.length > 0 &&
      tenantAuditTraffic.body.items.every(
        (item) => item.tenantId !== null && !String(item.actorRole ?? "").startsWith("PLATFORM_"),
      ),
    `roles=${
      [
        ...new Set(
          tenantAuditTraffic?.body?.items?.map((item) => item.actorRole).filter(Boolean) ?? [],
        ),
      ].join(",") || "байхгүй"
    }`,
  );

  report.api = apiTraffic.map(({ body: _body, ...entry }) => entry);
  report.finishedAt = new Date().toISOString();
  const failedChecks = report.checks.filter((item) => !item.passed);
  report.summary = {
    passed: report.checks.length - failedChecks.length,
    failed: failedChecks.length,
    routePassed: report.routes.filter((item) => item.passed).length,
    routeTotal: report.routes.length,
  };
  await writeFile(path.join(outputDirectory, "latest.json"), JSON.stringify(report, null, 2));
  process.stdout.write(
    `\nRESULT ${report.summary.passed} passed, ${report.summary.failed} failed; routes ${report.summary.routePassed}/${report.summary.routeTotal}\n`,
  );
  if (failedChecks.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
