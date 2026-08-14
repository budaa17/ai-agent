import { spawn } from "node:child_process";

const DEFAULT_OUTPUT_LIMIT = 8 * 1024 * 1024;

function packageManagerInvocation(args) {
  const npmExecPath = process.env.npm_execpath?.trim();

  if (npmExecPath && /\.(?:c?js|mjs)$/iu.test(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
  };
}

function appendWithLimit(current, value, limit) {
  const next = current + value;

  if (Buffer.byteLength(next, "utf8") <= limit) {
    return next;
  }

  throw new Error(`Process output exceeded ${limit} bytes`);
}

export async function runProcess({
  command,
  args = [],
  cwd,
  env = process.env,
  timeoutMs = 120_000,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
  onOutput,
}) {
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finishReject(new Error(`Process timed out after ${timeoutMs} milliseconds`));
    }, timeoutMs);

    function finishReject(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    child.stdout.on("data", (chunk) => {
      try {
        const text = chunk.toString("utf8");
        stdout = appendWithLimit(stdout, text, outputLimit);
        onOutput?.({ stream: "stdout", text });
      } catch (error) {
        child.kill();
        finishReject(error);
      }
    });

    child.stderr.on("data", (chunk) => {
      try {
        const text = chunk.toString("utf8");
        stderr = appendWithLimit(stderr, text, outputLimit);
        onOutput?.({ stream: "stderr", text });
      } catch (error) {
        child.kill();
        finishReject(error);
      }
    });

    child.on("error", finishReject);
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export async function runPnpm(args, cwd, options = {}) {
  const invocation = packageManagerInvocation(args);
  return await runProcess({
    ...options,
    ...invocation,
    cwd,
  });
}
