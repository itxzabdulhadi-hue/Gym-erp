import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME, mergeTheme, sanitizeTheme } from '@erp/shared';
import {
  applyTenantAppearance,
  applyMode,
  applyThemeVars,
  applyBranding,
  resolveMode,
  watchSystemMode,
} from '@/lib/themeEngine';
import { useAuth } from './AuthContext';

/**
 * Live theme state.
 *
 * `committed` is what the server holds; `draft` is what the Theme Studio is
 * editing. The preview applies `draft` immediately so a colour or radius change
 * is visible without saving - and `discard()` puts `committed` back, which is
 * what makes the studio's Reset button honest rather than cosmetic.
 */

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { theme: serverTheme, branding } = useAuth();
  const config = serverTheme?.config || null;

  const [committed, setCommitted] = useState(() => sanitizeTheme(mergeTheme(DEFAULT_THEME, config)));
  const [draft, setDraft] = useState(committed);
  const [resolvedMode, setResolvedMode] = useState(() => resolveMode(committed.appearance?.mode));

  // Keep the DOM in sync with the tenant's saved theme.
  useEffect(() => {
    const safe = sanitizeTheme(mergeTheme(DEFAULT_THEME, config));
    setCommitted(safe);
    setDraft(safe);
    const mode = applyTenantAppearance({ theme: safe, branding });
    setResolvedMode(resolveMode(safe.appearance?.mode));
    return undefined;
  }, [config, branding]);

  // Follow the OS while the theme says 'system'.
  useEffect(() => watchSystemMode((m) => setResolvedMode(m)), [committed.appearance?.mode]);

  /** Live preview: paint the draft without touching the server. */
  const preview = useCallback((patch) => {
    setDraft((prev) => {
      const next = sanitizeTheme(mergeTheme(prev, patch));
      applyThemeVars(next);
      applyMode(next.appearance?.mode || 'system');
      setResolvedMode(resolveMode(next.appearance?.mode));
      return next;
    });
  }, []);

  /** Full replacement, used when a preset is applied. */
  const previewTheme = useCallback((nextTheme) => {
    const next = sanitizeTheme(mergeTheme(DEFAULT_THEME, nextTheme));
    setDraft(next);
    applyThemeVars(next);
    applyMode(next.appearance?.mode || 'system');
    setResolvedMode(resolveMode(next.appearance?.mode));
  }, []);

  /** Abandon edits and repaint what the server has. */
  const discard = useCallback(() => {
    setDraft(committed);
    applyThemeVars(committed);
    applyMode(committed.appearance?.mode || 'system');
    setResolvedMode(resolveMode(committed.appearance?.mode));
  }, [committed]);

  /** Called after a successful save so the committed baseline moves forward. */
  const commit = useCallback((savedConfig) => {
    const safe = sanitizeTheme(mergeTheme(DEFAULT_THEME, savedConfig));
    setCommitted(safe);
    setDraft(safe);
    applyThemeVars(safe);
    applyMode(safe.appearance?.mode || 'system');
    setResolvedMode(resolveMode(safe.appearance?.mode));
  }, []);

  /** Quick appearance switch (light / dark / system) with instant feedback. */
  const setMode = useCallback(
    (mode) => {
      preview({ appearance: { mode } });
    },
    [preview],
  );

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(committed), [draft, committed]);

  const value = useMemo(
    () => ({
      theme: draft,
      committed,
      isDirty,
      resolvedMode,
      branding,
      preview,
      previewTheme,
      discard,
      commit,
      setMode,
      reapplyBranding: () => applyBranding(branding, draft),
    }),
    [draft, committed, isDirty, resolvedMode, branding, preview, previewTheme, discard, commit, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export default ThemeContext;
