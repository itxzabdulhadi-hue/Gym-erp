import { query } from '../../src/db/index.js';

/**
 * Direct database fixtures.
 *
 * Cross-tenant tests need records that exist in the *other* tenant, and going
 * through the API for those would hide the very thing under test (a leaked
 * record would be created by the endpoint being tested). These helpers write
 * straight to the database.
 */
let seq = 0;
const nextNo = () => {
  seq += 1;
  return `M-9${String(seq).padStart(3, '0')}`;
};

export async function member(tenantId, { firstName = 'Fixture', lastName = 'Member', status = 'active', memberNo } = {}) {
  const res = await query(
    `INSERT INTO members (tenant_id, member_no, first_name, last_name, status, join_date)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
     RETURNING *`,
    [tenantId, memberNo || nextNo(), firstName, lastName, status],
  );
  return res.rows[0];
}

export async function membership(tenantId, memberId, { planName = 'Monthly', price = 100, status = 'active', days = 30 } = {}) {
  const res = await query(
    `INSERT INTO memberships (tenant_id, member_id, plan_name, price, status, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_DATE + ($6 || ' days')::interval)
     RETURNING *`,
    [tenantId, memberId, planName, price, status, days],
  );
  return res.rows[0];
}

export async function payment(tenantId, memberId, { amount = 100, invoiceNo, status = 'paid' } = {}) {
  const res = await query(
    `INSERT INTO payments (tenant_id, member_id, invoice_no, amount, amount_paid, status, method, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'cash', now())
     RETURNING *`,
    [tenantId, memberId, invoiceNo || `INV-T-${Date.now()}-${seq}`, amount, status === 'paid' ? amount : 0, status],
  );
  return res.rows[0];
}

export async function attendance(tenantId, memberId) {
  const res = await query(
    `INSERT INTO attendance (tenant_id, member_id, check_in_at, visit_date)
     VALUES ($1, $2, now(), CURRENT_DATE)
     RETURNING *`,
    [tenantId, memberId],
  );
  return res.rows[0];
}

export async function trainer(tenantId, { firstName = 'Fixture', lastName = 'Trainer' } = {}) {
  const res = await query(
    `INSERT INTO trainers (tenant_id, first_name, last_name, email, status)
     VALUES ($1, $2, $3, lower($4), 'active')
     RETURNING *`,
    [tenantId, firstName, lastName, `${firstName}.${lastName}${seq}@example.test`],
  );
  return res.rows[0];
}

export async function expense(tenantId, { title = 'Fixture expense', amount = 25 } = {}) {
  const res = await query(
    `INSERT INTO expenses (tenant_id, title, amount, category, expense_date)
     VALUES ($1, $2, $3, 'supplies', CURRENT_DATE)
     RETURNING *`,
    [tenantId, title, amount],
  );
  return res.rows[0];
}

export async function file(tenantId, { purpose = 'member_photo', filename = 'fixture.jpg' } = {}) {
  const key = `test/${tenantId}/${Date.now()}-${seq}.jpg`;
  const res = await query(
    `INSERT INTO files (tenant_id, bucket, storage_key, filename, mime_type, byte_size, purpose, url, meta)
     VALUES ($1, 'local', $2, $3, 'image/jpeg', 1024, $4, $5, '{}'::jsonb)
     RETURNING *`,
    [tenantId, key, filename, purpose, `/api/files/${key}/download`],
  );
  return res.rows[0];
}

export async function auditLog(tenantId, { action = 'member.create', entity = 'member' } = {}) {
  const res = await query(
    `INSERT INTO audit_logs (tenant_id, action, entity, user_label, ip)
     VALUES ($1, $2, $3, 'fixture', '127.0.0.1')
     RETURNING *`,
    [tenantId, action, entity],
  );
  return res.rows[0];
}
