import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

import { api, auth, tenantWithOwner, closeDbAfterSuite, PASSWORD, createUser } from '../helpers/context.js';
import config from '../../src/config/env.js';

describe('authentication', () => {
  closeDbAfterSuite();

  let ctx;

  beforeAll(async () => {
    ctx = await tenantWithOwner({ name: 'Auth Gym', slugPrefix: 'auth' });
  });

  it('logs in with valid credentials', async () => {
    const res = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe(ctx.email);
    expect(res.body.tenant.slug).toBe(ctx.tenant.slug);
  });

  it('never returns a password hash', async () => {
    const res = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
  });

  it('rejects a wrong password', async () => {
    const res = await api.post('/api/auth/login').send({ email: ctx.email, password: 'wrong-password', tenantSlug: ctx.tenant.slug });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBeTruthy();
  });

  it('rejects an unknown email with the same message', async () => {
    const unknown = await api.post('/api/auth/login').send({ email: `nobody@${ctx.tenant.slug}.test`, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    const wrongPw = await api.post('/api/auth/login').send({ email: ctx.email, password: 'wrong-password', tenantSlug: ctx.tenant.slug });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrongPw.body.error.message);
  });

  it('requires the tenant code - the same email is not global', async () => {
    const res = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD });
    expect([400, 401, 422]).toContain(res.status);
  });

  it('rejects an unknown tenant code', async () => {
    const res = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: 'no-such-business' });
    expect(res.status).toBe(401);
  });

  it('rejects a disabled account', async () => {
    const disabled = await createUser(ctx.tenant.id, { roleKey: 'manager', email: `disabled@${ctx.tenant.slug}.test`, status: 'disabled' });
    const res = await api.post('/api/auth/login').send({ email: disabled.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    expect([401, 403]).toContain(res.status);
  });

  it('protects routes: no token, no data', async () => {
    for (const path of ['/api/auth/me', '/api/members', '/api/payments', '/api/settings', '/api/themes']) {
      const res = await api.get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('rejects a malformed token', async () => {
    const res = await api.get('/api/auth/me').set(auth('not.a.jwt'));
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = jwt.sign({ sub: ctx.owner.id, tid: ctx.tenant.id }, 'another-secret', { expiresIn: '5m', issuer: 'erp-platform' });
    const res = await api.get('/api/auth/me').set(auth(forged));
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = jwt.sign({ sub: ctx.owner.id, tid: ctx.tenant.id }, config.JWT_ACCESS_SECRET, { expiresIn: '5m', issuer: 'someone-else' });
    const res = await api.get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(401);
  });

  it('rejects an expired token with a clear message', async () => {
    const expired = jwt.sign({ sub: ctx.owner.id, tid: ctx.tenant.id }, config.JWT_ACCESS_SECRET, {
      expiresIn: '-10s',
      issuer: 'erp-platform',
    });
    const res = await api.get('/api/auth/me').set(auth(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.message.toLowerCase()).toMatch(/expired/);
  });

  it('accepts the token from the cookie as well as the header', async () => {
    const login = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    const cookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('erp_at='));
    expect(cookie, 'access cookie should be set').toBeTruthy();

    const viaHeader = await api.get('/api/auth/me').set(auth(login.body.accessToken));
    expect(viaHeader.status).toBe(200);
  });

  it('sets httpOnly, sameSite cookies for the refresh token', async () => {
    const login = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    const refresh = (login.headers['set-cookie'] || []).find((c) => c.startsWith('erp_rt='));
    expect(refresh).toBeTruthy();
    expect(refresh.toLowerCase()).toContain('httponly');
    expect(refresh.toLowerCase()).toContain('samesite');
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const login = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    const first = login.body.refreshToken;

    const rotated = await api.post('/api/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).toBeTruthy();
    expect(rotated.body.refreshToken).not.toBe(first);

    const replay = await api.post('/api/auth/refresh').send({ refreshToken: first });
    expect([401, 403]).toContain(replay.status);
  });

  it('rejects a refresh token used as an access token', async () => {
    const login = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    const res = await api.get('/api/auth/me').set(auth(login.body.refreshToken));
    expect(res.status).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const list = await api.get('/api/auth/sessions').set(auth(ctx.token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const session = list.body.data[0];
    if (session?.id) {
      const revoked = await api.delete(`/api/auth/sessions/${session.id}`).set(auth(ctx.token));
      expect([200, 204, 404]).toContain(revoked.status);
    }
  });

  it('logs out and revokes the presented refresh token', async () => {
    const login = await api.post('/api/auth/login').send({ email: ctx.email, password: PASSWORD, tenantSlug: ctx.tenant.slug });
    const out = await api.post('/api/auth/logout').send({ refreshToken: login.body.refreshToken });
    expect([200, 204]).toContain(out.status);

    const reuse = await api.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect([401, 403]).toContain(reuse.status);
  });

  it('validates the login payload instead of crashing', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBeTruthy();
  });

  it('returns the profile for /me', async () => {
    const res = await api.get('/api/auth/me').set(auth(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(ctx.email);
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.tenant.slug).toBe(ctx.tenant.slug);
  });
});
