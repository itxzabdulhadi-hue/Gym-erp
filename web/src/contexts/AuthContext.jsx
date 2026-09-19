import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { hasPermission } from '@erp/shared';
import { authToken, setUnauthorizedHandler, setTenantOverride } from '@/lib/apiClient';
import authApi from '@/services/auth.api';
import { normalizeModules } from '@/services/modules.api';
import { normalizeBranding } from '@/services/branding.api';

/**
 * Session state for the whole app.
 *
 * On a cold load there is no access token in memory - only the httpOnly refresh
 * cookie the browser holds. So boot tries a refresh, then loads /auth/me. Until
 * that resolves the app shows a splash rather than a login screen, so a signed
 * in user is never bounced through the login form on a reload.
 *
 * Permissions and enabled modules come from the server on every load. The UI
 * uses them to decide what to show; the server enforces them regardless.
 */

const AuthContext = createContext(null);

const STATUS = {
  INITIALIZING: 'initializing',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
};

function emptySession() {
  return {
    user: null,
    tenant: null,
    roles: [],
    permissions: [],
    modules: [],
    branding: normalizeBranding(null),
    theme: null,
    counts: {},
  };
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(STATUS.INITIALIZING);
  const [session, setSession] = useState(emptySession);
  const [lastError, setLastError] = useState(null);
  const bootstrapped = useRef(false);

  const applySession = useCallback((next) => {
    setSession({
      user: next.user || null,
      tenant: next.tenant || null,
      roles: next.roles || [],
      permissions: next.permissions || [],
      modules: normalizeModules(next.modules),
      branding: normalizeBranding(next.branding),
      theme: next.theme || null,
      counts: next.counts || {},
    });
  }, []);

  const signOut = useCallback(() => {
    authToken.clear();
    setSession(emptySession());
    setStatus(STATUS.UNAUTHENTICATED);
  }, []);

  /** Pull the full workspace for the current session. */
  const refresh = useCallback(async () => {
    const me = await authApi.me();
    applySession(me);
    setStatus(STATUS.AUTHENTICATED);
    return me;
  }, [applySession]);

  // Boot once. A 401 from the refresh simply means "not signed in".
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      try {
        await authApi.restore().catch(() => null);
        await refresh();
      } catch {
        authToken.clear();
        setSession(emptySession());
        setStatus(STATUS.UNAUTHENTICATED);
      }
    })();
  }, [refresh]);

  // Any 401 that survives a refresh attempt ends the session app wide.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(emptySession());
      setStatus(STATUS.UNAUTHENTICATED);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(
    async (credentials) => {
      setLastError(null);
      const result = await authApi.login(credentials);
      await refresh();
      return result;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => null);
    signOut();
  }, [signOut]);

  const logoutEverywhere = useCallback(async () => {
    await authApi.logoutAll().catch(() => null);
    signOut();
  }, [signOut]);

  /** Permission check. `can('members.view')` or `can(['a','b'])` for any-of. */
  const can = useCallback(
    (key) => {
      if (!key) return true;
      const keys = Array.isArray(key) ? key : [key];
      return keys.some((k) => hasPermission(session.permissions, k));
    },
    [session.permissions],
  );

  const canAll = useCallback(
    (keys) => (Array.isArray(keys) ? keys : [keys]).every((k) => hasPermission(session.permissions, k)),
    [session.permissions],
  );

  /** Module gate - mirrors what the API enforces with MODULE_DISABLED. */
  const moduleEnabled = useCallback(
    (key) => session.modules.some((m) => m.key === key && m.enabled),
    [session.modules],
  );

  /** Platform admins can scope the whole UI to another tenant. */
  const actAsTenant = useCallback((tenantId) => {
    setTenantOverride(tenantId);
  }, []);

  const value = useMemo(
    () => ({
      status,
      isInitializing: status === STATUS.INITIALIZING,
      isAuthenticated: status === STATUS.AUTHENTICATED,
      ...session,
      enabledModuleKeys: session.modules.filter((m) => m.enabled).map((m) => m.key),
      lastError,
      login,
      logout,
      logoutEverywhere,
      refresh,
      can,
      canAll,
      moduleEnabled,
      actAsTenant,
      signOut,
    }),
    [status, session, lastError, login, logout, logoutEverywhere, refresh, can, canAll, moduleEnabled, actAsTenant, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Convenience for components that only need a permission decision. */
export function usePermission(key) {
  const { can } = useAuth();
  return can(key);
}

export { STATUS as AUTH_STATUS };
export default AuthContext;
