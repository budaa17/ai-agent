import { describe, expect, it } from "vitest";
import { createCollectionWindow } from "../../src/tools/summarize.js";

describe("createCollectionWindow", () => {
  it("returns every item when the collection fits inside the limit", () => {
    const result = createCollectionWindow([1, 2], 2, (items) =>
      items.reduce((total, value) => total + value, 0),
    );

    expect(result).toEqual({
      sample: [1, 2],
      total: 2,
      truncated: false,
      summary: 3,
    });
  });

  it("returns a limited sample and summarizes the complete collection", () => {
    const result = createCollectionWindow([1, 2, 3, 4], 2, (items) => ({
      count: items.length,
      sum: items.reduce((total, value) => total + value, 0),
    }));

    expect(result.sample).toEqual([1, 2]);
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.summary).toEqual({ count: 4, sum: 10 });
  });

  it("does not mutate the source collection", () => {
    const source = [1, 2, 3];

    createCollectionWindow(source, 1, (items) => items.length);

    expect(source).toEqual([1, 2, 3]);
  });

  it("rejects an invalid limit", () => {
    expect(() => createCollectionWindow([], 0, () => null)).toThrow(RangeError);
  });
});
