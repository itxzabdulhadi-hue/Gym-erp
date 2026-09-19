import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, closeDbAfterSuite } from '../helpers/context.js';
import { DEFAULT_THEME } from '@erp/shared';
import * as fx from '../helpers/fixtures.js';
import { queryMany } from '../../src/db/index.js';

/**
 * Audit trail.
 *
 * Every consequential mutation must leave a record, and every record must be
 * scoped to the tenant that caused it.
 */
describe('audit logging', () => {
  closeDbAfterSuite();

  let tenant;
  let token;
  let email;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Audit Gym', slugPrefix: 'audit' });
    tenant = owner.tenant;
    token = owner.token;
    email = owner.email;
  });

  const actions = async () =>
    (await queryMany('SELECT action FROM audit_logs WHERE tenant_id = $1 ORDER BY id', [tenant.id])).map((r) => r.action);

  it('records a login', async () => {
    expect(await actions()).toContain('auth.login');
  });

  it('records member creation, update and deletion', async () => {
    const created = await api.post('/api/members').set(auth(token)).send({ firstName: 'Audit', lastName: 'Trail' });
    expect([200, 201]).toContain(created.status);
    const id = created.body.data.id;

    await api.patch(`/api/members/${id}`).set(auth(token)).send({ notes: 'audited' });
    await api.delete(`/api/members/${id}`).set(auth(token));

    const seen = await actions();
    expect(seen).toContain('member.created');
    expect(seen).toContain('member.updated');
    expect(seen).toContain('member.deleted');
  });

  it('records membership creation and renewal', async () => {
    const plan = await api.post('/api/membership-plans').set(auth(token)).send({ name: 'Audit plan', durationDays: 30, price: 500 });
    const member = await fx.member(tenant.id);
    const created = await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.body.data.id });
    await api.post(`/api/memberships/${created.body.data.id}/renew`).set(auth(token)).send({ planId: plan.body.data.id });

    const seen = await actions();
    expect(seen).toContain('membership.created');
    expect(seen).toContain('membership.renewed');
  });

  it('records payment creation and refund', async () => {
    const member = await fx.member(tenant.id);
    const created = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 250 });
    await api.post(`/api/payments/${created.body.data.id}/refund`).set(auth(token)).send({ amount: 250, reason: 'audit' });

    const seen = await actions();
    expect(seen).toContain('payment.created');
    expect(seen).toContain('payment.refunded');
  });

  it('records expense creation', async () => {
    await api.post('/api/expenses').set(auth(token)).send({ title: 'Audit expense', amount: 12, category: 'supplies' });
    expect(await actions()).toContain('expense.created');
  });

  it('records attendance check-in', async () => {
    const member = await fx.member(tenant.id);
    await api.post('/api/attendance/check-in').set(auth(token)).send({ memberId: member.id });
    expect(await actions()).toContain('attendance.check_in');
  });

  it('records theme and branding changes', async () => {
    const created = await api.post('/api/themes').set(auth(token)).send({ name: 'Audit theme', config: DEFAULT_THEME });
    await api.post(`/api/themes/${created.body.data.id}/activate`).set(auth(token));
    await api.patch('/api/branding').set(auth(token)).send({ businessName: 'Audit Renamed' });

    const seen = await actions();
    expect(seen).toContain('theme.created');
    expect(seen).toContain('theme.activated');
    expect(seen).toContain('branding.updated');
  });

  it('records module and settings changes', async () => {
    const modules = await api.get('/api/modules').set(auth(token));
    await api.put('/api/modules').set(auth(token))
      .send({ enabled: modules.body.data.filter((m) => m.key !== 'expenses').map((m) => m.key) });
    await api.patch('/api/settings/general').set(auth(token)).send({ timezone: 'Asia/Karachi' });

    const seen = await actions();
    expect(seen).toContain('modules.updated');
    expect(seen).toContain('settings.updated');

    await api.put('/api/modules').set(auth(token)).send({ enabled: modules.body.data.map((m) => m.key) });
  });

  it('records role changes', async () => {
    const created = await api.post('/api/roles').set(auth(token)).send({ key: 'auditor', name: 'Auditor', permissions: ['members.view'] });
    expect([200, 201]).toContain(created.status);
    const id = created.body.data.id;

    await api.patch(`/api/roles/${id}`).set(auth(token)).send({ permissions: ['members.view', 'payments.view'] });
    await api.delete(`/api/roles/${id}`).set(auth(token));

    const seen = await actions();
    expect(seen).toContain('role.created');
    expect(seen).toContain('role.updated');
    expect(seen).toContain('role.deleted');
  });

  it('records a logout', async () => {
    const login = await api.post('/api/auth/login').send({ email, password: 'Test1234!', tenantSlug: tenant.slug });
    await api.post('/api/auth/logout').send({ refreshToken: login.body.refreshToken });
    expect(await actions()).toContain('auth.logout');
  });

  it('stores who did it and when', async () => {
    const rows = await queryMany(
      'SELECT action, user_label, user_id, created_at FROM audit_logs WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1',
      [tenant.id],
    );
    expect(rows[0].user_label).toBeTruthy();
    expect(rows[0].user_id).toBeTruthy();
    expect(new Date(rows[0].created_at).getTime()).toBeGreaterThan(0);
  });

  it('never mixes another tenant into the log', async () => {
    const other = await tenantWithOwner({ name: 'Audit Other', slugPrefix: 'audit2' });
    await fx.member(other.tenant.id, { firstName: 'Elsewhere', lastName: 'Person' });

    const mine = await api.get('/api/audit-logs?limit=200').set(auth(token));
    expect(mine.status).toBe(200);
    expect(mine.body.data.every((row) => row.tenantId === undefined || row.tenantId === tenant.id)).toBe(true);

    const foreignRows = await queryMany(
      'SELECT id FROM audit_logs WHERE tenant_id = $1 AND user_label LIKE $2',
      [tenant.id, '%Elsewhere%'],
    );
    expect(foreignRows).toEqual([]);
  });
});
