import { describe, it, expect } from 'vitest';

import { resolveSort, param, likePattern, startsWithPattern, inPlaceholders, andAll, chunk } from '../../src/utils/sql.js';

/**
 * SQL building helpers.
 *
 * `resolveSort` is covered hard on purpose: a regression there produced
 * `ORDER BY created_at DESC ASC` and broke every paginated list endpoint at
 * once, and it is the kind of bug no endpoint test would localise.
 */
describe('resolveSort', () => {
  const allowed = { name: 'lower(name)', created_at: 'created_at', amount: 'amount' };

  it('uses the fallback verbatim when no sort key is given', () => {
    expect(resolveSort(undefined, undefined, allowed, 'created_at DESC')).toBe('created_at DESC');
  });

  it('never appends a direction to the fallback', () => {
    for (const order of [undefined, 'asc', 'desc', 'ASC', 'DESC', '', 'nonsense']) {
      const sql = resolveSort(undefined, order, allowed, 'created_at DESC');
      expect(sql, `order=${order}`).toBe('created_at DESC');
      expect(sql).not.toMatch(/(ASC|DESC)\s+(ASC|DESC)/);
    }
  });

  it('applies the requested direction to an allow-listed key', () => {
    expect(resolveSort('name', 'asc', allowed, 'x')).toBe('lower(name) ASC');
    expect(resolveSort('name', 'ASC', allowed, 'x')).toBe('lower(name) ASC');
    expect(resolveSort('amount', 'desc', allowed, 'x')).toBe('amount DESC');
    expect(resolveSort('amount', 'DESC', allowed, 'x')).toBe('amount DESC');
  });

  it('defaults an allow-listed key to ascending', () => {
    expect(resolveSort('created_at', undefined, allowed, 'x')).toBe('created_at ASC');
    expect(resolveSort('created_at', 'sideways', allowed, 'x')).toBe('created_at ASC');
  });

  it('falls back for an unknown key instead of interpolating it', () => {
    expect(resolveSort('password_hash', 'asc', allowed, 'created_at DESC')).toBe('created_at DESC');
    expect(resolveSort('1; DROP TABLE members', 'asc', allowed, 'created_at DESC')).toBe('created_at DESC');
  });

  it('cannot read inherited properties off the allow-list', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(resolveSort(key, 'asc', allowed, 'fallback')).toBe('fallback');
    }
  });

  it('handles a missing allow-list', () => {
    expect(resolveSort('name', 'asc', undefined, 'created_at')).toBe('created_at');
  });
});

describe('parameter building', () => {
  it('param appends and returns the next placeholder', () => {
    const params = [];
    expect(param(params, 'a')).toBe('$1');
    expect(param(params, 'b')).toBe('$2');
    expect(params).toEqual(['a', 'b']);
  });

  it('likePattern escapes LIKE wildcards in user input', () => {
    const pattern = likePattern('100%_off');
    expect(pattern).toContain('\\%');
    expect(pattern).toContain('\\_');
    // The surrounding wildcards are ours, not the user's.
    expect(pattern.startsWith('%')).toBe(true);
    expect(pattern.endsWith('%')).toBe(true);
  });

  it('startsWithPattern anchors to the beginning', () => {
    const pattern = startsWithPattern('ab%');
    expect(pattern.endsWith('%')).toBe(true);
    expect(pattern.startsWith('%')).toBe(false);
    expect(pattern).toContain('\\%');
  });

  it('inPlaceholders builds a list, or NULL when empty', () => {
    const params = [];
    expect(inPlaceholders(params, ['a', 'b'])).toBe('($1, $2)');
    expect(params).toEqual(['a', 'b']);

    const empty = [];
    expect(inPlaceholders(empty, [])).toBe('NULL');
    expect(empty).toEqual([]);
  });

  it('andAll joins fragments and degrades to TRUE', () => {
    expect(andAll(['a = $1', 'b = $2'])).toBe('a = $1 AND b = $2');
    expect(andAll(['a = $1', '', null, undefined])).toBe('a = $1');
    expect(andAll([])).toBe('TRUE');
  });

  it('chunk splits a list for batched statements', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});
