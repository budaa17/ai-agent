import { describe, expect, it } from "vitest";
import { createPgBossKey } from "../../src/jobs/pg-boss-key.js";

describe("createPgBossKey", () => {
  it("creates a pg-boss-compatible hierarchical key", () => {
    const key = createPgBossKey("a2-observe-project", "tenant-demo", "project-atlas");

    expect(key).toBe("a2-observe-project/tenant-demo/project-atlas");
    expect(key).toMatch(/^[A-Za-z0-9_.\-/]+$/);
  });

  it("hashes unsafe or Unicode segments deterministically", () => {
    const first = createPgBossKey("a2-observe-project", "tenant demo", "Монгол төсөл");
    const second = createPgBossKey("a2-observe-project", "tenant demo", "Монгол төсөл");

    expect(first).toBe(second);
    expect(first).toMatch(/^a2-observe-project\/sha256-[A-Za-z0-9_-]+\/sha256-[A-Za-z0-9_-]+$/);
  });

  it("rejects empty key segments", () => {
    expect(() => createPgBossKey("a2", "   ")).toThrow("pg-boss key segment cannot be empty");
  });
});
