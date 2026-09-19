import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { sanitizeTheme, mergeTheme, DEFAULT_THEME } from '@erp/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { BrandMarkLight } from '@/components/layout/BrandMark';
import { useAuth } from '@/contexts/AuthContext';
import { applyTenantAppearance } from '@/lib/themeEngine';
import brandingApi, { normalizeBranding } from '@/services/branding.api';

/**
 * Sign in.
 *
 * The screen is not ours - it is the tenant's. As soon as a workspace is
 * identified, its logo, name, tagline, colours and login background are applied
 * to this very page, before anybody authenticates. That is the whole point of a
 * white-label product: the first thing a gym owner's members see is the gym.
 */

const SLUG_KEY = 'erp.lastWorkspace';

export function LoginPage() {
  const { login, isAuthenticated, branding: sessionBranding } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [slug, setSlug] = useState(() => {
    try {
      return params.get('workspace') || localStorage.getItem(SLUG_KEY) || '';
    } catch {
      return params.get('workspace') || '';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  // Branding shown before login: the tenant's if we resolved one, otherwise
  // whatever the session already carries.
  const [preview, setPreview] = useState(() => ({
    found: false,
    branding: normalizeBranding(null),
    theme: null,
    tenant: null,
  }));
  const lookupTimer = useRef(null);

  const branding = preview.found ? preview.branding : sessionBranding || normalizeBranding(null);
  const theme = preview.theme?.config || preview.theme || null;

  // Paint the tenant's identity onto this page as soon as we know it.
  useEffect(() => {
    if (preview.found) {
      applyTenantAppearance({ theme: preview.theme?.config || preview.theme, branding: preview.branding });
    }
  }, [preview]);

  const loadBranding = useCallback(async (value) => {
    const candidate = String(value || '').trim();
    if (!candidate) return;
    setLookingUp(true);
    try {
      const result = await brandingApi.public(candidate);
      setPreview({ ...result, branding: result.branding || normalizeBranding(null) });
      if (result.found) {
        try {
          localStorage.setItem(SLUG_KEY, candidate);
        } catch {
          /* non-fatal */
        }
      }
    } catch {
      // An unknown workspace is not an error yet - the server will confirm on submit.
      setPreview((prev) => ({ ...prev, found: false }));
    } finally {
      setLookingUp(false);
    }
  }, []);

  // Resolve branding for a prefilled workspace on mount.
  useEffect(() => {
    if (slug) loadBranding(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced lookup while typing a workspace.
  useEffect(() => {
    if (!slug) return undefined;
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(() => loadBranding(slug), 450);
    return () => clearTimeout(lookupTimer.current);
  }, [slug, loadBranding]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const target = location.state?.from?.pathname || '/';
    navigate(target, { replace: true });
  }, [isAuthenticated, navigate, location.state]);

  const background = branding?.loginBackgroundUrl;
  const businessName = branding?.businessName || 'Your business';
  const tagline = branding?.tagline || branding?.description;

  const onSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!slug.trim()) {
      setFieldErrors({ slug: 'Enter your workspace to continue' });
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: email.trim(), password, tenantSlug: slug.trim().toLowerCase() });
      try {
        localStorage.setItem(SLUG_KEY, slug.trim().toLowerCase());
      } catch {
        /* non-fatal */
      }
    } catch (error) {
      if (error?.isValidation) setFieldErrors(error.fieldErrors());
      setFormError(error?.message || 'Unable to sign in. Check your details and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const accentStyle = useMemo(() => {
    const color = branding?.themeColor || theme?.colors?.primary;
    return color ? { '--login-accent': color } : undefined;
  }, [branding, theme]);

  return (
    <div className="relative flex min-h-dvh flex-col bg-background lg:flex-row" style={accentStyle}>
      {/* --------------------------- Brand panel --------------------------- */}
      <aside
        className={cn(
          'relative hidden overflow-hidden bg-secondary lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-10',
        )}
        aria-hidden="true"
      >
        {background ? (
          <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_0%,var(--color-primary)_0%,transparent_55%)] opacity-90" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.35),rgba(2,6,23,0.82))]" />

        <div className="relative">
          <BrandMarkLight branding={branding} size="lg" className="drop-shadow" />
          <p className="mt-4 text-sm font-medium text-white/85">{businessName}</p>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            {tagline || 'Run every part of your business from one place.'}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Members, memberships, attendance, payments, programs and reporting — with your branding,
            your colours and your team's permissions.
          </p>
        </div>

        <p className="relative text-xs text-white/45">
          {branding?.website ? (
            <a href={branding.website} className="hover:text-white/70">{branding.website}</a>
          ) : (
            'Secure sign in'
          )}
        </p>
      </aside>

      {/* ---------------------------- Form panel --------------------------- */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="lg:hidden">
              <BrandMarkLight branding={branding} size="lg" />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground lg:mt-0">
              Sign in
            </h1>
            <p className="mt-1 text-sm text-muted">
              {preview.found ? (
                <>
                  Continue to <span className="font-medium text-foreground">{businessName}</span>
                </>
              ) : (
                'Enter your workspace to continue'
              )}
            </p>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field
              label="Workspace"
              htmlFor="workspace"
              error={fieldErrors.slug}
              hint={preview.found ? preview.tenant?.name : 'The address your business was set up with'}
            >
              <div className="relative">
                <Input
                  id="workspace"
                  name="workspace"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="your-business"
                  autoComplete="organization"
                  autoCapitalize="none"
                  spellCheck={false}
                  invalid={!!fieldErrors.slug}
                  className="pr-9"
                />
                {lookingUp && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                )}
              </div>
            </Field>

            <Field label="Email" htmlFor="email" error={fieldErrors.email}>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                invalid={!!fieldErrors.email}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={fieldErrors.password}>
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                invalid={!!fieldErrors.password}
              />
            </Field>

            {formError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded bg-danger-soft px-3 py-2.5 text-xs text-danger"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </p>
            )}

            <Button type="submit" className="w-full" size="lg" loading={submitting} disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
              {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => navigate(`/forgot-password${slug ? `?workspace=${encodeURIComponent(slug)}` : ''}`)}
              className="font-medium text-primary hover:underline"
            >
              Forgot password?
            </button>
            {branding?.email && (
              <a href={`mailto:${branding.email}`} className="text-muted hover:text-foreground">
                {branding.email}
              </a>
            )}
          </div>

          <p className="mt-8 text-center text-[0.6875rem] text-muted">
            Protected area. Access is logged.
          </p>
        </div>
      </main>
    </div>
  );
}

export default LoginPage;
