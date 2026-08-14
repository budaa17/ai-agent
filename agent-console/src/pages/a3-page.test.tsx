import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceFixture } from "../test/workspace-fixture";
import { renderProjectPage } from "../test/render-project-page";
import { A3Page } from "./a3-page";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    buildWatchApi: {
      ...actual.buildWatchApi,
      workspace: vi.fn(async () =>
        buildWorkspaceFixture({
          assistants: {
            a1Drafts: [],
            a3Drafts: [
              {
                id: "draft-1",
                title: "Долоо хоногийн тайлан",
                type: "PROJECT_REPORT",
                status: "PENDING_APPROVAL",
                sourceAsOf: "2026-08-01T00:00:00Z",
                content: { summary: "test" },
              },
            ],
          },
        }),
      ),
    },
  };
});

describe("A3 document page", () => {
  it("ноорог баримт бичгийг жагсаалтад харуулна", async () => {
    renderProjectPage("a3", <A3Page />);
    await waitFor(() =>
      expect(screen.getAllByText("Долоо хоногийн тайлан").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("1 draft · 0 PDF")).toBeInTheDocument();
  });
});
