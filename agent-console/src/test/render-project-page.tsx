import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/toast";

/** Renders a `/projects/:projectId/<path>`-scoped page with router + query + toast providers. */
export function renderProjectPage(path: string, element: ReactElement, projectId = "project-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/projects/${projectId}/${path}`]}>
          <Routes>
            <Route path={`/projects/:projectId/${path}`} element={element} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
