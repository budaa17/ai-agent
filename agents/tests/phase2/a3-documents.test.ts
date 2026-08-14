import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuiltInImageMalwareScanner, LocalArtifactStore } from "../../src/artifacts/index.js";
import {
  FileDocumentReviewStore,
  persistRenderedA3DocumentArtifacts,
  persistA3DocumentArtifacts,
  renderA3DocumentHtml,
  runProductionA3,
} from "../../src/phase2/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 2 A3 production document agent", () => {
  it("creates all six grounded document drafts from deterministic facts", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-production-001",
    });

    expect(result.bundle.documents.map((item) => item.documentType)).toEqual([
      "WEEKLY_REPORT",
      "MONTHLY_REPORT",
      "DEVIATION_CONCLUSION",
      "SUBCONTRACTOR_REMINDER",
      "SUPPLIER_DEMAND",
      "CLIENT_NOTICE",
    ]);
    expect(result.bundle.totalUnsupportedClaimCount).toBe(0);
    expect(result.bundle.status).toBe("PENDING_REVIEW");
    expect(result.bundle.requiresHumanReview).toBe(true);
    expect(result.facts.length).toBeGreaterThanOrEqual(16);

    for (const document of result.bundle.documents) {
      expect(document.sourceRefs.length).toBeGreaterThan(0);
      expect(document.deterministicFactCount).toBeGreaterThan(0);
      expect(document.unsupportedClaimCount).toBe(0);
      expect(document.status).toBe("PENDING_REVIEW");
    }
  });

  it("derives exact money values without floating-point arithmetic", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const expected = snapshot.costEntries.reduce((total, entry) => {
      const [whole, decimal] = entry.amountMnt.split(".");
      return total + BigInt(whole!) * 100n + BigInt(decimal!);
    }, 0n);
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-money-001",
    });
    const cost = result.facts.find((item) => item.label === "Бодит зардал");

    expect(cost?.value).toBe(`${expected / 100n}.${String(expected % 100n).padStart(2, "0")}`);
  });

  it("keeps deterministic documents if AI invents a number", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-number-guard-001",
      narrativeGateway: {
        enrich: async ({ documents }) => ({
          [documents[0]!.documentId]: "Баталгаагүй шинэ таамаг 987654321 хоног.",
        }),
      },
    });

    expect(result.aiStatus).toBe("AI_UNAVAILABLE");
    expect(result.aiError).toContain("unsupported numeric claims");
    expect(result.bundle.totalUnsupportedClaimCount).toBe(0);
    expect(result.bundle.documents[0]!.markdown).not.toContain("987654321");
  });

  it("persists scanned immutable markdown artifacts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-a3-artifacts-"));
    temporaryDirectories.push(directory);
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-artifact-001",
    });
    const store = new LocalArtifactStore(directory, "a3-test-signing-secret-at-least-32-bytes");
    const bundle = await persistA3DocumentArtifacts({
      bundle: result.bundle,
      store,
      scanner: new BuiltInImageMalwareScanner(() => "2026-07-30T00:00:00.000Z"),
      retention: {
        schemaVersion: 1,
        classification: "AGENT_DRAFT",
        createdAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2026-08-29T00:00:00.000Z",
        legalHold: false,
        deletionStatus: "ACTIVE",
      },
    });

    for (const document of bundle.documents) {
      expect(document.outputArtifact?.kind).toBe("REPORT_MARKDOWN");
      expect(document.outputArtifact?.sha256).toBe(
        createHash("sha256").update(document.markdown).digest("hex"),
      );
    }
  });

  it("audits edits and freezes the approved checksum", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-a3-review-"));
    temporaryDirectories.push(directory);
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-review-001",
    });
    const draft = result.bundle.documents[0]!;
    const store = new FileDocumentReviewStore(directory);
    await store.save(snapshot.tenantId, snapshot.projectId, draft, "2026-07-30T00:00:00.000Z");
    const editedMarkdown = `${draft.markdown}\nХянасан тэмдэглэл.\n`;
    const approved = await store.decide({
      documentId: draft.documentId,
      decision: "EDITED",
      reviewedBy: "user-manager",
      reason: "Найруулгыг тодруулав.",
      editCategory: "CLARITY",
      editedMarkdown,
      reviewedAt: "2026-07-30T01:00:00.000Z",
    });
    const repeated = await store.decide({
      documentId: draft.documentId,
      decision: "REJECTED",
      reviewedBy: "other-user",
      reason: "Дахин өөрчлөх оролдлого.",
    });

    expect(approved.decision).toBe("EDITED");
    expect(approved.finalMarkdown).toBe(editedMarkdown.trim());
    expect(approved.comparison?.similarity).toBeLessThan(1);
    expect(repeated).toEqual(approved);
    expect(await store.list()).toHaveLength(1);
  });

  it("renders safe HTML and persists immutable Markdown, HTML, and PDF", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-a3-rendered-"));
    temporaryDirectories.push(directory);
    const snapshot = buildBuildWatchSimulation().snapshot;
    const styleMemory = {
      schemaVersion: 1 as const,
      styleProfileId: "tenant-demo-style-v1",
      companyName: "BuildWatch Demo ХХК",
      reportTemplateName: "company-report-v1",
      terminology: { workItem: "ажил" },
      approvedPatternSnippets: ["Баримтад тулгуурлан бичнэ."],
      logoPlaceholder: "[ЛОГО]",
      signaturePlaceholder: "[ГАРЫН ҮСЭГ]",
      recipientStyle: "Албан, товч",
      prohibitedClaims: ["баталгаагүй амлалт"],
    };
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-rendered-001",
      styleMemory,
    });
    const store = new LocalArtifactStore(directory, "a3-rendered-signing-secret-at-least-32-bytes");
    const rendered = await persistRenderedA3DocumentArtifacts({
      bundle: result.bundle,
      store,
      scanner: new BuiltInImageMalwareScanner(() => "2026-07-30T00:00:00.000Z"),
      retention: {
        schemaVersion: 1,
        classification: "AGENT_DRAFT",
        createdAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2026-08-29T00:00:00.000Z",
        legalHold: false,
        deletionStatus: "ACTIVE",
      },
      styleMemory,
      pdfRenderer: {
        render: async () => Buffer.from("%PDF-1.4\nphase-2-test\n%%EOF", "ascii"),
      },
    });
    const html = renderA3DocumentHtml(
      {
        ...result.bundle.documents[0]!,
        markdown: `${result.bundle.documents[0]!.markdown}\n<script>alert(1)</script>`,
      },
      styleMemory,
    );

    expect(rendered.artifacts).toHaveLength(6);
    expect(
      rendered.artifacts.every(
        (item) =>
          item.markdown.kind === "REPORT_MARKDOWN" &&
          item.html.kind === "REPORT_HTML" &&
          item.pdf.kind === "REPORT_PDF",
      ),
    ).toBe(true);
    expect(
      rendered.bundle.documents.every((document) => document.outputArtifact?.kind === "REPORT_PDF"),
    ).toBe(true);
    expect(html).toContain("BuildWatch Demo ХХК");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("rejects prohibited AI claims and keeps the deterministic draft", async () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const result = await runProductionA3({
      snapshot,
      requestId: "a3-prohibited-001",
      styleMemory: {
        schemaVersion: 1,
        styleProfileId: "tenant-demo-style-v2",
        companyName: "BuildWatch Demo ХХК",
        reportTemplateName: "company-report-v2",
        terminology: {},
        approvedPatternSnippets: [],
        logoPlaceholder: "[ЛОГО]",
        signaturePlaceholder: "[ГАРЫН ҮСЭГ]",
        recipientStyle: "Албан",
        prohibitedClaims: ["баталгаагүй амлалт"],
      },
      narrativeGateway: {
        enrich: async ({ documents }) => ({
          [documents[0]!.documentId]: "Энэ бол баталгаагүй амлалт.",
        }),
      },
    });

    expect(result.aiStatus).toBe("AI_UNAVAILABLE");
    expect(result.aiError).toContain("prohibited claim");
    expect(result.bundle.documents[0]!.markdown).not.toContain("баталгаагүй амлалт");
  });
});
