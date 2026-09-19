/**
 * Theme contract.
 *
 * The theme is pure data: a JSON object that is translated into CSS custom
 * properties at runtime. Because it is data (not code), it can be stored per
 * tenant, duplicated, exported, imported and previewed live.
 *
 * `sanitizeTheme()` is the trust boundary - it is used by the API before
 * persisting a theme and by the client before applying one, so a malicious or
 * malformed payload can never inject arbitrary CSS through a theme token.
 */

export const COLOR_TOKENS = [
  { key: 'primary', label: 'Primary', group: 'Brand' },
  { key: 'primaryForeground', label: 'Primary text', group: 'Brand' },
  { key: 'secondary', label: 'Secondary', group: 'Brand' },
  { key: 'secondaryForeground', label: 'Secondary text', group: 'Brand' },
  { key: 'accent', label: 'Accent', group: 'Brand' },
  { key: 'accentForeground', label: 'Accent text', group: 'Brand' },
  { key: 'background', label: 'Background', group: 'Surfaces' },
  { key: 'surface', label: 'Surface / card', group: 'Surfaces' },
  { key: 'surfaceAlt', label: 'Surface (alternate)', group: 'Surfaces' },
  { key: 'inputBackground', label: 'Input background', group: 'Surfaces' },
  { key: 'border', label: 'Border', group: 'Surfaces' },
  { key: 'text', label: 'Text', group: 'Text' },
  { key: 'mutedText', label: 'Muted text', group: 'Text' },
  { key: 'success', label: 'Success', group: 'Status' },
  { key: 'warning', label: 'Warning', group: 'Status' },
  { key: 'error', label: 'Error', group: 'Status' },
  { key: 'info', label: 'Info', group: 'Status' },
  { key: 'sidebarBackground', label: 'Sidebar background', group: 'Chrome' },
  { key: 'sidebarForeground', label: 'Sidebar text', group: 'Chrome' },
  { key: 'sidebarActiveBackground', label: 'Sidebar active item', group: 'Chrome' },
  { key: 'sidebarActiveForeground', label: 'Sidebar active text', group: 'Chrome' },
  { key: 'navbarBackground', label: 'Navbar background', group: 'Chrome' },
  { key: 'ring', label: 'Focus ring', group: 'Chrome' },
];

export const RADIUS_PRESETS = [
  { value: 0, label: 'Sharp' },
  { value: 4, label: 'Subtle' },
  { value: 8, label: 'Rounded' },
  { value: 12, label: 'Soft' },
  { value: 18, label: 'Very round' },
  { value: 999, label: 'Pill' },
];

export const FONT_PRESETS = [
  { value: 'Inter', label: 'Inter', stack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', stack: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { value: 'Manrope', label: 'Manrope', stack: "'Manrope', system-ui, sans-serif" },
  { value: 'Outfit', label: 'Outfit', stack: "'Outfit', system-ui, sans-serif" },
  { value: 'Sora', label: 'Sora', stack: "'Sora', system-ui, sans-serif" },
  { value: 'DM Sans', label: 'DM Sans', stack: "'DM Sans', system-ui, sans-serif" },
  { value: 'Space Grotesk', label: 'Space Grotesk', stack: "'Space Grotesk', system-ui, sans-serif" },
  { value: 'Roboto', label: 'Roboto', stack: "'Roboto', system-ui, sans-serif" },
  { value: 'Poppins', label: 'Poppins', stack: "'Poppins', system-ui, sans-serif" },
  { value: 'Lato', label: 'Lato', stack: "'Lato', system-ui, sans-serif" },
  { value: 'IBM Plex Sans', label: 'IBM Plex Sans', stack: "'IBM Plex Sans', system-ui, sans-serif" },
  { value: 'System', label: 'System default', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
];

export const ENUMS = {
  mode: ['light', 'dark', 'system'],
  cardStyle: ['flat', 'outlined', 'elevated'],
  buttonStyle: ['solid', 'soft', 'outline', 'pill'],
  shadow: ['none', 'sm', 'md', 'lg'],
  tableStyle: ['plain', 'striped', 'bordered'],
  inputStyle: ['outlined', 'filled', 'underlined'],
  sidebarStyle: ['solid', 'soft', 'glass'],
  navbarStyle: ['solid', 'glass', 'bordered'],
  density: ['compact', 'comfortable', 'spacious'],
  sidebarPosition: ['left', 'right'],
  contentWidth: ['full', 'wide', 'boxed'],
  fontSource: ['preset', 'google', 'custom'],
};

export const DEFAULT_THEME = Object.freeze({
  colors: {
    primary: '#4f46e5',
    primaryForeground: '#ffffff',
    secondary: '#0f172a',
    secondaryForeground: '#ffffff',
    accent: '#f59e0b',
    accentForeground: '#1f2937',
    background: '#f6f7fb',
    surface: '#ffffff',
    surfaceAlt: '#f1f3f9',
    inputBackground: '#ffffff',
    border: '#e3e6ef',
    text: '#111827',
    mutedText: '#6b7280',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
    info: '#0284c7',
    sidebarBackground: '#0f172a',
    sidebarForeground: '#cbd5e1',
    sidebarActiveBackground: '#4f46e5',
    sidebarActiveForeground: '#ffffff',
    navbarBackground: '#ffffff',
    ring: '#6366f1',
  },
  appearance: {
    mode: 'light',
    radius: 12,
    cardStyle: 'elevated',
    buttonStyle: 'solid',
    shadow: 'md',
    tableStyle: 'plain',
    inputStyle: 'outlined',
    sidebarStyle: 'solid',
    navbarStyle: 'solid',
    density: 'comfortable',
  },
  typography: {
    fontFamily: 'Inter',
    fontSource: 'preset',
    customFontUrl: '',
    headingFontFamily: 'inherit',
    fontScale: 1,
  },
  layout: {
    sidebarPosition: 'left',
    sidebarWidth: 264,
    sidebarCollapsible: true,
    navbarStyle: 'sticky',
    contentWidth: 'wide',
    dashboardColumns: 12,
  },
});

const PRESET_LIGHT = {
  ...DEFAULT_THEME.colors,
};

const PRESET_DARK = {
  background: '#0b1120',
  surface: '#111a2e',
  surfaceAlt: '#16203a',
  inputBackground: '#0e1729',
  border: '#22304f',
  text: '#e6edf7',
  mutedText: '#8ea0bd',
  sidebarBackground: '#080e1c',
  sidebarForeground: '#a9bad6',
  navbarBackground: '#0e1729',
};

/** Ready-made themes offered in the Theme Studio. */
export const THEME_PRESETS = [
  {
    name: 'Default',
    description: 'Balanced indigo SaaS look.',
    config: DEFAULT_THEME,
  },
  {
    name: 'Midnight',
    description: 'Dark, low-glare night shift theme.',
    config: {
      colors: { ...PRESET_DARK, primary: '#6366f1', primaryForeground: '#ffffff', accent: '#22d3ee', ring: '#818cf8' },
      appearance: { ...DEFAULT_THEME.appearance, mode: 'dark', cardStyle: 'outlined', shadow: 'sm' },
    },
  },
  {
    name: 'Modern Blue',
    description: 'Clean blue and white corporate.',
    config: {
      colors: { ...PRESET_LIGHT, primary: '#1d4ed8', ring: '#3b82f6', accent: '#0ea5e9', sidebarBackground: '#0b2545', sidebarActiveBackground: '#1d4ed8' },
      appearance: { ...DEFAULT_THEME.appearance, radius: 8, cardStyle: 'outlined', buttonStyle: 'solid' },
    },
  },
  {
    name: 'Luxury',
    description: 'Charcoal and gold, high contrast.',
    config: {
      colors: {
        ...PRESET_DARK, background: '#0c0a09', surface: '#1c1917', surfaceAlt: '#292524', inputBackground: '#1c1917',
        border: '#3f3a34', text: '#f5f0e8', mutedText: '#a8a29e', primary: '#c9a227', primaryForeground: '#1c1917',
        accent: '#c9a227', ring: '#c9a227', sidebarBackground: '#0c0a09', sidebarForeground: '#d6d3d1',
        sidebarActiveBackground: '#c9a227', sidebarActiveForeground: '#1c1917', navbarBackground: '#1c1917',
      },
      appearance: { ...DEFAULT_THEME.appearance, mode: 'dark', radius: 4, cardStyle: 'outlined', shadow: 'none', buttonStyle: 'solid' },
    },
  },
  {
    name: 'Titan Fitness',
    description: 'Red and black, high energy gym branding.',
    config: {
      colors: {
        ...PRESET_DARK, background: '#0a0a0a', surface: '#141414', surfaceAlt: '#1f1f1f', inputBackground: '#141414',
        border: '#2a2a2a', text: '#fafafa', mutedText: '#a1a1aa', primary: '#dc2626', primaryForeground: '#ffffff',
        accent: '#f97316', ring: '#ef4444', sidebarBackground: '#000000', sidebarForeground: '#a1a1aa',
        sidebarActiveBackground: '#dc2626', navbarBackground: '#141414',
      },
      appearance: { ...DEFAULT_THEME.appearance, mode: 'dark', radius: 4, cardStyle: 'outlined', buttonStyle: 'solid', shadow: 'sm' },
    },
  },
  {
    name: 'Elite Fitness',
    description: 'Blue and white, bright and clinical.',
    config: {
      colors: {
        ...PRESET_LIGHT, background: '#f8fafc', primary: '#2563eb', ring: '#3b82f6', accent: '#06b6d4',
        sidebarBackground: '#eff6ff', sidebarForeground: '#1e3a8a', sidebarActiveBackground: '#2563eb',
        sidebarActiveForeground: '#ffffff', border: '#dbeafe',
      },
      appearance: { ...DEFAULT_THEME.appearance, mode: 'light', radius: 16, cardStyle: 'elevated', sidebarStyle: 'soft' },
    },
  },
  {
    name: 'Emerald Clinic',
    description: 'Calm green palette for health verticals.',
    config: {
      colors: { ...PRESET_LIGHT, primary: '#0f766e', ring: '#14b8a6', accent: '#0ea5e9', sidebarBackground: '#042f2e', sidebarActiveBackground: '#0f766e' },
      appearance: { ...DEFAULT_THEME.appearance, radius: 18, cardStyle: 'elevated' },
    },
  },
  {
    name: 'Sunset Salon',
    description: 'Warm rose palette for beauty verticals.',
    config: {
      colors: { ...PRESET_LIGHT, primary: '#be185d', ring: '#ec4899', accent: '#f59e0b', background: '#fdf6f8', surfaceAlt: '#fbeef2', sidebarBackground: '#4c0519', sidebarActiveBackground: '#be185d', border: '#f4d9e2' },
      appearance: { ...DEFAULT_THEME.appearance, radius: 18, cardStyle: 'elevated', buttonStyle: 'pill' },
      typography: { ...DEFAULT_THEME.typography, fontFamily: 'Poppins' },
    },
  },
];

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|transparent)$/;

function isColor(value) {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) && value.length <= 64;
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validate + normalise a theme config. Unknown keys are dropped, invalid values
 * fall back to the default. Always run this before persisting or applying.
 */
export function sanitizeTheme(input) {
  const source = input && typeof input === 'object' ? input : {};
  const colors = source.colors && typeof source.colors === 'object' ? source.colors : {};
  const appearance = source.appearance && typeof source.appearance === 'object' ? source.appearance : {};
  const typography = source.typography && typeof source.typography === 'object' ? source.typography : {};
  const layout = source.layout && typeof source.layout === 'object' ? source.layout : {};

  const outColors = {};
  for (const token of COLOR_TOKENS) {
    const fallback = DEFAULT_THEME.colors[token.key];
    outColors[token.key] = isColor(colors[token.key]) ? colors[token.key].trim() : fallback;
  }

  const fontFamily =
    typeof typography.fontFamily === 'string' && /^[\w\s,'"()+.-]{1,80}$/.test(typography.fontFamily)
      ? typography.fontFamily
      : DEFAULT_THEME.typography.fontFamily;

  const fontSource = pickEnum(typography.fontSource, ENUMS.fontSource, DEFAULT_THEME.typography.fontSource);

  // Only http(s) stylesheet URLs are accepted for custom fonts.
  let customFontUrl = '';
  if (typeof typography.customFontUrl === 'string' && typography.customFontUrl.trim()) {
    const candidate = typography.customFontUrl.trim();
    if (/^https?:\/\/[^\s"'<>]{1,300}$/i.test(candidate)) customFontUrl = candidate.slice(0, 300);
  }

  const headingFontFamily =
    typeof typography.headingFontFamily === 'string' && /^[\w\s,'"()+.-]{1,80}$/.test(typography.headingFontFamily)
      ? typography.headingFontFamily
      : 'inherit';

  return {
    colors: outColors,
    appearance: {
      mode: pickEnum(appearance.mode, ENUMS.mode, DEFAULT_THEME.appearance.mode),
      radius: num(appearance.radius, DEFAULT_THEME.appearance.radius, 0, 999),
      cardStyle: pickEnum(appearance.cardStyle, ENUMS.cardStyle, DEFAULT_THEME.appearance.cardStyle),
      buttonStyle: pickEnum(appearance.buttonStyle, ENUMS.buttonStyle, DEFAULT_THEME.appearance.buttonStyle),
      shadow: pickEnum(appearance.shadow, ENUMS.shadow, DEFAULT_THEME.appearance.shadow),
      tableStyle: pickEnum(appearance.tableStyle, ENUMS.tableStyle, DEFAULT_THEME.appearance.tableStyle),
      inputStyle: pickEnum(appearance.inputStyle, ENUMS.inputStyle, DEFAULT_THEME.appearance.inputStyle),
      sidebarStyle: pickEnum(appearance.sidebarStyle, ENUMS.sidebarStyle, DEFAULT_THEME.appearance.sidebarStyle),
      navbarStyle: pickEnum(appearance.navbarStyle, ENUMS.navbarStyle, DEFAULT_THEME.appearance.navbarStyle),
      density: pickEnum(appearance.density, ENUMS.density, DEFAULT_THEME.appearance.density),
    },
    typography: {
      fontFamily,
      fontSource,
      customFontUrl,
      headingFontFamily,
      fontScale: num(typography.fontScale, 1, 0.8, 1.3),
    },
    layout: {
      sidebarPosition: pickEnum(layout.sidebarPosition, ENUMS.sidebarPosition, DEFAULT_THEME.layout.sidebarPosition),
      sidebarWidth: Math.round(num(layout.sidebarWidth, DEFAULT_THEME.layout.sidebarWidth, 200, 400)),
      sidebarCollapsible: layout.sidebarCollapsible !== false,
      navbarStyle: pickEnum(layout.navbarStyle, ['sticky', 'static'], 'sticky'),
      contentWidth: pickEnum(layout.contentWidth, ENUMS.contentWidth, DEFAULT_THEME.layout.contentWidth),
      dashboardColumns: Math.round(num(layout.dashboardColumns, 12, 6, 12)),
    },
  };
}

/** Deep merge two theme configs (used for partial updates / preset overrides). */
export function mergeTheme(base, patch) {
  return sanitizeTheme({
    colors: { ...(base?.colors || {}), ...(patch?.colors || {}) },
    appearance: { ...(base?.appearance || {}), ...(patch?.appearance || {}) },
    typography: { ...(base?.typography || {}), ...(patch?.typography || {}) },
    layout: { ...(base?.layout || {}), ...(patch?.layout || {}) },
  });
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** Parse #rgb / #rrggbb / #rrggbbaa into {r,g,b} or null. */
export function parseHex(input) {
  if (typeof input !== 'string') return null;
  let hex = input.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 8) hex = hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function hexToRgbString(input, alpha = 1) {
  const c = parseHex(input);
  if (!c) return input;
  return alpha >= 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgb(${c.r} ${c.g} ${c.b} / ${alpha})`;
}

/** Relative luminance (WCAG). */
export function luminance(input) {
  const c = parseHex(input);
  if (!c) return 0.5;
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

/** Best readable foreground (black or white) for a background colour. */
export function readableForeground(background) {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#111111') ? '#ffffff' : '#111111';
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function adjustColor(input, amt) {
  const c = parseHex(input);
  if (!c) return input;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const shift = (v) => (amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  const toHex = (v) => clamp(shift(v)).toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

/** Translate a theme into CSS custom properties for :root. */
export function themeToCssVars(theme) {
  const t = sanitizeTheme(theme);
  const vars = {
    '--color-primary': t.colors.primary,
    '--color-primary-fg': t.colors.primaryForeground,
    '--color-primary-hover': adjustColor(t.colors.primary, -0.12),
    '--color-primary-soft': hexToRgbString(t.colors.primary, 0.12),
    '--color-secondary': t.colors.secondary,
    '--color-secondary-fg': t.colors.secondaryForeground,
    '--color-accent': t.colors.accent,
    '--color-accent-fg': t.colors.accentForeground,
    '--color-background': t.colors.background,
    '--color-surface': t.colors.surface,
    '--color-surface-alt': t.colors.surfaceAlt,
    '--color-input-bg': t.colors.inputBackground,
    '--color-border': t.colors.border,
    '--color-text': t.colors.text,
    '--color-muted-text': t.colors.mutedText,
    '--color-success': t.colors.success,
    '--color-warning': t.colors.warning,
    '--color-error': t.colors.error,
    '--color-info': t.colors.info,
    '--color-success-soft': hexToRgbString(t.colors.success, 0.14),
    '--color-warning-soft': hexToRgbString(t.colors.warning, 0.14),
    '--color-error-soft': hexToRgbString(t.colors.error, 0.14),
    '--color-info-soft': hexToRgbString(t.colors.info, 0.14),
    '--color-sidebar-bg': t.colors.sidebarBackground,
    '--color-sidebar-fg': t.colors.sidebarForeground,
    '--color-sidebar-active-bg': t.colors.sidebarActiveBackground,
    '--color-sidebar-active-fg': t.colors.sidebarActiveForeground,
    '--color-navbar-bg': t.colors.navbarBackground,
    '--color-ring': t.colors.ring,
    '--radius': `${t.appearance.radius}px`,
    '--radius-sm': `${Math.max(0, Math.round(t.appearance.radius * 0.6))}px`,
    '--radius-lg': `${Math.round(t.appearance.radius * 1.4)}px`,
    '--shadow-card': shadowFor(t.appearance.shadow, t.appearance.cardStyle),
    '--font-sans': fontStackFor(t.typography),
    '--font-heading': t.typography.headingFontFamily === 'inherit' ? fontStackFor(t.typography) : `'${t.typography.headingFontFamily}', ${fontStackFor(t.typography)}`,
    '--font-scale': String(t.typography.fontScale),
    '--sidebar-width': `${t.layout.sidebarWidth}px`,
    '--density-y': { compact: '0.4rem', comfortable: '0.65rem', spacious: '0.95rem' }[t.appearance.density],
    '--density-x': { compact: '0.6rem', comfortable: '0.9rem', spacious: '1.25rem' }[t.appearance.density],
  };
  return vars;
}

export function shadowFor(shadow, cardStyle) {
  if (cardStyle === 'flat') return 'none';
  const map = {
    none: 'none',
    sm: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
    md: '0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)',
    lg: '0 10px 24px -6px rgb(15 23 42 / 0.14), 0 4px 8px -4px rgb(15 23 42 / 0.08)',
  };
  return map[shadow] || map.md;
}

export function fontStackFor(typography) {
  const preset = FONT_PRESETS.find((f) => f.value === typography?.fontFamily);
  if (typography?.fontSource === 'custom' && typography?.customFontUrl) {
    return `'${typography.fontFamily}', ${preset ? preset.stack : "system-ui, sans-serif"}`;
  }
  return preset ? preset.stack : FONT_PRESETS[0].stack;
}

// ---------------------------------------------------------------------------
// Custom CSS
// ---------------------------------------------------------------------------

export const MAX_CUSTOM_CSS_LENGTH = 20000;

/**
 * Defensive sanitiser for tenant supplied CSS.
 *
 * Tenant CSS is only ever rendered inside that tenant's own browser session, so
 * this is defence in depth rather than the primary isolation boundary. It still
 * strips the things that could escape the stylesheet context or exfiltrate data.
 */
export function sanitizeCss(css) {
  if (typeof css !== 'string' || !css.trim()) return '';
  let out = css.replace(/\r\n/g, '\n');
  // Remove comments (they can hide `</style>` payloads).
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // No imports / charset / namespaces / behaviours.
  out = out.replace(/@(import|charset|namespace|behavior|font-feature-values)[^;{}]*[;{]/gi, '');
  // No closing style/script tags.
  out = out.replace(/<\/?\s*(style|script|link|meta)[^>]*>/gi, '');
  // No javascript:/vbscript:/data:text-html URLs.
  out = out.replace(/(javascript|vbscript|data\s*:\s*text\/html)\s*:/gi, 'blocked:');
  // No legacy IE expression() or -moz-binding.
  out = out.replace(/expression\s*\(/gi, 'blocked(');
  out = out.replace(/-moz-binding\s*:/gi, 'blocked-prop:');
  // Strip control characters.
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Reject unbalanced rules instead of trying to repair them.
  const open = (out.match(/{/g) || []).length;
  const close = (out.match(/}/g) || []).length;
  if (open !== close) return '';
  return out.slice(0, MAX_CUSTOM_CSS_LENGTH).trim();
}
