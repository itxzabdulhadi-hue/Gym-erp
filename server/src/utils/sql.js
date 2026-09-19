/**
 * Small SQL helpers.
 *
 * Rules: values always go through parameters ($1, $2 ...); anything that ends up
 * as an identifier (ORDER BY, column names) is resolved through an allow list.
 * No string concatenation of user input, anywhere.
 */

/** Append a value and return its placeholder. */
export function param(params, value) {
  params.push(value);
  return `$${params.length}`;
}

/** Escape LIKE wildcards so a search for "100%" does not match everything. */
export function likePattern(value) {
  return `%${String(value).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function startsWithPattern(value) {
  return `${String(value).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Resolve a client supplied sort key to a real, allow-listed SQL expression.
 * `allowed` maps public key -> SQL expression.
 *
 * The fallback is used verbatim because callers pass a complete expression that
 * already carries a direction (`'m.created_at DESC'`); appending a direction to
 * it produced `… DESC ASC` and a syntax error on every unsorted list request.
 */
export function resolveSort(sortKey, order, allowed = {}, fallbackExpression = 'created_at') {
  // `sort` arrives straight from the query string, so read own properties only -
  // keys such as `constructor` or `__proto__` must not resolve to anything.
  const mapped = sortKey && Object.prototype.hasOwnProperty.call(allowed, sortKey) ? allowed[sortKey] : null;
  if (!mapped) return fallbackExpression;
  const direction = String(order ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `${mapped} ${direction}`;
}

/** Build `($1,$2,$3)` for an IN clause, or NULL when the list is empty. */
export function inPlaceholders(params, values) {
  if (!values?.length) return 'NULL';
  return `(${values.map((v) => param(params, v)).join(', ')})`;
}

/** Join non-empty SQL fragments with AND, returning 'TRUE' when empty. */
export function andAll(fragments) {
  const parts = fragments.filter(Boolean);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

export function chunk(list, size = 500) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Round to 2 decimals for money without dragging in a decimal library. */
export function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
