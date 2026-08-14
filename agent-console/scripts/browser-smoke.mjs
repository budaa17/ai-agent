import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { finalizeDailyReportDraft } from "../../agents/dist/structuring/daily-report-finalize.js";
import { FileDailyReportReviewStore } from "../../agents/dist/structuring/daily-report-review.js";
import { createAgentConsoleServer } from "../server.mjs";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDirectory = path.resolve(consoleRoot, "..", "agents");
const requireFromAgents = createRequire(path.join(agentsDirectory, "package.json"));
const puppeteer = requireFromAgents("puppeteer");
const outputDirectory = path.join(consoleRoot, "data", "browser-smoke");
const a1ReviewDirectory = path.join(consoleRoot, "data", "a1-review");
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

async function waitForText(page, selector, predicate, timeout = 30_000) {
  await page.waitForFunction(
    (target, expected) => {
      const text = document.querySelector(target)?.textContent ?? "";
      return expected === "non-empty"
        ? text.trim().length > 0 && text.trim() !== "—"
        : text.includes(expected);
    },
    { timeout },
    selector,
    predicate,
  );
}

async function setValue(page, selector, value) {
  await page.$eval(
    selector,
    (input, nextValue) => {
      input.value = nextValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

function buildA1SmokeDraft(snapshot, requestId) {
  return finalizeDailyReportDraft({
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    requestId,
    sourceText: "2026-07-30-нд SMOKE-001 ажил 30 хувь, нийт 30 м3 гүйцэтгэлтэй.",
    referenceDate: "2026-07-30",
    projectSnapshot: snapshot,
    modelOutput: {
      schemaVersion: 1,
      language: "mn",
      reportDate: "2026-07-30",
      location: {
        block: null,
        stage: null,
        floor: null,
        zone: null,
      },
      progressEntries: [
        {
          workItemCode: "SMOKE-001",
          workItemName: "Суурийн туршилтын ажил",
          candidateCodes: [],
          progressMode: "CUMULATIVE",
          progressPercent: 30,
          quantityDone: "30",
          unit: "м3",
          status: "IN_PROGRESS",
          blocker: null,
          note: null,
          confidence: [
            {
              fieldPath: "workItem.code",
              score: 0.99,
              evidenceQuote: "SMOKE-001",
              sourceImageIndex: null,
              imageRegion: null,
            },
            {
              fieldPath: "progressPercent",
              score: 0.99,
              evidenceQuote: "30 хувь",
              sourceImageIndex: null,
              imageRegion: null,
            },
            {
              fieldPath: "quantityDone",
              score: 0.99,
              evidenceQuote: "30 м3",
              sourceImageIndex: null,
              imageRegion: null,
            },
            {
              fieldPath: "status",
              score: 0.99,
              evidenceQuote: "30 хувь",
              sourceImageIndex: null,
              imageRegion: null,
            },
          ],
        },
      ],
      attendanceEntries: [],
      materialSignals: [],
      photoObservations: [],
      topLevelConfidence: [
        {
          fieldPath: "reportDate",
          score: 0.99,
          evidenceQuote: "2026-07-30",
          sourceImageIndex: null,
          imageRegion: null,
        },
      ],
    },
  });
}

const app = createAgentConsoleServer({
  host: "127.0.0.1",
  port: 0,
});
const address = await app.start();
let browser;
let a1SmokeProjectKey = null;
let a1SmokeDraftId = null;

try {
  await mkdir(outputDirectory, { recursive: true });
  browser = await puppeteer.launch({
    headless: true,
    executablePath: await firstExistingPath(executableCandidates),
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(address.url, { waitUntil: "networkidle0" });
  await waitForText(page, "#demo-project-code", "non-empty");

  await page.click('[data-page="a1"]');
  await page.waitForSelector("#a1-project-select option");
  await page.$eval("#a1-project-select", (select) => {
    const builtIn = [...select.options].find((option) =>
      option.textContent?.startsWith("BW-SIM ·"),
    );

    if (!builtIn) {
      throw new Error("BW-SIM project option was not found");
    }

    select.value = builtIn.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForText(page, "#a1-intake-project", "BW-SIM");
  await page.click("#a1-new-project");
  await page.waitForSelector("#a1-project-setup:not(.hidden)");
  const projectSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tenantId = `tenant-ui-smoke-${projectSuffix}`;
  const projectId = `project-ui-smoke-${projectSuffix}`;
  const projectCode = `UI-SMOKE-${projectSuffix}`;
  a1SmokeProjectKey = `${tenantId}::${projectId}`;
  await setValue(page, "#a1-project-tenant", tenantId);
  await setValue(page, "#a1-project-id", projectId);
  await setValue(page, "#a1-project-code", projectCode);
  await setValue(page, "#a1-project-name", "A1 browser smoke project");
  await setValue(page, "#a1-project-start", "2026-01-01");
  await setValue(page, "#a1-project-end", "2026-12-31");
  await setValue(page, "#a1-project-as-of", "2026-07-30");
  await setValue(page, "#a1-project-budget", "50000000");
  await setValue(
    page,
    "#a1-project-work-items",
    "SMOKE-001 | Суурийн туршилтын ажил | м3 | 100 | 250000",
  );
  await page.click("#a1-project-form button[type='submit']");
  await page.waitForFunction(
    (expectedCode) =>
      document
        .querySelector("#a1-project-select option:checked")
        ?.textContent?.includes(expectedCode) &&
      document.querySelector("#a1-project-setup")?.classList.contains("hidden"),
    { timeout: 30_000 },
    projectCode,
  );
  await waitForText(page, "#a1-intake-project", projectCode);
  await waitForText(page, "#a1-draft-list", "энэ төлөвтэй draft алга");
  const snapshotResponse = await fetch(
    `${address.url}/api/a1/projects/snapshot?projectKey=${encodeURIComponent(a1SmokeProjectKey)}`,
  );

  if (!snapshotResponse.ok) {
    throw new Error(`A1 smoke snapshot failed with HTTP ${snapshotResponse.status}`);
  }

  const snapshot = (await snapshotResponse.json()).snapshot;
  const smokeDraft = buildA1SmokeDraft(snapshot, `browser-smoke-${projectSuffix}`);
  a1SmokeDraftId = smokeDraft.draftId;
  const reviewStore = new FileDailyReportReviewStore(a1ReviewDirectory);
  await reviewStore.saveIntake(smokeDraft, "2026-07-30T12:00:00.000Z");
  await page.click("#a1-refresh-drafts");
  await page.waitForSelector(".a1-draft-row");
  await page.click(".a1-draft-row");
  await page.waitForSelector("#a1-result:not(.hidden)");
  await waitForText(page, "#a1-result-summary", "READY_FOR_REVIEW");

  for (const tab of ["evidence", "questions", "source", "json", "structured"]) {
    await page.$eval(`[data-a1-tab="${tab}"]`, (button) => button.click());
    await page.waitForFunction(
      (expectedTab) =>
        document.querySelector(`[data-a1-tab="${expectedTab}"]`)?.classList.contains("active") &&
        (document.querySelector("#a1-tab-content")?.textContent ?? "").trim().length > 0,
      {},
      tab,
    );
  }

  await page.$eval('[data-a1-tab="edit"]', (button) => button.click());
  await new Promise((resolve) => setTimeout(resolve, 300));
  const editTabReady = await page.evaluate(() => ({
    active: document.querySelector("#a1-tabs button.active")?.dataset.a1Tab ?? null,
    hasEditor: Boolean(document.querySelector("#a1-draft-editor")),
    content: document.querySelector("#a1-tab-content")?.textContent?.trim() ?? "",
  }));

  if (!editTabReady.hasEditor) {
    throw new Error(`A1 edit tab did not render: ${JSON.stringify(editTabReady)}`);
  }
  await page.$eval("#a1-draft-editor", (editor) => {
    const draft = JSON.parse(editor.value);
    draft.progressEntries[0].progressPercent = 31;
    editor.value = JSON.stringify(draft, null, 2);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#a1-save-edit");
  await page.waitForFunction(
    () =>
      (document.querySelector("#a1-result-summary")?.textContent ?? "").includes("Human edits") &&
      !(document.querySelector("#a1-result-summary")?.textContent ?? "").includes("Human edits0"),
    { timeout: 30_000 },
  );
  await page.$eval('[data-a1-tab="structured"]', (button) => button.click());
  await setValue(page, "#a1-review-note", "Browser smoke human review");
  await page.click("#a1-approve");
  await waitForText(page, "#a1-result-summary", "APPROVED");
  await page.$eval("#a1-apply", (button) => button.click());
  await page.waitForFunction(
    () =>
      (document.querySelector("#toast-region .toast:last-child")?.textContent ?? "").includes(
        "snapshot",
      ),
    { timeout: 30_000 },
  );
  const applyToast = await page.$eval(
    "#toast-region .toast:last-child",
    (toast) => toast.textContent ?? "",
  );

  if (!applyToast.includes("apply боллоо")) {
    throw new Error(`A1 browser apply failed: ${applyToast}`);
  }

  const appliedSnapshotResponse = await fetch(
    `${address.url}/api/a1/projects/snapshot?projectKey=${encodeURIComponent(a1SmokeProjectKey)}`,
  );
  const appliedSnapshot = (await appliedSnapshotResponse.json()).snapshot;

  if (
    appliedSnapshot.dailyReports.filter((report) => report.sourceDraftId === a1SmokeDraftId)
      .length !== 1 ||
    appliedSnapshot.progressEntries.at(-1)?.progressPercent !== 31
  ) {
    throw new Error("A1 browser apply did not update the local snapshot");
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll("#toast-region .toast").forEach((toast) => toast.remove());
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const a1DesktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  await page.screenshot({
    path: path.join(outputDirectory, "a1-workbench.png"),
    fullPage: true,
  });

  if (a1DesktopOverflow > 1) {
    const overflowElements = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .map((node) => {
          const rectangle = node.getBoundingClientRect();
          return {
            tag: node.tagName,
            id: node.id,
            className: typeof node.className === "string" ? node.className : "",
            left: Math.round(rectangle.left),
            right: Math.round(rectangle.right),
            width: Math.round(rectangle.width),
            scrollWidth: node.scrollWidth,
          };
        })
        .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
        .sort((left, right) => right.right - left.right)
        .slice(0, 12),
    );
    throw new Error(
      `A1 desktop horizontal overflow: ${a1DesktopOverflow}px; ` + JSON.stringify(overflowElements),
    );
  }

  page.once("dialog", (dialog) => void dialog.accept());
  await page.click("#a1-delete-project");
  await page.waitForFunction(
    (projectKey) =>
      ![...document.querySelector("#a1-project-select").options].some(
        (option) => option.value === projectKey,
      ),
    { timeout: 30_000 },
    a1SmokeProjectKey,
  );
  a1SmokeProjectKey = null;
  await page.$eval("#a1-project-select", (select) => {
    const builtIn = [...select.options].find((option) =>
      option.textContent?.startsWith("BW-SIM ·"),
    );

    if (!builtIn) {
      throw new Error("BW-SIM project option was not found");
    }

    select.value = builtIn.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForText(page, "#a1-intake-project", "BW-SIM");

  await page.click('[data-page="a2"]');
  await page.click("#a2-run");
  await page.waitForSelector("#a2-result:not(.hidden)", {
    timeout: 60_000,
  });

  await page.click('[data-page="a3"]');
  await page.click("#a3-run");
  await page.waitForSelector("#a3-result:not(.hidden)", {
    timeout: 60_000,
  });

  await page.click('[data-page="a4"]');
  await waitForText(page, "#a4-project-context", "BW-SIM simulation");
  await page.type("#a4-question", "Төслийн ерөнхий хураангуйг хэл");
  let a4Requested = false;
  let a4ResponseStatus = null;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/a4/ask")) {
      a4Requested = true;
    }
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/api/a4/ask")) {
      a4ResponseStatus = response.status();
    }
  });
  await page.click("#a4-form button");
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (browserErrors.length > 0) {
    throw new Error(`A4 browser errors: ${browserErrors.join(" | ")}`);
  }

  if (!a4Requested) {
    const debug = await page.evaluate(() => ({
      hash: location.hash,
      value: document.querySelector("#a4-question")?.value,
      messageCount: document.querySelectorAll("#a4-messages .message").length,
      buttonDisabled: document.querySelector("#a4-form button")?.disabled,
      buttonRect: (() => {
        const rect = document.querySelector("#a4-form button")?.getBoundingClientRect();
        return rect
          ? {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }
          : null;
      })(),
      hitElement: (() => {
        const button = document.querySelector("#a4-form button");
        const rect = button?.getBoundingClientRect();
        return rect
          ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML
          : null;
      })(),
    }));
    await page.screenshot({
      path: path.join(outputDirectory, "a4-debug.png"),
      fullPage: true,
    });
    throw new Error(`A4 browser request was not sent: ${JSON.stringify(debug)}`);
  }

  if (a4ResponseStatus !== null && a4ResponseStatus >= 400) {
    throw new Error(`A4 browser request failed with HTTP ${a4ResponseStatus}`);
  }

  await page.waitForFunction(() => document.querySelectorAll("#a4-messages .message").length >= 3, {
    timeout: 60_000,
  });
  await page.type("#a4-question", "tosow heden tugrug baina");
  await page.click("#a4-form button");
  await page.waitForFunction(
    () => {
      const messages = [...document.querySelectorAll("#a4-messages .message.assistant p")];
      return messages.at(-1)?.textContent?.includes("Нийт төлөвлөсөн төсөв");
    },
    { timeout: 60_000 },
  );
  await page.type("#a4-question", "atlas projectiin medeelliig yawuul");
  await page.click("#a4-form button");
  await page.waitForFunction(
    () => {
      const messages = [...document.querySelectorAll("#a4-messages .message.assistant p")];
      const text = messages.at(-1)?.textContent ?? "";
      return text.includes("BW-SIM") && text.includes("ATLAS");
    },
    { timeout: 60_000 },
  );
  await page.screenshot({
    path: path.join(outputDirectory, "a4-chat.png"),
    fullPage: true,
  });

  await page.click('[data-page="overview"]');
  await page.screenshot({
    path: path.join(outputDirectory, "desktop.png"),
    fullPage: true,
  });

  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
  });
  await page.reload({ waitUntil: "networkidle0" });
  await waitForText(page, "#demo-project-code", "non-empty");
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  await page.screenshot({
    path: path.join(outputDirectory, "mobile.png"),
    fullPage: true,
  });

  if (mobileOverflow > 1) {
    throw new Error(`Mobile horizontal overflow: ${mobileOverflow}px`);
  }

  await page.evaluate(() => {
    window.location.hash = "a1";
  });
  await page.waitForSelector('[data-page-panel="a1"].active');
  await page.$eval("#a1-project-select", (select) => {
    const builtIn = [...select.options].find((option) =>
      option.textContent?.startsWith("BW-SIM ·"),
    );

    if (!builtIn) {
      throw new Error("BW-SIM project option was not found");
    }

    select.value = builtIn.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForText(page, "#a1-intake-project", "BW-SIM");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const a1MobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  await page.screenshot({
    path: path.join(outputDirectory, "a1-mobile.png"),
    fullPage: true,
  });

  if (a1MobileOverflow > 1) {
    throw new Error(`A1 mobile horizontal overflow: ${a1MobileOverflow}px`);
  }

  if (browserErrors.length > 0) {
    throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        url: address.url,
        desktop: "data/browser-smoke/desktop.png",
        mobile: "data/browser-smoke/mobile.png",
        a1Workbench: "data/browser-smoke/a1-workbench.png",
        a1Mobile: "data/browser-smoke/a1-mobile.png",
        a4Chat: "data/browser-smoke/a4-chat.png",
        browserErrors: 0,
        mobileOverflow,
        a1MobileOverflow,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (a1SmokeProjectKey !== null) {
    await fetch(`${address.url}/api/a1/projects/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: address.url,
      },
      body: JSON.stringify({
        projectKey: a1SmokeProjectKey,
      }),
    }).catch(() => {});
  }
  if (a1SmokeDraftId !== null) {
    await rm(path.join(a1ReviewDirectory, `${a1SmokeDraftId}.json`), { force: true }).catch(
      () => {},
    );
  }
  await browser?.close();
  await app.stop();
}
