import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PageLoader } from '@/components/ui/States';
import { ForbiddenPage } from '@/pages/errors/StatusPages';

/**
 * Route guards.
 *
 * These exist for navigation hygiene, not for security - the API re-checks
 * every permission and every module on every request, so a tampered client
 * still cannot read another tenant's data or reach a disabled module.
 */

/** Blocks rendering of any protected tree until the session is resolved. */
export function RequireAuth({ children }) {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();

  // While the refresh cookie is being exchanged we show a splash, not the login
  // form, so a signed-in user is never bounced through sign-in on a reload.
  if (status === 'initializing') return <PageLoader label="Restoring your session" />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

/** Sends an already-signed-in user away from the login screen. */
export function RedirectIfAuthenticated({ children }) {
  const { status, isAuthenticated } = useAuth();
  if (status === 'initializing') return <PageLoader label="Checking your session" />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

/** Permission gate. `permission` may be a key or an any-of array. */
export function RequirePermission({ permission, children }) {
  const { can } = useAuth();
  if (permission && !can(permission)) {
    return <ForbiddenPage permission={Array.isArray(permission) ? permission.join(' or ') : permission} />;
  }
  return children;
}

/**
 * Module gate. A module disabled for the tenant is not merely hidden from the
 * menu - its routes render a clear explanation rather than a half-broken page.
 */
export function RequireModule({ module: moduleName, children }) {
  const { moduleEnabled } = useAuth();
  if (moduleName && !moduleEnabled(moduleName)) {
    return <ForbiddenPage module={moduleName} />;
  }
  return children;
}
