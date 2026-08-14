import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyA1Draft,
  approveA1Draft,
  askA4Demo,
  checkSuites,
  createA1Project,
  deleteA1Project,
  editA1Draft,
  getA1Artifact,
  getA1Draft,
  getA1ProjectSnapshot,
  getDemoMetadata,
  getSystemStatus,
  importA1Project,
  listA1Drafts,
  listA1Projects,
  rejectA1Draft,
  runA1Live,
  runA2Demo,
  runA3Demo,
  runCheckCommand,
} from "./lib/agent-service.mjs";

const consoleRoot = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(consoleRoot, "public");
const maxBodyBytes = 70 * 1024 * 1024;
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(statusCode, {
    ...securityHeaders("application/json; charset=utf-8"),
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response, error) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Тодорхойгүй алдаа";

  sendJson(response, statusCode, {
    ok: false,
    error: message,
  });
}

function assertLocalOrigin(request) {
  const origin = request.headers.origin;

  if (origin && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin)) {
    throw new HttpError(403, "Local origin шаардлагатай");
  }
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type application/json байх ёстой");
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);

  if (declaredLength > maxBodyBytes) {
    throw new HttpError(413, "Request body хэт том байна");
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.byteLength;

    if (size > maxBodyBytes) {
      throw new HttpError(413, "Request body хэт том байна");
    }

    chunks.push(chunk);
  }

  if (size === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON body буруу байна");
  }
}

function staticFilePath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(publicDirectory, `.${decodeURIComponent(requested)}`);
  const publicPrefix = `${path.resolve(publicDirectory)}${path.sep}`;

  if (resolved !== path.join(publicDirectory, "index.html") && !resolved.startsWith(publicPrefix)) {
    throw new HttpError(403, "Static path зөвшөөрөгдөөгүй");
  }

  return resolved;
}

async function serveStatic(request, response, pathname) {
  const filePath = staticFilePath(pathname);
  let fileStat;

  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(404, "Файл олдсонгүй");
    }
    throw error;
  }

  if (!fileStat.isFile()) {
    throw new HttpError(404, "Файл олдсонгүй");
  }

  const contentType =
    contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
  response.writeHead(200, {
    ...securityHeaders(contentType),
    "Content-Length": fileStat.size,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

function jobSnapshot(job) {
  return {
    jobId: job.jobId,
    suite: job.suite,
    label: job.label,
    paid: job.paid,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    currentStep: job.currentStep,
    results: job.results,
    logs: job.logs,
    error: job.error,
  };
}

function appendJobLog(job, stream, text) {
  if (!text) {
    return;
  }

  job.logs.push({
    at: new Date().toISOString(),
    stream,
    text,
  });

  while (
    job.logs.length > 1_000 ||
    job.logs.reduce((total, entry) => total + entry.text.length, 0) > 1_500_000
  ) {
    job.logs.shift();
  }
}

export function createAgentConsoleServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4173;
  const logger = options.logger ?? console;
  const jobs = new Map();
  let activeJobId = null;
  let paidA1Active = false;

  async function executeJob(job, suite) {
    activeJobId = job.jobId;
    job.status = "RUNNING";
    job.startedAt = new Date().toISOString();

    try {
      for (const [index, command] of suite.commands.entries()) {
        job.currentStep = {
          index: index + 1,
          total: suite.commands.length,
          label: command.label,
        };
        appendJobLog(
          job,
          "system",
          `\n▶ ${command.label} (${index + 1}/${suite.commands.length})\n`,
        );
        const result = await runCheckCommand(command, ({ stream, text }) => {
          appendJobLog(job, stream, text);
        });
        job.results.push({
          label: command.label,
          code: result.code,
          durationMs: result.durationMs,
        });

        if (result.code !== 0) {
          throw new Error(`${command.label} шалгалт exit code ${result.code}-оор дууслаа`);
        }

        appendJobLog(
          job,
          "system",
          `✓ ${command.label} PASS (${Math.round(result.durationMs / 1000)} сек)\n`,
        );
      }

      job.status = "PASSED";
    } catch (error) {
      job.status = "FAILED";
      job.error = error instanceof Error ? error.message : String(error);
      appendJobLog(job, "stderr", `\n✗ ${job.error}\n`);
    } finally {
      job.currentStep = null;
      job.completedAt = new Date().toISOString();
      activeJobId = null;
    }
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, {
        ok: true,
        ...(await getSystemStatus()),
        activeCheckJobId: activeJobId,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/demo") {
      sendJson(response, 200, {
        ok: true,
        ...(await getDemoMetadata()),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/a1/projects") {
      sendJson(response, 200, {
        ok: true,
        projects: await listA1Projects(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/a1/projects/snapshot") {
      sendJson(response, 200, {
        ok: true,
        snapshot: await getA1ProjectSnapshot({
          projectKey: url.searchParams.get("projectKey"),
        }),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/projects/create") {
      assertLocalOrigin(request);
      sendJson(response, 201, {
        ok: true,
        project: await createA1Project(await readJsonBody(request)),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/projects/import") {
      assertLocalOrigin(request);
      sendJson(response, 201, {
        ok: true,
        project: await importA1Project(await readJsonBody(request)),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/projects/delete") {
      assertLocalOrigin(request);
      sendJson(response, 200, {
        ok: true,
        result: await deleteA1Project(await readJsonBody(request)),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/a1/drafts") {
      sendJson(response, 200, {
        ok: true,
        ...(await listA1Drafts({
          projectKey: url.searchParams.get("projectKey"),
          status: url.searchParams.get("status") ?? "ALL",
        })),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/drafts/show") {
      assertLocalOrigin(request);
      sendJson(response, 200, {
        ok: true,
        ...(await getA1Draft(await readJsonBody(request))),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/drafts/edit") {
      assertLocalOrigin(request);
      sendJson(response, 200, {
        ok: true,
        ...(await editA1Draft(await readJsonBody(request))),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/drafts/approve") {
      assertLocalOrigin(request);
      sendJson(response, 200, {
        ok: true,
        ...(await approveA1Draft(await readJsonBody(request))),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/drafts/reject") {
      assertLocalOrigin(request);
      sendJson(response, 200, {
        ok: true,
        ...(await rejectA1Draft(await readJsonBody(request))),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/drafts/apply") {
      assertLocalOrigin(request);
      sendJson(response, 200, {
        ok: true,
        result: await applyA1Draft(await readJsonBody(request)),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/a1/artifact") {
      const artifact = await getA1Artifact({
        projectKey: url.searchParams.get("projectKey"),
        draftId: url.searchParams.get("draftId"),
        artifactId: url.searchParams.get("artifactId"),
      });
      response.writeHead(200, {
        ...securityHeaders(artifact.mediaType),
        "Content-Length": artifact.sizeBytes,
        "Content-Disposition": "inline",
        ETag: `"${artifact.sha256}"`,
      });
      createReadStream(artifact.filePath).pipe(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a1/intake") {
      assertLocalOrigin(request);

      if (paidA1Active) {
        throw new HttpError(
          409,
          "Өөр A1 live intake ажиллаж байна. Дууссаны дараа дахин оролдоно уу.",
        );
      }

      const body = await readJsonBody(request);

      if (body.confirmPaid !== true) {
        throw new HttpError(
          400,
          "A1 live intake ажиллуулахын өмнө API quota/төлбөрийн зөвшөөрөл өгнө",
        );
      }

      paidA1Active = true;

      try {
        sendJson(response, 200, {
          ok: true,
          result: await runA1Live(body),
        });
      } finally {
        paidA1Active = false;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a2/run") {
      assertLocalOrigin(request);
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        ok: true,
        result: await runA2Demo(body),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a3/run") {
      assertLocalOrigin(request);
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        ok: true,
        result: await runA3Demo(body),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a4/ask") {
      assertLocalOrigin(request);
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        ok: true,
        result: await askA4Demo(body),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/checks/run") {
      assertLocalOrigin(request);

      if (activeJobId !== null) {
        throw new HttpError(409, "Өөр шалгалт ажиллаж байна. Дууссаны дараа дахин эхлүүлнэ үү.");
      }

      const body = await readJsonBody(request);
      const suite = checkSuites[body.suite];

      if (!suite) {
        throw new HttpError(400, "Танигдаагүй шалгалтын suite");
      }

      if (suite.paid && body.confirmPaid !== true) {
        throw new HttpError(400, "OpenAI live шалгалтын төлбөр/quota-г зөвшөөрөх шаардлагатай");
      }

      const job = {
        jobId: `check-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        suite: body.suite,
        label: suite.label,
        paid: suite.paid,
        status: "QUEUED",
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        currentStep: null,
        results: [],
        logs: [],
        error: null,
      };
      jobs.set(job.jobId, job);
      void executeJob(job, suite);
      sendJson(response, 202, {
        ok: true,
        job: jobSnapshot(job),
      });
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/checks\/([a-z0-9-]+)$/u);

    if (request.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);

      if (!job) {
        throw new HttpError(404, "Шалгалтын job олдсонгүй");
      }

      sendJson(response, 200, {
        ok: true,
        job: jobSnapshot(job),
      });
      return;
    }

    throw new HttpError(404, "API endpoint олдсонгүй");
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? `${host}:${requestedPort}`}`,
      );

      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }

      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        throw new HttpError(405, "Method зөвшөөрөгдөөгүй");
      }

      await serveStatic(request, response, url.pathname);
    } catch (error) {
      if (!response.headersSent) {
        sendError(response, error);
      } else {
        response.destroy(error);
      }

      if (!(error instanceof HttpError) || error.statusCode >= 500) {
        logger.error?.(error);
      }
    }
  });

  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : requestedPort;
      return {
        host,
        port,
        url: `http://${host}:${port}`,
      };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function openBrowser(url) {
  const commands =
    process.platform === "win32"
      ? [["cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`]]]
      : process.platform === "darwin"
        ? [["open", [url]]]
        : [["xdg-open", [url]]];

  for (const [command, args] of commands) {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
}

export async function startAgentConsoleFromCli() {
  const port = Number(process.env.AGENT_CONSOLE_PORT ?? 4173);
  const app = createAgentConsoleServer({
    host: "127.0.0.1",
    port: Number.isInteger(port) && port > 0 ? port : 4173,
  });

  try {
    const address = await app.start();
    process.stdout.write("\n");
    process.stdout.write("Agent Console ажиллаж байна\n");
    process.stdout.write(`URL: ${address.url}\n`);
    process.stdout.write("Зогсоох: Ctrl+C\n\n");

    if (process.env.AGENT_CONSOLE_AUTO_OPEN !== "false") {
      openBrowser(address.url);
    }

    const shutdown = async () => {
      await app.stop();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    process.stderr.write(
      `Agent Console эхэлсэнгүй: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  await startAgentConsoleFromCli();
}
