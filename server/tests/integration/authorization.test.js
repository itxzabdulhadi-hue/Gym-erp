import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, userWithRole, closeDbAfterSuite } from '../helpers/context.js';
import * as fx from '../helpers/fixtures.js';

/**
 * Role and permission enforcement.
 *
 * Table driven on purpose: the matrix below is the contract the admin UI is
 * built from, and every cell is exercised against the running API. A denial is
 * asserted by error code as well as status, so a 403 caused by a *disabled
 * module* cannot masquerade as a permission check.
 */
describe('authorization', () => {
  closeDbAfterSuite();

  let tenant;
  const tokens = {};

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Roles Gym', slugPrefix: 'roles' });
    tenant = owner.tenant;
    tokens.owner = owner.token;
    for (const role of ['manager', 'receptionist', 'trainer', 'accountant']) {
      tokens[role] = (await userWithRole(tenant, role)).token;
    }
  });

  /** Build a fresh record per case so destructive permissions don't collide. */
  const withMember = async () => fx.member(tenant.id, { firstName: 'Authz', lastName: 'Target' });

  const cases = [
    // [label, method, path builder, body, expected status per role]
    ['members.view', 'GET', '/api/members', null, { owner: 200, manager: 200, receptionist: 200, trainer: 200, accountant: 200 }],
    ['members.create', 'POST', '/api/members', { firstName: 'Authz', lastName: 'New' }, { owner: 201, manager: 201, receptionist: 201, trainer: 403, accountant: 403 }],
    ['members.edit', 'PATCH', async () => `/api/members/${(await withMember()).id}`, { notes: 'x' }, { owner: 200, manager: 200, receptionist: 200, trainer: 403, accountant: 403 }],
    ['members.delete', 'DELETE', async () => `/api/members/${(await withMember()).id}`, null, { owner: 200, manager: 200, receptionist: 403, trainer: 403, accountant: 403 }],

    ['payments.view', 'GET', '/api/payments', null, { owner: 200, manager: 200, receptionist: 200, trainer: 403, accountant: 200 }],
    ['payments.refund', 'POST', async () => {
      const m = await withMember();
      return `/api/payments/${(await fx.payment(tenant.id, m.id)).id}/refund`;
    }, { amount: 1 }, { owner: 200, manager: 200, receptionist: 403, trainer: 403, accountant: 200 }],

    ['expenses.view', 'GET', '/api/expenses', null, { owner: 200, manager: 200, receptionist: 403, trainer: 403, accountant: 200 }],
    ['expenses.create', 'POST', '/api/expenses', { title: 'Authz', amount: 5, category: 'supplies' }, { owner: 201, manager: 201, receptionist: 403, trainer: 403, accountant: 201 }],
    ['expenses.delete', 'DELETE', async () => `/api/expenses/${(await fx.expense(tenant.id)).id}`, null, { owner: 200, manager: 403, receptionist: 403, trainer: 403, accountant: 200 }],

    ['reports.view', 'GET', '/api/reports/finance', null, { owner: 200, manager: 200, receptionist: 403, trainer: 403, accountant: 200 }],

    ['attendance.checkin', 'POST', '/api/attendance/check-in', async () => ({ memberId: (await withMember()).id }), { owner: [200, 201], manager: [200, 201], receptionist: [200, 201], trainer: [200, 201], accountant: 403 }],

    ['workouts.view', 'GET', '/api/workouts/plans', null, { owner: 200, manager: 200, receptionist: 403, trainer: 200, accountant: 403 }],
    ['workouts.create', 'POST', '/api/workouts/plans', { name: 'Authz plan' }, { owner: 201, manager: 201, receptionist: 403, trainer: 201, accountant: 403 }],
    ['progress.create', 'POST', '/api/progress', async () => ({ memberId: (await withMember()).id, weightKg: 70 }), { owner: 201, manager: 201, receptionist: 403, trainer: 201, accountant: 403 }],

    ['users.view', 'GET', '/api/users', null, { owner: 200, manager: 200, receptionist: 403, trainer: 403, accountant: 403 }],
    ['users.create', 'POST', '/api/users', { email: 'authz-new@example.test', fullName: 'Authz New', password: 'Authz1234!', roleKeys: ['trainer'] }, { owner: [200, 201], manager: 403, receptionist: 403, trainer: 403, accountant: 403 }],

    ['settings.view', 'GET', '/api/settings', null, { owner: 200, manager: 403, receptionist: 403, trainer: 403, accountant: 403 }],
    ['roles.view', 'GET', '/api/roles', null, { owner: 200, manager: 403, receptionist: 403, trainer: 403, accountant: 403 }],
    ['themes.view', 'GET', '/api/themes', null, { owner: 200, manager: 403, receptionist: 403, trainer: 403, accountant: 403 }],
    ['audit.view', 'GET', '/api/audit-logs', null, { owner: 200, manager: 403, receptionist: 403, trainer: 403, accountant: 403 }],
  ];

  for (const [permission, method, path, body, expected] of cases) {
    describe(permission, () => {
      for (const [role, status] of Object.entries(expected)) {
        it(`${role} -> ${Array.isArray(status) ? status.join('/') : status}`, async () => {
          const url = typeof path === 'function' ? await path() : path;
          const payload = typeof body === 'function' ? await body() : body;
          const req = api[method.toLowerCase()](url).set(auth(tokens[role]));
          const res = payload ? await req.send(payload) : await req;

          const allowed = [].concat(status);
          const detail = `${role} ${method} ${url} -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`;
          expect(allowed, detail).toContain(res.status);

          if (res.status === 403) {
            // A 403 must be a permission decision, not a disabled module.
            expect(res.body.error.code, detail).toBe('FORBIDDEN');
          }
        });
      }
    });
  }

  it('gives the owner the full permission catalogue', async () => {
    const me = await api.get('/api/auth/me').set(auth(tokens.owner));
    const catalogue = await api.get('/api/permissions').set(auth(tokens.owner));
    const all = catalogue.body.data.map((p) => p.key);
    expect(me.body.permissions.sort()).toEqual(all.sort());
    expect(all.length).toBeGreaterThanOrEqual(60);
  });

  it('gives the trainer no financial permissions at all', async () => {
    const me = await api.get('/api/auth/me').set(auth(tokens.trainer));
    expect(me.body.permissions.filter((p) => /^(payments|expenses|reports)\./.test(p))).toEqual([]);
  });

  it('never grants a permission that is not in the central registry', async () => {
    const { ALL_PERMISSION_KEYS } = await import('@erp/shared');
    for (const role of Object.keys(tokens)) {
      const me = await api.get('/api/auth/me').set(auth(tokens[role]));
      const unknown = me.body.permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
      expect(unknown, `${role} holds unregistered permissions`).toEqual([]);
    }
  });
});
