import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { finalizeDailyReportDraft } from "../../agents/dist/structuring/daily-report-finalize.js";
import { FileDailyReportReviewStore } from "../../agents/dist/structuring/daily-report-review.js";
import { createAgentConsoleServer } from "../server.mjs";

let app;
let baseUrl;
const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const a1ReviewDirectory = path.join(consoleRoot, "data", "a1-review");

before(async () => {
  app = createAgentConsoleServer({
    host: "127.0.0.1",
    port: 0,
    logger: {
      error: () => {},
    },
  });
  baseUrl = (await app.start()).url;
});

after(async () => {
  await app.stop();
});

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
            Origin: baseUrl,
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

function uniqueProjectInput(label) {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  return {
    tenantId: `tenant-${label}-${suffix}`,
    projectId: `project-${label}-${suffix}`,
    projectCode: `${label.toUpperCase()}-${suffix}`,
    projectName: `${label} console test project`,
    plannedStart: "2026-03-01",
    plannedEnd: "2026-12-31",
    asOfDate: "2026-03-28",
    budgetMnt: "125000000",
    workItems: [
      {
        code: "TEST-001",
        name: "Console lifecycle work",
        unit: "м3",
        plannedQuantity: "100",
        unitCostMnt: "250000",
      },
    ],
  };
}

function buildReadyA1Draft(snapshot, requestId) {
  const sourceText = "2026-03-28-нд TEST-001 ажил 25 хувь, нийт 25 м3 гүйцэтгэлтэй.";

  return finalizeDailyReportDraft({
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    requestId,
    sourceText,
    referenceDate: "2026-03-28",
    projectSnapshot: snapshot,
    modelOutput: {
      schemaVersion: 1,
      language: "mn",
      reportDate: "2026-03-28",
      location: {
        block: null,
        stage: null,
        floor: null,
        zone: null,
      },
      progressEntries: [
        {
          workItemCode: "TEST-001",
          workItemName: "Console lifecycle work",
          candidateCodes: [],
          progressMode: "CUMULATIVE",
          progressPercent: 25,
          quantityDone: "25",
          unit: "м3",
          status: "IN_PROGRESS",
          blocker: null,
          note: null,
          confidence: [
            {
              fieldPath: "workItem.code",
              score: 0.99,
              evidenceQuote: "TEST-001",
              sourceImageIndex: null,
              imageRegion: null,
            },
            {
              fieldPath: "progressPercent",
              score: 0.99,
              evidenceQuote: "25 хувь",
              sourceImageIndex: null,
              imageRegion: null,
            },
            {
              fieldPath: "quantityDone",
              score: 0.99,
              evidenceQuote: "25 м3",
              sourceImageIndex: null,
              imageRegion: null,
            },
            {
              fieldPath: "status",
              score: 0.99,
              evidenceQuote: "25 хувь",
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
          evidenceQuote: "2026-03-28",
          sourceImageIndex: null,
          imageRegion: null,
        },
      ],
    },
  });
}

test("serves the local console with restrictive headers", async () => {
  const response = await fetch(baseUrl);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/u);
  assert.match(await response.text(), /Agent Console/u);
});

test("reports sanitized runtime status and demo metadata", async () => {
  const status = await request("/api/status");
  const demo = await request("/api/demo");

  assert.equal(status.response.status, 200);
  assert.equal(typeof status.payload.configuration.openAIKeyConfigured, "boolean");
  assert.equal("openAIKey" in status.payload.configuration, false);
  assert.equal(demo.payload.projectCode, "BW-SIM");
  assert.equal(demo.payload.dataSource, "SIMULATION_SNAPSHOT");
  assert.equal(demo.payload.weekEndDates.length, 12);
  assert.ok(demo.payload.counts.workItems >= 40);
});

test("manages project-aware A1 create and import registry entries", async () => {
  const createdInput = uniqueProjectInput("builder");
  const importedInput = uniqueProjectInput("import");
  const projectKeys = [];

  try {
    const created = await request("/api/a1/projects/create", {
      project: createdInput,
      replace: false,
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.payload.project.source, "LOCAL_PROJECT_BUILDER");
    assert.equal(created.payload.project.counts.workItems, 1);
    projectKeys.push(created.payload.project.projectKey);

    const createdSnapshot = await request(
      `/api/a1/projects/snapshot?projectKey=${encodeURIComponent(
        created.payload.project.projectKey,
      )}`,
    );
    assert.equal(createdSnapshot.response.status, 200);
    assert.equal(createdSnapshot.payload.snapshot.schemaVersion, 1);
    assert.equal(createdSnapshot.payload.snapshot.workItems[0].code, "TEST-001");

    const importedSnapshot = structuredClone(createdSnapshot.payload.snapshot);
    importedSnapshot.snapshotId = `snapshot-${importedInput.projectId}`;
    importedSnapshot.tenantId = importedInput.tenantId;
    importedSnapshot.projectId = importedInput.projectId;
    importedSnapshot.projectCode = importedInput.projectCode;
    importedSnapshot.projectName = importedInput.projectName;
    importedSnapshot.activeBaseline.baselineVersionId = `baseline-${importedInput.projectId}`;
    importedSnapshot.workItems[0].workItemId = `work-item-${importedInput.projectId}`;

    const imported = await request("/api/a1/projects/import", {
      snapshot: importedSnapshot,
      replace: false,
    });

    assert.equal(imported.response.status, 201);
    assert.equal(imported.payload.project.source, "IMPORTED_SNAPSHOT");
    projectKeys.push(imported.payload.project.projectKey);

    const registry = await request("/api/a1/projects");
    const registered = new Map(
      registry.payload.projects.map((project) => [project.projectKey, project]),
    );
    assert.equal(
      registered.get(created.payload.project.projectKey)?.source,
      "LOCAL_PROJECT_BUILDER",
    );
    assert.equal(registered.get(imported.payload.project.projectKey)?.source, "IMPORTED_SNAPSHOT");

    const drafts = await request(
      `/api/a1/drafts?projectKey=${encodeURIComponent(
        created.payload.project.projectKey,
      )}&status=ALL`,
    );
    assert.equal(drafts.response.status, 200);
    assert.deepEqual(drafts.payload.drafts, []);
  } finally {
    await Promise.all(
      projectKeys.map((projectKey) => request("/api/a1/projects/delete", { projectKey })),
    );
  }
});

test("runs the complete A1 human review and idempotent apply lifecycle", async () => {
  const projectInput = uniqueProjectInput("review");
  let projectKey;
  let draftId;

  try {
    const created = await request("/api/a1/projects/create", {
      project: projectInput,
      replace: false,
    });
    assert.equal(created.response.status, 201);
    projectKey = created.payload.project.projectKey;

    const snapshotResult = await request(
      `/api/a1/projects/snapshot?projectKey=${encodeURIComponent(projectKey)}`,
    );
    const draft = buildReadyA1Draft(
      snapshotResult.payload.snapshot,
      `console-review-${process.pid}-${Date.now()}`,
    );
    draftId = draft.draftId;
    assert.equal(draft.status, "READY_FOR_REVIEW");

    const store = new FileDailyReportReviewStore(a1ReviewDirectory);
    await store.saveIntake(draft, "2026-03-28T12:00:00.000Z");

    const listed = await request(
      `/api/a1/drafts?projectKey=${encodeURIComponent(projectKey)}&status=READY_FOR_REVIEW`,
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.drafts.length, 1);
    assert.equal(listed.payload.drafts[0].draftId, draftId);

    const shown = await request("/api/a1/drafts/show", {
      projectKey,
      draftId,
    });
    assert.equal(shown.response.status, 200);
    assert.equal(shown.payload.record.status, "READY_FOR_REVIEW");

    const replacement = structuredClone(shown.payload.record.draft);
    replacement.progressEntries[0].progressPercent = 26;
    const edited = await request("/api/a1/drafts/edit", {
      projectKey,
      draftId,
      draft: replacement,
    });
    assert.equal(edited.response.status, 200);
    assert.ok(
      edited.payload.record.humanEditedFieldPaths.some((fieldPath) =>
        fieldPath.includes("progressPercent"),
      ),
    );

    const approved = await request("/api/a1/drafts/approve", {
      projectKey,
      draftId,
      reviewer: "console-test-reviewer",
      note: "API lifecycle test approval",
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.record.status, "APPROVED");
    assert.equal(approved.payload.record.approvedCommand.commandType, "APPROVE_DAILY_REPORT");

    const firstApply = await request("/api/a1/drafts/apply", {
      projectKey,
      draftId,
      applyAsOf: "2026-03-28",
    });
    assert.equal(firstApply.response.status, 200);
    assert.equal(firstApply.payload.result.applied, true);

    const secondApply = await request("/api/a1/drafts/apply", {
      projectKey,
      draftId,
      applyAsOf: "2026-03-28",
    });
    assert.equal(secondApply.response.status, 200);
    assert.equal(secondApply.payload.result.applied, false);

    const updatedSnapshot = await request(
      `/api/a1/projects/snapshot?projectKey=${encodeURIComponent(projectKey)}`,
    );
    assert.equal(
      updatedSnapshot.payload.snapshot.dailyReports.filter(
        (report) => report.sourceDraftId === draftId,
      ).length,
      1,
    );
    assert.equal(updatedSnapshot.payload.snapshot.progressEntries.at(-1).progressPercent, 26);
  } finally {
    if (projectKey) {
      await request("/api/a1/projects/delete", { projectKey });
    }
    if (draftId) {
      await rm(path.join(a1ReviewDirectory, `${draftId}.json`), {
        force: true,
      });
    }
  }
});

test("runs A2 deterministic observation from the demo snapshot", async () => {
  const { response, payload } = await request("/api/a2/run", {
    asOf: "2026-03-28",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.result.trigger, "MANUAL");
  assert.ok(payload.result.analysis.deviations.length > 0);
  assert.ok(payload.result.drafts.length > 0);
  assert.equal(payload.result.aiStatus, "NOT_REQUESTED");
});

test("runs A3 and returns six grounded documents", async () => {
  const { response, payload } = await request("/api/a3/run", {
    asOf: "2026-03-28",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.result.bundle.documents.length, 6);
  assert.equal(payload.result.bundle.totalUnsupportedClaimCount, 0);
  assert.equal(Object.keys(payload.result.previews).length, payload.result.bundle.documents.length);
});

test("answers A4 with inspected tools and source claims", async () => {
  const { response, payload } = await request("/api/a4/ask", {
    question: "Төслийн ерөнхий хураангуйг хэл",
    asOf: "2026-03-28",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.result.status, "ANSWERED");
  assert.ok(payload.result.inspectedTools.includes("getProjectSummary"));
  assert.ok(payload.result.claims.length > 0);
  assert.equal(payload.result.readOnly, true);
});

test("answers natural Mongolian and Latin-script budget questions", async () => {
  for (const question of ["төсөв хэдэн төгрөг байна", "tosow heden tugrug baina"]) {
    const { response, payload } = await request("/api/a4/ask", {
      question,
      asOf: "2026-03-28",
    });

    assert.equal(response.status, 200);
    assert.equal(payload.result.status, "ANSWERED");
    assert.ok(payload.result.inspectedTools.includes("getProjectSummary"));
    assert.match(payload.result.answer, /Нийт төлөвлөсөн төсөв \d+\.\d{2} ₮/u);
  }
});

test("does not answer an Atlas question from the BW-SIM source", async () => {
  const { response, payload } = await request("/api/a4/ask", {
    question: "atlas projectiin medeelliig yawuul",
    asOf: "2026-03-28",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(payload.result.suggestedRouteCode, "SELECT_PROJECT_CONTEXT");
  assert.match(payload.result.answer, /BW-SIM/u);
  assert.match(payload.result.answer, /ATLAS/u);
  assert.deepEqual(payload.result.inspectedTools, []);
});

test("requires explicit paid confirmation before A1 live intake", async () => {
  const { response, payload } = await request("/api/a1/intake", {
    text: "BW-017 ажил 60 хувь болсон.",
    referenceDate: "2026-03-28",
    images: [],
    confirmPaid: false,
  });

  assert.equal(response.status, 400);
  assert.match(payload.error, /quota\/төлбөрийн зөвшөөрөл/u);
});

test("rejects unknown check suites", async () => {
  const { response, payload } = await request("/api/checks/run", {
    suite: "unknown",
  });

  assert.equal(response.status, 400);
  assert.match(payload.error, /Танигдаагүй/u);
});

test("runs the quick A1-A4 check suite to completion", { timeout: 240_000 }, async () => {
  const started = await request("/api/checks/run", {
    suite: "quick",
    confirmPaid: false,
  });

  assert.equal(started.response.status, 202);
  const jobId = started.payload.job.jobId;
  let job = started.payload.job;
  const deadline = Date.now() + 220_000;

  while (!["PASSED", "FAILED"].includes(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    job = (await request(`/api/checks/${jobId}`)).payload.job;
  }

  assert.equal(job.status, "PASSED", job.error ?? "Quick suite failed");
  assert.equal(job.results.length, 2);
  assert.ok(job.logs.some((entry) => entry.text.includes("Test Files")));
});
