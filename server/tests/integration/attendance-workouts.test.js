import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, userWithRole, closeDbAfterSuite } from '../helpers/context.js';
import * as fx from '../helpers/fixtures.js';

closeDbAfterSuite();

describe('attendance', () => {
  let tenant;
  let token;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Attendance Gym', slugPrefix: 'att' });
    tenant = owner.tenant;
    token = owner.token;
  });

  it('checks a member in by id', async () => {
    const member = await fx.member(tenant.id);
    const res = await api.post('/api/attendance/check-in').set(auth(token)).send({ memberId: member.id });
    expect([200, 201]).toContain(res.status);
    const visit = res.body.data.visit ?? res.body.data;
    expect(visit.memberId ?? visit.member_id).toBe(member.id);
  });

  it('checks a member in by member number', async () => {
    const member = await fx.member(tenant.id);
    const res = await api.post('/api/attendance/check-in').set(auth(token)).send({ query: member.member_no });
    expect([200, 201]).toContain(res.status);
  });

  it('refuses an unknown member number instead of guessing', async () => {
    const res = await api.post('/api/attendance/check-in').set(auth(token)).send({ query: 'M-000000' });
    expect([404, 422]).toContain(res.status);
  });

  it('allows repeat visits by default, and can be told not to', async () => {
    const member = await fx.member(tenant.id);
    await api.post('/api/attendance/check-in').set(auth(token)).send({ memberId: member.id });

    // Default: a second visit the same day really is a second visit.
    const again = await api.post('/api/attendance/check-in').set(auth(token)).send({ memberId: member.id });
    expect([200, 201]).toContain(again.status);
    expect(again.body.data.alreadyCheckedIn ?? false).toBe(false);

    // With the setting off, the existing visit is returned instead of a new one.
    const patched = await api.patch('/api/settings/attendance').set(auth(token)).send({ allowMultipleCheckinsPerDay: false });
    expect([200, 422]).toContain(patched.status);

    const blocked = await api.post('/api/attendance/check-in').set(auth(token)).send({ memberId: member.id });
    expect(blocked.body.data.alreadyCheckedIn).toBe(true);

    await api.patch('/api/settings/attendance').set(auth(token)).send({ allowMultipleCheckinsPerDay: true });
  });

  it('checks a member out', async () => {
    const member = await fx.member(tenant.id);
    await api.post('/api/attendance/check-in').set(auth(token)).send({ memberId: member.id });
    const out = await api.post('/api/attendance/check-out').set(auth(token)).send({ memberId: member.id });
    expect([200, 201]).toContain(out.status);
  });

  it("lists today's visits for this tenant only", async () => {
    const other = await tenantWithOwner({ name: 'Attendance Other', slugPrefix: 'att2' });
    const foreign = await fx.member(other.tenant.id, { firstName: 'Elsewhere', lastName: 'Person' });
    await fx.attendance(other.tenant.id, foreign.id);

    const res = await api.get('/api/attendance/today').set(auth(token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Elsewhere');
  });

  it('produces monthly stats', async () => {
    const res = await api.get('/api/attendance/stats/monthly').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
  });
});

describe('workouts', () => {
  let tenant;
  let owner;
  let trainer;

  beforeAll(async () => {
    const ctx = await tenantWithOwner({ name: 'Workouts Gym', slugPrefix: 'wkt' });
    tenant = ctx.tenant;
    owner = ctx.token;
    trainer = (await userWithRole(tenant, 'trainer')).token;
  });

  it('creates an exercise and validates the muscle group', async () => {
    const ok = await api.post('/api/workouts/exercises').set(auth(owner)).send({ name: 'Goblet squat', muscleGroup: 'quadriceps' });
    expect([200, 201]).toContain(ok.status);

    const bad = await api.post('/api/workouts/exercises').set(auth(owner)).send({ name: 'Mystery', muscleGroup: 'biceps_aurium' });
    expect([400, 422]).toContain(bad.status);
  });

  it('refuses a duplicate exercise name within the tenant', async () => {
    await api.post('/api/workouts/exercises').set(auth(owner)).send({ name: 'Deadlift dupe' });
    const again = await api.post('/api/workouts/exercises').set(auth(owner)).send({ name: 'deadlift dupe' });
    expect([400, 409, 422]).toContain(again.status);
  });

  it('builds a plan with items', async () => {
    const exercise = await api.post('/api/workouts/exercises').set(auth(owner)).send({ name: 'Bench press' });
    const plan = await api.post('/api/workouts/plans').set(auth(owner)).send({
      name: 'Push day',
      items: [{ exerciseId: exercise.body.data.id, sets: 4, reps: '8', restSeconds: 90 }],
    });
    expect([200, 201]).toContain(plan.status);

    const fetched = await api.get(`/api/workouts/plans/${plan.body.data.id}`).set(auth(owner));
    expect(fetched.status).toBe(200);
  });

  it('assigns a plan to a member', async () => {
    const member = await fx.member(tenant.id);
    const plan = await api.post('/api/workouts/plans').set(auth(owner)).send({ name: 'Assign me' });
    const res = await api.post('/api/workouts/assignments').set(auth(owner)).send({ memberId: member.id, planId: plan.body.data.id });
    expect([200, 201]).toContain(res.status);
  });

  it('gives a trainer workout access but not financial access', async () => {
    expect((await api.get('/api/workouts/plans').set(auth(trainer))).status).toBe(200);
    expect((await api.get('/api/workouts/exercises').set(auth(trainer))).status).toBe(200);

    const payments = await api.get('/api/payments').set(auth(trainer));
    expect(payments.status).toBe(403);
    expect(payments.body.error.code).toBe('FORBIDDEN');
  });

  it('does not leak another tenant plans through the assignment endpoint', async () => {
    const other = await tenantWithOwner({ name: 'Workouts Other', slugPrefix: 'wkt2' });
    const foreignPlan = await api.post('/api/workouts/plans').set(auth(other.token)).send({ name: 'Foreign plan' });
    const member = await fx.member(tenant.id);

    const res = await api.post('/api/workouts/assignments').set(auth(owner)).send({
      memberId: member.id,
      planId: foreignPlan.body.data.id,
    });
    expect([400, 404, 422]).toContain(res.status);
  });
});
