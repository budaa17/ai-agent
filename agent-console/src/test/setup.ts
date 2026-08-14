import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

if (globalThis.crypto.randomUUID === undefined) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () => `test-${Math.random().toString(16).slice(2)}`,
  });
}
