import { themeToCssVars, sanitizeTheme, DEFAULT_THEME, mergeTheme } from '@erp/shared';

/**
 * Theme engine.
 *
 * A theme is pure data. This module is the only place that turns it into
 * something the browser understands: CSS custom properties on :root, a dark
 * class, a favicon, a document title and the PWA theme colour. Components
 * never touch any of it - they read `bg-surface`, `text-muted`, `rounded`.
 *
 * The mapping comes from `themeToCssVars` in @erp/shared, the same function the
 * server validates against, so a theme cannot render differently than it saves.
 */

const CACHE_KEYS = {
  css: 'erp.theme.css',
  mode: 'erp.theme.mode',
  color: 'erp.theme.color',
  title: 'erp.branding.title',
};

let mediaQuery = null;
let modeListeners = new Set();
let currentMode = 'light';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / full storage: the app still works, it just will not pre-paint */
  }
}

export function prefersDark() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** 'system' resolves against the OS; anything else is taken literally. */
export function resolveMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return prefersDark() ? 'dark' : 'light';
}

export function applyMode(mode) {
  currentMode = resolveMode(mode);
  const root = document.documentElement;
  root.classList.toggle('dark', currentMode === 'dark');
  root.style.colorScheme = currentMode;
  root.dataset.themeMode = currentMode;
  safeSet(CACHE_KEYS.mode, mode || 'system');
  return currentMode;
}

/** Follow the OS while the tenant theme is set to 'system'. */
export function watchSystemMode(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  mediaQuery = mediaQuery || window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event) => {
    const stored = safeGet(CACHE_KEYS.mode) || 'system';
    if (stored === 'system') {
      applyMode('system');
      onChange?.(event.matches ? 'dark' : 'light');
    }
  };
  mediaQuery.addEventListener('change', handler);
  return () => mediaQuery.removeEventListener('change', handler);
}

/**
 * Write every token onto :root. Invalid or partial input is passed through the
 * shared sanitiser first, so a malformed saved theme degrades to defaults
 * instead of blanking the UI.
 */
export function applyThemeVars(theme) {
  const safe = sanitizeTheme(mergeTheme(DEFAULT_THEME, theme || {}));
  const vars = themeToCssVars(safe);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null) continue;
    root.style.setProperty(key, String(value));
  }
  safeSet(CACHE_KEYS.css, JSON.stringify(vars));
  return safe;
}

/**
 * Brand favicon. When the tenant has not uploaded one, an initial-based mark is
 * generated from their own colours - so even an unconfigured tenant gets
 * something that looks intentional rather than a default icon.
 */
export function buildFallbackFavicon({ shortName, businessName, background, foreground }) {
  const letters = (shortName || businessName || 'E')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
  const label = letters || 'E';
  const bg = background || 'var(--color-primary)';
  const fg = foreground || '#ffffff';
  const size = label.length > 1 ? 0.42 : 0.62;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="32" font-family="system-ui, -apple-system, Segoe UI, sans-serif" ` +
    `font-size="${Math.round(64 * size)}" font-weight="700" fill="${fg}" ` +
    `text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function setLinkRel(rel, href, extra = {}) {
  let link = document.querySelector(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
  for (const [key, value] of Object.entries(extra)) link.setAttribute(key, value);
}

function setMeta(name, content) {
  if (!content) return;
  let meta = document.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

/**
 * Propagate branding to the document shell: title, icons and PWA colours.
 * Called whenever branding changes, so saving in the Branding studio updates
 * the tab immediately with no reload.
 */
export function applyBranding(branding, theme) {
  const b = branding || {};
  const title = b.browserTitle || b.appName || b.businessName || 'Dashboard';
  document.title = title;
  safeSet(CACHE_KEYS.title, title);

  const favicon = b.faviconUrl || buildFallbackFavicon({
    shortName: b.shortName,
    businessName: b.businessName,
    background: theme?.colors?.primary,
  });
  setLinkRel('icon', favicon);
  setLinkRel('shortcut icon', favicon);
  setLinkRel('apple-touch-icon', b.appIconUrl || b.logoUrl || favicon);

  const themeColor = b.themeColor || theme?.colors?.primary;
  if (themeColor) {
    setMeta('theme-color', themeColor);
    safeSet(CACHE_KEYS.color, themeColor);
  }
  if (b.backgroundColor) setMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  if (b.description) {
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', b.description);
  }
}

/**
 * A tenant-branded manifest, generated in the browser and swapped in place.
 * Name, colours and icons all come from the tenant, so installing the PWA
 * produces their app, not ours.
 */
export function applyManifest(branding, theme) {
  const b = branding || {};
  const iconUrl = b.appIconUrl || b.logoUrl || null;
  const manifest = {
    name: b.appName || b.businessName || 'Management',
    short_name: b.shortName || b.appName || b.businessName || 'App',
    description: b.description || undefined,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: b.backgroundColor || theme?.colors?.background || '#f6f7fb',
    theme_color: b.themeColor || theme?.colors?.primary || '#4f46e5',
    categories: ['business', 'productivity'],
    icons: iconUrl
      ? [
          { src: iconUrl, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ]
      : [
          {
            src: buildFallbackFavicon({
              shortName: b.shortName,
              businessName: b.businessName,
              background: theme?.colors?.primary,
            }),
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
  };

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  const url = URL.createObjectURL(blob);
  setLinkRel('manifest', url);
  return url;
}

/** Everything at once - used on boot and after any theme or branding save. */
export function applyTenantAppearance({ theme, branding }) {
  const safe = applyThemeVars(theme);
  applyMode(theme?.appearance?.mode || 'system');
  applyBranding(branding, safe);
  applyManifest(branding, safe);
  return safe;
}

export function currentResolvedMode() {
  return currentMode;
}

/** Restore the last known appearance before React mounts, to avoid a flash. */
export function restoreCachedAppearance() {
  const cachedCss = safeGet(CACHE_KEYS.css);
  if (cachedCss) {
    try {
      const vars = JSON.parse(cachedCss);
      for (const [key, value] of Object.entries(vars)) {
        document.documentElement.style.setProperty(key, String(value));
      }
    } catch {
      /* ignore a corrupt cache */
    }
  }
  applyMode(safeGet(CACHE_KEYS.mode) || 'system');
  const title = safeGet(CACHE_KEYS.title);
  if (title) document.title = title;
}

export { themeToCssVars, sanitizeTheme, mergeTheme, DEFAULT_THEME };
