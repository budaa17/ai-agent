import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("agents environment", () => {
  it("validates with zod", () => {
    const schema = z.object({ ok: z.boolean() });

    expect(schema.parse({ ok: true })).toEqual({ ok: true });
  });
});
