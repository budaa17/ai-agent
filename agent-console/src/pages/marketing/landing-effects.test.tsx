import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProductConsole } from "./landing-effects";

describe("landing product preview", () => {
  it("supports the ARIA tab keyboard pattern", async () => {
    render(
      <MemoryRouter>
        <ProductConsole />
      </MemoryRouter>,
    );

    const first = screen.getByRole("tab", { name: "01 НОТОЛГОО" });
    const second = screen.getByRole("tab", { name: "02 ХЯНАЛТ" });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(first).toHaveAttribute("aria-selected", "false");
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "bw-preview-tab-control",
    );
  });
});
