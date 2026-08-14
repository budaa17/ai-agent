import { createServer } from "node:http";
import { prisma } from "../prisma.js";
import { createPhase9ProductionRuntime, resolvePhase9BackendConfig } from "../backend/index.js";

async function main() {
  const config = resolvePhase9BackendConfig();
  const runtime = createPhase9ProductionRuntime(prisma, config);
  const server = createServer(runtime.app);
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  server.maxHeadersCount = 100;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  runtime.logger.info("api_started", {
    publicBaseUrl: config.publicBaseUrl,
    host: config.host,
    port: config.port,
    sentryEnabled: runtime.errorReporter.enabled,
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    runtime.logger.info("api_shutdown_started");
    const forceClose = setTimeout(() => server.closeAllConnections(), 10_000);
    forceClose.unref();
    server.closeIdleConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(forceClose);
    await prisma.$disconnect();
    await runtime.errorReporter.flush();
    runtime.logger.info("api_shutdown_completed");
  };
  process.once("SIGINT", () => {
    shutdown().catch(() => (process.exitCode = 1));
  });
  process.once("SIGTERM", () => {
    shutdown().catch(() => (process.exitCode = 1));
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Phase 9 API failed: ${message}\n`);
  process.exitCode = 1;
});
