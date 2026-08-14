import { describe, expect, it } from "vitest";
import { friendlyError } from "./api-error";

describe("friendlyError", () => {
  it("upstream review dependency алдааг stale task-аас ялгаж тайлбарлана", () => {
    const error = Object.assign(new Error("Upstream review must be approved first"), {
      code: "REVIEW_NOT_APPROVED",
      status: 409,
      details: { dependencyId: "quantity-v2" },
    });

    expect(friendlyError(error)).toMatchObject({
      title: "Өмнөх шат батлагдаагүй байна",
      reloadable: true,
    });
  });
});
