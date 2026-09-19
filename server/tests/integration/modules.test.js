import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, userWithRole, closeDbAfterSuite } from '../helpers/context.js';
import * as fx from '../helpers/fixtures.js';
import { MODULES } from '@erp/shared';

/**
 * Module gating.
 *
 * A disabled module must disappear from the navigation payload *and* be refused
 * at the API, so turning a module off in the admin cannot be bypassed by
 * calling the endpoint directly.
 */
describe('module system', () => {
  closeDbAfterSuite();

  let tenant;
  let token;
  let member;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Modules Gym', slugPrefix: 'mods' });
    tenant = owner.tenant;
    token = owner.token;
    member = await fx.member(tenant.id);
  });

  const setModules = (keys) => api.put('/api/modules').set(auth(token)).send({ enabled: keys });

  it('lists the module registry for the tenant', async () => {
    const res = await api.get('/api/modules').set(auth(token));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((m) => m.key);
    for (const mod of MODULES) expect(keys).toContain(mod.key);
    // The payload is what the navigation is built from.
    expect(res.body.data[0]).toHaveProperty('label');
    expect(res.body.data[0]).toHaveProperty('enabled');
  });

  it('has every gym module enabled for a new tenant', async () => {
    const res = await api.get('/api/modules').set(auth(token));
    const enabled = res.body.data.filter((m) => m.enabled).map((m) => m.key);
    for (const key of ['members', 'memberships', 'attendance', 'payments', 'trainers', 'workouts', 'progress', 'expenses', 'reports']) {
      expect(enabled, `${key} should be on by default`).toContain(key);
    }
  });

  it('serves a module endpoint while it is enabled', async () => {
    const res = await api.get('/api/progress').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('blocks a disabled module at the API with MODULE_DISABLED', async () => {
    const modules = await api.get('/api/modules').set(auth(token));
    const withoutProgress = modules.body.data.filter((m) => m.key !== 'progress').map((m) => m.key);

    const put = await setModules(withoutProgress);
    expect([200, 204]).toContain(put.status);

    // Only the disabled module is refused; unrelated modules keep working.
    for (const path of ['/api/progress', '/api/progress/latest']) {
      const res = await api.get(path).set(auth(token));
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('MODULE_DISABLED');
    }
    expect((await api.get('/api/workouts/plans').set(auth(token))).status).toBe(200);
  });

  it('blocks writes to a disabled module too', async () => {
    const res = await api.post('/api/progress').set(auth(token)).send({ memberId: member.id, weightKg: 71 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_DISABLED');
  });

  it('hides a disabled module from the navigation payload', async () => {
    const res = await api.get('/api/modules').set(auth(token));
    const progress = res.body.data.find((m) => m.key === 'progress');
    expect(progress.enabled).toBe(false);
  });

  it('restores access when the module is re-enabled', async () => {
    const modules = await api.get('/api/modules').set(auth(token));
    const all = modules.body.data.map((m) => m.key);
    await setModules(all);

    const res = await api.get('/api/progress').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('cannot switch off platform modules', async () => {
    const modules = await api.get('/api/modules').set(auth(token));
    const withoutCore = modules.body.data.filter((m) => !['settings', 'roles', 'users'].includes(m.key)).map((m) => m.key);
    await setModules(withoutCore);

    const after = await api.get('/api/modules').set(auth(token));
    for (const key of ['settings', 'roles', 'users']) {
      expect(after.body.data.find((m) => m.key === key).enabled, `${key} must stay on`).toBe(true);
    }
    // Their endpoints still work.
    expect((await api.get('/api/settings').set(auth(token))).status).toBe(200);
    expect((await api.get('/api/roles').set(auth(token))).status).toBe(200);
    expect((await api.get('/api/users').set(auth(token))).status).toBe(200);
  });

  it('applies module state per tenant, not globally', async () => {
    const other = await tenantWithOwner({ name: 'Modules Other Gym', slugPrefix: 'mods2' });

    const modules = await api.get('/api/modules').set(auth(token));
    await setModules(modules.body.data.filter((m) => m.key !== 'expenses').map((m) => m.key));

    const offHere = await api.get('/api/expenses').set(auth(token));
    expect(offHere.status).toBe(403);
    expect(offHere.body.error.code).toBe('MODULE_DISABLED');

    const onThere = await api.get('/api/expenses').set(auth(other.token));
    expect(onThere.status).toBe(200);
  });

  it('rejects an unknown module key', async () => {
    const res = await setModules(['members', 'not-a-real-module']);
    expect([400, 422], `got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`).toContain(res.status);
    const after = await api.get('/api/modules').set(auth(token));
    expect(after.body.data.map((m) => m.key)).not.toContain('not-a-real-module');
  });

  it('blocks a module for every role, including a manager', async () => {
    const manager = await userWithRole(tenant, 'manager');
    const modules = await api.get('/api/modules').set(auth(token));
    await setModules(modules.body.data.filter((m) => m.key !== 'reports').map((m) => m.key));

    const res = await api.get('/api/reports/finance').set(auth(manager.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_DISABLED');

    await setModules(modules.body.data.map((m) => m.key));
  });
});
