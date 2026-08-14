import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";

export interface RenderPdfOptions {
  executablePath?: string;
  launchArgs?: string[];
  timeoutMs?: number;
}

export async function renderHtmlToPdfBytes(html: string, options: RenderPdfOptions = {}) {
  const configuredExecutable =
    options.executablePath ?? process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  const disableSandbox = process.env.PUPPETEER_DISABLE_SANDBOX?.trim().toLowerCase() === "true";
  const launchArgs =
    options.launchArgs ??
    (disableSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : undefined);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: configuredExecutable || (await puppeteer.executablePath()),
    args: launchArgs,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: "load",
      timeout: options.timeoutMs ?? 30_000,
    });
    await page.evaluate("document.fonts.ready");
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "12mm",
        right: "12mm",
        bottom: "14mm",
        left: "12mm",
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function renderHtmlToPdf(
  html: string,
  outputPath: string,
  options: RenderPdfOptions = {},
) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const pdf = await renderHtmlToPdfBytes(html, options);
  await writeFile(absolutePath, pdf);
  const file = await stat(absolutePath);
  return {
    path: absolutePath,
    bytes: file.size,
  };
}
