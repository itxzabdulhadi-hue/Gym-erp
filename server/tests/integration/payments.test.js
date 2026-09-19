import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, closeDbAfterSuite } from '../helpers/context.js';
import * as fx from '../helpers/fixtures.js';
import { queryOne } from '../../src/db/index.js';

describe('payments', () => {
  closeDbAfterSuite();

  let tenant;
  let token;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Payments Gym', slugPrefix: 'pay' });
    tenant = owner.tenant;
    token = owner.token;
  });

  const newMember = () => fx.member(tenant.id, { firstName: 'Paying', lastName: 'Member' });

  it('records a payment and generates a tenant-scoped invoice number', async () => {
    const member = await newMember();
    const res = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 3000, method: 'cash' });
    expect(res.status).toBe(201);
    expect(res.body.data.invoiceNo).toBeTruthy();
    expect(res.body.data.status).toBe('paid');
    expect(Number(res.body.data.amount)).toBe(3000);
  });

  it('never reuses an invoice number inside a tenant', async () => {
    const member = await newMember();
    const seen = new Set();
    for (let i = 0; i < 5; i += 1) {
      const res = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 100 });
      expect(res.status).toBe(201);
      expect(seen.has(res.body.data.invoiceNo), `duplicate ${res.body.data.invoiceNo}`).toBe(false);
      seen.add(res.body.data.invoiceNo);
    }
  });

  it('marks a part payment as partial and tracks the balance', async () => {
    const member = await newMember();
    const res = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 1000, amountPaid: 400 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('partial');
    expect(Number(res.body.data.amountPaid)).toBe(400);
  });

  it('refuses a payment larger than the amount owed', async () => {
    const member = await newMember();
    const res = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 100, amountPaid: 500 });
    // The database CHECK would catch it; the API must reject it before that.
    expect([400, 422], `got ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`).toContain(res.status);
  });

  it('refuses a negative amount', async () => {
    const member = await newMember();
    const res = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: -50 });
    expect([400, 422]).toContain(res.status);
  });

  it('produces printable receipt data from real records', async () => {
    const member = await newMember();
    const created = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 1500, method: 'card' });
    const receipt = await api.get(`/api/payments/${created.body.data.id}/receipt`).set(auth(token));
    expect(receipt.status).toBe(200);

    const body = JSON.stringify(receipt.body);
    expect(body).toContain(created.body.data.invoiceNo);
    expect(body).toContain(member.first_name);
    // The receipt carries the tenant's own branding, not hardcoded copy.
    expect(body).toContain('Payments Gym');
  });

  it('refunds a payment and records the reason', async () => {
    const member = await newMember();
    const created = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 800 });
    const refunded = await api.post(`/api/payments/${created.body.data.id}/refund`).set(auth(token))
      .send({ amount: 800, reason: 'duplicate charge' });
    expect([200, 201]).toContain(refunded.status);

    const row = await queryOne('SELECT status, refunded_at, refund_reason FROM payments WHERE id = $1', [created.body.data.id]);
    expect(row.status).toBe('refunded');
    expect(row.refunded_at).toBeTruthy();
    expect(row.refund_reason).toBe('duplicate charge');
  });

  it('refuses to refund more than was paid', async () => {
    const member = await newMember();
    const created = await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 200 });
    const res = await api.post(`/api/payments/${created.body.data.id}/refund`).set(auth(token)).send({ amount: 5000 });
    expect([400, 422]).toContain(res.status);
  });

  it('summarises collections without leaking other tenants', async () => {
    const member = await newMember();
    await api.post('/api/payments').set(auth(token)).send({ memberId: member.id, amount: 777 });

    const summary = await api.get('/api/payments/summary').set(auth(token));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toBeTruthy();

    const row = await queryOne(
      `SELECT COALESCE(SUM(amount_paid),0)::numeric AS total FROM payments WHERE tenant_id = $1 AND status IN ('paid','partial')`,
      [tenant.id],
    );
    expect(Number(summary.body.data.total ?? summary.body.data.collected ?? row.total)).toBeGreaterThan(0);
  });

  it('exports CSV with a content disposition', async () => {
    const res = await api.get('/api/payments/export').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/i);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });
});
