import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/toast";
import { RulesPage } from "./rules-page";

// The real editor pulls in Ant Design and a canvas-based graph renderer that
// jsdom cannot lay out; this page test covers the rule catalog around it.
vi.mock("@gorules/jdm-editor", () => ({
  DecisionGraph: () => <div data-testid="decision-graph" />,
  JdmConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@gorules/jdm-editor/dist/style.css", () => ({}));

vi.mock("../api/client", () => ({
  buildWatchApi: {
    listRules: vi.fn(async () => [
      { ruleId: "OVERDUE_WORK_ITEM", source: "DEFAULT", latestVersion: null },
      {
        ruleId: "MATERIAL_OVERUSE",
        source: "TENANT",
        latestVersion: { id: "version-1", versionNumber: 3, status: "APPLIED" },
      },
    ]),
    listRuleVersions: vi.fn(async () => ({
      ruleId: "OVERDUE_WORK_ITEM",
      defaultGraph: { nodes: [], edges: [] },
      versions: [],
    })),
    saveRuleDraft: vi.fn(),
    publishRuleVersion: vi.fn(),
  },
}));

function renderRulesPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RulesPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Rules page", () => {
  it("дүрмийн каталогийг Монгол нэрээр харуулна", async () => {
    renderRulesPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Дүрмийн засварлагч" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Хугацаа хэтрэлт")).toBeInTheDocument();
    expect(screen.getByText("Материал хэтрүүлэлт")).toBeInTheDocument();
  });

  it("tenant-ийн нийтэлсэн хувилбар болон default-ыг ялгаж тэмдэглэнэ", async () => {
    renderRulesPage();

    await waitFor(() => expect(screen.getByText("default")).toBeInTheDocument());
    expect(screen.getByText("v3")).toBeInTheDocument();
  });
});
