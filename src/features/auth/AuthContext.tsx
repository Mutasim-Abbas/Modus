import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthError, type AuthUser, me } from '@/lib/authApi';
import { getAuthAvailability, markAuthAvailable, markAuthUnavailable } from '@/features/auth/authAvailability';

export type AuthStatus = 'loading' | 'guest' | 'signed-in' | 'unconfigured';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Re-runs the "am I signed in" probe (`GET /api/auth/me`). */
  refresh: () => Promise<void>;
  /** Call after a successful signup/login/recovery-redeem. */
  signIn: (user: AuthUser) => void;
  /**
   * Drops to guest WITHOUT calling the server and WITHOUT touching the local store —
   * this is exactly the "a 401 mid-session drops to guest without losing local data"
   * acceptance criterion. Local data lives entirely in `src/lib/store.ts`, which this
   * function never imports or calls, so there is nothing here that could clear it.
   */
  signOutLocally: () => void;
  /**
   * Feeds any `AuthError` observed by a caller back into the shared auth state: an
   * `unauthorized` drops to guest (session expired/revoked elsewhere), a
   * `sync_unconfigured` hides auth entirely, everything else is left for the caller to
   * display and does not change global state.
   */
  handleAuthError: (error: unknown) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextUser = await me();
      markAuthAvailable();
      setUser(nextUser);
      setStatus('signed-in');
    } catch (error) {
      if (error instanceof AuthError && error.isUnconfigured) {
        markAuthUnavailable(error);
        setUser(null);
        setStatus('unconfigured');
        return;
      }
      if (error instanceof AuthError && error.kind === 'unauthorized') {
        markAuthAvailable();
        setUser(null);
        setStatus('guest');
        return;
      }
      // Network/server failure while merely *checking* sign-in state must never block
      // guest mode — fail open to guest, leave availability 'unknown' so a later real
      // attempt (e.g. submitting the sign-in form) can still discover the real state.
      setUser(null);
      setStatus('guest');
    }
  }, []);

  useEffect(() => {
    if (getAuthAvailability() === 'unavailable') {
      setStatus('unconfigured');
      return;
    }
    void refresh();
    // Intentionally run once on mount — `refresh` is stable (no deps) and callers use
    // the exposed `refresh()` for any subsequent re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback((nextUser: AuthUser) => {
    markAuthAvailable();
    setUser(nextUser);
    setStatus('signed-in');
  }, []);

  const signOutLocally = useCallback(() => {
    setUser(null);
    setStatus('guest');
  }, []);

  const handleAuthError = useCallback(
    (error: unknown) => {
      if (!(error instanceof AuthError)) return;
      if (error.isUnconfigured) {
        markAuthUnavailable(error);
        setUser(null);
        setStatus('unconfigured');
        return;
      }
      if (error.kind === 'unauthorized') {
        signOutLocally();
      }
    },
    [signOutLocally],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refresh, signIn, signOutLocally, handleAuthError }),
    [status, user, refresh, signIn, signOutLocally, handleAuthError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
