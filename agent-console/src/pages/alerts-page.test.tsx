import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceFixture } from "../test/workspace-fixture";
import { renderProjectPage } from "../test/render-project-page";
import { AlertsPage } from "./alerts-page";

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
              title: "Материал хэтрүүлэлт",
              description: "Цемент нормоос 15% илүү зарцуулагдсан",
              severity: "HIGH",
              sourceId: "material-1",
              blocksApproval: true,
            },
          ],
        }),
      ),
    },
  };
});

describe("Alerts page", () => {
  it("severity/search filter-той alert карт харуулна", async () => {
    renderProjectPage("alerts", <AlertsPage />);
    await waitFor(() => expect(screen.getByText("Материал хэтрүүлэлт")).toBeInTheDocument());
    expect(screen.getByText("1 OPEN")).toBeInTheDocument();
  });
});
