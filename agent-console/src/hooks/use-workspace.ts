import { useQuery } from "@tanstack/react-query";
import { BuildWatchApiError, buildWatchApi } from "../api/client";
import { cacheWorkspace, cachedWorkspace } from "../offline/database";

export function useWorkspace(projectId: string | undefined) {
  return useQuery({
    queryKey: ["workspace", projectId],
    enabled: projectId !== undefined,
    queryFn: async () => {
      if (projectId === undefined) throw new Error("Project id required");
      try {
        const workspace = await buildWatchApi.workspace(projectId);
        await cacheWorkspace(workspace);
        return { workspace, offline: false, cachedAt: null as string | null };
      } catch (error) {
        const cached = await cachedWorkspace(projectId);
        const networkFailure =
          !(error instanceof BuildWatchApiError) || error.status === 0 || error.status >= 500;
        if (cached !== undefined && (networkFailure || !navigator.onLine)) {
          return { workspace: cached.workspace, offline: true, cachedAt: cached.cachedAt };
        }
        throw error;
      }
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    networkMode: "always",
  });
}
