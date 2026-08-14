import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StructuredDraft } from "./a1-page";

describe("A1 confidence review", () => {
  it("бага confidence-тэй талбарыг тусгайлан ялгаруулна", () => {
    const { container } = render(
      <StructuredDraft
        draft={{
          structuredData: { workItemCode: "BW-017", progressPercent: 60, status: "IN_PROGRESS" },
          confidence: {
            overall: 0.78,
            fields: [
              { field: "workItemCode", score: 0.98 },
              { field: "progressPercent", score: 0.54 },
              { field: "status", score: 0.88 },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("progressPercent")).toBeInTheDocument();
    expect(container.querySelectorAll(".low-confidence")).toHaveLength(1);
    expect(screen.getByText("0.54")).toBeInTheDocument();
  });
});
