import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Client-side audit of the public marketing pages.
 *
 * Runs a real browser against a running dev server and reports what actually
 * happens: which routes render, whether the plan data arrives, what the console
 * and the network say, and whether the page behaves on a phone-sized screen.
 *
 * Usage:  node scripts/marketing-audit.mjs [baseUrl]
 */

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDirectory = path.resolve(consoleRoot, "..", "agents");
const requireFromAgents = createRequire(path.join(agentsDirectory, "package.json"));
const puppeteer = requireFromAgents("puppeteer");

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const outputDirectory = path.join(consoleRoot, "data", "marketing-audit");

const ROUTES = [
  { path: "/", name: "Landing", expect: ["Өнөөдрийн ажил", "SUBSCRIPTION", "АСУУХ ЗҮЙ"] },
  { path: "/pricing", name: "Pricing", expect: ["Ил тод үнэ", "Багцын харьцуулалт"] },
  { path: "/features", name: "Features", expect: ["Боломжууд"] },
  { path: "/security", name: "Security", expect: ["Аюулгүй байдал"] },
  { path: "/contact", name: "Contact", expect: ["Холбоо барих"] },
  { path: "/terms", name: "Terms", expect: ["Үйлчилгээний нөхцөл"] },
  { path: "/privacy", name: "Privacy", expect: ["Нууцлалын бодлого"] },
  { path: "/company-signup", name: "Signup", expect: ["Компани бүртгүүлэх"] },
  { path: "/checkout/success", name: "Checkout return", expect: ["Хүсэлт олдсонгүй"] },
];

const results = [];
const record = (area, name, passed, detail) => {
  results.push({ area, name, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  [${area}] ${name} — ${detail}\n`);
};

/** Collects everything the browser complains about while a page loads. */
function watch(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 200)));
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  return { consoleErrors, pageErrors, failedRequests };
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // --- Every public route renders -------------------------------------
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const noise = watch(page);
      let status = 0;
      try {
        const response = await page.goto(`${baseUrl}${route.path}`, {
          waitUntil: "networkidle0",
          timeout: 30_000,
        });
        status = response?.status() ?? 0;
        await new Promise((resolve) => setTimeout(resolve, 400));
        const text = await page.evaluate(() => document.body.innerText);
        const normalizedText = text.replace(/\s+/g, " ").toLocaleLowerCase("mn-MN");
        const missing = route.expect.filter(
          (needle) => !normalizedText.includes(needle.toLocaleLowerCase("mn-MN")),
        );
        record(
          "Route",
          route.name,
          status === 200 && missing.length === 0,
          missing.length === 0 ? `${status}, агуулга бүрэн` : `дутуу: ${missing.join(", ")}`,
        );
        record(
          "Console",
          route.name,
          noise.consoleErrors.length === 0 && noise.pageErrors.length === 0,
          [...noise.pageErrors, ...noise.consoleErrors].slice(0, 2).join(" | ") || "алдаагүй",
        );
        const realFailures = noise.failedRequests.filter(
          (entry) => !entry.includes("favicon") && !entry.includes("/@vite"),
        );
        record(
          "Network",
          route.name,
          realFailures.length === 0,
          realFailures.slice(0, 2).join(" | ") || "бүх хүсэлт амжилттай",
        );
        // A full-page screenshot does not naturally scroll, so intersection-
        // based reveals would otherwise remain in their pre-animation state.
        // Walk the landing page once just as a visitor would, then capture it.
        if (route.path === "/") {
          await page.evaluate(async () => {
            const step = Math.max(500, Math.floor(window.innerHeight * 0.75));
            for (let top = 0; top < document.documentElement.scrollHeight; top += step) {
              window.scrollTo({ top, behavior: "instant" });
              await new Promise((resolve) => setTimeout(resolve, 45));
            }
            window.scrollTo({ top: 0, behavior: "instant" });
          });
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await page.screenshot({
          path: path.join(outputDirectory, `${route.name.toLowerCase().replace(/\s+/g, "-")}.png`),
          fullPage: true,
        });
      } catch (error) {
        record("Route", route.name, false, String(error.message).slice(0, 160));
      } finally {
        await page.close();
      }
    }

    // --- Landing page: live plan data ------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 30_000 });
      const text = await page.evaluate(() => document.body.innerText);

      const hasPrice = /\d{1,3}(,\d{3})+₮/.test(text);
      record(
        "Data",
        "Landing үнэ API-аас",
        hasPrice,
        hasPrice ? (text.match(/\d{1,3}(,\d{3})+₮/g) ?? []).slice(0, 3).join(", ") : "үнэ гараагүй",
      );

      const meta = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content ?? null,
        ogImage: document.querySelector('meta[property="og:image"]')?.content ?? null,
        ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? null,
        twitter: document.querySelector('meta[name="twitter:card"]')?.content ?? null,
        jsonLd: document.querySelector('script[type="application/ld+json"]')?.textContent ?? null,
      }));
      record(
        "SEO",
        "title + description",
        meta.title !== "" && meta.description !== null,
        meta.title,
      );
      record(
        "SEO",
        "og:image абсолют",
        meta.ogImage !== null && meta.ogImage.startsWith("http"),
        meta.ogImage ?? "байхгүй",
      );
      record(
        "SEO",
        "twitter:card",
        meta.twitter === "summary_large_image",
        meta.twitter ?? "байхгүй",
      );

      let offers = 0;
      try {
        offers = JSON.parse(meta.jsonLd ?? "{}").offers?.length ?? 0;
      } catch {
        offers = 0;
      }
      record("SEO", "JSON-LD Offer", offers > 0, offers > 0 ? `${offers} offer` : "байхгүй");

      // The share image itself has to be fetchable, not just referenced.
      // Status alone is not enough: an SPA fallback answers 200 with HTML, and a
      // crawler handed HTML shows a blank card.
      const ogResponse = meta.ogImage === null ? null : await page.goto(meta.ogImage);
      const ogType = ogResponse?.headers()["content-type"] ?? "";
      record(
        "SEO",
        "og:image бодитоор зураг",
        ogResponse?.status() === 200 && ogType.startsWith("image/"),
        `${ogResponse?.status() ?? "—"} ${ogType || "content-type алга"}`,
      );

      for (const [name, asset, expected] of [
        ["robots.txt", "/robots.txt", "text/plain"],
        ["sitemap.xml", "/sitemap.xml", "xml"],
      ]) {
        const response = await page.goto(`${baseUrl}${asset}`);
        const type = response?.headers()["content-type"] ?? "";
        record(
          "SEO",
          name,
          response?.status() === 200 && type.includes(expected),
          `${response?.status() ?? "—"} ${type || "content-type алга"}`,
        );
      }
      await page.close();
    }

    // --- Navigation and CTAs ---------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });

      const links = await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")]
          .map((anchor) => anchor.getAttribute("href"))
          .filter((href) => href !== null && href.startsWith("/")),
      );
      const unique = [...new Set(links)];
      const broken = [];
      for (const href of unique) {
        const response = await fetch(`${baseUrl}${href}`);
        if (!response.ok) broken.push(`${href} → ${response.status}`);
      }
      record(
        "Links",
        "Landing доторх бүх холбоос",
        broken.length === 0,
        broken.length === 0 ? `${unique.length} холбоос бүгд 200` : broken.join(" | "),
      );

      await page.click('a[href="/pricing"]');
      await page.waitForFunction(() => window.location.pathname === "/pricing", {
        timeout: 10_000,
      });
      record("Nav", "Багц сонгох CTA", true, "→ /pricing");
      await page.close();
    }

    // --- Pricing interaction ---------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${baseUrl}/pricing`, { waitUntil: "networkidle0" });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const yearly = await page.evaluate(() => document.body.innerText);
      const yearlyPressed = await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .filter((button) => button.textContent?.includes("Жилээр"))
          .map((button) => button.getAttribute("aria-pressed"))
          .at(0),
      );
      record(
        "Pricing",
        "Анхны утга жилээр",
        yearlyPressed === "true",
        `aria-pressed=${yearlyPressed}`,
      );

      await page.evaluate(() => {
        const monthly = [...document.querySelectorAll("button")].find(
          (button) => button.textContent?.trim() === "Сараар",
        );
        monthly?.click();
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const monthly = await page.evaluate(() => document.body.innerText);
      record(
        "Pricing",
        "Сар/жил toggle",
        monthly !== yearly,
        monthly === yearly ? "дарахад юу ч өөрчлөгдөөгүй" : "үнэ солигдов",
      );

      const rows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
      record("Pricing", "Харьцуулалтын хүснэгт", rows > 0, `${rows} мөр`);
      await page.close();
    }

    // --- Mobile ----------------------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      record(
        "Mobile",
        "Хэвтээ гүйлгэлт байхгүй",
        !overflow,
        overflow ? "хуудас хэвтээгээр гүйж байна" : "390px-д багтсан",
      );

      const toggle = await page.$('button[aria-controls="marketing-menu"]');
      record("Mobile", "Hamburger товч", toggle !== null, toggle === null ? "олдсонгүй" : "байна");
      if (toggle !== null) {
        await toggle.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const open = await page.evaluate(() => document.querySelector("#marketing-menu") !== null);
        record("Mobile", "Цэс нээгдэнэ", open, open ? "нээгдэв" : "нээгдсэнгүй");
        await toggle.click();
      }
      await page.evaluate(async () => {
        const step = Math.max(400, Math.floor(window.innerHeight * 0.75));
        for (let top = 0; top < document.documentElement.scrollHeight; top += step) {
          window.scrollTo({ top, behavior: "instant" });
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await page.screenshot({
        path: path.join(outputDirectory, "mobile-landing.png"),
        fullPage: true,
      });
      await page.close();
    }

    // --- Accessibility basics --------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });

      await page.keyboard.press("Tab");
      const firstFocus = await page.evaluate(
        () => document.activeElement?.textContent?.trim() ?? "",
      );
      record(
        "A11y",
        "Skip link эхний Tab дээр",
        firstFocus.includes("Үндсэн хэсэг"),
        firstFocus || "фокус аваагүй",
      );

      const structure = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length,
        main: document.querySelectorAll("main").length,
        imagesWithoutAlt: [...document.querySelectorAll("img")].filter(
          (image) => !image.hasAttribute("alt"),
        ).length,
        landmarks: document.querySelectorAll("nav[aria-label]").length,
      }));
      record("A11y", "Ганц h1", structure.h1 === 1, `${structure.h1} ширхэг`);
      record("A11y", "main landmark", structure.main === 1, `${structure.main} ширхэг`);
      record(
        "A11y",
        "alt-гүй зураг",
        structure.imagesWithoutAlt === 0,
        `${structure.imagesWithoutAlt} ширхэг`,
      );
      record("A11y", "Нэрлэсэн nav", structure.landmarks >= 2, `${structure.landmarks} ширхэг`);
      await page.close();
    }

    // --- Signup form ------------------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${baseUrl}/company-signup?plan=starter&interval=YEAR`, {
        waitUntil: "networkidle0",
      });
      const form = await page.evaluate(() => ({
        inputs: document.querySelectorAll("form input").length,
        hasPasswordField: document.querySelector('input[type="password"]') !== null,
        planShown: document.body.innerText.includes("starter"),
      }));
      record("Signup", "Маягт ачаалагдав", form.inputs >= 4, `${form.inputs} талбар`);
      record(
        "Signup",
        "Нууц үг асуухгүй",
        !form.hasPasswordField,
        form.hasPasswordField ? "нууц үгийн талбар БАЙНА" : "төлбөрөөс өмнө нууц үг асуухгүй",
      );
      record("Signup", "Сонгосон багц харагдана", form.planShown, form.planShown ? "starter" : "—");
      await page.close();
    }

    // --- Weight -----------------------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      let transferred = 0;
      page.on("response", async (response) => {
        try {
          const length = Number(response.headers()["content-length"] ?? 0);
          transferred += Number.isFinite(length) ? length : 0;
        } catch {
          /* ignore */
        }
      });
      const started = Date.now();
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
      const elapsed = Date.now() - started;
      record(
        "Perf",
        "Ачаалалт (dev, minify-гүй)",
        true,
        `${elapsed}ms, ~${Math.round(transferred / 1024)}KB (dev серверийн тоо, production-ийнх биш)`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((entry) => entry.passed).length;
  await writeFile(
    path.join(outputDirectory, "report.json"),
    `${JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `\nMarketing audit: ${passed}/${results.length}\nScreenshots: ${outputDirectory}\n`,
  );
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Marketing audit failed: ${error.stack ?? error}\n`);
  process.exitCode = 1;
});
