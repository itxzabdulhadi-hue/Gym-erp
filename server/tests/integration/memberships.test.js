import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, closeDbAfterSuite } from '../helpers/context.js';
import * as fx from '../helpers/fixtures.js';
import { queryOne } from '../../src/db/index.js';

/**
 * Membership lifecycle: the business rules the gym actually runs on.
 */
describe('memberships', () => {
  closeDbAfterSuite();

  let tenant;
  let token;
  let plan;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Membership Gym', slugPrefix: 'msx' });
    tenant = owner.tenant;
    token = owner.token;

    const created = await api.post('/api/membership-plans').set(auth(token)).send({
      name: 'Monthly Test', durationDays: 30, price: 2500, billingCycle: 'monthly',
    });
    expect([200, 201]).toContain(created.status);
    plan = created.body.data;
  });

  const newMember = () => fx.member(tenant.id, { firstName: 'Life', lastName: 'Cycle' });

  it('creates a membership from a plan and copies the plan details', async () => {
    const member = await newMember();
    const res = await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.id });
    expect(res.status).toBe(201);
    expect(res.body.data.planName).toBe('Monthly Test');
    expect(Number(res.body.data.price)).toBe(2500);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.startDate).toBeTruthy();
    expect(res.body.data.endDate).toBeTruthy();
  });

  it('marks the member active once they hold a membership', async () => {
    const member = await newMember();
    await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.id });
    const res = await api.get(`/api/members/${member.id}`).set(auth(token));
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.currentPlan).toBe('Monthly Test');
  });

  it('expires a membership whose end date has passed', async () => {
    const member = await newMember();
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const res = await api.post('/api/memberships').set(auth(token)).send({
      memberId: member.id, planId: plan.id, startDate: '2020-01-01', endDate: past,
    });
    expect(res.status).toBe(201);

    const row = await queryOne('SELECT status FROM memberships WHERE id = $1', [res.body.data.id]);
    expect(row.status).toBe('expired');

    const memberRow = await api.get(`/api/members/${member.id}`).set(auth(token));
    expect(memberRow.body.data.status).toBe('expired');
  });

  it('renews by extending from the current end date', async () => {
    const member = await newMember();
    const created = await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.id });
    const original = created.body.data;

    const renewed = await api.post(`/api/memberships/${original.id}/renew`).set(auth(token)).send({ planId: plan.id });
    expect([200, 201]).toContain(renewed.status);

    const next = renewed.body.data;
    expect(new Date(next.endDate).getTime()).toBeGreaterThan(new Date(original.endDate).getTime());

    // The renewal must link back to what it replaced.
    const row = await queryOne('SELECT previous_membership_id FROM memberships WHERE id = $1', [next.id]);
    expect(row.previous_membership_id).toBe(original.id);
  });

  it('freezes and resumes, moving the end date out by the frozen days', async () => {
    const member = await newMember();
    const created = await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.id });
    const id = created.body.data.id;
    const before = new Date(created.body.data.endDate).getTime();

    const frozen = await api.post(`/api/memberships/${id}/freeze`).set(auth(token)).send({ days: 14 });
    expect([200, 201]).toContain(frozen.status);
    expect(frozen.body.data.status).toBe('frozen');

    const resumed = await api.post(`/api/memberships/${id}/resume`).set(auth(token));
    expect([200, 201]).toContain(resumed.status);
    expect(resumed.body.data.status).toBe('active');
    expect(new Date(resumed.body.data.endDate).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('cancels a membership and stops treating the member as active', async () => {
    const member = await newMember();
    const created = await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.id });
    const cancelled = await api.post(`/api/memberships/${created.body.data.id}/cancel`).set(auth(token)).send({ notes: 'moved away' });
    expect([200, 201]).toContain(cancelled.status);
    expect(cancelled.body.data.status).toBe('cancelled');

    const memberRow = await api.get(`/api/members/${member.id}`).set(auth(token));
    expect(['inactive', 'expired', 'cancelled']).toContain(memberRow.body.data.status);
  });

  it('changes plan and records the direction', async () => {
    const annual = await api.post('/api/membership-plans').set(auth(token)).send({
      name: 'Annual Test', durationDays: 365, price: 20000, billingCycle: 'yearly',
    });
    const member = await newMember();
    const created = await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: plan.id });

    const changed = await api.post(`/api/memberships/${created.body.data.id}/change`).set(auth(token))
      .send({ planId: annual.body.data.id, direction: 'upgrade' });
    expect([200, 201]).toContain(changed.status);
    expect(changed.body.data.planName).toBe('Annual Test');
    expect(changed.body.data.changeType).toBe('upgrade');
  });

  it('retires a plan instead of deleting it while memberships reference it', async () => {
    const used = await api.post('/api/membership-plans').set(auth(token)).send({
      name: 'To Retire', durationDays: 30, price: 999, billingCycle: 'monthly',
    });
    const member = await newMember();
    await api.post('/api/memberships').set(auth(token)).send({ memberId: member.id, planId: used.body.data.id });

    const del = await api.delete(`/api/membership-plans/${used.body.data.id}`).set(auth(token));
    expect([200, 204, 409]).toContain(del.status);

    const row = await queryOne('SELECT is_active FROM membership_plans WHERE id = $1', [used.body.data.id]);
    expect(row, 'plan row must survive').not.toBeNull();
  });

  it('rejects a membership for a member that does not exist', async () => {
    const res = await api.post('/api/memberships').set(auth(token)).send({
      memberId: '00000000-0000-0000-0000-000000000001', planId: plan.id,
    });
    expect([404, 422]).toContain(res.status);
  });

  it('validates dates: end before start is refused', async () => {
    const member = await newMember();
    const res = await api.post('/api/memberships').set(auth(token)).send({
      memberId: member.id, planId: plan.id, startDate: '2026-06-01', endDate: '2026-01-01',
    });
    expect([400, 422]).toContain(res.status);
  });
});
