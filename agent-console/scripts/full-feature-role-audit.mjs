import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = path.resolve(consoleRoot, "..", "agents");
const requireFromAgents = createRequire(path.join(agentsRoot, "package.json"));
const puppeteer = requireFromAgents("puppeteer");
const baseUrl = (process.env.BUILDWATCH_AUDIT_URL ?? "http://127.0.0.1:4173").replace(/\/$/u, "");
const outputRoot = path.join(consoleRoot, "data", "full-feature-audit");
const setupPath = path.join(outputRoot, "setup-latest.json");
const liveAiAudit = process.env.BUILDWATCH_AUDIT_LIVE_AI === "true";
const observerUploadProbe = "C:\\Users\\user\\Downloads\\01_material_price_catalog.xlsx";
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
  await new Promise((resolve) => setTimeout(resolve, 250));
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

async function typeValue(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, value);
}

async function login(page, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector('input[type="email"]');
  await typeValue(page, 'input[type="email"]', email);
  await typeValue(page, 'input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () =>
      globalThis.window.location.pathname === "/projects" ||
      globalThis.document.querySelector('[role="alert"]') !== null,
    { timeout: 30_000 },
  );
  await waitForSettled(page);
  const state = await page.evaluate(() => ({
    path: globalThis.window.location.pathname,
    alert: globalThis.document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  }));
  if (state.path !== "/projects") throw new Error(state.alert ?? `Login opened ${state.path}`);
}

async function logout(page) {
  await page.evaluate(() => {
    const button = [...globalThis.document.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes("Гарах"),
    );
    button?.click();
  });
  await page
    .waitForFunction(() => globalThis.window.location.pathname === "/login", { timeout: 15_000 })
    .catch(() => undefined);
}

async function captureAction(page, input, run) {
  const errors = [];
  const warnings = [];
  const responses = [];
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
      responses.push(`HTTP ${response.status()} ${response.url().replace(baseUrl, "")}`);
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
    ...responses.map((error) => `api: ${error}`),
  ]);
  return {
    ...input,
    status: allErrors.length === 0 ? "PASS" : "FAIL",
    errors: allErrors,
    warnings: unique(warnings),
    output,
  };
}

async function inviteAccount(page, projectId, account, report) {
  const action = await captureAction(
    page,
    { role: "COMPANY_ADMIN", feature: "Auth", action: `Invite ${account.role}` },
    async () => {
      await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector('form input[name="email"]');
      await setValue(page, 'input[name="email"]', account.email);
      await setValue(page, 'select[name="role"]', account.role);
      await page.$eval(
        'select[name="projectIds"]',
        (select, selectedProjectId) => {
          for (const option of select.options) option.selected = option.value === selectedProjectId;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        },
        projectId,
      );
      const previousToken = await page
        .$eval(".secret-result code", (code) => code.textContent)
        .catch(() => null);
      await page.click('form button[type="submit"]');
      await page.waitForFunction(
        (previous) => {
          const token = globalThis.document
            .querySelector(".secret-result code")
            ?.textContent?.trim();
          const error = globalThis.document.querySelector(".toast-error")?.textContent?.trim();
          return (token !== undefined && token !== "" && token !== previous) || Boolean(error);
        },
        { timeout: 30_000 },
        previousToken,
      );
      await waitForSettled(page);
      const token = await page.$eval(
        ".secret-result code",
        (code) => code.textContent?.trim() ?? "",
      );
      if (token.length < 32) throw new Error("Invitation token was not rendered");
      return { token };
    },
  );
  report.actions.push(action);
  if (action.status === "FAIL" || action.output === null)
    throw new Error(action.errors.join(" | "));
  account.invitationToken = action.output.token;
}

async function registerAccount(browser, projectCode, account, report) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const alreadyRegistered = await login(page, account.email, account.password)
    .then(() => true)
    .catch(() => false);
  if (alreadyRegistered) {
    const resume = await captureAction(
      page,
      { role: account.role, feature: "Auth", action: "Resume registered account" },
      async () => {
        await page.waitForFunction(
          (code) =>
            [...globalThis.document.querySelectorAll(".project-card .project-code")].some(
              (node) => (node.textContent ?? "").trim() === code,
            ),
          { timeout: 30_000 },
          projectCode,
        );
        return { assigned: true };
      },
    );
    report.actions.push(resume);
    await logout(page);
    await context.close();
    return;
  }
  const register = await captureAction(
    page,
    { role: account.role, feature: "Auth", action: "Accept invitation in UI" },
    async () => {
      await page.goto(`${baseUrl}/register?token=${encodeURIComponent(account.invitationToken)}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForSelector('input[autocomplete="name"]');
      await typeValue(page, 'input[autocomplete="name"]', account.displayName);
      const passwordInputs = await page.$$('input[type="password"]');
      if (passwordInputs.length !== 2) throw new Error("Registration password inputs missing");
      await passwordInputs[0].type(account.password);
      await passwordInputs[1].type(account.password);
      await page.click('button[type="submit"]');
      await page.waitForFunction(
        () =>
          globalThis.window.location.pathname === "/login" ||
          globalThis.document.querySelector('[role="alert"]') !== null,
        { timeout: 30_000 },
      );
      const state = await page.evaluate(() => ({
        path: globalThis.window.location.pathname,
        error: globalThis.document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
      }));
      if (state.path !== "/login") throw new Error(state.error ?? `Register opened ${state.path}`);
      return state;
    },
  );
  report.actions.push(register);
  if (register.status === "PASS") {
    const access = await captureAction(
      page,
      { role: account.role, feature: "Auth", action: "Login and verify project assignment" },
      async () => {
        await login(page, account.email, account.password);
        await page.waitForFunction(
          (code) =>
            [...globalThis.document.querySelectorAll(".project-card .project-code")].some(
              (node) => (node.textContent ?? "").trim() === code,
            ) || globalThis.document.querySelector(".state-error") !== null,
          { timeout: 30_000 },
          projectCode,
        );
        const assigned = await page.evaluate(
          (code) =>
            [...globalThis.document.querySelectorAll(".project-card .project-code")].some(
              (node) => (node.textContent ?? "").trim() === code,
            ),
          projectCode,
        );
        if (!assigned) throw new Error(`Project ${projectCode} is not visible`);
        return { assigned };
      },
    );
    report.actions.push(access);
    await logout(page);
  }
  await context.close();
}

const routeDefinitions = [
  ["Dashboard", "", "PROJECT_READ"],
  ["Inbox", "inbox", "PROJECT_READ"],
  ["A0", "a0", "DESIGN_READ"],
  ["Field", "field", "PLAN_READ"],
  ["Sync", "sync", "REPORT_SUBMIT"],
  ["Materials", "materials", "INVENTORY_READ"],
  ["A1", "a1", "REPORT_READ"],
  ["A2", "a2", "FORECAST_READ"],
  ["A3", "a3", "REPORT_READ"],
  ["A4", "a4", "CHAT_READ"],
  ["A5", "a5", "PLAN_READ"],
  ["Alerts", "alerts", "PROJECT_READ"],
];

const permissionsByRole = {
  SUPER_ADMIN: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "FORECAST_READ",
    "CHAT_READ",
    "AGENT_RUN",
    "TENANT_ADMIN",
  ]),
  COMPANY_ADMIN: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "FORECAST_READ",
    "CHAT_READ",
    "AGENT_RUN",
    "TENANT_ADMIN",
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
    "AGENT_RUN",
  ]),
  ENGINEER: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "FORECAST_READ",
    "CHAT_READ",
    "AGENT_RUN",
  ]),
  SITE_SUPERVISOR: new Set([
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "INVENTORY_READ",
    "CHAT_READ",
    "AGENT_RUN",
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

async function openProjectPage(page, projectId, suffix = "") {
  const expected = `/projects/${projectId}${suffix === "" ? "" : `/${suffix}`}`;
  await page.goto(`${baseUrl}${expected}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForSettled(page);
  return page.evaluate((pathName) => {
    const actualPath = globalThis.window.location.pathname;
    const alerts = [...globalThis.document.querySelectorAll('[role="alert"], .state-error')]
      .map((node) => (node.textContent ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean);
    const main = globalThis.document.querySelector("main.page");
    const overflow = globalThis.document.documentElement.scrollWidth - globalThis.window.innerWidth;
    return {
      expectedPath: pathName,
      actualPath,
      alerts,
      mainTextLength: (main?.textContent ?? "").trim().length,
      mainText: (main?.textContent ?? "").replace(/\s+/gu, " ").trim(),
      overflow,
    };
  }, expected);
}

async function approveInbox(page, account, projectId, maximum, report) {
  const action = await captureAction(
    page,
    { role: account.role, feature: "Review", action: "Approve assigned review chain" },
    async () => {
      const approved = [];
      for (let index = 0; index < maximum; index += 1) {
        await openProjectPage(page, projectId, "inbox");
        const count = await page.$$(".inbox-queue .inbox-row").then((rows) => rows.length);
        if (count === 0) break;
        const detail = await page.waitForSelector(".inbox-detail", { timeout: 20_000 });
        if (detail === null) throw new Error("Inbox detail was not rendered");
        const targetType = await page.$eval(
          ".inbox-detail .eyebrow",
          (node) => node.textContent?.trim() ?? "UNKNOWN",
        );
        await typeValue(page, ".inbox-detail textarea", `E2E ${targetType} шалгаж батлав`);
        const ready = await page.evaluate(() =>
          [...globalThis.document.querySelectorAll(".inbox-detail button")].some(
            (button) => !button.disabled && (button.textContent ?? "").includes("Батлах"),
          ),
        );
        if (!ready) throw new Error(`${targetType} approval is blocked by the client workflow`);
        await page.evaluate(() =>
          globalThis.document.querySelectorAll(".toast").forEach((toast) => toast.remove()),
        );
        await page.evaluate(() => {
          const button = [...globalThis.document.querySelectorAll(".inbox-detail button")].find(
            (candidate) => !candidate.disabled && (candidate.textContent ?? "").includes("Батлах"),
          );
          button?.click();
        });
        await page.waitForFunction(
          () =>
            (globalThis.document.querySelector(".toast:last-child")?.textContent ?? "").trim()
              .length > 0,
          { timeout: 30_000 },
        );
        const toast = await page.$eval(
          ".toast:last-child",
          (node) => node.textContent?.replace(/\s+/gu, " ").trim() ?? "",
        );
        approved.push({ targetType, toast });
        if (/амжилтгүй|алдаа|хориг/u.test(toast.toLocaleLowerCase("mn-MN"))) {
          throw new Error(`${targetType}: ${toast}`);
        }
      }
      return approved;
    },
  );
  report.actions.push(action);
}

async function submitDailyReport(page, account, projectId, report) {
  const action = await captureAction(
    page,
    { role: account.role, feature: "A5", action: "Create photo daily report and sync" },
    async () => {
      await openProjectPage(page, projectId, "a5");
      await page.evaluate(() => {
        const tab = [...globalThis.document.querySelectorAll('[role="tab"]')].find((candidate) =>
          (candidate.textContent ?? "").includes("Оройн тайлан"),
        );
        tab?.click();
      });
      await page.waitForSelector(".wizard-card select");
      await page.$eval(".wizard-card select", (select) => {
        const option = [...select.options].find((candidate) => candidate.value !== "");
        if (option === undefined) throw new Error("No work item is available for daily reporting");
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.evaluate(() => {
        const button = [...globalThis.document.querySelectorAll(".wizard-card button")].find(
          (candidate) => (candidate.textContent ?? "").includes("Дараах"),
        );
        button?.click();
      });
      await page.waitForFunction(() =>
        (globalThis.document.querySelector(".wizard-card h2")?.textContent ?? "").includes(
          "Гүйцэтгэл",
        ),
      );
      const stepTwoInputs = await page.$$(".wizard-card input");
      if (stepTwoInputs.length < 3) throw new Error("Daily report quantity inputs are missing");
      await stepTwoInputs[0].type("1");
      await stepTwoInputs[2].type("5");
      await page.evaluate(() => {
        const button = [...globalThis.document.querySelectorAll(".wizard-card button")].find(
          (candidate) => (candidate.textContent ?? "").includes("Дараах"),
        );
        button?.click();
      });
      await page.waitForSelector('.wizard-card input[type="file"]');
      const photoInput = await page.$('.wizard-card input[type="file"]');
      await photoInput.uploadFile(path.join(outputRoot, "a0-after-processing.png"));
      await page.waitForFunction(() =>
        (globalThis.document.querySelector(".photo-capture span")?.textContent ?? "").includes(
          "1/5",
        ),
      );
      const narrative = await page.$(".wizard-card textarea");
      if (narrative !== null) await narrative.type("E2E client-side өдрийн тайлан");
      await page.evaluate(() => {
        const button = [...globalThis.document.querySelectorAll(".wizard-card button")].find(
          (candidate) => (candidate.textContent ?? "").includes("Дараах"),
        );
        button?.click();
      });
      await page.waitForFunction(() =>
        (globalThis.document.querySelector(".wizard-card h2")?.textContent ?? "").includes("Хянаж"),
      );
      await page.evaluate(() =>
        globalThis.document.querySelectorAll(".toast").forEach((toast) => toast.remove()),
      );
      await page.evaluate(() => {
        const button = [...globalThis.document.querySelectorAll(".wizard-card button")].find(
          (candidate) =>
            !candidate.disabled &&
            ["Илгээх", "Offline queue-д хийх"].some((text) =>
              (candidate.textContent ?? "").includes(text),
            ),
        );
        button?.click();
      });
      await page.waitForFunction(
        () =>
          (globalThis.document.querySelector(".toast:last-child")?.textContent ?? "").trim()
            .length > 0,
        { timeout: 45_000 },
      );
      await waitForSettled(page);
      return page.$$eval(".toast", (nodes) =>
        nodes.map((node) => (node.textContent ?? "").replace(/\s+/gu, " ").trim()),
      );
    },
  );
  report.actions.push(action);
}

async function auditA0Tabs(page) {
  const labels = [
    "Файл ба revision",
    "Зураг ба source",
    "Quantity",
    "Estimate",
    "WBS / dependency",
    "Gantt",
    "Baseline approval",
  ];
  for (const label of labels) {
    await page.evaluate((tabLabel) => {
      const tab = [...globalThis.document.querySelectorAll('[role="tab"]')].find((candidate) =>
        (candidate.textContent ?? "").includes(tabLabel),
      );
      tab?.click();
    }, label);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return labels;
}

async function askA4(page) {
  const before = await page.$$(".chat-message").then((messages) => messages.length);
  await typeValue(
    page,
    ".chat-composer textarea",
    "Энэ төслийн нийт төсөв, тооцоолсон өртөг, хугацааг эх сурвалжтай хэл",
  );
  await page.click('.chat-composer button[type="submit"]');
  await page.waitForFunction(
    (count) =>
      globalThis.document.querySelectorAll(".chat-message").length > count &&
      globalThis.document.querySelector(".chat-message .typing") === null,
    { timeout: 90_000 },
    before,
  );
  return page.$eval(".chat-message:last-child", (message) =>
    (message.textContent ?? "").replace(/\s+/gu, " ").trim(),
  );
}

async function auditRoleFeatures(browser, account, projectId, report) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await login(page, account.email, account.password);
  const permissions = permissionsByRole[account.role];
  const projectsAction = await captureAction(
    page,
    { role: account.role, feature: "Projects", action: "Open project registry" },
    async () => {
      await page.goto(`${baseUrl}/projects`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForSettled(page);
      const visible = await page.evaluate(
        (id) =>
          [...globalThis.document.querySelectorAll("a.project-card")].some((card) =>
            (card.getAttribute("href") ?? "").includes(id),
          ),
        projectId,
      );
      if (!visible) throw new Error("Assigned E2E project is not visible in registry");
      return { visible };
    },
  );
  report.actions.push(projectsAction);
  for (const [name, suffix, permission] of routeDefinitions) {
    if (!permissions.has(permission)) continue;
    const action = await captureAction(
      page,
      { role: account.role, feature: name, action: "Open authorized page" },
      async () => {
        const state = await openProjectPage(page, projectId, suffix);
        if (state.actualPath !== state.expectedPath) {
          throw new Error(`Expected ${state.expectedPath}, opened ${state.actualPath}`);
        }
        if (state.alerts.length > 0) throw new Error(state.alerts.join(" | "));
        if (state.mainTextLength < 8) throw new Error("Main content is blank");
        if (state.overflow > 2) throw new Error(`Horizontal overflow ${state.overflow}px`);
        const missingFeature = [
          ["field", "Өдрийн plan алга", "A5 daily plan was not generated"],
          ["materials", "хараахан бэлэн болоогүй", "Inventory movement entry is not implemented"],
          ["a5", "Өдрийн plan алга", "A5 daily plan was not generated"],
        ].find(([route, marker]) => suffix === route && state.mainText.includes(marker));
        if (missingFeature !== undefined) throw new Error(missingFeature[2]);
        if (suffix === "a1" || suffix === "a3") {
          const actionLabel = suffix === "a1" ? "A1 draft үүсгэх" : "Шинэ тайлан бэлтгэх";
          const actionVisible = await page.evaluate(
            (label) =>
              [...globalThis.document.querySelectorAll("button")].some((button) =>
                (button.textContent ?? "").includes(label),
              ),
            actionLabel,
          );
          if (actionVisible !== permissions.has("AGENT_RUN")) {
            throw new Error(
              `${actionLabel} control visibility does not match AGENT_RUN permission`,
            );
          }
        }
        if (suffix === "a0") return auditA0Tabs(page);
        if (suffix === "a4" && liveAiAudit) return askA4(page);
        return state;
      },
    );
    report.actions.push(action);
  }
  if (permissions.has("TENANT_ADMIN")) {
    for (const [name, route] of [
      ["Admin", "/admin"],
      ["Rules", "/admin/rules"],
    ]) {
      const action = await captureAction(
        page,
        { role: account.role, feature: name, action: "Open tenant page" },
        async () => {
          await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await waitForSettled(page);
          return page.evaluate(() => globalThis.window.location.pathname);
        },
      );
      report.actions.push(action);
    }
  }
  await logout(page);
  await context.close();
}

async function auditRoleSecurity(browser, account, projectId, report) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await login(page, account.email, account.password);
  const permissions = permissionsByRole[account.role];
  for (const [name, suffix, permission] of routeDefinitions) {
    if (permissions.has(permission) || suffix === "") continue;
    const action = await captureAction(
      page,
      { role: account.role, feature: name, action: "Reject unauthorized route" },
      async () => {
        const requested = `/projects/${projectId}/${suffix}`;
        await page.goto(`${baseUrl}${requested}`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await waitForSettled(page);
        const actual = new URL(page.url()).pathname;
        const expected = `/projects/${projectId}`;
        if (actual !== expected) throw new Error(`Unauthorized route opened ${actual}`);
        return { requested, redirectedTo: actual };
      },
    );
    report.actions.push(action);
  }
  if (!permissions.has("TENANT_ADMIN")) {
    for (const route of ["/admin", "/admin/rules"]) {
      const action = await captureAction(
        page,
        { role: account.role, feature: "Tenant admin", action: `Reject ${route}` },
        async () => {
          await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await waitForSettled(page);
          const actual = new URL(page.url()).pathname;
          if (actual !== "/projects") throw new Error(`Unauthorized tenant route opened ${actual}`);
          return { redirectedTo: actual };
        },
      );
      report.actions.push(action);
    }
  }
  if (account.role === "OBSERVER") {
    const uploadVisibility = await captureAction(
      page,
      { role: account.role, feature: "A0", action: "Hide artifact upload from read-only role" },
      async () => {
        await openProjectPage(page, projectId, "a0");
        const input = await page.$('.split-grid input[type="file"]');
        if (input === null) return { visible: false, toast: null };
        await page.evaluate(() =>
          globalThis.document.querySelectorAll(".toast").forEach((toast) => toast.remove()),
        );
        await input.uploadFile(observerUploadProbe);
        await page
          .waitForFunction(
            () =>
              (globalThis.document.querySelector(".toast:last-child")?.textContent ?? "").trim()
                .length > 0,
            { timeout: 15_000 },
          )
          .catch(() => undefined);
        const toast = await page
          .$eval(
            ".toast:last-child",
            (node) => node.textContent?.replace(/\s+/gu, " ").trim() ?? "",
          )
          .catch(() => null);
        return { visible: true, toast };
      },
    );
    if (uploadVisibility.output?.visible === true) {
      uploadVisibility.status = "FAIL";
      uploadVisibility.errors.push("ui: Read-only Observer can see the artifact upload control");
    }
    report.actions.push(uploadVisibility);
  }
  if (!permissions.has("REPORT_SUBMIT") && permissions.has("PLAN_READ")) {
    const submitVisibility = await captureAction(
      page,
      { role: account.role, feature: "A5", action: "Hide report submit from read-only role" },
      async () => {
        await openProjectPage(page, projectId, "a5");
        const visible = await page.evaluate(() =>
          [...globalThis.document.querySelectorAll('[role="tab"]')].some((tab) =>
            (tab.textContent ?? "").includes("Оройн тайлан"),
          ),
        );
        if (visible) throw new Error("Role without REPORT_SUBMIT can open the daily report wizard");
        return { visible };
      },
    );
    report.actions.push(submitVisibility);
  }
  await logout(page);
  await context.close();
}

await mkdir(outputRoot, { recursive: true });
const setup = JSON.parse(await readFile(setupPath, "utf8"));
if (setup.project?.projectId === undefined || setup.project?.code === undefined) {
  throw new Error("setup-latest.json does not contain a project");
}
const suffix = setup.project.code.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-");
const password = "BuildWatch-E2E-Role-2026!";
const generatedAccounts = [
  ["PROJECT_MANAGER", "E2E төслийн менежер"],
  ["ENGINEER", "E2E инженер"],
  ["SITE_SUPERVISOR", "E2E талбайн ахлагч"],
  ["STOREKEEPER", "E2E нярав"],
  ["OBSERVER", "E2E ажиглагч"],
].map(([role, displayName]) => ({
  role,
  displayName,
  email: `${role.toLocaleLowerCase("en-US").replaceAll("_", ".")}.${suffix}@buildwatch.demo`,
  password,
  invitationToken: "",
}));
const previousReport = await readFile(path.join(outputRoot, "roles-latest.json"), "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => null);
const accounts =
  previousReport?.project?.projectId === setup.project.projectId &&
  Array.isArray(previousReport.accounts)
    ? previousReport.accounts
    : generatedAccounts;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl,
  project: setup.project,
  accounts,
  actions: [],
};
const auditMode = process.env.BUILDWATCH_FEATURE_AUDIT_MODE ?? "all";
const browser = await puppeteer.launch({
  headless: true,
  executablePath: await firstExistingPath(executableCandidates),
  args: ["--disable-dev-shm-usage"],
});
try {
  if (["all", "provision"].includes(auditMode)) {
    const adminContext = await browser.createBrowserContext();
    const adminPage = await adminContext.newPage();
    await adminPage.setViewport({ width: 1440, height: 1000 });
    await login(adminPage, "company.admin@buildwatch.demo", "BuildWatch-CompanyAdmin-2026!");
    for (const account of accounts) {
      if (account.invitationToken === "") {
        await inviteAccount(adminPage, setup.project.projectId, account, report);
      }
    }
    await logout(adminPage);
    await adminContext.close();
    for (const account of accounts) {
      await registerAccount(browser, setup.project.code, account, report);
    }
  }
  const byRole = Object.fromEntries(accounts.map((account) => [account.role, account]));
  if (["all", "workflow"].includes(auditMode)) {
    for (const [role, maximum] of [
      ["ENGINEER", 1],
      ["PROJECT_MANAGER", 4],
    ]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      await login(page, byRole[role].email, byRole[role].password);
      await approveInbox(page, byRole[role], setup.project.projectId, maximum, report);
      await logout(page);
      await context.close();
    }
    {
      const account = byRole.SITE_SUPERVISOR;
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      await login(page, account.email, account.password);
      await submitDailyReport(page, account, setup.project.projectId, report);
      await logout(page);
      await context.close();
    }
    {
      const account = byRole.PROJECT_MANAGER;
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      await login(page, account.email, account.password);
      await approveInbox(page, account, setup.project.projectId, 2, report);
      await logout(page);
      await context.close();
    }
  }
  const auditAccounts = [
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
    ...accounts,
  ];
  if (["all", "pages"].includes(auditMode)) {
    for (const account of auditAccounts) {
      try {
        await auditRoleFeatures(browser, account, setup.project.projectId, report);
      } catch (error) {
        report.actions.push({
          role: account.role,
          feature: "Role audit",
          action: "Login or audit session",
          status: "FAIL",
          errors: [cleanText(error instanceof Error ? error.message : String(error))],
          warnings: [],
          output: null,
        });
      }
    }
  }
  if (["all", "security"].includes(auditMode)) {
    const roleFilter = new Set(
      (process.env.BUILDWATCH_AUDIT_ROLES ?? "")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
    );
    for (const account of auditAccounts.filter(
      (candidate) => roleFilter.size === 0 || roleFilter.has(candidate.role),
    )) {
      try {
        await auditRoleSecurity(browser, account, setup.project.projectId, report);
      } catch (error) {
        report.actions.push({
          role: account.role,
          feature: "Security audit",
          action: "Login or audit session",
          status: "FAIL",
          errors: [cleanText(error instanceof Error ? error.message : String(error))],
          warnings: [],
          output: null,
        });
      }
    }
  }
} finally {
  await browser.close();
  report.generatedAt = new Date().toISOString();
  if (["all", "provision"].includes(auditMode)) {
    await writeFile(
      path.join(outputRoot, "roles-latest.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  await writeFile(
    path.join(outputRoot, `features-${auditMode}-latest.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

for (const action of report.actions) {
  process.stdout.write(
    `${action.status.padEnd(4)} ${action.role} · ${action.feature} · ${action.action}\n`,
  );
  for (const error of action.errors) process.stdout.write(`     ${error}\n`);
}
process.stdout.write(`Report: data/full-feature-audit/features-${auditMode}-latest.json\n`);
