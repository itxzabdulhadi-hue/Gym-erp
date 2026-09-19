import { withTenant, query } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';
import { memberNumber } from '../../../utils/ids.js';
import { toCsv, parseCsv } from '../../../utils/csv.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { todayISO, addDays, age, toISODate } from '../../../utils/dates.js';
import { MEMBER_STATUSES } from '@erp/shared';

/**
 * Members.
 *
 * The member row holds identity + lifecycle state. Everything transactional
 * (memberships, payments, attendance, progress) lives in its own table and is
 * read through the member's sub-resources so a profile page never drags the
 * whole history into a list query.
 */

const SORTABLE = {
  name: 'm.last_name, m.first_name',
  created_at: 'm.created_at',
  join_date: 'm.join_date',
  status: 'm.status',
  member_no: 'm.member_no',
};

const SELECT_LIST = `
  SELECT m.id, m.member_no, m.first_name, m.last_name, m.dob, m.gender, m.phone, m.email,
         m.status, m.join_date, m.photo_url, m.trainer_id, m.created_at,
         concat(m.first_name, ' ', m.last_name) AS full_name,
         t.first_name || ' ' || t.last_name AS trainer_name,
         cur.plan_name AS current_plan,
         cur.end_date AS membership_end_date,
         cur.status AS membership_status,
         COALESCE(visits.visits, 0)::int AS visits_30d,
         COALESCE(visits.total, 0)::int AS total_visits,
         COALESCE(due.outstanding, 0)::numeric AS outstanding
  FROM members m
  LEFT JOIN trainers t ON t.id = m.trainer_id
  LEFT JOIN LATERAL (
    SELECT plan_name, end_date, status FROM memberships
    WHERE member_id = m.id ORDER BY end_date DESC LIMIT 1
  ) cur ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE a.visit_date >= CURRENT_DATE - interval '30 days') AS visits,
           count(*) AS total
    FROM attendance a
    WHERE a.member_id = m.id
  ) visits ON true
  LEFT JOIN LATERAL (
    SELECT SUM(amount - amount_paid) AS outstanding FROM payments p
    WHERE p.member_id = m.id AND p.status IN ('pending', 'partial')
  ) due ON true
`;

function buildWhere(tenantId, q) {
  const params = [];
  const where = [`m.tenant_id = ${param(params, tenantId)}`];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(m.first_name ILIKE ${param(params, pattern)}
      OR m.last_name ILIKE ${param(params, pattern)}
      OR m.member_no ILIKE ${param(params, pattern)}
      OR m.email ILIKE ${param(params, pattern)}
      OR m.phone ILIKE ${param(params, pattern)}
      OR (m.first_name || ' ' || m.last_name) ILIKE ${param(params, pattern)})`);
  }
  if (q.status?.length) {
    const list = Array.isArray(q.status) ? q.status : [q.status];
    where.push(`m.status IN (${list.map((s) => param(params, s)).join(', ')})`);
  }
  if (q.gender) where.push(`m.gender = ${param(params, q.gender)}`);
  if (q.trainerId) where.push(`m.trainer_id = ${param(params, q.trainerId)}`);
  if (q.planId) {
    where.push(`EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.plan_id = ${param(params, q.planId)} AND ms.status = 'active')`);
  }
  if (q.joinedFrom) where.push(`m.join_date >= ${param(params, q.joinedFrom)}`);
  if (q.joinedTo) where.push(`m.join_date <= ${param(params, q.joinedTo)}`);
  if (q.expiringWithinDays) {
    where.push(`EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'active'
      AND ms.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${param(params, Number(q.expiringWithinDays))})`);
  }

  return { where: where.join(' AND '), params };
}

export async function listMembers(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const { where, params } = buildWhere(tenantId, q);
  const orderSql = resolveSort(q.sort, q.order, SORTABLE, 'm.created_at DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(`${SELECT_LIST} WHERE ${where} ORDER BY ${orderSql} LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`, params),
      client.query(`SELECT count(*)::int AS total FROM members m WHERE ${where}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapeMember), pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function getMember(tenantId, memberId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT m.*, concat(m.first_name, ' ', m.last_name) AS full_name,
              t.first_name || ' ' || t.last_name AS trainer_name, t.id AS trainer_id2,
              cur.plan_name AS current_plan, cur.end_date AS membership_end_date,
              cur.status AS membership_status, cur.plan_id AS current_plan_id, cur.id AS current_membership_id,
              (SELECT count(*)::int FROM attendance a WHERE a.member_id = m.id) AS total_visits,
              (SELECT count(*)::int FROM attendance a WHERE a.member_id = m.id AND a.visit_date >= CURRENT_DATE - interval '30 days') AS visits_30d,
              (SELECT COALESCE(SUM(amount_paid), 0)::numeric FROM payments p WHERE p.member_id = m.id AND p.status IN ('paid','partial')) AS total_paid,
              (SELECT COALESCE(SUM(amount - amount_paid), 0)::numeric FROM payments p WHERE p.member_id = m.id AND p.status IN ('pending','partial')) AS outstanding,
              (SELECT recorded_at FROM progress_records pr WHERE pr.member_id = m.id ORDER BY recorded_at DESC LIMIT 1) AS last_progress_at
       FROM members m
       LEFT JOIN trainers t ON t.id = m.trainer_id
       LEFT JOIN LATERAL (
         SELECT id, plan_id, plan_name, end_date, status FROM memberships
         WHERE member_id = m.id ORDER BY end_date DESC LIMIT 1
       ) cur ON true
       WHERE m.tenant_id = $1 AND m.id = $2`,
      [tenantId, memberId],
    );
    const row = res.rows[0];
    if (!row) throw ApiError.notFound('Member not found');
    return { ...shapeMember(row), notes: row.notes, address: row.address, city: row.city, emergencyContact: row.emergency_contact, emergencyPhone: row.emergency_phone, bloodGroup: row.blood_group, occupation: row.occupation, customFields: row.custom_fields || {}, totalPaid: Number(row.total_paid), outstanding: Number(row.outstanding), lastProgressAt: row.last_progress_at };
  });
}

export async function createMember(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const memberNo = input.memberNo || (await nextMemberNumber(client, tenantId));
    const clash = await client.query('SELECT id FROM members WHERE tenant_id = $1 AND member_no = $2', [tenantId, memberNo]);
    if (clash.rowCount) throw ApiError.conflict(`Member number ${memberNo} is already used`);

    if (input.email) {
      const dup = await client.query('SELECT id FROM members WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenantId, input.email]);
      if (dup.rowCount) throw ApiError.conflict('A member with that email already exists');
    }
    if (input.trainerId) await assertTrainer(client, tenantId, input.trainerId);

    const inserted = await client.query(
      `INSERT INTO members (tenant_id, member_no, first_name, last_name, dob, gender, phone, email, address, city,
                            emergency_contact, emergency_phone, photo_url, join_date, trainer_id, status, blood_group, occupation, notes, custom_fields, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [
        tenantId, memberNo, input.firstName, input.lastName, input.dob ?? null, input.gender ?? null,
        input.phone ?? null, input.email ?? null, input.address ?? null, input.city ?? null,
        input.emergencyContact ?? null, input.emergencyPhone ?? null, input.photoUrl ?? null,
        input.joinDate || todayISO(), input.trainerId ?? null, input.status || 'active',
        input.bloodGroup ?? null, input.occupation ?? null, input.notes ?? null,
        JSON.stringify(input.customFields || {}), actor?.userId ?? null,
      ],
    );

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.created',
      entity: 'member',
      entityId: inserted.rows[0].id,
      metadata: { memberNo, name: `${input.firstName} ${input.lastName}` },
    });

    return shapeMember({ ...inserted.rows[0], full_name: `${input.firstName} ${input.lastName}` });
  });
}

export async function updateMember(tenantId, memberId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, memberId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('Member not found');
    if (input.trainerId) await assertTrainer(client, tenantId, input.trainerId);

    const columns = {
      firstName: 'first_name', lastName: 'last_name', dob: 'dob', gender: 'gender', phone: 'phone',
      email: 'email', address: 'address', city: 'city', emergencyContact: 'emergency_contact',
      emergencyPhone: 'emergency_phone', photoUrl: 'photo_url', joinDate: 'join_date',
      trainerId: 'trainer_id', status: 'status', bloodGroup: 'blood_group', occupation: 'occupation', notes: 'notes',
    };

    const sets = [];
    const params = [tenantId, memberId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (input.customFields !== undefined) {
      params.push(JSON.stringify(input.customFields));
      sets.push(`custom_fields = $${params.length}::jsonb`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(
      `UPDATE members SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );

    const after = res.rows[0];
    const changes = {};
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] !== undefined && String(before[column] ?? '') !== String(after[column] ?? '')) {
        changes[key] = { from: before[column], to: after[column] };
      }
    }

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.updated',
      entity: 'member',
      entityId: memberId,
      metadata: { memberNo: before.member_no, changes },
    });

    return shapeMember({ ...after, full_name: `${after.first_name} ${after.last_name}` });
  });
}

export async function deleteMember(tenantId, memberId, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT member_no, first_name, last_name FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, memberId]);
    if (!current.rows[0]) throw ApiError.notFound('Member not found');

    await client.query('DELETE FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, memberId]);
    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.deleted',
      entity: 'member',
      entityId: memberId,
      metadata: { memberNo: current.rows[0].member_no, name: `${current.rows[0].first_name} ${current.rows[0].last_name}` },
    });
    return { ok: true };
  });
}

/** Bulk status change (suspend / freeze / reactivate from the list view). */
export async function bulkUpdateStatus(tenantId, memberIds, status, actor) {
  if (!MEMBER_STATUSES.includes(status)) throw ApiError.badRequest('Unknown member status');
  if (!memberIds.length) throw ApiError.badRequest('No members selected');

  return withTenant(tenantId, async (client) => {
    const placeholders = memberIds.map((_, i) => `$${i + 3}`).join(', ');
    const res = await client.query(
      `UPDATE members SET status = $2 WHERE tenant_id = $1 AND id IN (${placeholders}) RETURNING id`,
      [tenantId, status, ...memberIds],
    );
    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.bulk_status',
      entity: 'member',
      entityId: tenantId,
      metadata: { status, count: res.rowCount },
    });
    return { updated: res.rowCount };
  });
}

// ---------------------------------------------------------------------------
// Sub-resources used by the profile page
// ---------------------------------------------------------------------------

export async function memberMemberships(tenantId, memberId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT ms.*, mp.name AS plan_current_name
       FROM memberships ms LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
       WHERE ms.tenant_id = $1 AND ms.member_id = $2 ORDER BY ms.start_date DESC`,
      [tenantId, memberId],
    ),
  );
  return res.rows;
}

export async function memberPayments(tenantId, memberId, limit = 50) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT * FROM payments WHERE tenant_id = $1 AND member_id = $2 ORDER BY paid_at DESC, created_at DESC LIMIT $3`,
      [tenantId, memberId, Math.min(Number(limit) || 50, 500)],
    ),
  );
  return res.rows;
}

export async function memberAttendance(tenantId, memberId, { limit = 50, from, to } = {}) {
  const params = [tenantId, memberId];
  let sql = 'SELECT * FROM attendance WHERE tenant_id = $1 AND member_id = $2';
  if (from) {
    params.push(from);
    sql += ` AND visit_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    sql += ` AND visit_date <= $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 500));
  sql += ` ORDER BY check_in_at DESC LIMIT $${params.length}`;
  const res = await withTenant(tenantId, (client) => client.query(sql, params));
  return res.rows;
}

export async function memberProgress(tenantId, memberId) {
  const res = await withTenant(tenantId, (client) =>
    client.query('SELECT * FROM progress_records WHERE tenant_id = $1 AND member_id = $2 ORDER BY recorded_at ASC', [tenantId, memberId]),
  );
  return res.rows;
}

export async function memberWorkouts(tenantId, memberId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT wa.*, wp.name AS plan_name, wp.level, wp.goal,
              concat(t.first_name, ' ', t.last_name) AS trainer_name
       FROM workout_assignments wa
       JOIN workout_plans wp ON wp.id = wa.plan_id
       LEFT JOIN trainers t ON t.id = wa.trainer_id
       WHERE wa.tenant_id = $1 AND wa.member_id = $2
       ORDER BY wa.assigned_at DESC`,
      [tenantId, memberId],
    ),
  );
  return res.rows;
}

export async function memberDocuments(tenantId, memberId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT md.id, md.label, md.created_at, f.id AS file_id, f.filename, f.url, f.mime_type, f.byte_size
       FROM member_documents md JOIN files f ON f.id = md.file_id
       WHERE md.tenant_id = $1 AND md.member_id = $2 ORDER BY md.created_at DESC`,
      [tenantId, memberId],
    ),
  );
  return res.rows;
}

export async function attachDocument(tenantId, memberId, { fileId, label }, actor) {
  const res = await withTenant(tenantId, async (client) => {
    const file = await client.query('SELECT id FROM files WHERE tenant_id = $1 AND id = $2', [tenantId, fileId]);
    if (!file.rows[0]) throw ApiError.notFound('File not found');
    const inserted = await client.query(
      'INSERT INTO member_documents (tenant_id, member_id, file_id, label) VALUES ($1,$2,$3,$4) RETURNING *',
      [tenantId, memberId, fileId, label || 'Document'],
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'member.document_added', entity: 'member', entityId: memberId,
      metadata: { label: label || 'Document' },
    });
    return inserted.rows[0];
  });
  return res;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const IMPORT_COLUMNS = ['member_no', 'first_name', 'last_name', 'dob', 'gender', 'phone', 'email', 'address', 'join_date', 'status', 'notes'];

export function importTemplateCsv() {
  return toCsv(
    [{ member_no: 'M-1001', first_name: 'Alex', last_name: 'Rivera', dob: '1994-05-12', gender: 'male', phone: '+15551234567', email: 'alex@example.com', address: '12 Main St', join_date: todayISO(), status: 'active', notes: '' }],
    IMPORT_COLUMNS.map((c) => ({ key: c, header: c })),
  );
}

/**
 * Validate then insert. Every row is checked; invalid rows are reported with
 * their line number and nothing is written for them.
 */
export async function importMembers(tenantId, csvText, actor) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) throw ApiError.badRequest('The file has no data rows');
  if (rows.length > 5000) throw ApiError.badRequest('Import at most 5000 rows at a time');

  const errors = [];
  const prepared = [];

  rows.forEach((row, index) => {
    const line = row.__line || index + 2;
    const firstName = row.first_name?.trim();
    const lastName = row.last_name?.trim();
    if (!firstName || !lastName) {
      errors.push({ line, message: 'first_name and last_name are required' });
      return;
    }
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
      errors.push({ line, message: `"${row.email}" is not a valid email` });
      return;
    }
    if (row.dob && !/^\d{4}-\d{2}-\d{2}$/.test(row.dob)) {
      errors.push({ line, message: 'dob must be YYYY-MM-DD' });
      return;
    }
    if (row.status && !MEMBER_STATUSES.includes(row.status)) {
      errors.push({ line, message: `status must be one of ${MEMBER_STATUSES.join(', ')}` });
      return;
    }
    prepared.push({
      memberNo: row.member_no?.trim() || null,
      firstName,
      lastName,
      dob: row.dob || null,
      gender: row.gender || null,
      phone: row.phone || null,
      email: row.email || null,
      address: row.address || null,
      joinDate: row.join_date || todayISO(),
      status: row.status || 'active',
      notes: row.notes || null,
    });
  });

  if (errors.length) return { imported: 0, failed: errors.length, errors: errors.slice(0, 50) };

  const result = await withTenant(tenantId, async (client) => {
    let imported = 0;
    let sequence = await nextSequence(client, tenantId);
    for (const row of prepared) {
      const memberNo = row.memberNo || memberNumber(sequence);
      sequence += 1;
      const inserted = await client.query(
        `INSERT INTO members (tenant_id, member_no, first_name, last_name, dob, gender, phone, email, address, join_date, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tenant_id, member_no) DO NOTHING RETURNING id`,
        [tenantId, memberNo, row.firstName, row.lastName, row.dob, row.gender, row.phone, row.email, row.address, row.joinDate, row.status, row.notes, actor?.userId ?? null],
      );
      if (inserted.rowCount) imported += 1;
    }
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'member.imported', entity: 'member', entityId: tenantId,
      metadata: { imported, attempted: prepared.length },
    });
    return { imported, attempted: prepared.length };
  });

  return { ...result, failed: result.attempted - result.imported, errors: [] };
}

export async function exportMembersCsv(tenantId, q = {}) {
  const { where, params } = buildWhere(tenantId, q);
  params.push(10_000);
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT m.member_no, m.first_name, m.last_name, m.dob, m.gender, m.phone, m.email, m.address, m.city,
              m.join_date, m.status, m.emergency_contact, m.emergency_phone, m.notes,
              t.first_name || ' ' || t.last_name AS trainer
       FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id
       WHERE ${where} ORDER BY m.created_at DESC LIMIT $${params.length}`,
      params,
    ),
  );

  return toCsv(res.rows, [
    { key: 'member_no', header: 'Member No' },
    { key: 'first_name', header: 'First Name' },
    { key: 'last_name', header: 'Last Name' },
    { key: 'dob', header: 'Date of Birth' },
    { key: 'gender', header: 'Gender' },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email' },
    { key: 'address', header: 'Address' },
    { key: 'city', header: 'City' },
    { key: 'join_date', header: 'Join Date' },
    { key: 'status', header: 'Status' },
    { key: 'emergency_contact', header: 'Emergency Contact' },
    { key: 'emergency_phone', header: 'Emergency Phone' },
    { key: 'trainer', header: 'Trainer' },
    { key: 'notes', header: 'Notes' },
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function nextSequence(client, tenantId) {
  const res = await client.query('SELECT count(*)::int AS c FROM members WHERE tenant_id = $1', [tenantId]);
  return res.rows[0].c + 1;
}

export async function nextMemberNumber(client, tenantId) {
  // Retry on collision so two concurrent "new member" requests cannot both win.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sequence = await nextSequence(client, tenantId);
    const candidate = memberNumber(sequence + attempt);
    const clash = await client.query('SELECT 1 FROM members WHERE tenant_id = $1 AND member_no = $2', [tenantId, candidate]);
    if (!clash.rowCount) return candidate;
  }
  return memberNumber(Date.now() % 1_000_000);
}

async function assertTrainer(client, tenantId, trainerId) {
  const res = await client.query('SELECT id FROM trainers WHERE tenant_id = $1 AND id = $2', [tenantId, trainerId]);
  if (!res.rows[0]) throw ApiError.badRequest('That trainer does not belong to this business');
}

function shapeMember(row) {
  return {
    id: row.id,
    memberNo: row.member_no,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name || `${row.first_name} ${row.last_name}`,
    dob: row.dob,
    age: age(row.dob),
    gender: row.gender,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    photoUrl: row.photo_url,
    joinDate: row.join_date,
    status: row.status,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    currentPlan: row.current_plan,
    currentPlanId: row.current_plan_id,
    currentMembershipId: row.current_membership_id,
    membershipEndDate: row.membership_end_date,
    membershipStatus: row.membership_status,
    daysRemaining: row.membership_end_date ? daysUntil(row.membership_end_date) : null,
    visits30d: Number(row.visits_30d ?? 0),
    totalVisits: Number(row.total_visits ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    createdAt: row.created_at,
  };
}

function daysUntil(date) {
  return Math.round((new Date(`${toISODate(date)}T00:00:00Z`) - new Date(`${todayISO()}T00:00:00Z`)) / 86_400_000);
}

export { addDays };
