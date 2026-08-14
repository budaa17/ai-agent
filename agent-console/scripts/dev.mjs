import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = path.resolve(consoleRoot, "..", "agents");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const developmentSecret = "buildwatch-local-development-secret-change-before-production-2026";
const children = new Set();
let closing = false;

function run(command, args, cwd, env = process.env) {
  return spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function apiSupportsA0(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/openapi.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const specification = await response.json();
    return Boolean(specification.paths?.["/v1/projects/{projectId}/a0-intakes"]?.post);
  } catch {
    return false;
  }
}

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function availablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`${preferredPort}-${preferredPort + 19} мужид сул API порт олдсонгүй`);
}

async function waitForApi(child, baseUrl) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await reachable(`${baseUrl}/health/ready`)) return;
    if (child.exitCode !== null) throw new Error(`Backend ${child.exitCode} кодоор зогслоо`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Backend 60 секундэд ready болсонгүй. PostgreSQL болон agents/.env DATABASE_URL-ийг шалгана уу.",
  );
}

function stopChild(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) stopChild(child);
  process.exitCode = exitCode;
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

try {
  process.stdout.write("[1/4] OpenAPI client шинэчилж байна…\n");
  const generated = spawnSync(pnpm, ["run", "api:generate"], {
    cwd: consoleRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (generated.status !== 0) throw new Error("OpenAPI client generation амжилтгүй");

  const configuredPort = Number(process.env.PHASE9_API_PORT ?? "4180");
  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
    throw new Error("PHASE9_API_PORT нь хүчинтэй TCP порт байх ёстой");
  }
  let backend = null;
  let apiPort = configuredPort;
  let apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const preferredApiReady = await reachable(`${apiBaseUrl}/health/ready`);
  if (preferredApiReady && (await apiSupportsA0(apiBaseUrl))) {
    process.stdout.write(`[2/4] BuildWatch API аль хэдийн compatible байна (${apiBaseUrl}).\n`);
  } else {
    if (!(await portAvailable(apiPort))) {
      const staleReason = preferredApiReady
        ? "хуучин API A0 endpoint-гүй"
        : "сонгосон порт ашиглагдаж байна";
      apiPort = await availablePort(apiPort + 1);
      apiBaseUrl = `http://127.0.0.1:${apiPort}`;
      process.stdout.write(
        `[2/4] ${staleReason}; шинэ BuildWatch API-г ${apiBaseUrl} дээр асааж байна…\n`,
      );
    } else {
      process.stdout.write(`[2/4] BuildWatch API-г ${apiBaseUrl} дээр асааж байна…\n`);
    }
    backend = run(pnpm, ["run", "api:v22"], agentsRoot, {
      ...process.env,
      PHASE9_DEVELOPMENT_SECRET: process.env.PHASE9_DEVELOPMENT_SECRET ?? developmentSecret,
      PHASE9_API_HOST: process.env.PHASE9_API_HOST ?? "127.0.0.1",
      PHASE9_API_PORT: String(apiPort),
      PHASE9_PUBLIC_BASE_URL: apiBaseUrl,
    });
    children.add(backend);
    await waitForApi(backend, apiBaseUrl);
    if (!(await apiSupportsA0(apiBaseUrl))) {
      throw new Error("Шинэ backend ready болсон ч A0 intake endpoint бүртгэгдсэнгүй");
    }
  }

  let outboxWorker = null;
  if (process.env.BUILDWATCH_DISABLE_OUTBOX_WORKER?.trim().toLowerCase() === "true") {
    process.stdout.write("[3/4] Outbox relay worker development тохиргоогоор унтраалттай.\n");
  } else {
    process.stdout.write("[3/4] Transactional outbox relay worker асааж байна…\n");
    outboxWorker = run(pnpm, ["run", "worker:phase9"], agentsRoot, {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? "development",
    });
    children.add(outboxWorker);
  }

  if (await reachable("http://127.0.0.1:4173")) {
    throw new Error(
      "127.0.0.1:4173 порт ашиглагдаж байна. Өмнөх Agent Console/Vite процессыг хаагаад дахин ажиллуулна уу.",
    );
  }
  process.stdout.write(
    `[4/4] React PWA асааж байна…\n\nBuildWatch: http://127.0.0.1:4173\nAPI: ${apiBaseUrl}\n\n`,
  );
  const frontend = run(pnpm, ["run", "dev:frontend"], consoleRoot, {
    ...process.env,
    BUILDWATCH_API_TARGET: apiBaseUrl,
  });
  children.add(frontend);
  frontend.once("exit", (code) => shutdown(code ?? 0));
  backend?.once("exit", (code) => {
    if (!closing) {
      process.stderr.write(`Backend гэнэт зогслоо (${code ?? "unknown"}).\n`);
      shutdown(code ?? 1);
    }
  });
  outboxWorker?.once("exit", (code) => {
    if (!closing) {
      process.stderr.write(`Outbox relay worker гэнэт зогслоо (${code ?? "unknown"}).\n`);
      shutdown(code ?? 1);
    }
  });
} catch (error) {
  process.stderr.write(
    `Agent Console эхэлсэнгүй: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  shutdown(1);
}
