/** Date helpers. All functions work with plain YYYY-MM-DD strings or Dates. */

export const MS_PER_DAY = 86_400_000;

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function toISODate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(value, days) {
  const d = toDate(value) || new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function addMonths(value, months) {
  const d = toDate(value) || new Date();
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp when the target month is shorter (Jan 31 + 1 month -> Feb 28).
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return toISODate(d);
}

export function daysBetween(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY);
}

export function startOfMonth(value = new Date()) {
  const d = toDate(value) || new Date();
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function endOfMonth(value = new Date()) {
  const d = toDate(value) || new Date();
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function monthKey(value) {
  return String(toISODate(value) || '').slice(0, 7);
}

/** Inclusive date window used by reports and dashboards. */
export function rangeFromDays(days, endDate = new Date()) {
  const end = toISODate(endDate);
  return { from: addDays(end, -(days - 1)), to: end };
}

/** Last N full month keys, oldest first. */
export function lastMonths(count, reference = new Date()) {
  const base = toDate(reference) || new Date();
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    out.push(toISODate(d).slice(0, 7));
  }
  return out;
}

/** Last N day keys, oldest first. */
export function lastDays(count, reference = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addDays(reference, -i));
  return out;
}

export function isValidISODate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(toDate(value));
}

export function age(dob) {
  const birth = toDate(dob);
  if (!birth) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 ? years : null;
}
