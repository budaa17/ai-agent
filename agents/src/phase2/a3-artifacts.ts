import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ArtifactRetentionV1,
  ArtifactStore,
  MalwareScanner,
  StoredArtifactV1,
} from "../artifacts/index.js";
import {
  documentBundleV1Schema,
  documentDraftV1Schema,
  type DocumentBundleV1,
  type DocumentDraftV1,
} from "../contracts/agent-outputs.js";
import {
  contractArtifactReferenceSchema,
  type ContractArtifactReference,
} from "../contracts/common.js";
import { renderHtmlToPdfBytes } from "../reporting/pdf.js";
import {
  a3StyleMemoryV1Schema,
  assertA3ProhibitedClaims,
  type A3StyleMemoryV1,
} from "./a3-documents.js";

const MAX_A3_ARTIFACT_BYTES = 25 * 1024 * 1024;

export const a3RenderedDocumentArtifactsV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: z.string().trim().min(1).max(200),
    markdown: contractArtifactReferenceSchema,
    html: contractArtifactReferenceSchema,
    pdf: contractArtifactReferenceSchema,
  })
  .strict();

export const a3RenderedBundleV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    bundle: documentBundleV1Schema,
    artifacts: z.array(a3RenderedDocumentArtifactsV1Schema).min(1).max(20),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.bundle.documents.length !== result.artifacts.length) {
      context.addIssue({
        code: "custom",
        message: "Every A3 document requires Markdown, HTML, and PDF artifacts",
        path: ["artifacts"],
      });
    }
  });

export type A3RenderedDocumentArtifactsV1 = z.infer<typeof a3RenderedDocumentArtifactsV1Schema>;
export type A3RenderedBundleV1 = z.infer<typeof a3RenderedBundleV1Schema>;

export interface A3PdfRenderer {
  render(html: string): Promise<Uint8Array>;
}

export class PuppeteerA3PdfRenderer implements A3PdfRenderer {
  async render(html: string) {
    return renderHtmlToPdfBytes(html);
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownToSafeHtml(markdown: string) {
  const output: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      output.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);

    if (heading) {
      closeList();
      const level = heading[1]!.length;
      output.push(`<h${level}>${escapeHtml(heading[2]!)}</h${level}>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!listOpen) {
        output.push("<ul>");
        listOpen = true;
      }
      output.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  return output.join("\n");
}

function defaultStyle(document: DocumentDraftV1): A3StyleMemoryV1 {
  return {
    schemaVersion: 1,
    styleProfileId: document.styleProfileRef ?? "a3-default-style-v1",
    companyName: "BuildWatch",
    reportTemplateName: "buildwatch-a3-v1",
    terminology: {},
    approvedPatternSnippets: [],
    logoPlaceholder: "[КОМПАНИЙН ЛОГО]",
    signaturePlaceholder: "[БАТАЛГААЖУУЛАХ ГАРЫН ҮСЭГ]",
    recipientStyle: "Албан, товч, баримтад тулгуурласан",
    prohibitedClaims: [],
  };
}

export function renderA3DocumentHtml(documentInput: DocumentDraftV1, styleInput?: A3StyleMemoryV1) {
  const document = documentDraftV1Schema.parse(documentInput);
  const style = a3StyleMemoryV1Schema.parse(styleInput ?? defaultStyle(document));

  if (document.styleProfileRef !== null && document.styleProfileRef !== style.styleProfileId) {
    throw new Error("A3 document style profile does not match the renderer profile");
  }

  assertA3ProhibitedClaims([document], style);
  const body = markdownToSafeHtml(document.markdown);

  return `<!doctype html>
<html lang="${document.language === "en" ? "en" : "mn"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { color: #172033; font-family: "Noto Sans", Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; margin: 0; }
    header { border-bottom: 2px solid #1f4b99; display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding-bottom: 10px; }
    .logo { color: #50627f; font-size: 9pt; }
    .company { font-size: 13pt; font-weight: 700; text-align: right; }
    h1 { color: #102f66; font-size: 20pt; line-height: 1.25; margin: 0 0 14px; }
    h2 { border-bottom: 1px solid #d9e1ef; color: #153b76; font-size: 13pt; margin: 20px 0 8px; padding-bottom: 4px; }
    h3 { color: #244a82; font-size: 11pt; margin: 16px 0 6px; }
    p { margin: 7px 0; }
    ul { margin: 7px 0 10px 20px; padding: 0; }
    li { margin: 4px 0; }
    .meta { background: #f3f6fb; border: 1px solid #d9e1ef; border-radius: 6px; margin-bottom: 16px; padding: 9px 11px; }
    footer { border-top: 1px solid #d9e1ef; color: #50627f; font-size: 8.5pt; margin-top: 28px; padding-top: 10px; }
    .signature { margin-top: 30px; min-height: 50px; }
  </style>
</head>
<body data-style-profile="${escapeHtml(style.styleProfileId)}" data-template="${escapeHtml(style.reportTemplateName)}">
  <header>
    <div class="logo">${escapeHtml(style.logoPlaceholder)}</div>
    <div class="company">${escapeHtml(style.companyName)}</div>
  </header>
  <div class="meta">
    <div>Төрөл: ${escapeHtml(document.documentType)}</div>
    <div>Тайлант хугацаа: ${escapeHtml(document.periodFrom)} — ${escapeHtml(document.periodTo)}</div>
    <div>Хүлээн авагчийн хэв: ${escapeHtml(style.recipientStyle)}</div>
  </div>
  <main>${body}</main>
  <div class="signature">${escapeHtml(style.signaturePlaceholder)}</div>
  <footer>
    Ноорог — хүний хяналт, баталгаажуулалтгүйгээр илгээхгүй.
    Эх сурвалж: ${document.sourceRefs.length}; deterministic баримт: ${document.deterministicFactCount}.
  </footer>
</body>
</html>`;
}

function artifactReference(artifact: StoredArtifactV1, kind: ContractArtifactReference["kind"]) {
  return contractArtifactReferenceSchema.parse({
    artifactId: artifact.artifactId,
    kind,
    mediaType: artifact.mediaType,
    sha256: artifact.sha256,
    storageKey: artifact.storageKey,
    sizeBytes: artifact.sizeBytes,
  });
}

async function persistArtifact(input: {
  artifactId: string;
  tenantId: string;
  projectId: string;
  mediaType: string;
  kind: ContractArtifactReference["kind"];
  data: Uint8Array;
  store: ArtifactStore;
  scanner: MalwareScanner;
  retention: ArtifactRetentionV1;
}) {
  if (input.data.byteLength === 0 || input.data.byteLength > MAX_A3_ARTIFACT_BYTES) {
    throw new Error(`A3 artifact must contain 1-${MAX_A3_ARTIFACT_BYTES} bytes`);
  }

  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const scan = await input.scanner.scan({
    data: input.data,
    sha256,
    mediaType: input.mediaType,
    fileName: input.artifactId,
  });

  if (scan.status !== "CLEAN") {
    throw new Error(
      scan.status === "INFECTED"
        ? `A3 artifact rejected: ${scan.threatName}`
        : `A3 artifact scan failed: ${scan.errorMessage}`,
    );
  }

  return artifactReference(
    await input.store.put({
      artifactId: input.artifactId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      mediaType: input.mediaType,
      data: input.data,
      malwareScan: scan,
      retention: input.retention,
    }),
    input.kind,
  );
}

export async function persistRenderedA3DocumentArtifacts(input: {
  bundle: DocumentBundleV1;
  store: ArtifactStore;
  scanner: MalwareScanner;
  retention: ArtifactRetentionV1;
  styleMemory?: A3StyleMemoryV1;
  pdfRenderer?: A3PdfRenderer;
}) {
  const bundle = documentBundleV1Schema.parse(input.bundle);
  const style =
    input.styleMemory === undefined ? undefined : a3StyleMemoryV1Schema.parse(input.styleMemory);
  const pdfRenderer = input.pdfRenderer ?? new PuppeteerA3PdfRenderer();
  const documents: DocumentDraftV1[] = [];
  const artifacts: A3RenderedDocumentArtifactsV1[] = [];

  for (const document of bundle.documents) {
    const html = renderA3DocumentHtml(document, style);
    const markdownBytes = Buffer.from(document.markdown, "utf8");
    const htmlBytes = Buffer.from(html, "utf8");
    const pdfBytes = Buffer.from(await pdfRenderer.render(html));

    if (pdfBytes.byteLength < 5 || pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error(`A3 PDF renderer returned an invalid PDF for ${document.documentId}`);
    }

    const [markdown, htmlArtifact, pdf] = await Promise.all([
      persistArtifact({
        artifactId: `${document.documentId}-markdown`,
        tenantId: bundle.tenantId,
        projectId: bundle.projectId,
        mediaType: "text/markdown",
        kind: "REPORT_MARKDOWN",
        data: markdownBytes,
        store: input.store,
        scanner: input.scanner,
        retention: input.retention,
      }),
      persistArtifact({
        artifactId: `${document.documentId}-html`,
        tenantId: bundle.tenantId,
        projectId: bundle.projectId,
        mediaType: "text/html",
        kind: "REPORT_HTML",
        data: htmlBytes,
        store: input.store,
        scanner: input.scanner,
        retention: input.retention,
      }),
      persistArtifact({
        artifactId: `${document.documentId}-pdf`,
        tenantId: bundle.tenantId,
        projectId: bundle.projectId,
        mediaType: "application/pdf",
        kind: "REPORT_PDF",
        data: pdfBytes,
        store: input.store,
        scanner: input.scanner,
        retention: input.retention,
      }),
    ]);

    documents.push(
      documentDraftV1Schema.parse({
        ...document,
        outputArtifact: pdf,
      }),
    );
    artifacts.push(
      a3RenderedDocumentArtifactsV1Schema.parse({
        schemaVersion: 1,
        documentId: document.documentId,
        markdown,
        html: htmlArtifact,
        pdf,
      }),
    );
  }

  return a3RenderedBundleV1Schema.parse({
    schemaVersion: 1,
    bundle: {
      ...bundle,
      documents,
    },
    artifacts,
  });
}
