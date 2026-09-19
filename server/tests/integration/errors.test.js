import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, closeDbAfterSuite } from '../helpers/context.js';

/**
 * Error contract.
 *
 * Clients always receive `{ error: { code, message, details? } }`. Nothing in a
 * response may reveal SQL, a stack trace, a filesystem path, an environment
 * variable or a credential - in any environment, not just production.
 */
describe('error handling', () => {
  closeDbAfterSuite();

  let tenant;
  let token;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Errors Gym', slugPrefix: 'err' });
    tenant = owner.tenant;
    token = owner.token;
  });

  const leaks = [
    /password_hash/i,
    /\$2[aby]\$\d{2}\$/,            // bcrypt hash
    /BEGIN (RSA )?PRIVATE KEY/i,
    /\/home\/\w+\//,                 // absolute filesystem path
    /\/var\/www\//,
    /node_modules\//,
    /\bat [A-Za-z0-9_$.]+ \(.*:\d+:\d+\)/,  // stack frame
    /\bSELECT\b.*\bFROM\b/i,
    /\bINSERT INTO\b/i,
    /\bUPDATE\b.*\bSET\b/i,
    /DATABASE_URL/i,
    /JWT_ACCESS_SECRET/i,
    /connection string/i,
    /pg_promise|pg-pool|pg\/lib/i,
  ];

  const assertClean = (res, label) => {
    const body = JSON.stringify(res.body);
    for (const pattern of leaks) {
      expect(body, `${label} leaked ${pattern} -> ${body.slice(0, 300)}`).not.toMatch(pattern);
    }
  };

  it('returns a structured 404 for an unknown API route', async () => {
    const res = await api.get('/api/definitely-not-here').set(auth(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBeTruthy();
    assertClean(res, 'unknown route');
  });

  it('returns a structured 401 without a token', async () => {
    const res = await api.get('/api/members');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBeTruthy();
    assertClean(res, 'unauthenticated');
  });

  it('returns field level validation errors', async () => {
    const res = await api.post('/api/members').set(auth(token)).send({ firstName: '', lastName: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeTypeOf('object');
    assertClean(res, 'validation');
  });

  it('rejects a malformed uuid with 422 rather than a database error', async () => {
    const res = await api.get('/api/members/this-is-not-a-uuid').set(auth(token));
    expect(res.status).toBe(422);
    assertClean(res, 'bad uuid');
  });

  it('handles a malformed JSON body without crashing', async () => {
    const res = await api.post('/api/members').set(auth(token)).set('content-type', 'application/json').send('{"broken": ');
    expect([400, 422]).toContain(res.status);
    assertClean(res, 'bad json');
  });

  it('rejects an oversized body', async () => {
    const res = await api.post('/api/members').set(auth(token)).send({ notes: 'x'.repeat(5 * 1024 * 1024) });
    expect([400, 413, 422]).toContain(res.status);
    assertClean(res, 'oversized body');
  });

  it('maps a unique constraint violation to 409, not a raw SQL error', async () => {
    const first = await api.post('/api/members').set(auth(token)).send({ firstName: 'Unique', lastName: 'Test', email: 'dupe@example.test' });
    expect([200, 201]).toContain(first.status);

    const again = await api.post('/api/members').set(auth(token)).send({ firstName: 'Unique', lastName: 'Test', email: 'dupe@example.test' });
    expect([409, 422]).toContain(again.status);
    assertClean(again, 'unique violation');
  });

  it('reports a missing record as 404', async () => {
    const res = await api.get('/api/members/00000000-0000-0000-0000-000000000000').set(auth(token));
    expect(res.status).toBe(404);
    assertClean(res, 'missing record');
  });

  it('never echoes the tenant id of another business in an error', async () => {
    const other = await tenantWithOwner({ name: 'Secret Gym', slugPrefix: 'err2' });
    const res = await api.get(`/api/members/${'00000000-0000-0000-0000-000000000000'}`).set(auth(token));
    expect(JSON.stringify(res.body)).not.toContain(other.tenant.id);
  });

  it('serves a JSON 404 for an unknown /api path even without auth', async () => {
    const res = await api.get('/api/nope/nope');
    expect([401, 404]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('does not expose the stack of an internal failure', async () => {
    // A request that reaches the database with an impossible predicate.
    const res = await api.get('/api/members?sort=__proto__&order=desc').set(auth(token));
    expect([200, 400, 422]).toContain(res.status);
    assertClean(res, 'hostile sort key');
  });
});
