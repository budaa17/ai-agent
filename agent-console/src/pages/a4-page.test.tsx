import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceFixture } from "../test/workspace-fixture";
import { renderProjectPage } from "../test/render-project-page";
import { A4Page } from "./a4-page";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    buildWatchApi: {
      ...actual.buildWatchApi,
      workspace: vi.fn(async () => buildWorkspaceFixture()),
    },
  };
});

describe("A4 read-only assistant page", () => {
  it("төслийн код болон эрхийн хамрах хүрээг харуулна", async () => {
    renderProjectPage("a4", <A4Page />);
    await waitFor(() => expect(screen.getByText("BW-001")).toBeInTheDocument());
    expect(screen.getByText("Төслөөсөө асуугаарай")).toBeInTheDocument();
  });
});
