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
import { platformApi } from "../api/platform-client";
import type {
  PlatformLoginRequest,
  PlatformPermission,
  PlatformSession,
} from "../api/platform-schemas";
import type { TokenPair } from "./token-store";
import {
  getPlatformTokens,
  setPlatformTokens,
  subscribePlatformTokens,
} from "./platform-token-store";

interface PlatformAuthContextValue {
  tokens: TokenPair | null;
  session: PlatformSession | null;
  loading: boolean;
  login: (input: PlatformLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  hasPlatformPermission: (permission: PlatformPermission) => boolean;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

function platformSessionQueryKey(accessToken: string | null) {
  return ["platform", "session", accessToken] as const;
}

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [tokens, setTokenState] = useState<TokenPair | null>(() => getPlatformTokens());

  useEffect(() => subscribePlatformTokens(setTokenState), []);
  useEffect(() => {
    if (tokens === null) queryClient.removeQueries({ queryKey: ["platform"] });
  }, [queryClient, tokens]);

  const sessionQuery = useQuery({
    queryKey: platformSessionQueryKey(tokens?.accessToken ?? null),
    queryFn: platformApi.session,
    enabled: tokens !== null,
    retry: false,
    staleTime: 60_000,
  });

  const login = useCallback(
    async (input: PlatformLoginRequest) => {
      const nextTokens = await platformApi.login(input);
      try {
        await queryClient.fetchQuery({
          queryKey: platformSessionQueryKey(nextTokens.accessToken),
          queryFn: platformApi.session,
          staleTime: 60_000,
        });
      } catch (error) {
        setPlatformTokens(null);
        throw error;
      }
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await platformApi.logout();
    queryClient.removeQueries({ queryKey: ["platform"] });
  }, [queryClient]);

  const session = sessionQuery.data ?? null;
  const hasPlatformPermission = useCallback(
    (permission: PlatformPermission) => session?.permissions.includes(permission) ?? false,
    [session],
  );
  const value = useMemo<PlatformAuthContextValue>(
    () => ({
      tokens,
      session,
      loading: tokens !== null && sessionQuery.isPending,
      login,
      logout,
      hasPlatformPermission,
    }),
    [hasPlatformPermission, login, logout, session, sessionQuery.isPending, tokens],
  );

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const context = useContext(PlatformAuthContext);
  if (context === null) {
    throw new Error("usePlatformAuth must be used inside PlatformAuthProvider");
  }
  return context;
}
