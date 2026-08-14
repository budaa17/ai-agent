import { renderHtmlToPdfBytes } from "../reporting/pdf.js";

const pdf = await renderHtmlToPdfBytes(
  "<!doctype html><html><body><h1>BuildWatch PDF smoke</h1><p>Монгол тайлан</p></body></html>",
);

if (pdf.byteLength < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
  throw new Error("Puppeteer did not return a valid PDF");
}

process.stdout.write(
  `${JSON.stringify({
    status: "ok",
    artifact: "pdf",
    bytes: pdf.byteLength,
  })}\n`,
);
