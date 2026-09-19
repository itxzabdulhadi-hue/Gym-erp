/**
 * Presentation helpers. Currency and locale come from the tenant's branding,
 * so the same screen reads "$1,200.00" for one business and "₨ 1,200.00" for
 * another without any component knowing about it.
 */

const numberCache = new Map();

function numberFormatter(currency, currencySymbol, locale) {
  const key = `${currency}|${currencySymbol}|${locale}`;
  if (numberCache.has(key)) return numberCache.get(key);
  let formatter;
  try {
    formatter = new Intl.NumberFormat(locale || 'en', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    // An unusual currency code from tenant settings must not break rendering.
    formatter = { format: (v) => `${currencySymbol || ''}${Number(v || 0).toFixed(2)}` };
  }
  numberCache.set(key, formatter);
  return formatter;
}

export function money(amount, branding) {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return `${branding?.currencySymbol || '$'}0.00`;
  return numberFormatter(branding?.currency, branding?.currencySymbol, branding?.locale).format(value);
}

/** Compact form for dashboard tiles: 12.4k instead of 12,400. */
export function compactNumber(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function plainNumber(value, digits = 0) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value, opts) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "3 days ago" / "in 2 weeks" - used for expiry and audit timestamps. */
export function relativeTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  try {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const [unit, ms] of units) {
      if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
    }
    return rtf.format(Math.round(diff / 1000), 'second');
  } catch {
    return formatDate(d);
  }
}

export function initials(name) {
  if (!name) return '?';
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

/** Today as YYYY-MM-DD, in local time - what the API's date filters expect. */
export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(value) {
  const d = toDate(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** Human label for a snake_case status coming from the API. */
export function humanize(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function titleCase(value) {
  return humanize(value);
}
