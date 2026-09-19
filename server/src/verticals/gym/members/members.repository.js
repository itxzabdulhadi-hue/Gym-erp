import { query, queryOne, queryMany } from '../../../db/index.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';

/**
 * Members - data access only.
 *
 * No HTTP, no audit, no business rules. Every function runs through `query()`,
 * which resolves the ambient client set by `withTenant()` in the service, so a
 * repository call automatically joins the caller's transaction.
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

const SELECT_ONE = `
  SELECT m.*, concat(m.first_name, ' ', m.last_name) AS full_name,
         t.first_name || ' ' || t.last_name AS trainer_name,
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
  WHERE m.tenant_id = $1 AND m.id = $2
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

const clampLimit = (limit, fallback = 50, max = 500) => Math.min(Number(limit) || fallback, max);

export const membersRepository = {
  /** Paged list. `count` and `rows` use the same filter; params are cloned because each statement consumes its own. */
  async list(tenantId, q, { limit, offset }) {
    const { where, params } = buildWhere(tenantId, q);
    const orderSql = resolveSort(q.sort, q.order, SORTABLE, 'm.created_at DESC');
    const countParams = [...params];

    const [rows, count] = await Promise.all([
      query(
        `${SELECT_LIST} WHERE ${where} ORDER BY ${orderSql} LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      query(`SELECT count(*)::int AS total FROM members m WHERE ${where}`, countParams),
    ]);
    return { rows: rows.rows, total: count.rows[0].total };
  },

  findById: (tenantId, memberId) => queryOne(SELECT_ONE, [tenantId, memberId]),

  /** The bare row, used to diff fields for the audit trail. */
  findRawById: (tenantId, memberId) =>
    queryOne('SELECT * FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, memberId]),

  findSummaryById: (tenantId, memberId) =>
    queryOne('SELECT member_no, first_name, last_name FROM members WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      memberId,
    ]),

  existsByMemberNo: (tenantId, memberNo) =>
    queryOne('SELECT id FROM members WHERE tenant_id = $1 AND member_no = $2', [tenantId, memberNo]),

  existsByEmail: (tenantId, email) =>
    queryOne('SELECT id FROM members WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenantId, email]),

  async count(tenantId) {
    const row = await queryOne('SELECT count(*)::int AS c FROM members WHERE tenant_id = $1', [tenantId]);
    return row.c;
  },

  insert(tenantId, values, createdBy) {
    return queryOne(
      `INSERT INTO members (tenant_id, member_no, first_name, last_name, dob, gender, phone, email, address, city,
                            emergency_contact, emergency_phone, photo_url, join_date, trainer_id, status, blood_group,
                            occupation, notes, custom_fields, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [
        tenantId, values.memberNo, values.firstName, values.lastName, values.dob, values.gender,
        values.phone, values.email, values.address, values.city,
        values.emergencyContact, values.emergencyPhone, values.photoUrl,
        values.joinDate, values.trainerId, values.status,
        values.bloodGroup, values.occupation, values.notes,
        JSON.stringify(values.customFields || {}), createdBy ?? null,
      ],
    );
  },

  /** Bulk import row; returns null when the member number is already taken. */
  insertImported(tenantId, row, createdBy) {
    return queryOne(
      `INSERT INTO members (tenant_id, member_no, first_name, last_name, dob, gender, phone, email, address,
                            join_date, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id, member_no) DO NOTHING RETURNING id`,
      [
        tenantId, row.memberNo, row.firstName, row.lastName, row.dob, row.gender, row.phone,
        row.email, row.address, row.joinDate, row.status, row.notes, createdBy ?? null,
      ],
    );
  },

  /**
   * Patch by column map. `sets`/`params` are built by the service, which owns
   * the camelCase-to-column mapping.
   */
  update(tenantId, memberId, sets, params) {
    return queryOne(
      `UPDATE members SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, memberId, ...params],
    );
  },

  remove(tenantId, memberId) {
    return query('DELETE FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, memberId]);
  },

  async bulkStatus(tenantId, memberIds, status) {
    const res = await query(
      `UPDATE members SET status = $2 WHERE tenant_id = $1 AND id IN (${memberIds.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
      [tenantId, status, ...memberIds],
    );
    return res.rowCount;
  },

  // -------------------------------------------------------------------------
  // Sub-resources for the profile page
  // -------------------------------------------------------------------------

  memberships: (tenantId, memberId) =>
    queryMany(
      `SELECT ms.*, mp.name AS plan_current_name
       FROM memberships ms LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
       WHERE ms.tenant_id = $1 AND ms.member_id = $2 ORDER BY ms.start_date DESC`,
      [tenantId, memberId],
    ),

  payments: (tenantId, memberId, limit) =>
    queryMany(
      'SELECT * FROM payments WHERE tenant_id = $1 AND member_id = $2 ORDER BY paid_at DESC, created_at DESC LIMIT $3',
      [tenantId, memberId, clampLimit(limit)],
    ),

  attendance(tenantId, memberId, { limit, from, to } = {}) {
    const params = [tenantId, memberId];
    let sql = 'SELECT * FROM attendance WHERE tenant_id = $1 AND member_id = $2';
    if (from) sql += ` AND visit_date >= ${param(params, from)}`;
    if (to) sql += ` AND visit_date <= ${param(params, to)}`;
    sql += ` ORDER BY check_in_at DESC LIMIT ${param(params, clampLimit(limit))}`;
    return queryMany(sql, params);
  },

  progress: (tenantId, memberId) =>
    queryMany('SELECT * FROM progress_records WHERE tenant_id = $1 AND member_id = $2 ORDER BY recorded_at ASC', [
      tenantId,
      memberId,
    ]),

  workouts: (tenantId, memberId) =>
    queryMany(
      `SELECT wa.*, wp.name AS plan_name, wp.level, wp.goal,
              concat(t.first_name, ' ', t.last_name) AS trainer_name
       FROM workout_assignments wa
       JOIN workout_plans wp ON wp.id = wa.plan_id
       LEFT JOIN trainers t ON t.id = wa.trainer_id
       WHERE wa.tenant_id = $1 AND wa.member_id = $2
       ORDER BY wa.assigned_at DESC`,
      [tenantId, memberId],
    ),

  documents: (tenantId, memberId) =>
    queryMany(
      `SELECT md.id, md.label, md.created_at, f.id AS file_id, f.filename, f.url, f.mime_type, f.byte_size
       FROM member_documents md JOIN files f ON f.id = md.file_id
       WHERE md.tenant_id = $1 AND md.member_id = $2 ORDER BY md.created_at DESC`,
      [tenantId, memberId],
    ),

  findFile: (tenantId, fileId) =>
    queryOne('SELECT id FROM files WHERE tenant_id = $1 AND id = $2', [tenantId, fileId]),

  insertDocument: (tenantId, memberId, fileId, label) =>
    queryOne(
      'INSERT INTO member_documents (tenant_id, member_id, file_id, label) VALUES ($1,$2,$3,$4) RETURNING *',
      [tenantId, memberId, fileId, label],
    ),

  findTrainer: (tenantId, trainerId) =>
    queryOne('SELECT id FROM trainers WHERE tenant_id = $1 AND id = $2', [tenantId, trainerId]),

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  exportRows(tenantId, q) {
    const { where, params } = buildWhere(tenantId, q);
    params.push(10_000);
    return queryMany(
      `SELECT m.member_no, m.first_name, m.last_name, m.dob, m.gender, m.phone, m.email, m.address, m.city,
              m.join_date, m.status, m.emergency_contact, m.emergency_phone, m.notes,
              t.first_name || ' ' || t.last_name AS trainer
       FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id
       WHERE ${where} ORDER BY m.created_at DESC LIMIT $${params.length}`,
      params,
    );
  },
};

export default membersRepository;
