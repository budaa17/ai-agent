import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformFetch } from "../../api/platform-client";
import { PlatformBillingPage } from "./billing-page";

vi.mock("../../api/platform-client", () => ({ platformFetch: vi.fn() }));

const fetchMock = vi.mocked(platformFetch);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlatformBillingPage />
    </QueryClientProvider>,
  );
}

describe("platform billing page", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (path) => {
      if (path === "/billing/overview") {
        return {
          active: 4,
          activeTenants: 4,
          activeSubscriptions: 0,
          activeWithoutSubscription: 4,
          pendingPayment: 0,
          inGrace: 0,
          suspended: 0,
          graceEndingWithin7Days: 0,
          failedWebhooks: 0,
          unpaidInvoices: 0,
        } as never;
      }
      if (path === "/billing/subscriptions") return { subscriptions: [] } as never;
      if (path === "/billing/webhooks") return { events: [] } as never;
      throw new Error(`Unexpected path ${path}`);
    });
  });

  it("does not present active workspaces as paid subscriptions", async () => {
    renderPage();

    expect(await screen.findByText("Идэвхтэй workspace")).toBeInTheDocument();
    expect(screen.getByText("Идэвхтэй subscription")).toBeInTheDocument();
    expect(screen.getByText("Subscription нотолгоогүй")).toBeInTheDocument();
    expect(screen.getByText(/төлбөр төлсөн компани гэж тооцохгүй/)).toBeInTheDocument();
  });
});
