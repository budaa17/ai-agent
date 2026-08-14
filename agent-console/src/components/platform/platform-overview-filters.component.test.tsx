import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlatformOverviewFilters } from "./platform-overview-filters";

function renderFilters() {
  const onApply = vi.fn();
  render(
    <PlatformOverviewFilters
      query={{ window: "24h" }}
      tenantOptions={[]}
      agentOptions={[]}
      fetching={false}
      onApply={onApply}
      onRefresh={vi.fn()}
    />,
  );
  return onApply;
}

describe("PlatformOverviewFilters", () => {
  it("blocks a reversed custom range before calling the API query", async () => {
    const user = userEvent.setup();
    const onApply = renderFilters();
    await user.selectOptions(screen.getByLabelText("Хугацаа"), "custom");
    await user.type(screen.getByLabelText("Эхлэх · Улаанбаатар"), "2026-08-02T08:00");
    await user.type(screen.getByLabelText("Дуусах · Улаанбаатар"), "2026-08-01T08:00");

    await user.click(screen.getByRole("button", { name: "Filter хэрэглэх" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("эхлэл төгсгөлөөс өмнө");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("converts an Ulaanbaatar custom range to an exact UTC half-open query", async () => {
    const user = userEvent.setup();
    const onApply = renderFilters();
    await user.selectOptions(screen.getByLabelText("Хугацаа"), "custom");
    await user.type(screen.getByLabelText("Эхлэх · Улаанбаатар"), "2026-08-01T08:00");
    await user.type(screen.getByLabelText("Дуусах · Улаанбаатар"), "2026-08-02T08:00");

    await user.click(screen.getByRole("button", { name: "Filter хэрэглэх" }));

    expect(onApply).toHaveBeenCalledWith({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    });
  });
});
