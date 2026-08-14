import "dotenv/config";

const worker = process.env.AGENT_WORKER?.trim().toLowerCase();
const modules = {
  a1: "./a1-worker.js",
  a2: "./a2-worker.js",
  a3: "./a3-worker.js",
  analysis: "./analysis-worker.js",
  phase9bridge: "./phase9-bridge-worker.js",
} as const;

if (!worker || !(worker in modules)) {
  throw new Error(`AGENT_WORKER must be one of: ${Object.keys(modules).join(", ")}`);
}

await import(modules[worker as keyof typeof modules]);
