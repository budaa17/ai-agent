import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceFixture } from "../test/workspace-fixture";
import { renderProjectPage } from "../test/render-project-page";
import { A2Page } from "./a2-page";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    buildWatchApi: {
      ...actual.buildWatchApi,
      workspace: vi.fn(async () =>
        buildWorkspaceFixture({
          alerts: [
            {
              id: "alert-1",
              title: "Ажил хугацаа хэтэрсэн",
              description: "BW-017 ажил 5 өдөр хоцорсон",
              severity: "CRITICAL",
              sourceId: "work-item-17",
            },
          ],
        }),
      ),
    },
  };
});

describe("A2 observer page", () => {
  it("ажиглалтын inbox-д алдааг харуулна", async () => {
    renderProjectPage("a2", <A2Page />);
    await waitFor(() => expect(screen.getByText("Ажил хугацаа хэтэрсэн")).toBeInTheDocument());
    expect(screen.getByText("1 signal")).toBeInTheDocument();
  });
});
