import { describe, expect, it } from "vitest";
import {
  a4AnswerSchema,
  collectA4SourceReferences,
  formatA4Answer,
} from "../../src/agent/schema.js";

describe("A4 answer schema", () => {
  it("requires a source for every answered claim", () => {
    expect(() =>
      a4AnswerSchema.parse({
        schemaVersion: 1,
        language: "mn",
        status: "ANSWERED",
        claims: [{ text: "Баримттай хариулт.", sources: [] }],
      }),
    ).toThrow();
  });

  it("formats claims and deduplicates source references", () => {
    const source = {
      toolName: "lookupWorkItems",
      sourceId: "lookupWorkItems:aggregate",
      field: "total",
    } as const;
    const answer = a4AnswerSchema.parse({
      schemaVersion: 1,
      language: "mn",
      status: "ANSWERED",
      claims: [
        { text: "Эхний өгүүлбэр.", sources: [source] },
        { text: "Хоёр дахь өгүүлбэр.", sources: [source] },
      ],
    });

    expect(formatA4Answer(answer)).toBe("Эхний өгүүлбэр.\nХоёр дахь өгүүлбэр.");
    expect(collectA4SourceReferences(answer)).toEqual([source]);
  });
});
