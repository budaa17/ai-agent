import { useEffect, useState } from "react";
import { buildWatchApi } from "../api/client";
import { syncOutbox } from "./outbox";

/** How often to re-ask the API while the browser believes it has a network. */
const PROBE_INTERVAL_MS = 20_000;

export type ConnectivityState = "ONLINE" | "OFFLINE" | "API_UNREACHABLE";

/**
 * `navigator.onLine` only says whether the device has *a* network — site wifi
 * with no route to the office still reports true. A supervisor who trusts that
 * would think the report was delivered. So readiness is confirmed against the
 * API itself, and the three states are kept apart:
 *
 *   ONLINE           network + API answering
 *   API_UNREACHABLE  network, but BuildWatch is not responding
 *   OFFLINE          no network at all
 */
export function useConnectivityState(): ConnectivityState {
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [apiReachable, setApiReachable] = useState(true);

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      void syncOutbox();
    };
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void syncOutbox();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    // No point probing without a network; the OFFLINE branch below wins anyway,
    // so the last known reachability can simply go stale until we are back.
    if (!browserOnline) return;
    let cancelled = false;
    const probe = async () => {
      const ready = await buildWatchApi.health("ready");
      if (cancelled) return;
      setApiReachable((previous) => {
        // Recovering from an outage is a good moment to drain the outbox.
        if (ready && !previous) void syncOutbox();
        return ready;
      });
    };
    void probe();
    const timer = window.setInterval(() => void probe(), PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [browserOnline]);

  if (!browserOnline) return "OFFLINE";
  return apiReachable ? "ONLINE" : "API_UNREACHABLE";
}

/** Convenience wrapper for callers that only need "can I send right now". */
export function useConnectivity(): boolean {
  return useConnectivityState() === "ONLINE";
}
