import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

export type SecretScanFinding = {
  ruleId: string;
  file: string;
  line: number;
  fingerprint: string;
};

const excludedDirectories = new Set([
  ".git",
  ".cache",
  ".docker",
  "backups",
  "coverage",
  "data",
  "dist",
  "node_modules",
]);

const scannedExtensions = new Set([
  ".cjs",
  ".cmd",
  ".dockerfile",
  ".env",
  ".example",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const rules = [
  {
    id: "OPENAI_API_KEY",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    id: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    id: "AWS_ACCESS_KEY",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    id: "GITHUB_TOKEN",
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,}\b/gu,
  },
] as const;

function isEnvironmentFile(path: string): boolean {
  const name = path.split(/[\\/]/u).at(-1) ?? "";
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
}

function shouldScan(path: string): boolean {
  if (isEnvironmentFile(path)) return false;
  const name = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile") return true;
  if (name.endsWith(".env.example")) return true;
  return scannedExtensions.has(extname(name));
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        output.push(...(await listFiles(path)));
      }
    } else if (entry.isFile() && shouldScan(path)) {
      const metadata = await stat(path);
      if (metadata.size <= 2 * 1024 * 1024) output.push(path);
    }
  }
  return output;
}

export async function scanRepositoryForSecrets(rootInput: string): Promise<SecretScanFinding[]> {
  const root = resolve(rootInput);
  const files = await listFiles(root);
  const findings: SecretScanFinding[] = [];
  for (const path of files) {
    const content = await readFile(path, "utf8");
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of content.matchAll(rule.pattern)) {
        const index = match.index ?? 0;
        findings.push({
          ruleId: rule.id,
          file: relative(root, path).split(sep).join("/"),
          line: content.slice(0, index).split("\n").length,
          fingerprint: createHash("sha256")
            .update(`${rule.id}:${match[0]}`)
            .digest("hex")
            .slice(0, 16),
        });
      }
    }
  }
  return findings.sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
}
