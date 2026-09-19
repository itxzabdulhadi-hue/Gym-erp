import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';

/**
 * Trainers (staff).
 *
 * A trainer can optionally be linked to a login account; that link is what lets
 * the trainer role see only their assigned members.
 */

const SORTABLE = {
  name: 't.last_name, t.first_name',
  created_at: 't.created_at',
  status: 't.status',
  members: 'member_count DESC',
};

export async function listTrainers(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['t.tenant_id = $1'];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(t.first_name ILIKE ${param(params, pattern)} OR t.last_name ILIKE ${param(params, pattern)}
      OR t.specialization ILIKE ${param(params, pattern)} OR t.email ILIKE ${param(params, pattern)})`);
  }
  if (q.status) where.push(`t.status = ${param(params, q.status)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, SORTABLE, 't.last_name ASC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT t.*, concat(t.first_name, ' ', t.last_name) AS full_name,
                (SELECT count(*)::int FROM members m WHERE m.trainer_id = t.id AND m.status = 'active') AS member_count,
                (SELECT count(*)::int FROM members m WHERE m.trainer_id = t.id) AS total_members,
                u.email AS user_email, u.status AS user_status
         FROM trainers t LEFT JOIN users u ON u.id = t.user_id
         WHERE ${whereSql} ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM trainers t WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapeTrainer), pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function getTrainer(tenantId, trainerId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT t.*, concat(t.first_name, ' ', t.last_name) AS full_name,
              u.email AS user_email, u.id AS linked_user_id
       FROM trainers t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.tenant_id = $1 AND t.id = $2`,
      [tenantId, trainerId],
    );
    if (!res.rows[0]) throw ApiError.notFound('Trainer not found');
    return shapeTrainer(res.rows[0]);
  });
}

/** Members assigned to this trainer, plus their latest membership + visits. */
export async function trainerMembers(tenantId, trainerId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT m.id, m.member_no, concat(m.first_name, ' ', m.last_name) AS full_name, m.status,
              m.photo_url, m.phone, cur.plan_name, cur.end_date,
              COALESCE(v.visits, 0)::int AS visits_30d
       FROM members m
       LEFT JOIN LATERAL (SELECT plan_name, end_date FROM memberships WHERE member_id = m.id ORDER BY end_date DESC LIMIT 1) cur ON true
       LEFT JOIN LATERAL (SELECT count(*) AS visits FROM attendance a WHERE a.member_id = m.id AND a.visit_date >= CURRENT_DATE - interval '30 days') v ON true
       WHERE m.tenant_id = $1 AND m.trainer_id = $2
       ORDER BY m.last_name`,
      [tenantId, trainerId],
    ),
  );
  return res.rows;
}

/** Workout plans authored by this trainer. */
export async function trainerPlans(tenantId, trainerId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT id, name, level, goal, is_active, created_at,
              (SELECT count(*)::int FROM workout_plan_items i WHERE i.plan_id = workout_plans.id) AS item_count,
              (SELECT count(*)::int FROM workout_assignments wa WHERE wa.plan_id = workout_plans.id) AS assigned_count
       FROM workout_plans WHERE tenant_id = $1 AND trainer_id = $2 ORDER BY updated_at DESC`,
      [tenantId, trainerId],
    ),
  );
  return res.rows;
}

/** Commission basis: revenue from members assigned to this trainer. */
export async function trainerPerformance(tenantId, trainerId, { days = 30 } = {}) {
  return withTenant(tenantId, async (client) => {
    // Confirm ownership first: without this a foreign trainer id returned a
    // zeroed-out report with HTTP 200 instead of 404.
    const trainer = await client.query(
      'SELECT id, commission_rate FROM trainers WHERE tenant_id = $1 AND id = $2',
      [tenantId, trainerId],
    );
    if (!trainer.rows[0]) throw ApiError.notFound('Trainer not found');

    const res = await client.query(
      `SELECT count(DISTINCT m.id)::int AS members,
              COALESCE(SUM(p.amount_paid), 0)::numeric AS revenue,
              count(DISTINCT a.id)::int AS member_visits
       FROM members m
       LEFT JOIN payments p ON p.member_id = m.id AND p.status IN ('paid','partial') AND p.paid_at >= CURRENT_DATE - ($3 || ' days')::interval
       LEFT JOIN attendance a ON a.member_id = m.id AND a.visit_date >= CURRENT_DATE - ($3 || ' days')::interval
       WHERE m.tenant_id = $1 AND m.trainer_id = $2`,
      [tenantId, trainerId, String(days)],
    );
    const revenue = Number(res.rows[0].revenue || 0);
    const rate = Number(trainer.rows[0].commission_rate || 0);
    return {
      days: Number(days),
      members: res.rows[0].members,
      revenue,
      memberVisits: res.rows[0].member_visits,
      commissionRate: rate,
      commission: Math.round(revenue * rate) / 100,
    };
  });
}

export async function createTrainer(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    if (input.email) {
      const clash = await client.query('SELECT id FROM trainers WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenantId, input.email]);
      if (clash.rowCount) throw ApiError.conflict('A trainer with that email already exists');
    }
    const inserted = await client.query(
      `INSERT INTO trainers (tenant_id, user_id, first_name, last_name, email, phone, photo_url, specialization, bio, hire_date, salary, commission_rate, schedule, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        tenantId, input.userId ?? null, input.firstName, input.lastName, input.email ?? null, input.phone ?? null,
        input.photoUrl ?? null, input.specialization ?? null, input.bio ?? null, input.hireDate ?? null,
        input.salary ?? 0, input.commissionRate ?? 0, JSON.stringify(input.schedule || []),
        input.status || 'active', input.notes ?? null,
      ],
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'trainer.created', entity: 'trainer', entityId: inserted.rows[0].id,
      metadata: { name: `${input.firstName} ${input.lastName}` },
    });
    return shapeTrainer(inserted.rows[0]);
  });
}

export async function updateTrainer(tenantId, trainerId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM trainers WHERE tenant_id = $1 AND id = $2', [tenantId, trainerId]);
    if (!current.rows[0]) throw ApiError.notFound('Trainer not found');

    const columns = {
      firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
      photoUrl: 'photo_url', specialization: 'specialization', bio: 'bio', hireDate: 'hire_date',
      salary: 'salary', commissionRate: 'commission_rate', status: 'status', notes: 'notes', userId: 'user_id',
    };
    const sets = [];
    const params = [tenantId, trainerId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (input.schedule !== undefined) {
      params.push(JSON.stringify(input.schedule));
      sets.push(`schedule = $${params.length}::jsonb`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(`UPDATE trainers SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'trainer.updated', entity: 'trainer', entityId: trainerId,
      metadata: { changedKeys: Object.keys(input) },
    });
    return shapeTrainer(res.rows[0]);
  });
}

export async function deleteTrainer(tenantId, trainerId, actor) {
  return withTenant(tenantId, async (client) => {
    const assigned = await client.query('SELECT count(*)::int AS c FROM members WHERE trainer_id = $1', [trainerId]);
    if (assigned.rows[0].c > 0) {
      throw ApiError.conflict(`This trainer still has ${assigned.rows[0].c} assigned member(s). Reassign them first.`);
    }
    const res = await client.query('DELETE FROM trainers WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, trainerId]);
    if (!res.rows[0]) throw ApiError.notFound('Trainer not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'trainer.deleted', entity: 'trainer', entityId: trainerId,
    });
    return { ok: true };
  });
}

/** Link a trainer to a login account so they can sign in. */
export async function linkUser(tenantId, trainerId, userId, actor) {
  return withTenant(tenantId, async (client) => {
    const user = await client.query('SELECT id, email FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, userId]);
    if (!user.rows[0]) throw ApiError.notFound('That user does not belong to this business');
    const res = await client.query('UPDATE trainers SET user_id = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *', [tenantId, trainerId, userId]);
    if (!res.rows[0]) throw ApiError.notFound('Trainer not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'trainer.user_linked', entity: 'trainer', entityId: trainerId,
      metadata: { email: user.rows[0].email },
    });
    return shapeTrainer(res.rows[0]);
  });
}

function shapeTrainer(row) {
  return {
    id: row.id,
    userId: row.user_id ?? row.linked_user_id ?? null,
    userEmail: row.user_email,
    userStatus: row.user_status,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name || `${row.first_name} ${row.last_name}`,
    email: row.email,
    phone: row.phone,
    photoUrl: row.photo_url,
    specialization: row.specialization,
    bio: row.bio,
    hireDate: row.hire_date,
    salary: Number(row.salary ?? 0),
    commissionRate: Number(row.commission_rate ?? 0),
    schedule: row.schedule || [],
    status: row.status,
    notes: row.notes,
    memberCount: row.member_count ?? 0,
    totalMembers: row.total_members ?? 0,
    createdAt: row.created_at,
  };
}
