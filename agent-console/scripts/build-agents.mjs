import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "../lib/process-runner.mjs";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDirectory = path.resolve(consoleRoot, "..", "agents");

process.stdout.write("Agent core build шалгаж байна...\n");
const result = await runPnpm(["run", "build"], agentsDirectory, {
  timeoutMs: 180_000,
  onOutput: ({ stream, text }) => {
    (stream === "stderr" ? process.stderr : process.stdout).write(text);
  },
});

if (result.code !== 0) {
  process.exitCode = result.code;
}
