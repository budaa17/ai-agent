import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildWatchPhase9OpenApi } from "../backend/openapi.js";

const output = resolve(process.cwd(), "data/openapi/buildwatch-v22.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(buildWatchPhase9OpenApi, null, 2)}\n`, "utf8");
process.stdout.write(`BuildWatch OpenAPI exported: ${output}\n`);
