import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { buildWatchApi, type LoginRequest, type TenantSelectionRequest } from "../api/client";
import type { LoginResult, Session } from "../api/schemas";
import { getTokens, setTokens, subscribeTokens, type TokenPair } from "./token-store";

interface AuthContextValue {
  tokens: TokenPair | null;
  session: Session | null;
  loading: boolean;
  /** Resolves to the organization choice when one email and password unlock several. */
  login: (input: LoginRequest) => Promise<LoginResult>;
  completeTenantSelection: (input: TenantSelectionRequest) => Promise<void>;
  logout: () => Promise<void>;
  hasTenantPermission: (permission: string) => boolean;
  hasProjectPermission: (projectId: string, permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [tokens, setTokenState] = useState<TokenPair | null>(() => getTokens());
  useEffect(() => subscribeTokens(setTokenState), []);
  const sessionQuery = useQuery({
    queryKey: ["session", tokens?.accessToken ?? null],
    queryFn: buildWatchApi.session,
    enabled: tokens !== null,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (sessionQuery.isError && getTokens() === null) queryClient.clear();
  }, [queryClient, sessionQuery.isError]);

  const login = useCallback(
    async (input: LoginRequest) => {
      const result = await buildWatchApi.login(input);
      if (result.status === "AUTHENTICATED") {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
      }
      return result;
    },
    [queryClient],
  );

  const completeTenantSelection = useCallback(
    async (input: TenantSelectionRequest) => {
      await buildWatchApi.completeTenantSelection(input);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await buildWatchApi.logout();
    setTokens(null);
    queryClient.clear();
  }, [queryClient]);

  const session = sessionQuery.data ?? null;
  const hasTenantPermission = useCallback(
    (permission: string) => session?.tenantPermissions.includes(permission) ?? false,
    [session],
  );
  const hasProjectPermission = useCallback(
    (projectId: string, permission: string) => {
      if (session?.tenantPermissions.includes(permission)) return true;
      return (
        session?.projectMemberships
          .find((membership) => membership.projectId === projectId)
          ?.permissions.includes(permission) ?? false
      );
    },
    [session],
  );
  const value = useMemo<AuthContextValue>(
    () => ({
      tokens,
      session,
      loading: tokens !== null && sessionQuery.isPending,
      login,
      completeTenantSelection,
      logout,
      hasTenantPermission,
      hasProjectPermission,
    }),
    [
      completeTenantSelection,
      hasProjectPermission,
      hasTenantPermission,
      login,
      logout,
      session,
      sessionQuery.isPending,
      tokens,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
