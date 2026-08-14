import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

interface ToastItem {
  id: string;
  message: string;
  tone: "success" | "error" | "info";
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastItem["tone"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const showToast = useCallback(
    (message: string, tone: ToastItem["tone"] = "info") => {
      const id = crypto.randomUUID();
      setItems((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 5_000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-label="Мэдэгдэл">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            {item.tone === "success" ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <CircleAlert aria-hidden="true" />
            )}
            <span>{item.message}</span>
            <button type="button" aria-label="Мэдэгдэл хаах" onClick={() => dismiss(item.id)}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
