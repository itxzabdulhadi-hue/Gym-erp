import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort, money as roundMoney } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { toCsv } from '../../../utils/csv.js';
import { todayISO } from '../../../utils/dates.js';
import { dispatchNotification } from '../../../core/notifications/notification.service.js';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from '@erp/shared';

/**
 * Payments and billing.
 *
 * Amount rules live here, not in the client: a payment is 'paid' when
 * amount_paid equals the amount, 'partial' when it is between 0 and the amount,
 * and 'pending' when nothing has been paid. 'refunded' is only reachable
 * through the refund action, which keeps an audit trail.
 */

const SORTABLE = {
  paid_at: 'p.paid_at',
  amount: 'p.amount',
  status: 'p.status',
  created_at: 'p.created_at',
  member: 'm.last_name, m.first_name',
  invoice_no: 'p.invoice_no',
};

export async function listPayments(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['p.tenant_id = $1'];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(p.invoice_no ILIKE ${param(params, pattern)} OR p.reference ILIKE ${param(params, pattern)}
      OR m.first_name ILIKE ${param(params, pattern)} OR m.last_name ILIKE ${param(params, pattern)}
      OR m.member_no ILIKE ${param(params, pattern)} OR (m.first_name || ' ' || m.last_name) ILIKE ${param(params, pattern)})`);
  }
  if (q.status?.length) {
    const list = Array.isArray(q.status) ? q.status : [q.status];
    where.push(`p.status IN (${list.map((s) => param(params, s)).join(', ')})`);
  }
  if (q.method) where.push(`p.method = ${param(params, q.method)}`);
  if (q.memberId) where.push(`p.member_id = ${param(params, q.memberId)}`);
  if (q.membershipId) where.push(`p.membership_id = ${param(params, q.membershipId)}`);
  if (q.from) where.push(`p.paid_at >= ${param(params, q.from)}`);
  if (q.to) where.push(`p.paid_at <= ${param(params, q.to)}`);
  if (q.receivedBy) where.push(`p.received_by = ${param(params, q.receivedBy)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, SORTABLE, 'p.created_at DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count, totals] = await Promise.all([
      client.query(
        `SELECT p.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no,
                concat(u.full_name) AS received_by_name
         FROM payments p
         JOIN members m ON m.id = p.member_id
         LEFT JOIN users u ON u.id = p.received_by
         WHERE ${whereSql} ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM payments p JOIN members m ON m.id = p.member_id WHERE ${whereSql}`, countParams),
      client.query(
        `SELECT COALESCE(SUM(p.amount), 0)::numeric AS billed,
                COALESCE(SUM(p.amount_paid), 0)::numeric AS collected,
                COALESCE(SUM(p.amount - p.amount_paid) FILTER (WHERE p.status IN ('pending','partial')), 0)::numeric AS outstanding,
                COALESCE(SUM(p.discount), 0)::numeric AS discounted
         FROM payments p JOIN members m ON m.id = p.member_id WHERE ${whereSql}`,
        countParams,
      ),
    ]);
    const t = totals.rows[0];
    return listResponse(rows.rows.map(shapePayment), pageMeta({ page, limit }, count.rows[0].total), {
      totals: {
        billed: Number(t.billed),
        collected: Number(t.collected),
        outstanding: Number(t.outstanding),
        discounted: Number(t.discounted),
      },
    });
  });
}

export async function getPayment(tenantId, paymentId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT p.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no, m.email, m.phone,
              ms.plan_name, ms.start_date, ms.end_date, u.full_name AS received_by_name
       FROM payments p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN memberships ms ON ms.id = p.membership_id
       LEFT JOIN users u ON u.id = p.received_by
       WHERE p.tenant_id = $1 AND p.id = $2`,
      [tenantId, paymentId],
    ),
  );
  if (!res.rows[0]) throw ApiError.notFound('Payment not found');
  return shapePayment(res.rows[0]);
}

export async function createPayment(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const member = await client.query('SELECT id, member_no, first_name, last_name FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, input.memberId]);
    if (!member.rows[0]) throw ApiError.notFound('Member not found');

    if (input.membershipId) {
      const ms = await client.query('SELECT id FROM memberships WHERE tenant_id = $1 AND id = $2 AND member_id = $3', [
        tenantId, input.membershipId, input.memberId,
      ]);
      if (!ms.rows[0]) throw ApiError.badRequest('That membership does not belong to this member');
    }

    const amount = roundMoney(input.amount);
    const discount = roundMoney(input.discount ?? 0);
    if (discount > amount) throw ApiError.badRequest('Discount cannot be greater than the amount');

    const requestedPaid = input.amountPaid !== undefined ? roundMoney(input.amountPaid) : amount - discount;
    // Clamping an overpayment silently would hide a data-entry mistake from the
    // person at the desk, so refuse it instead.
    if (requestedPaid > amount) throw ApiError.badRequest('Amount paid cannot be greater than the amount due');
    const amountPaid = Math.max(0, requestedPaid);
    const status = resolveStatus(amountPaid, amount);

    const settings = await client.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
    const allowPartial = settings.rows[0]?.settings?.payments?.allowPartialPayments !== false;
    if (!allowPartial && status === 'partial') throw ApiError.badRequest('Partial payments are disabled for this business');

    const invoiceNo = input.invoiceNo || (await nextInvoiceNumber(client, tenantId, settings.rows[0]?.settings));

    const inserted = await client.query(
      `INSERT INTO payments (tenant_id, member_id, membership_id, invoice_no, amount, discount, amount_paid, currency, method, status, paid_at, reference, notes, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        tenantId, input.memberId, input.membershipId ?? null, invoiceNo, amount, discount, amountPaid,
        input.currency || 'USD', input.method || 'cash', status, input.paidAt || todayISO(),
        input.reference ?? null, input.notes ?? null, actor?.userId ?? null,
      ],
    );

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'payment.created', entity: 'payment', entityId: inserted.rows[0].id,
      metadata: { invoiceNo, memberNo: member.rows[0].member_no, amount, amountPaid, method: input.method, status },
    });

    if (status === 'paid') {
      await dispatchNotification({
        tenantId,
        userId: actor?.userId ?? null,
        type: 'payment_received',
        title: 'Payment received',
        body: `${member.rows[0].first_name} ${member.rows[0].last_name} paid ${amount} (${invoiceNo}).`,
        level: 'success',
        entity: 'payment',
        entityId: inserted.rows[0].id,
        data: { amount, invoiceNo },
        channels: ['in_app'],
      }).catch(() => {
        /* notifications must never fail a payment */
      });
    }

    return shapePayment(inserted.rows[0]);
  });
}

export async function updatePayment(tenantId, paymentId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM payments WHERE tenant_id = $1 AND id = $2', [tenantId, paymentId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('Payment not found');
    if (before.status === 'refunded') throw ApiError.badRequest('A refunded payment cannot be edited');

    const amount = input.amount !== undefined ? roundMoney(input.amount) : Number(before.amount);
    const discount = input.discount !== undefined ? roundMoney(input.discount) : Number(before.discount);
    const amountPaid = input.amountPaid !== undefined ? roundMoney(input.amountPaid) : Number(before.amount_paid);

    if (amountPaid > amount) throw ApiError.badRequest('Paid amount cannot exceed the invoice amount');

    const sets = [];
    const params = [tenantId, paymentId];
    const columns = { method: 'method', paidAt: 'paid_at', reference: 'reference', notes: 'notes', membershipId: 'membership_id' };
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }

    if (input.amount !== undefined || input.discount !== undefined || input.amountPaid !== undefined) {
      sets.push(`amount = ${param(params, amount)}`);
      sets.push(`discount = ${param(params, discount)}`);
      sets.push(`amount_paid = ${param(params, Math.min(amountPaid, amount))}`);
      sets.push(`status = ${param(params, resolveStatus(Math.min(amountPaid, amount), amount))}`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(`UPDATE payments SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'payment.updated', entity: 'payment', entityId: paymentId,
      metadata: {
        invoiceNo: before.invoice_no,
        before: { amount: Number(before.amount), amountPaid: Number(before.amount_paid), status: before.status },
        after: { amount: Number(res.rows[0].amount), amountPaid: Number(res.rows[0].amount_paid), status: res.rows[0].status },
      },
    });

    return shapePayment(res.rows[0]);
  });
}

export async function refundPayment(tenantId, paymentId, { reason, amount } = {}, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM payments WHERE tenant_id = $1 AND id = $2', [tenantId, paymentId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('Payment not found');
    if (before.status === 'refunded') throw ApiError.badRequest('This payment is already refunded');
    if (Number(before.amount_paid) <= 0) throw ApiError.badRequest('Nothing has been paid on this invoice yet');

    const refundAmount = amount !== undefined ? roundMoney(amount) : Number(before.amount_paid);
    if (refundAmount <= 0 || refundAmount > Number(before.amount_paid)) {
      throw ApiError.badRequest('Refund amount must be between 0 and the amount paid');
    }

    const res = await client.query(
      `UPDATE payments SET status = 'refunded', refunded_at = now(), refunded_by = $3, refund_reason = $4,
              amount_paid = amount_paid - $5
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, paymentId, actor?.userId ?? null, reason ?? null, refundAmount],
    );

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'payment.refunded', entity: 'payment', entityId: paymentId,
      metadata: { invoiceNo: before.invoice_no, refundAmount, reason: reason ?? null },
    });

    return shapePayment(res.rows[0]);
  });
}

export async function deletePayment(tenantId, paymentId, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM payments WHERE tenant_id = $1 AND id = $2', [tenantId, paymentId]);
    if (!current.rows[0]) throw ApiError.notFound('Payment not found');
    if (Number(current.rows[0].amount_paid) > 0) {
      throw ApiError.badRequest('Payments with money received cannot be deleted - refund them instead');
    }
    await client.query('DELETE FROM payments WHERE tenant_id = $1 AND id = $2', [tenantId, paymentId]);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'payment.deleted', entity: 'payment', entityId: paymentId,
      metadata: { invoiceNo: current.rows[0].invoice_no },
    });
    return { ok: true };
  });
}

/**
 * Everything needed to render (and later PDF) a receipt. Returning structured
 * data keeps presentation in the client and makes a PDF generator a drop-in.
 */
export async function receiptData(tenantId, paymentId) {
  const payment = await getPayment(tenantId, paymentId);
  const branding = await loadBrandingForReceipt(tenantId);
  return { payment, branding };
}

async function loadBrandingForReceipt(tenantId) {
  const res = await withTenant(tenantId, (client) => client.query('SELECT * FROM branding WHERE tenant_id = $1', [tenantId]));
  const b = res.rows[0] || {};
  return {
    businessName: b.business_name,
    shortName: b.short_name,
    address: [b.address, b.city, b.country].filter(Boolean).join(', '),
    phone: b.phone,
    email: b.email,
    website: b.website,
    logoUrl: b.logo_url,
    currencySymbol: b.currency_symbol,
  };
}

export async function summary(tenantId, { from, to } = {}) {
  return withTenant(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['tenant_id = $1'];
    if (from) {
      params.push(from);
      where.push(`paid_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`paid_at <= $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const [totals, byMethod, byStatus] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS billed,
                COALESCE(SUM(amount_paid),0)::numeric AS collected, COALESCE(SUM(discount),0)::numeric AS discounted
         FROM payments WHERE ${whereSql}`,
        params,
      ),
      client.query(
        `SELECT method, count(*)::int AS count, COALESCE(SUM(amount_paid),0)::numeric AS collected
         FROM payments WHERE ${whereSql} AND status IN ('paid','partial') GROUP BY method ORDER BY collected DESC`,
        params,
      ),
      client.query(
        `SELECT status, count(*)::int AS count, COALESCE(SUM(amount - amount_paid),0)::numeric AS outstanding
         FROM payments WHERE ${whereSql} GROUP BY status ORDER BY status`,
        params,
      ),
    ]);

    return {
      from: from ?? null,
      to: to ?? null,
      ...totals.rows[0],
      billed: Number(totals.rows[0].billed),
      collected: Number(totals.rows[0].collected),
      discounted: Number(totals.rows[0].discounted),
      byMethod: byMethod.rows.map((r) => ({ ...r, collected: Number(r.collected), label: PAYMENT_METHOD_LABELS[r.method] ?? r.method })),
      byStatus: byStatus.rows.map((r) => ({ ...r, outstanding: Number(r.outstanding), label: PAYMENT_STATUS_LABELS[r.status] ?? r.status })),
    };
  });
}

export async function exportCsv(tenantId, q = {}) {
  const params = [tenantId];
  const where = ['p.tenant_id = $1'];
  if (q.from) {
    params.push(q.from);
    where.push(`p.paid_at >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`p.paid_at <= $${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`p.status = $${params.length}`);
  }
  if (q.memberId) {
    params.push(q.memberId);
    where.push(`p.member_id = $${params.length}`);
  }
  params.push(10_000);

  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT p.invoice_no, p.paid_at, m.member_no, concat(m.first_name, ' ', m.last_name) AS member_name,
              p.amount, p.discount, p.amount_paid, p.method, p.status, p.reference, p.notes
       FROM payments p JOIN members m ON m.id = p.member_id
       WHERE ${where.join(' AND ')} ORDER BY p.paid_at DESC LIMIT $${params.length}`,
      params,
    ),
  );

  return toCsv(res.rows, [
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'paid_at', header: 'Date' },
    { key: 'member_no', header: 'Member No' },
    { key: 'member_name', header: 'Member' },
    { key: 'amount', header: 'Amount' },
    { key: 'discount', header: 'Discount' },
    { key: 'amount_paid', header: 'Paid' },
    { key: 'method', header: 'Method' },
    { key: 'status', header: 'Status' },
    { key: 'reference', header: 'Reference' },
    { key: 'notes', header: 'Notes' },
  ]);
}

// ---------------------------------------------------------------------------

function resolveStatus(amountPaid, amount) {
  if (amountPaid <= 0) return 'pending';
  if (amountPaid >= amount) return 'paid';
  return 'partial';
}

async function nextInvoiceNumber(client, tenantId, settings) {
  const prefix = settings?.payments?.invoicePrefix || 'INV';
  const year = new Date().getUTCFullYear();
  const res = await client.query(
    "SELECT count(*)::int AS c FROM payments WHERE tenant_id = $1 AND paid_at >= date_trunc('year', CURRENT_DATE)",
    [tenantId],
  );
  let sequence = res.rows[0].c + 1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${prefix}-${year}-${String(sequence).padStart(5, '0')}`;
    const clash = await client.query('SELECT 1 FROM payments WHERE tenant_id = $1 AND invoice_no = $2', [tenantId, candidate]);
    if (!clash.rowCount) return candidate;
    sequence += 1;
  }
  return `${prefix}-${year}-${Date.now().toString().slice(-6)}`;
}

function shapePayment(row) {
  const amount = Number(row.amount);
  const amountPaid = Number(row.amount_paid ?? 0);
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    memberId: row.member_id,
    memberName: row.member_name,
    memberNo: row.member_no,
    membershipId: row.membership_id,
    planName: row.plan_name,
    periodStart: row.start_date,
    periodEnd: row.end_date,
    amount,
    discount: Number(row.discount ?? 0),
    amountPaid,
    balance: Math.max(0, Math.round((amount - amountPaid) * 100) / 100),
    currency: row.currency,
    method: row.method,
    methodLabel: PAYMENT_METHOD_LABELS[row.method] ?? row.method,
    status: row.status,
    statusLabel: PAYMENT_STATUS_LABELS[row.status] ?? row.status,
    paidAt: row.paid_at,
    reference: row.reference,
    notes: row.notes,
    receivedBy: row.received_by,
    receivedByName: row.received_by_name,
    refundedAt: row.refunded_at,
    refundReason: row.refund_reason,
    createdAt: row.created_at,
  };
}
