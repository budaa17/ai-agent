const pageMetadata = {
  overview: {
    eyebrow: "AGENT WORKSPACE",
    title: "Ерөнхий хяналт",
  },
  a1: {
    eyebrow: "A1 · REGISTRATION",
    title: "Бүртгэлийн агент",
  },
  a2: {
    eyebrow: "A2 · OBSERVER",
    title: "Ажиглагч агент",
  },
  a3: {
    eyebrow: "A3 · DOCUMENTS",
    title: "Баримт бичгийн агент",
  },
  a4: {
    eyebrow: "A4 · REFERENCE",
    title: "Лавлагааны туслах",
  },
  checks: {
    eyebrow: "EVALUATION CENTER",
    title: "Нэгдсэн шалгалт",
  },
};

const state = {
  status: null,
  demo: null,
  a1Images: [],
  a1Projects: [],
  a1ProjectKey: null,
  a1Drafts: [],
  a1Record: null,
  a1Tab: "structured",
  activeJobId: null,
  jobTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);

  if (options.className) {
    node.className = options.className;
  }

  if (options.text !== undefined) {
    node.textContent = String(options.text);
  }

  if (options.title) {
    node.title = options.title;
  }

  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    node.setAttribute(name, String(value));
  }

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) {
      node.append(child);
    }
  }

  return node;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function formatNumber(value) {
  return new Intl.NumberFormat("mn-MN").format(Number(value ?? 0));
}

function formatBytes(value) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function showToast(message, type = "info") {
  const toast = element("div", {
    className: `toast ${type === "error" ? "error" : ""}`,
    text: message,
  });
  $("#toast-region").append(toast);
  setTimeout(() => toast.remove(), 5_000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    method: options.method ?? "GET",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({
    error: `HTTP ${response.status}`,
  }));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

async function withBusy(button, label, operation) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;

  try {
    return await operation();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function showPage(page, updateHash = true) {
  const selected = pageMetadata[page] ? page : "overview";

  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === selected);
  });
  $$("[data-page-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.pagePanel === selected);
  });
  $("#page-eyebrow").textContent = pageMetadata[selected].eyebrow;
  $("#page-title").textContent = pageMetadata[selected].title;
  $(".sidebar").classList.remove("open");

  if (updateHash) {
    history.replaceState(null, "", `#${selected}`);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function statusValue(label, value, stateClass = "") {
  return element("div", { className: "system-item" }, [
    element("strong", { text: label }),
    element("span", {
      className: `system-value ${stateClass}`,
      text: value,
    }),
  ]);
}

function renderSystemStatus(status) {
  const list = $("#system-list");
  const configuration = status.configuration;
  const runtime = status.runtime;
  list.replaceChildren(
    statusValue(
      "Agent core",
      status.agents.buildReady ? "Build бэлэн" : "Build дутуу",
      status.agents.buildReady ? "" : "error",
    ),
    statusValue(
      "OpenAI key",
      configuration.openAIKeyConfigured ? "Тохируулсан" : "Тохируулаагүй",
      configuration.openAIKeyConfigured ? "" : "error",
    ),
    statusValue(
      "Runtime pricing",
      configuration.inputPricingConfigured && configuration.outputPricingConfigured
        ? "Тохируулсан"
        : "0 / дутуу",
      configuration.inputPricingConfigured && configuration.outputPricingConfigured
        ? ""
        : "warning",
    ),
    statusValue(
      "Node.js",
      `${runtime.nodeVersion} · ${runtime.expectedNode}`,
      runtime.nodeRecommended ? "" : "warning",
    ),
    statusValue(
      "Database config",
      configuration.databaseConfigured ? "DATABASE_URL байна" : "Дутуу",
      configuration.databaseConfigured ? "" : "warning",
    ),
  );

  const global = $("#global-status");
  const light = $(".status-light", global);
  light.className = `status-light ${configuration.openAIKeyConfigured ? "ok" : "warning"}`;
  $("span:last-child", global).textContent =
    status.activeCheckJobId === null ? "Console бэлэн" : "Шалгалт ажиллаж байна";
}

function renderDemo(demo) {
  $("#demo-project-name").textContent = demo.projectName;
  $("#demo-project-code").textContent = demo.projectCode;
  $("#a4-project-context").textContent = `${demo.projectCode} simulation`;
  $("#a4-context-message").textContent =
    `Идэвхтэй source нь ${demo.projectName} (${demo.projectCode}) ` +
    "simulation snapshot. Би ашигласан tool болон эх сурвалжаа хамт харуулна.";
  const values = [
    [demo.counts.workItems, "Ажил"],
    [demo.counts.progressEntries, "Явц"],
    [demo.counts.dailyReports, "Тайлан"],
    [demo.counts.alerts, "Alert"],
  ];
  const metrics = $("#demo-metrics");
  metrics.replaceChildren(
    ...values.map(([value, label]) =>
      element("div", {}, [
        element("strong", { text: formatNumber(value) }),
        element("span", { text: label }),
      ]),
    ),
  );

  for (const select of [$("#a2-date"), $("#a3-date")]) {
    select.replaceChildren(
      ...demo.weekEndDates
        .slice()
        .reverse()
        .map((date) =>
          element("option", {
            text: date,
            attributes: { value: date },
          }),
        ),
    );
  }
}

async function loadStatus() {
  const global = $("#global-status");
  $(".status-light", global).className = "status-light loading";
  $("span:last-child", global).textContent = "Шалгаж байна";

  try {
    state.status = await api("/api/status");
    renderSystemStatus(state.status);
  } catch (error) {
    $(".status-light", global).className = "status-light warning";
    $("span:last-child", global).textContent = "Status алдаа";
    showToast(error.message, "error");
  }
}

async function loadDemo() {
  try {
    state.demo = await api("/api/demo");
    renderDemo(state.demo);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function summaryCard(label, value) {
  return element("div", { className: "summary-card" }, [
    element("span", { text: label }),
    element("strong", { text: value ?? "—" }),
  ]);
}

function resultSection(title, content, status) {
  const headerChildren = [element("h3", { text: title })];

  if (status) {
    headerChildren.push(
      element("span", {
        className: `status-tag ${status.className}`,
        text: status.label,
      }),
    );
  }

  return element("section", { className: "result-section" }, [
    element("div", { className: "result-section-header" }, headerChildren),
    content,
  ]);
}

function jsonView(value) {
  return element("pre", {
    className: "json-view",
    text: pretty(value),
  });
}

function a1StatusClass(status) {
  if (status === "APPROVED" || status === "READY_FOR_REVIEW") {
    return "pass";
  }

  if (status === "REJECTED") {
    return "fail";
  }

  return "warning";
}

function a1ConfidenceClass(level) {
  return level === "HIGH" ? "pass" : level === "MEDIUM" ? "warning" : "fail";
}

function selectedA1Project() {
  return state.a1Projects.find((project) => project.projectKey === state.a1ProjectKey);
}

function projectSourceLabel(source) {
  return (
    {
      BUILT_IN_SIMULATION: "Built-in simulation",
      LOCAL_WORKING_COPY: "Local applied snapshot",
      LOCAL_PROJECT_BUILDER: "Local project builder",
      IMPORTED_SNAPSHOT: "Imported strict snapshot",
    }[source] ?? source
  );
}

function renderA1Project(project) {
  const meta = $("#a1-project-meta");

  if (!project) {
    meta.textContent = "Project сонгоогүй";
    $("#a1-intake-project").textContent = "Project сонгоно уу";
    $("#a1-delete-project").classList.add("hidden");
    return;
  }

  meta.replaceChildren(
    element("div", {}, [
      element("span", { text: "PROJECT" }),
      element("strong", {
        text: `${project.projectCode} · ${project.projectName}`,
      }),
    ]),
    element("div", {}, [
      element("span", { text: "SOURCE" }),
      element("strong", { text: projectSourceLabel(project.source) }),
    ]),
    element("div", {}, [
      element("span", { text: "CATALOG" }),
      element("strong", {
        text: `${project.counts.workItems} ажил · ${project.counts.materials} материал`,
      }),
    ]),
    element("div", {}, [
      element("span", { text: "AS-OF" }),
      element("strong", { text: project.asOf.slice(0, 10) }),
    ]),
  );
  $("#a1-intake-project").textContent =
    `Authoritative scope: ${project.tenantId} / ${project.projectCode} ` +
    `(${project.counts.workItems} work item)`;
  $("#a1-delete-project").classList.toggle("hidden", !project.canDelete);
  $("#a1-date").value = project.asOf.slice(0, 10);
  $("#a1-apply-date").value = project.asOf.slice(0, 10);
}

function renderA1ProjectOptions(preferredKey) {
  const select = $("#a1-project-select");
  const nextKey =
    preferredKey && state.a1Projects.some((project) => project.projectKey === preferredKey)
      ? preferredKey
      : state.a1ProjectKey &&
          state.a1Projects.some((project) => project.projectKey === state.a1ProjectKey)
        ? state.a1ProjectKey
        : (state.a1Projects[0]?.projectKey ?? null);
  state.a1ProjectKey = nextKey;
  select.replaceChildren(
    ...state.a1Projects.map((project) =>
      element("option", {
        text: `${project.projectCode} · ${project.projectName}`,
        attributes: { value: project.projectKey },
      }),
    ),
  );

  if (nextKey !== null) {
    select.value = nextKey;
  }

  renderA1Project(selectedA1Project());
}

async function loadA1Projects(preferredKey) {
  try {
    const response = await api("/api/a1/projects");
    state.a1Projects = response.projects ?? [];
    renderA1ProjectOptions(preferredKey);
    await loadA1Drafts();
  } catch (error) {
    $("#a1-project-meta").textContent = "Project registry ачаалсангүй";
    showToast(error.message, "error");
  }
}

function a1ProjectQuery(projectKey = state.a1ProjectKey) {
  return encodeURIComponent(projectKey ?? "");
}

function renderA1DraftList() {
  const list = $("#a1-draft-list");

  if (state.a1Drafts.length === 0) {
    list.className = "a1-draft-list empty";
    list.textContent = "Сонгосон project-д энэ төлөвтэй draft алга.";
    return;
  }

  list.className = "a1-draft-list";
  list.replaceChildren(
    ...state.a1Drafts.map((draft) => {
      const button = element(
        "button",
        {
          className: `a1-draft-row ${state.a1Record?.draftId === draft.draftId ? "active" : ""}`,
          attributes: { type: "button" },
        },
        [
          element("div", { className: "draft-main" }, [
            element("strong", {
              text: draft.reportDate ?? "Огноо тодорхойгүй",
            }),
            element("span", { text: draft.draftId }),
          ]),
          element("div", { className: "draft-metrics" }, [
            element("span", {
              className: `status-tag ${a1StatusClass(draft.status)}`,
              text: draft.status,
            }),
            element("span", {
              text: `${Math.round(draft.confidence * 100)}%`,
            }),
            element("span", {
              text: `${draft.validationErrors} error`,
            }),
            element("span", {
              text: `${draft.requiredClarifications} question`,
            }),
            element("span", {
              text: `${draft.imageCount} photo`,
            }),
          ]),
        ],
      );
      button.addEventListener("click", () => openA1Draft(draft.draftId));
      return button;
    }),
  );
}

async function loadA1Drafts() {
  if (!state.a1ProjectKey) {
    state.a1Drafts = [];
    renderA1DraftList();
    return;
  }

  try {
    const response = await api(
      `/api/a1/drafts?projectKey=${a1ProjectQuery()}&status=${encodeURIComponent(
        $("#a1-draft-filter").value,
      )}`,
    );
    state.a1Drafts = response.drafts ?? [];
    renderA1DraftList();
  } catch (error) {
    $("#a1-draft-list").textContent = "Draft жагсаалт ачаалсангүй";
    showToast(error.message, "error");
  }
}

function parseA1WorkItems(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const columns = line.split("|").map((column) => column.trim());

      if (columns.length < 5 || columns.slice(0, 5).some((item) => !item)) {
        throw new Error(`${index + 1}-р мөр CODE | Нэр | Нэгж | Тоо | Нэгж өртөг форматтай байна`);
      }

      return {
        code: columns[0],
        name: columns[1],
        unit: columns[2],
        plannedQuantity: columns[3],
        unitCostMnt: columns[4],
      };
    });
}

async function submitA1Project(event) {
  event.preventDefault();
  const button = $("#a1-project-form button[type='submit']");

  await withBusy(button, "Project үүсгэж байна…", async () => {
    try {
      const response = await api("/api/a1/projects/create", {
        method: "POST",
        body: {
          replace: $("#a1-project-replace").checked,
          project: {
            tenantId: $("#a1-project-tenant").value,
            projectId: $("#a1-project-id").value,
            projectCode: $("#a1-project-code").value,
            projectName: $("#a1-project-name").value,
            plannedStart: $("#a1-project-start").value,
            plannedEnd: $("#a1-project-end").value,
            asOfDate: $("#a1-project-as-of").value,
            budgetMnt: $("#a1-project-budget").value,
            workItems: parseA1WorkItems($("#a1-project-work-items").value),
          },
        },
      });
      $("#a1-project-setup").classList.add("hidden");
      await loadA1Projects(response.project.projectKey);
      showToast("Шинэ A1 project context бэлэн боллоо.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

async function importA1Snapshot(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  try {
    const snapshot = JSON.parse(await file.text());
    const response = await api("/api/a1/projects/import", {
      method: "POST",
      body: {
        snapshot,
        replace: $("#a1-project-replace").checked,
      },
    });
    await loadA1Projects(response.project.projectKey);
    showToast("Strict project snapshot импортлогдлоо.");
  } catch (error) {
    showToast(`Snapshot import: ${error.message}`, "error");
  }
}

async function exportA1Snapshot() {
  const project = selectedA1Project();

  if (!project) {
    showToast("Export хийх project сонгоно уу.", "error");
    return;
  }

  try {
    const response = await api(`/api/a1/projects/snapshot?projectKey=${a1ProjectQuery()}`);
    const blob = new Blob([`${JSON.stringify(response.snapshot, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = element("a", {
      attributes: {
        href: url,
        download: `${project.projectCode.toLowerCase()}-snapshot.json`,
      },
    });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteSelectedA1Project() {
  const project = selectedA1Project();

  if (!project?.canDelete) {
    return;
  }

  if (
    !window.confirm(
      `${project.projectCode} local project context-ийг устгах уу? Draft review records устахгүй.`,
    )
  ) {
    return;
  }

  try {
    await api("/api/a1/projects/delete", {
      method: "POST",
      body: { projectKey: project.projectKey },
    });
    state.a1Record = null;
    $("#a1-result").classList.add("hidden");
    $("#a1-empty").classList.remove("hidden");
    await loadA1Projects();
    showToast("Local project context устлаа.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function a1Value(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : value.join(", ");
  }

  if (typeof value === "object") {
    return pretty(value);
  }

  return String(value);
}

function a1Fact(label, value) {
  return element("div", { className: "a1-fact" }, [
    element("span", { text: label }),
    element("strong", { text: a1Value(value) }),
  ]);
}

function a1DataCard(title, facts, footer) {
  const card = element("article", { className: "a1-data-card" }, [
    element("h4", { text: title }),
    element(
      "div",
      { className: "a1-fact-grid" },
      facts.map(([label, value]) => a1Fact(label, value)),
    ),
  ]);

  if (footer) {
    card.append(footer);
  }

  return card;
}

function a1EmptyContent(message) {
  return element("div", { className: "a1-inline-empty", text: message });
}

function a1ValidationCards(draft) {
  if (draft.validationIssues.length === 0) {
    return a1EmptyContent("Deterministic validation issue илрээгүй.");
  }

  return element(
    "div",
    { className: "a1-issue-list" },
    draft.validationIssues.map((issue) =>
      element(
        "article",
        {
          className: `a1-issue ${issue.severity.toLowerCase()}`,
        },
        [
          element("div", { className: "issue-heading" }, [
            element("strong", { text: issue.code }),
            element("span", { text: issue.severity }),
          ]),
          element("p", { text: issue.message }),
          element("small", {
            text: `${issue.fieldPaths.join(", ")} · ${
              issue.deterministic ? "deterministic" : "model"
            }`,
          }),
        ],
      ),
    ),
  );
}

function renderA1StructuredTab(record) {
  const draft = record.draft;
  const sections = [];
  sections.push(
    resultSection(
      "Тайлангийн үндсэн мэдээлэл",
      element("div", { className: "a1-fact-grid wide" }, [
        a1Fact("Report date", draft.reportDate),
        a1Fact("Language", draft.language),
        a1Fact("Block", draft.location.block),
        a1Fact("Stage", draft.location.stage),
        a1Fact("Floor", draft.location.floor),
        a1Fact("Zone", draft.location.zone),
      ]),
    ),
  );

  const progressCards = draft.progressEntries.map((entry) =>
    a1DataCard(
      entry.workItem.code ?? entry.workItem.name ?? "Тодорхойгүй ажил",
      [
        ["Name", entry.workItem.name],
        ["Candidate", entry.workItem.candidateCodes],
        ["Mode", entry.progressMode],
        ["Progress", entry.progressPercent === null ? null : `${entry.progressPercent}%`],
        ["Quantity", entry.quantityDone],
        ["Unit", entry.unit],
        ["Status", entry.status],
        ["Note", entry.note],
      ],
      entry.blocker
        ? element("div", { className: "a1-blocker" }, [
            element("strong", {
              text: `Саад · ${entry.blocker.category}`,
            }),
            element("p", { text: entry.blocker.description }),
          ])
        : null,
    ),
  );
  sections.push(
    resultSection(
      `Явц ба саад · ${progressCards.length}`,
      progressCards.length
        ? element("div", { className: "a1-card-grid" }, progressCards)
        : a1EmptyContent("Явцын мэдээлэл ялгагдаагүй."),
    ),
  );

  const attendanceCards = draft.attendanceEntries.map((entry) =>
    a1DataCard(entry.teamName ?? entry.teamRef ?? "Ажиллах хүч", [
      ["Team type", entry.teamType],
      ["Headcount", entry.headcount],
      ["Hours/person", entry.hoursPerPerson],
      ["Total hours", entry.totalHours],
      ["Work items", entry.workItemCodes],
    ]),
  );
  sections.push(
    resultSection(
      `Ирц ба хүн-цаг · ${attendanceCards.length}`,
      attendanceCards.length
        ? element("div", { className: "a1-card-grid" }, attendanceCards)
        : a1EmptyContent("Ирцийн мэдээлэл ялгагдаагүй."),
    ),
  );

  const materialCards = draft.materialSignals.map((signal) =>
    a1DataCard(signal.normalizedName ?? signal.rawName, [
      ["Signal", signal.signalType],
      ["Raw name", signal.rawName],
      ["Material ref", signal.materialRef],
      ["Quantity", signal.quantity],
      ["Unit", signal.unit],
      ["Supplier", signal.supplierName],
      ["Work items", signal.workItemCodes],
      ["Note", signal.note],
    ]),
  );
  sections.push(
    resultSection(
      `Материалын дохио · ${materialCards.length}`,
      materialCards.length
        ? element("div", { className: "a1-card-grid" }, materialCards)
        : a1EmptyContent("Материалын мэдээлэл ялгагдаагүй."),
    ),
  );

  const photoCards = draft.photoObservations.map((observation) =>
    a1DataCard(observation.kind, [
      ["Statement", observation.statement],
      ["Review question", observation.reviewQuestion],
      ["Candidates", observation.workItemCandidateCodes],
      ["Confidence", `${Math.round(observation.confidence * 100)}%`],
      ["Advisory only", observation.advisoryOnly],
    ]),
  );
  sections.push(
    resultSection(
      `Зургийн observation · ${photoCards.length}`,
      photoCards.length
        ? element("div", { className: "a1-card-grid" }, photoCards)
        : a1EmptyContent("Зургийн observation байхгүй."),
      {
        className: "warning",
        label: "ADVISORY ONLY",
      },
    ),
  );
  sections.push(
    resultSection("Логик ба schema validation", a1ValidationCards(draft), {
      className: draft.validationIssues.some((issue) => issue.severity === "ERROR")
        ? "fail"
        : "pass",
      label: draft.validationIssues.some((issue) => issue.severity === "ERROR")
        ? "CORRECTION"
        : "VALID",
    }),
  );
  return element("div", { className: "result-stack" }, sections);
}

function collectA1Confidence(draft) {
  const all = [
    ...draft.fieldConfidence,
    ...draft.progressEntries.flatMap((entry) => entry.fieldConfidence),
    ...draft.attendanceEntries.flatMap((entry) => entry.fieldConfidence),
    ...draft.materialSignals.flatMap((entry) => entry.fieldConfidence),
  ];
  const unique = new Map();

  for (const confidence of all) {
    const key = `${confidence.fieldPath}:${confidence.score}:${JSON.stringify(
      confidence.evidence,
    )}`;
    unique.set(key, confidence);
  }

  return [...unique.values()].sort((left, right) => left.score - right.score);
}

function renderA1EvidenceTab(record) {
  const items = collectA1Confidence(record.draft);

  if (items.length === 0) {
    return a1EmptyContent("Field confidence evidence байхгүй.");
  }

  return element(
    "div",
    { className: "a1-evidence-list" },
    items.map((confidence) =>
      element("article", { className: "a1-evidence-card" }, [
        element("div", { className: "evidence-heading" }, [
          element("strong", { text: confidence.fieldPath }),
          element("span", {
            className: `status-tag ${a1ConfidenceClass(confidence.level)}`,
            text: `${Math.round(confidence.score * 100)}% · ${confidence.level}`,
          }),
        ]),
        element("progress", {
          className: "confidence-track",
          attributes: {
            max: "100",
            value: String(Math.round(confidence.score * 100)),
            "aria-label": `${confidence.fieldPath} confidence`,
          },
        }),
        element(
          "div",
          { className: "evidence-items" },
          confidence.evidence.length
            ? confidence.evidence.map((evidence) =>
                element("div", {}, [
                  element("b", {
                    text: `${evidence.sourceType} · ${evidence.sourceId}`,
                  }),
                  element("p", {
                    text:
                      evidence.quote ?? evidence.imageRegion?.description ?? "Visible image region",
                  }),
                  element("small", {
                    text:
                      evidence.fieldPath ??
                      (evidence.imageRegion
                        ? `region x=${evidence.imageRegion.x}, y=${evidence.imageRegion.y}, w=${evidence.imageRegion.width}, h=${evidence.imageRegion.height}`
                        : "field path байхгүй"),
                  }),
                ]),
              )
            : [element("div", { text: "Evidence хавсаргаагүй" })],
        ),
      ]),
    ),
  );
}

function setDraftPath(root, fieldPath, value) {
  const normalized = fieldPath.replace(/^dailyReport\./u, "");
  const keys = normalized.split(".");
  let target = root;

  for (const key of keys.slice(0, -1)) {
    const property = Number.isInteger(Number(key)) ? Number(key) : key;

    if (target?.[property] === undefined) {
      throw new Error(`Field path олдсонгүй: ${fieldPath}`);
    }
    target = target[property];
  }

  const last = keys.at(-1);
  const property = Number.isInteger(Number(last)) ? Number(last) : last;
  const current = target?.[property];
  let parsed = value;

  if (typeof current === "number") {
    parsed = Number(value);
  } else if (typeof current === "boolean") {
    parsed = String(value).toLowerCase() === "true";
  } else if (value === "null") {
    parsed = null;
  }

  target[property] = parsed;
}

function recalculateA1DraftStatus(draft) {
  const blocking = draft.validationIssues.some((issue) => issue.severity === "ERROR");
  const required = draft.clarificationQuestions.some((question) => question.requiredForApproval);
  draft.status =
    blocking || required || draft.confidenceLevel === "LOW"
      ? "NEEDS_CORRECTION"
      : "READY_FOR_REVIEW";
}

async function resolveA1Clarification(question, option) {
  if (!state.a1Record) {
    return;
  }

  try {
    const draft = structuredClone(state.a1Record.draft);

    if (question.fieldPath === "duplicateCandidates") {
      if (
        !["false", "none", "not_duplicate", "not-duplicate"].includes(
          String(option.value).toLowerCase(),
        )
      ) {
        throw new Error("Duplicate candidate-ийг JSON editor дээр шалгаж засна уу");
      }
      draft.duplicateCandidates = [];
    } else {
      setDraftPath(draft, question.fieldPath, option.value);
    }

    draft.clarificationQuestions = draft.clarificationQuestions.filter(
      (candidate) => candidate.questionId !== question.questionId,
    );
    recalculateA1DraftStatus(draft);
    const response = await api("/api/a1/drafts/edit", {
      method: "POST",
      body: {
        projectKey: state.a1ProjectKey,
        draftId: state.a1Record.draftId,
        draft,
      },
    });
    renderA1Record(response.record, response.project);
    await loadA1Drafts();
    showToast("Candidate сонголт draft-д хадгалагдлаа.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderA1QuestionsTab(record) {
  const draft = record.draft;
  const content = [];

  if (draft.clarificationQuestions.length > 0) {
    content.push(
      resultSection(
        `Тодруулах асуулт · ${draft.clarificationQuestions.length}`,
        element(
          "div",
          { className: "a1-question-list" },
          draft.clarificationQuestions.map((question) => {
            const card = element(
              "article",
              {
                className: `a1-question ${question.requiredForApproval ? "required" : ""}`,
              },
              [
                element("div", { className: "question-heading" }, [
                  element("strong", { text: question.question }),
                  element("span", {
                    className: `status-tag ${question.requiredForApproval ? "fail" : "warning"}`,
                    text: question.requiredForApproval ? "APPROVAL BLOCKER" : "REVIEW",
                  }),
                ]),
                element("p", {
                  text: `${question.reason} · ${question.fieldPath}`,
                }),
              ],
            );
            const options = element("div", {
              className: "candidate-options",
            });

            if (question.options.length > 0) {
              for (const option of question.options) {
                const button = element("button", {
                  className: "button secondary",
                  text: option.label,
                  attributes: { type: "button" },
                });
                button.addEventListener("click", () => resolveA1Clarification(question, option));
                options.append(button);
              }
            } else {
              const button = element("button", {
                className: "button secondary",
                text: "JSON editor дээр засах →",
                attributes: { type: "button" },
              });
              button.addEventListener("click", () => {
                state.a1Tab = "edit";
                renderA1Tabs();
              });
              options.append(button);
            }
            card.append(options);
            return card;
          }),
        ),
      ),
    );
  } else {
    content.push(
      resultSection("Тодруулах асуулт", a1EmptyContent("Required clarification үлдээгүй."), {
        className: "pass",
        label: "CLEAR",
      }),
    );
  }

  content.push(
    resultSection(
      `Duplicate warning · ${draft.duplicateCandidates.length}`,
      draft.duplicateCandidates.length
        ? element(
            "div",
            { className: "a1-duplicate-list" },
            draft.duplicateCandidates.map((candidate) =>
              a1DataCard(candidate.candidateReportId, [
                ["Similarity", `${Math.round(candidate.similarity * 100)}%`],
                ["Reasons", candidate.reasons],
              ]),
            ),
          )
        : a1EmptyContent("Duplicate candidate илрээгүй."),
      {
        className: draft.duplicateCandidates.length ? "warning" : "pass",
        label: draft.duplicateCandidates.length ? "CHECK" : "CLEAR",
      },
    ),
  );
  content.push(resultSection("Validation issue", a1ValidationCards(draft)));
  return element("div", { className: "result-stack" }, content);
}

function renderA1SourceTab(record) {
  const draft = record.draft;
  const images = draft.sourceArtifacts.filter((artifact) => artifact.kind === "SOURCE_IMAGE");
  const sections = [
    resultSection(
      "Эх текст",
      draft.rawText
        ? element("pre", {
            className: "source-text",
            text: draft.rawText,
          })
        : a1EmptyContent("Энэ intake-д эх текст байгаагүй."),
    ),
  ];

  sections.push(
    resultSection(
      `Normalized эх зураг · ${images.length}`,
      images.length
        ? element(
            "div",
            { className: "a1-source-gallery" },
            images.map((artifact) =>
              element("figure", {}, [
                element("img", {
                  attributes: {
                    src:
                      `/api/a1/artifact?projectKey=${a1ProjectQuery()}&` +
                      `draftId=${encodeURIComponent(record.draftId)}&` +
                      `artifactId=${encodeURIComponent(artifact.artifactId)}`,
                    alt: `A1 source ${artifact.artifactId}`,
                    loading: "lazy",
                  },
                }),
                element("figcaption", {
                  text: `${artifact.mediaType} · ${formatBytes(
                    artifact.sizeBytes,
                  )} · sha256 ${artifact.sha256.slice(0, 12)}…`,
                }),
              ]),
            ),
          )
        : a1EmptyContent("Энэ intake-д зураг байгаагүй."),
      {
        className: "neutral",
        label: "METADATA STRIPPED",
      },
    ),
  );
  return element("div", { className: "result-stack" }, sections);
}

function renderA1EditTab(record) {
  return element("div", { className: "a1-editor-wrap" }, [
    element("div", { className: "editor-notice" }, [
      element("strong", { text: "Human edit boundary" }),
      element("p", {
        text: "Identity/scope өөрчлөхгүй. Schema, logic болон required clarification-ийг зөв болгосны дараа хадгална.",
      }),
    ]),
    element("textarea", {
      className: "a1-json-editor",
      text: pretty(record.draft),
      attributes: {
        id: "a1-draft-editor",
        spellcheck: "false",
        "aria-label": "DailyReportDraftV1 JSON editor",
      },
    }),
    element("div", { className: "human-edit-paths" }, [
      element("strong", {
        text: `Хүн зассан field · ${record.humanEditedFieldPaths.length}`,
      }),
      element("p", {
        text: record.humanEditedFieldPaths.join(", ") || "Одоогоор human edit бүртгэгдээгүй.",
      }),
    ]),
  ]);
}

function renderA1Tabs() {
  $$("#a1-tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.a1Tab === state.a1Tab);
  });
  const content = $("#a1-tab-content");

  if (!state.a1Record) {
    content.replaceChildren(a1EmptyContent("Draft сонгоно уу."));
    return;
  }

  const views = {
    structured: renderA1StructuredTab,
    evidence: renderA1EvidenceTab,
    questions: renderA1QuestionsTab,
    source: renderA1SourceTab,
    edit: renderA1EditTab,
    json: (record) => jsonView(record),
  };
  content.replaceChildren((views[state.a1Tab] ?? views.structured)(state.a1Record));
}

function renderA1ReviewActions() {
  const record = state.a1Record;
  const save = $("#a1-save-edit");
  const approve = $("#a1-approve");
  const reject = $("#a1-reject");
  const apply = $("#a1-apply");

  if (!record) {
    save.disabled = true;
    approve.disabled = true;
    reject.disabled = true;
    apply.disabled = true;
    return;
  }

  const terminal = ["APPROVED", "REJECTED"].includes(record.status);
  const required = record.draft.clarificationQuestions.filter(
    (question) => question.requiredForApproval,
  ).length;
  const errors = record.draft.validationIssues.filter((issue) => issue.severity === "ERROR").length;
  save.disabled = terminal;
  approve.disabled = record.status !== "READY_FOR_REVIEW";
  reject.disabled = terminal;
  apply.disabled = record.status !== "APPROVED";
  $("#a1-review-hint").textContent =
    record.status === "APPROVED"
      ? "Approved command/event immutable болсон. Apply нь local project snapshot-д idempotent."
      : record.status === "REJECTED"
        ? `Rejected: ${record.rejection?.reason ?? "шалтгаангүй"}`
        : `${errors} validation error · ${required} required clarification · approve зөвхөн READY_FOR_REVIEW үед нээгдэнэ.`;
}

function renderA1Record(record, project = selectedA1Project()) {
  state.a1Record = record;
  $("#a1-empty").classList.add("hidden");
  $("#a1-result").classList.remove("hidden");
  const draft = record.draft;
  const errorCount = draft.validationIssues.filter((issue) => issue.severity === "ERROR").length;
  const requiredCount = draft.clarificationQuestions.filter(
    (question) => question.requiredForApproval,
  ).length;
  $("#a1-result-summary").replaceChildren(
    element("div", { className: "summary-grid a1-summary-grid" }, [
      summaryCard("Project", project?.projectCode ?? draft.projectId),
      summaryCard("Report date", draft.reportDate),
      summaryCard("Status", record.status),
      summaryCard(
        "Confidence",
        `${Math.round(draft.overallConfidence * 100)}% · ${draft.confidenceLevel}`,
      ),
      summaryCard("Validation", `${errorCount} error`),
      summaryCard("Clarification", `${requiredCount} required`),
      summaryCard("Duplicate", draft.duplicateCandidates.length),
      summaryCard("Human edits", record.humanEditedFieldPaths.length),
    ]),
  );
  renderA1Tabs();
  renderA1ReviewActions();
  renderA1DraftList();
  $$(".a1-flow-steps > div").forEach((step, index) => {
    step.classList.toggle("active", index < (record.status === "APPROVED" ? 4 : 3));
  });
}

async function openA1Draft(draftId) {
  try {
    const response = await api("/api/a1/drafts/show", {
      method: "POST",
      body: {
        projectKey: state.a1ProjectKey,
        draftId,
      },
    });
    renderA1Record(response.record, response.project);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function saveA1Edit() {
  if (!state.a1Record) {
    return;
  }

  const editor = $("#a1-draft-editor");

  if (!editor) {
    state.a1Tab = "edit";
    renderA1Tabs();
    showToast("JSON editor нээгдлээ. Засварлаад дахин хадгална уу.");
    return;
  }

  const button = $("#a1-save-edit");
  await withBusy(button, "Хадгалж байна…", async () => {
    try {
      const draft = JSON.parse(editor.value);
      const response = await api("/api/a1/drafts/edit", {
        method: "POST",
        body: {
          projectKey: state.a1ProjectKey,
          draftId: state.a1Record.draftId,
          draft,
        },
      });
      renderA1Record(response.record, response.project);
      await loadA1Drafts();
      showToast("Human edit болон changed field paths хадгалагдлаа.");
    } catch (error) {
      showToast(`Draft edit: ${error.message}`, "error");
    }
  });
}

async function approveA1Record() {
  if (!state.a1Record) {
    return;
  }

  const button = $("#a1-approve");
  await withBusy(button, "Approving…", async () => {
    try {
      const response = await api("/api/a1/drafts/approve", {
        method: "POST",
        body: {
          projectKey: state.a1ProjectKey,
          draftId: state.a1Record.draftId,
          reviewer: $("#a1-reviewer").value,
          note: $("#a1-review-note").value,
        },
      });
      renderA1Record(response.record, response.project);
      await loadA1Drafts();
      showToast("Draft approved command/event боллоо.");
    } catch (error) {
      showToast(`Approve: ${error.message}`, "error");
    }
  });
}

async function rejectA1Record() {
  if (!state.a1Record) {
    return;
  }

  const reason = $("#a1-review-note").value.trim();

  if (!reason) {
    showToast("Reject хийхдээ шалтгаан бичнэ үү.", "error");
    return;
  }

  const button = $("#a1-reject");
  await withBusy(button, "Rejecting…", async () => {
    try {
      const response = await api("/api/a1/drafts/reject", {
        method: "POST",
        body: {
          projectKey: state.a1ProjectKey,
          draftId: state.a1Record.draftId,
          reviewer: $("#a1-reviewer").value,
          reason,
        },
      });
      renderA1Record(response.record, response.project);
      await loadA1Drafts();
      showToast("Draft rejection audit-тай хадгалагдлаа.");
    } catch (error) {
      showToast(`Reject: ${error.message}`, "error");
    }
  });
}

async function applyA1Record() {
  if (!state.a1Record) {
    return;
  }

  const button = $("#a1-apply");
  await withBusy(button, "Applying…", async () => {
    try {
      const response = await api("/api/a1/drafts/apply", {
        method: "POST",
        body: {
          projectKey: state.a1ProjectKey,
          draftId: state.a1Record.draftId,
          applyAsOf: $("#a1-apply-date").value,
        },
      });
      await loadA1Projects(response.result.project.projectKey);
      showToast(
        response.result.applied
          ? "Approved data local project snapshot-д apply боллоо."
          : "Ижил command өмнө apply болсон — duplicate үүсгэсэнгүй.",
      );
    } catch (error) {
      showToast(`Apply: ${error.message}`, "error");
    }
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result,
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function renderA1FileList() {
  const container = $("#a1-file-list");

  if (state.a1Images.length === 0) {
    container.className = "file-list empty";
    container.textContent = "Зураг сонгоогүй";
    return;
  }

  container.className = "file-list";
  container.replaceChildren(
    ...state.a1Images.map((file) =>
      element("span", {
        className: "file-pill",
        text: `${file.name} · ${formatBytes(file.size)}`,
      }),
    ),
  );
}

async function submitA1(event) {
  event.preventDefault();
  const button = $("#a1-form button[type='submit']");

  if (!state.a1ProjectKey) {
    showToast("A1 intake хийх project сонгоно уу.", "error");
    return;
  }

  await withBusy(button, "A1 ажиллаж байна…", async () => {
    try {
      const images = await Promise.all(state.a1Images.map((file) => fileToDataUrl(file)));
      const response = await api("/api/a1/intake", {
        method: "POST",
        body: {
          text: $("#a1-text").value,
          referenceDate: $("#a1-date").value,
          requestId: $("#a1-request-id").value,
          projectKey: state.a1ProjectKey,
          images,
          confirmPaid: $("#a1-confirm").checked,
        },
      });
      renderA1Record(response.result.record, response.result.project);
      state.a1Images = [];
      $("#a1-images").value = "";
      renderA1FileList();
      $("#a1-request-id").value = `ui-${Date.now()}`;
      await loadA1Drafts();
      showToast("A1 draft амжилттай үүслээ.");
      void loadStatus();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function renderA2(result) {
  const analysis = result.analysis;
  const deviations = analysis.deviations ?? [];
  const drafts = result.drafts ?? [];
  const forecast = analysis.forecast ?? {};
  const metrics = element("div", { className: "analysis-metrics" }, [
    summaryCard("Deviation", deviations.length),
    summaryCard("Recommendation", drafts.length),
    summaryCard("AI status", result.aiStatus),
    summaryCard("Forecast", forecast.projectedEndDate ?? "—"),
    summaryCard("Delay", `${forecast.delayWorkingDays ?? 0} өдөр`),
  ]);
  const deviationGrid = element(
    "div",
    { className: "deviation-grid" },
    deviations.slice(0, 12).map((item) =>
      element("article", { className: "data-card" }, [
        element("h4", {
          text: item.title ?? item.ruleId ?? "Deviation",
        }),
        element("p", {
          text: `Severity: ${item.severity ?? "—"} · Work item: ${item.workItemId ?? "project"}`,
        }),
        element("p", {
          text: item.summary ?? item.explanation ?? "Тайлбар байхгүй",
        }),
      ]),
    ),
  );
  const recommendationGrid = element(
    "div",
    { className: "recommendation-grid" },
    drafts.slice(0, 12).map((draft) =>
      element("article", { className: "data-card" }, [
        element("h4", { text: draft.title }),
        element("p", { text: draft.summary }),
        element("p", {
          text: `Status: ${draft.status} · Sources: ${draft.sourceRefs?.length ?? 0}`,
        }),
        element("p", {
          text:
            draft.actions?.[0]?.action ??
            draft.actions?.[0]?.description ??
            "Action option байхгүй",
        }),
      ]),
    ),
  );
  const stack = element("div", { className: "result-stack" }, [
    resultSection("Run summary", metrics, {
      className: result.aiStatus === "AI_UNAVAILABLE" ? "warning" : "pass",
      label: result.aiStatus,
    }),
    resultSection(`Илэрсэн зөрүү · ${deviations.length}`, deviationGrid),
    resultSection(`Зөвлөмжийн draft · ${drafts.length}`, recommendationGrid),
    resultSection("Бүрэн JSON", jsonView(result)),
  ]);

  $("#a2-empty").classList.add("hidden");
  const container = $("#a2-result");
  container.classList.remove("hidden");
  container.replaceChildren(stack);
}

async function runA2() {
  const button = $("#a2-run");
  await withBusy(button, "A2 шинжилж байна…", async () => {
    try {
      const response = await api("/api/a2/run", {
        method: "POST",
        body: { asOf: $("#a2-date").value },
      });
      renderA2(response.result);
      showToast("A2 шинжилгээ дууслаа.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function documentLabel(type) {
  return (
    {
      WEEKLY_REPORT: "7 хоногийн тайлан",
      MONTHLY_REPORT: "Сарын тайлан",
      DEVIATION_CONCLUSION: "Зөрүүний дүгнэлт",
      SUBCONTRACTOR_REMINDER: "Туслан гүйцэтгэгчийн сануулга",
      SUPPLIER_DEMAND: "Нийлүүлэгчийн шаардлага",
      CLIENT_NOTICE: "Захиалагчийн мэдэгдэл",
    }[type] ?? type
  );
}

function renderDocument(document, result, previewContainer) {
  const documentView = element("div", { className: "result-stack" }, [
    element("div", { className: "summary-grid" }, [
      summaryCard("Төрөл", documentLabel(document.documentType)),
      summaryCard("Төлөв", document.status),
      summaryCard("Facts", document.deterministicFactCount),
      summaryCard("Unsupported", document.unsupportedClaimCount),
    ]),
    resultSection(
      "Markdown draft",
      element("pre", {
        className: "document-markdown",
        text: document.markdown,
      }),
      {
        className: document.unsupportedClaimCount === 0 ? "pass" : "fail",
        label: document.unsupportedClaimCount === 0 ? "GROUNDED" : "CHECK CLAIMS",
      },
    ),
    resultSection("Source references", jsonView(document.sourceRefs ?? [])),
  ]);
  previewContainer.replaceChildren(documentView);
}

function renderA3(result) {
  const documents = result.bundle.documents ?? [];
  const tabs = element("div", { className: "document-tabs" });
  const preview = element("div", { className: "document-preview" });

  documents.forEach((document, index) => {
    const button = element("button", {
      className: `document-tab ${index === 0 ? "active" : ""}`,
      text: documentLabel(document.documentType),
      attributes: { type: "button" },
    });
    button.addEventListener("click", () => {
      $$(".document-tab", tabs).forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderDocument(document, result, preview);
    });
    tabs.append(button);
  });

  if (documents[0]) {
    renderDocument(documents[0], result, preview);
  }

  const summary = element("div", { className: "summary-grid" }, [
    summaryCard("Document", documents.length),
    summaryCard("Facts", result.facts?.length ?? 0),
    summaryCard("Bundle", result.bundle.status),
    summaryCard("Unsupported", result.bundle.totalUnsupportedClaimCount),
  ]);
  const layout = element("div", { className: "document-layout" }, [tabs, preview]);
  const stack = element("div", { className: "result-stack" }, [
    resultSection("Bundle summary", summary, {
      className: result.bundle.totalUnsupportedClaimCount === 0 ? "pass" : "fail",
      label: result.bundle.totalUnsupportedClaimCount === 0 ? "GROUNDED" : "FAILED",
    }),
    resultSection("Баримт бичгүүд", layout),
  ]);

  $("#a3-empty").classList.add("hidden");
  const container = $("#a3-result");
  container.classList.remove("hidden");
  container.replaceChildren(stack);
}

async function runA3() {
  const button = $("#a3-run");
  await withBusy(button, "A3 үүсгэж байна…", async () => {
    try {
      const response = await api("/api/a3/run", {
        method: "POST",
        body: { asOf: $("#a3-date").value },
      });
      renderA3(response.result);
      showToast("A3 зургаан баримт бичиг үүсгэлээ.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function appendChatMessage(role, text, result) {
  const message = element("div", {
    className: `message ${role}`,
  });
  message.append(
    element("div", {
      className: "message-label",
      text: role === "user" ? "ТА" : "A4",
    }),
    element("p", { text }),
  );

  if (result) {
    const tools = (result.inspectedTools ?? []).join(", ") || "tool ашиглаагүй";
    const sources = element("div", { className: "source-list" }, [
      element("div", {
        className: "source-card",
        text: `Tools: ${tools} · Status: ${result.status}`,
      }),
      ...(result.claims ?? []).slice(0, 8).map((claim) =>
        element("div", {
          className: "source-card",
          text: `${claim.text ?? claim.claim ?? "Claim"} · sources ${
            claim.sourceRefs?.length ?? 0
          }`,
        }),
      ),
    ]);
    message.append(sources);
  }

  const messages = $("#a4-messages");
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
  return message;
}

async function submitA4(event) {
  event.preventDefault();
  const input = $("#a4-question");
  const question = input.value.trim();

  if (!question) {
    showToast("Асуултаа бичнэ үү.", "error");
    return;
  }

  const button = $("#a4-form button");
  appendChatMessage("user", question);
  input.value = "";

  await withBusy(button, "…", async () => {
    const placeholder = appendChatMessage("assistant", "Эх сурвалжийг шалгаж байна…");

    try {
      const response = await api("/api/a4/ask", {
        method: "POST",
        body: {
          question,
          asOf: $("#a2-date").value || "2026-03-28",
        },
      });
      placeholder.remove();
      appendChatMessage("assistant", response.result.answer, response.result);
    } catch (error) {
      placeholder.remove();
      appendChatMessage("assistant", `Алдаа: ${error.message}`);
    }
  });
}

function renderJob(job) {
  $("#job-title").textContent = job.label;
  const status = $("#job-status");
  status.textContent = job.status;
  status.className = `status-tag ${
    job.status === "PASSED"
      ? "pass"
      : job.status === "FAILED"
        ? "fail"
        : job.status === "RUNNING"
          ? "warning"
          : "neutral"
  }`;
  const total = job.currentStep?.total ?? Math.max(job.results?.length ?? 0, 1);
  const completed = job.results?.length ?? 0;
  const progress =
    job.status === "PASSED"
      ? 100
      : job.status === "FAILED"
        ? Math.max(8, Math.round((completed / total) * 100))
        : job.currentStep
          ? Math.max(8, Math.round(((job.currentStep.index - 0.5) / job.currentStep.total) * 100))
          : 4;
  $("#job-progress").value = progress;
  const log = $("#job-log");
  log.textContent = (job.logs ?? []).map((entry) => entry.text).join("") || "Job queue-д орлоо…";
  log.scrollTop = log.scrollHeight;
}

async function pollJob(jobId) {
  clearTimeout(state.jobTimer);

  try {
    const response = await api(`/api/checks/${jobId}`);
    const job = response.job;
    renderJob(job);

    if (["PASSED", "FAILED"].includes(job.status)) {
      state.activeJobId = null;
      showToast(
        job.status === "PASSED" ? `${job.label} PASS` : `${job.label} FAILED`,
        job.status === "PASSED" ? "info" : "error",
      );
      void loadStatus();
      return;
    }

    state.jobTimer = setTimeout(() => pollJob(jobId), 900);
  } catch (error) {
    showToast(error.message, "error");
    state.activeJobId = null;
  }
}

async function startSuite(suite) {
  if (state.activeJobId) {
    showPage("checks");
    showToast("Шалгалт аль хэдийн ажиллаж байна.", "error");
    return;
  }

  try {
    const response = await api("/api/checks/run", {
      method: "POST",
      body: {
        suite,
        confirmPaid: suite !== "live" || $("#live-confirm")?.checked === true,
      },
    });
    state.activeJobId = response.job.jobId;
    renderJob(response.job);
    showPage("checks");
    void pollJob(response.job.jobId);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });
  $$("[data-open-page]").forEach((card) => {
    card.addEventListener("click", () => showPage(card.dataset.openPage));
  });
  $$("[data-start-suite]").forEach((button) => {
    button.addEventListener("click", () => startSuite(button.dataset.startSuite));
  });
  $("#mobile-menu").addEventListener("click", () => {
    $(".sidebar").classList.toggle("open");
  });
  $("#refresh-status").addEventListener("click", loadStatus);
  $("#system-reload").addEventListener("click", loadStatus);
  $("#a1-project-select").addEventListener("change", async (event) => {
    state.a1ProjectKey = event.target.value;
    state.a1Record = null;
    $("#a1-result").classList.add("hidden");
    $("#a1-empty").classList.remove("hidden");
    renderA1Project(selectedA1Project());
    await loadA1Drafts();
  });
  $("#a1-new-project").addEventListener("click", () => {
    $("#a1-project-setup").classList.toggle("hidden");
  });
  $("#a1-close-project-setup").addEventListener("click", () => {
    $("#a1-project-setup").classList.add("hidden");
  });
  $("#a1-project-form").addEventListener("submit", submitA1Project);
  $("#a1-snapshot-file").addEventListener("change", importA1Snapshot);
  $("#a1-export-project").addEventListener("click", exportA1Snapshot);
  $("#a1-delete-project").addEventListener("click", deleteSelectedA1Project);
  $("#a1-form").addEventListener("submit", submitA1);
  $("#a1-images").addEventListener("change", (event) => {
    const files = [...event.target.files];
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

    if (files.length > 5) {
      showToast("Хамгийн ихдээ 5 зураг сонгоно.", "error");
      event.target.value = "";
      state.a1Images = [];
    } else if (
      files.some(
        (file) => !allowed.has(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024,
      )
    ) {
      showToast("Зураг бүр PNG/JPEG/WEBP/GIF, 1 byte–10 MB байна.", "error");
      event.target.value = "";
      state.a1Images = [];
    } else {
      state.a1Images = files;
    }
    renderA1FileList();
  });
  $$("#a1-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.a1Tab = button.dataset.a1Tab;
      renderA1Tabs();
    });
  });
  $("#a1-draft-filter").addEventListener("change", loadA1Drafts);
  $("#a1-refresh-drafts").addEventListener("click", loadA1Drafts);
  $("#a1-save-edit").addEventListener("click", saveA1Edit);
  $("#a1-approve").addEventListener("click", approveA1Record);
  $("#a1-reject").addEventListener("click", rejectA1Record);
  $("#a1-apply").addEventListener("click", applyA1Record);
  $("#a2-run").addEventListener("click", runA2);
  $("#a3-run").addEventListener("click", runA3);
  $("#a4-form").addEventListener("submit", submitA4);
  $$("#a4-questions button").forEach((button) => {
    button.addEventListener("click", () => {
      $("#a4-question").value = button.textContent;
      $("#a4-question").focus();
    });
  });
  window.addEventListener("hashchange", () => {
    showPage(location.hash.slice(1) || "overview", false);
  });
}

function initializeA1Defaults() {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = new Date(`${today}T00:00:00.000Z`);
  endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
  $("#a1-date").value = today;
  $("#a1-request-id").value = `ui-${Date.now()}`;
  $("#a1-project-start").value = today;
  $("#a1-project-as-of").value = today;
  $("#a1-project-end").value = endDate.toISOString().slice(0, 10);
  renderA1ReviewActions();
}

async function initialize() {
  initializeA1Defaults();
  bindEvents();
  showPage(location.hash.slice(1) || "overview", false);
  await Promise.all([loadStatus(), loadDemo(), loadA1Projects()]);
  setInterval(loadStatus, 30_000);
}

void initialize();
