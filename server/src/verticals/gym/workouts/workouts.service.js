import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { dispatchNotification } from '../../../core/notifications/notification.service.js';

/**
 * Exercises, workout plans and assignments.
 *
 * Plans are reusable templates; assignments connect a plan to a member and are
 * what progress is tracked against.
 */

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export async function listExercises(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['tenant_id = $1'];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(name ILIKE ${param(params, pattern)} OR muscle_group ILIKE ${param(params, pattern)})`);
  }
  if (q.muscleGroup) where.push(`muscle_group = ${param(params, q.muscleGroup)}`);
  if (q.equipment) where.push(`equipment = ${param(params, q.equipment)}`);
  if (q.difficulty) where.push(`difficulty = ${param(params, q.difficulty)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, { name: 'name', muscle_group: 'muscle_group', created_at: 'created_at' }, 'name ASC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(`SELECT * FROM exercises WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`, params),
      client.query(`SELECT count(*)::int AS total FROM exercises WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows, pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function createExercise(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const clash = await client.query('SELECT id FROM exercises WHERE tenant_id = $1 AND lower(name) = lower($2)', [tenantId, input.name]);
    if (clash.rowCount) throw ApiError.conflict('An exercise with that name already exists');

    const res = await client.query(
      `INSERT INTO exercises (tenant_id, name, muscle_group, equipment, difficulty, instructions, media_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tenantId, input.name, input.muscleGroup || 'full_body', input.equipment || 'none', input.difficulty || 'beginner', input.instructions ?? null, input.mediaUrl ?? null],
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'exercise.created', entity: 'exercise', entityId: res.rows[0].id,
      metadata: { name: input.name },
    });
    return res.rows[0];
  });
}

export async function updateExercise(tenantId, exerciseId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const columns = { name: 'name', muscleGroup: 'muscle_group', equipment: 'equipment', difficulty: 'difficulty', instructions: 'instructions', mediaUrl: 'media_url' };
    const sets = [];
    const params = [tenantId, exerciseId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');
    const res = await client.query(`UPDATE exercises SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
    if (!res.rows[0]) throw ApiError.notFound('Exercise not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'exercise.updated', entity: 'exercise', entityId: exerciseId,
      metadata: { changedKeys: Object.keys(input) },
    });
    return res.rows[0];
  });
}

export async function deleteExercise(tenantId, exerciseId, actor) {
  return withTenant(tenantId, async (client) => {
    const used = await client.query('SELECT count(*)::int AS c FROM workout_plan_items WHERE exercise_id = $1', [exerciseId]);
    if (used.rows[0].c > 0) {
      throw ApiError.conflict(`This exercise is used in ${used.rows[0].c} plan item(s). Remove them first.`);
    }
    const res = await client.query('DELETE FROM exercises WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, exerciseId]);
    if (!res.rows[0]) throw ApiError.notFound('Exercise not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'exercise.deleted', entity: 'exercise', entityId: exerciseId,
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['wp.tenant_id = $1'];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(wp.name ILIKE ${param(params, pattern)} OR wp.goal ILIKE ${param(params, pattern)})`);
  }
  if (q.level) where.push(`wp.level = ${param(params, q.level)}`);
  if (q.trainerId) where.push(`wp.trainer_id = ${param(params, q.trainerId)}`);
  if (q.activeOnly === true || q.activeOnly === 'true') where.push('wp.is_active');

  const whereSql = where.join(' AND ');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT wp.*, concat(t.first_name, ' ', t.last_name) AS trainer_name,
                (SELECT count(*)::int FROM workout_plan_items i WHERE i.plan_id = wp.id) AS item_count,
                (SELECT count(*)::int FROM workout_assignments a WHERE a.plan_id = wp.id AND a.status <> 'archived') AS assigned_count
         FROM workout_plans wp LEFT JOIN trainers t ON t.id = wp.trainer_id
         WHERE ${whereSql} ORDER BY wp.updated_at DESC
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM workout_plans wp WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapePlan), pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function getPlan(tenantId, planId) {
  return withTenant(tenantId, async (client) => {
    const planRes = await client.query(
      `SELECT wp.*, concat(t.first_name, ' ', t.last_name) AS trainer_name
       FROM workout_plans wp LEFT JOIN trainers t ON t.id = wp.trainer_id
       WHERE wp.tenant_id = $1 AND wp.id = $2`,
      [tenantId, planId],
    );
    if (!planRes.rows[0]) throw ApiError.notFound('Workout plan not found');

    const items = await client.query(
      `SELECT i.*, e.name AS exercise_name, e.muscle_group, e.equipment, e.difficulty, e.media_url, e.instructions
       FROM workout_plan_items i JOIN exercises e ON e.id = i.exercise_id
       WHERE i.plan_id = $1 ORDER BY i.sort_order, i.id`,
      [planId],
    );
    const assignments = await client.query(
      `SELECT a.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no
       FROM workout_assignments a JOIN members m ON m.id = a.member_id
       WHERE a.plan_id = $1 ORDER BY a.assigned_at DESC LIMIT 25`,
      [planId],
    );

    return { ...shapePlan(planRes.rows[0]), items: items.rows.map(shapeItem), assignments: assignments.rows };
  });
}

export async function createPlan(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    if (input.trainerId) {
      const t = await client.query('SELECT id FROM trainers WHERE tenant_id = $1 AND id = $2', [tenantId, input.trainerId]);
      if (!t.rows[0]) throw ApiError.badRequest('That trainer does not belong to this business');
    }
    const res = await client.query(
      `INSERT INTO workout_plans (tenant_id, name, description, trainer_id, level, goal, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenantId, input.name, input.description ?? null, input.trainerId ?? null, input.level || 'beginner', input.goal ?? null, input.isActive !== false, actor?.userId ?? null],
    );

    if (input.items?.length) await replaceItems(client, tenantId, res.rows[0].id, input.items);

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'workout_plan.created', entity: 'workout_plan', entityId: res.rows[0].id,
      metadata: { name: input.name, items: input.items?.length ?? 0 },
    });
    return getPlanInTx(client, tenantId, res.rows[0].id);
  });
}

export async function updatePlan(tenantId, planId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM workout_plans WHERE tenant_id = $1 AND id = $2', [tenantId, planId]);
    if (!current.rows[0]) throw ApiError.notFound('Workout plan not found');

    const columns = { name: 'name', description: 'description', trainerId: 'trainer_id', level: 'level', goal: 'goal', isActive: 'is_active' };
    const sets = [];
    const params = [tenantId, planId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) await client.query(`UPDATE workout_plans SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, params);
    if (Array.isArray(input.items)) await replaceItems(client, tenantId, planId, input.items);

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'workout_plan.updated', entity: 'workout_plan', entityId: planId,
      metadata: { changedKeys: Object.keys(input) },
    });
    return getPlanInTx(client, tenantId, planId);
  });
}

export async function deletePlan(tenantId, planId, actor) {
  return withTenant(tenantId, async (client) => {
    const assigned = await client.query(
      "SELECT count(*)::int AS c FROM workout_assignments WHERE plan_id = $1 AND status IN ('assigned','in_progress')",
      [planId],
    );
    if (assigned.rows[0].c > 0) {
      await client.query('UPDATE workout_plans SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenantId, planId]);
      return { ok: true, retired: true, activeAssignments: assigned.rows[0].c };
    }
    const res = await client.query('DELETE FROM workout_plans WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, planId]);
    if (!res.rows[0]) throw ApiError.notFound('Workout plan not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'workout_plan.deleted', entity: 'workout_plan', entityId: planId,
    });
    return { ok: true, retired: false };
  });
}

async function replaceItems(client, tenantId, planId, items) {
  await client.query('DELETE FROM workout_plan_items WHERE plan_id = $1', [planId]);
  let order = 0;
  for (const item of items) {
    const exercise = await client.query('SELECT id FROM exercises WHERE tenant_id = $1 AND id = $2', [tenantId, item.exerciseId]);
    if (!exercise.rows[0]) throw ApiError.badRequest(`Exercise ${item.exerciseId} does not belong to this business`);
    order += 1;
    await client.query(
      `INSERT INTO workout_plan_items (tenant_id, plan_id, exercise_id, sort_order, sets, reps, weight_kg, duration_sec, rest_sec, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenantId, planId, item.exerciseId, item.sortOrder ?? order, item.sets ?? null, item.reps ?? null,
        item.weightKg ?? null, item.durationSec ?? null, item.restSec ?? null, item.notes ?? null,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function listAssignments(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['wa.tenant_id = $1'];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(m.first_name ILIKE ${param(params, pattern)} OR m.last_name ILIKE ${param(params, pattern)} OR wp.name ILIKE ${param(params, pattern)})`);
  }
  if (q.memberId) where.push(`wa.member_id = ${param(params, q.memberId)}`);
  if (q.planId) where.push(`wa.plan_id = ${param(params, q.planId)}`);
  if (q.trainerId) where.push(`wa.trainer_id = ${param(params, q.trainerId)}`);
  if (q.status) where.push(`wa.status = ${param(params, q.status)}`);

  const whereSql = where.join(' AND ');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT wa.*, wp.name AS plan_name, wp.level, concat(m.first_name, ' ', m.last_name) AS member_name,
                m.member_no, concat(t.first_name, ' ', t.last_name) AS trainer_name,
                (SELECT count(*)::int FROM workout_logs l WHERE l.assignment_id = wa.id) AS log_count
         FROM workout_assignments wa
         JOIN workout_plans wp ON wp.id = wa.plan_id
         JOIN members m ON m.id = wa.member_id
         LEFT JOIN trainers t ON t.id = wa.trainer_id
         WHERE ${whereSql} ORDER BY wa.assigned_at DESC
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(
        `SELECT count(*)::int AS total FROM workout_assignments wa
         JOIN workout_plans wp ON wp.id = wa.plan_id JOIN members m ON m.id = wa.member_id
         WHERE ${whereSql}`,
        countParams,
      ),
    ]);
    return listResponse(rows.rows, pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function assignPlan(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const plan = await client.query('SELECT id, name FROM workout_plans WHERE tenant_id = $1 AND id = $2', [tenantId, input.planId]);
    if (!plan.rows[0]) throw ApiError.notFound('Workout plan not found');
    const member = await client.query('SELECT id, member_no FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, input.memberId]);
    if (!member.rows[0]) throw ApiError.notFound('Member not found');

    const res = await client.query(
      `INSERT INTO workout_assignments (tenant_id, plan_id, member_id, trainer_id, status, start_date, end_date, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenantId, input.planId, input.memberId, input.trainerId ?? null,
        input.status || 'assigned', input.startDate || new Date().toISOString().slice(0, 10),
        input.endDate ?? null, actor?.userId ?? null,
      ],
    );

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'workout_plan.assigned', entity: 'workout_assignment', entityId: res.rows[0].id,
      metadata: { plan: plan.rows[0].name, memberNo: member.rows[0].member_no },
    });

    await dispatchNotification({
      tenantId,
      userId: actor?.userId ?? null,
      type: 'workout_assigned',
      title: 'Workout plan assigned',
      body: `"${plan.rows[0].name}" was assigned to member ${member.rows[0].member_no}.`,
      level: 'info',
      entity: 'workout_assignment',
      entityId: res.rows[0].id,
      channels: ['in_app'],
    }).catch(() => {});

    return res.rows[0];
  });
}

export async function updateAssignment(tenantId, assignmentId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const columns = { status: 'status', startDate: 'start_date', endDate: 'end_date', trainerId: 'trainer_id' };
    const sets = [];
    const params = [tenantId, assignmentId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');
    const res = await client.query(`UPDATE workout_assignments SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
    if (!res.rows[0]) throw ApiError.notFound('Assignment not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'workout_assignment.updated', entity: 'workout_assignment', entityId: assignmentId,
      metadata: { changedKeys: Object.keys(input) },
    });
    return res.rows[0];
  });
}

export async function deleteAssignment(tenantId, assignmentId, actor) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query('DELETE FROM workout_assignments WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, assignmentId]);
    if (!res.rows[0]) throw ApiError.notFound('Assignment not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'workout_assignment.deleted', entity: 'workout_assignment', entityId: assignmentId,
    });
    return { ok: true };
  });
}

/** Log a completed session against an assignment (used for progress over time). */
export async function logSession(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const member = await client.query('SELECT id FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, input.memberId]);
    if (!member.rows[0]) throw ApiError.notFound('Member not found');
    if (input.assignmentId) {
      const a = await client.query('SELECT id FROM workout_assignments WHERE tenant_id = $1 AND id = $2', [tenantId, input.assignmentId]);
      if (!a.rows[0]) throw ApiError.notFound('Assignment not found');
    }

    const res = await client.query(
      `INSERT INTO workout_logs (tenant_id, assignment_id, member_id, logged_at, data, notes, logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tenantId, input.assignmentId ?? null, input.memberId, input.loggedAt || new Date().toISOString(), JSON.stringify(input.entries || []), input.notes ?? null, actor?.userId ?? null],
    );
    return res.rows[0];
  });
}

export async function listLogs(tenantId, { memberId, assignmentId, limit = 30 } = {}) {
  const params = [tenantId];
  const where = ['tenant_id = $1'];
  if (memberId) {
    params.push(memberId);
    where.push(`member_id = $${params.length}`);
  }
  if (assignmentId) {
    params.push(assignmentId);
    where.push(`assignment_id = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 30, 200));
  const res = await withTenant(tenantId, (client) =>
    client.query(`SELECT * FROM workout_logs WHERE ${where.join(' AND ')} ORDER BY logged_at DESC LIMIT $${params.length}`, params),
  );
  return res.rows;
}

// ---------------------------------------------------------------------------

async function getPlanInTx(client, tenantId, planId) {
  const plan = await client.query(
    `SELECT wp.*, concat(t.first_name, ' ', t.last_name) AS trainer_name
     FROM workout_plans wp LEFT JOIN trainers t ON t.id = wp.trainer_id
     WHERE wp.tenant_id = $1 AND wp.id = $2`,
    [tenantId, planId],
  );
  const items = await client.query(
    `SELECT i.*, e.name AS exercise_name, e.muscle_group, e.equipment, e.difficulty, e.media_url
     FROM workout_plan_items i JOIN exercises e ON e.id = i.exercise_id
     WHERE i.plan_id = $1 ORDER BY i.sort_order, i.id`,
    [planId],
  );
  return { ...shapePlan(plan.rows[0]), items: items.rows.map(shapeItem) };
}

function shapePlan(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    level: row.level,
    goal: row.goal,
    isActive: Boolean(row.is_active),
    itemCount: row.item_count,
    assignedCount: row.assigned_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeItem(row) {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    difficulty: row.difficulty,
    mediaUrl: row.media_url,
    instructions: row.instructions,
    sortOrder: row.sort_order,
    sets: row.sets,
    reps: row.reps,
    weightKg: row.weight_kg !== null && row.weight_kg !== undefined ? Number(row.weight_kg) : null,
    durationSec: row.duration_sec,
    restSec: row.rest_sec,
    notes: row.notes,
  };
}
