import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app";
import { AuthProvider } from "./auth/auth-provider";
import { PlatformAuthProvider } from "./auth/platform-auth-provider";
import { ToastProvider } from "./components/toast";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, networkMode: "offlineFirst" },
    mutations: { retry: false, networkMode: "always" },
  },
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root element олдсонгүй");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <PlatformAuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </PlatformAuthProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
