import { percentile95, phase11PerformanceTargets } from "../../src/performance/index.js";

describe("BuildWatch Phase 11 performance contracts", () => {
  it("calculates nearest-rank p95 without mutating samples", () => {
    const samples = [10, 1, 5, 20, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    expect(percentile95(samples)).toBe(19);
    expect(samples[0]).toBe(10);
    expect(() => percentile95([])).toThrow("without samples");
  });

  it("defines positive targets for every required Phase 11 path", () => {
    expect(Object.keys(phase11PerformanceTargets)).toHaveLength(7);
    expect(Object.values(phase11PerformanceTargets).every((value) => value > 0)).toBe(true);
  });
});
