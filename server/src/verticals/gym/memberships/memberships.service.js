import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { todayISO, addDays, daysBetween } from '../../../utils/dates.js';
import { BILLING_CYCLES, MEMBERSHIP_STATUSES } from '@erp/shared';

/**
 * Membership plans and memberships.
 *
 * Status transitions (new / renewal / upgrade / downgrade / freeze / resume /
 * cancel / expire) are explicit operations here; member.status is then derived
 * from the member's best membership so the two can never disagree.
 */

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(tenantId, { includeInactive = false, activeOnly = false } = {}) {
  const where = includeInactive || !activeOnly ? 'tenant_id = $1' : 'tenant_id = $1 AND is_active';
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT mp.*, (SELECT count(*)::int FROM memberships ms WHERE ms.plan_id = mp.id AND ms.status = 'active') AS active_members
       FROM membership_plans mp WHERE ${where} ORDER BY mp.sort_order, mp.price`,
      [tenantId],
    ),
  );
  return res.rows.map(shapePlan);
}

export async function getPlan(tenantId, planId) {
  const res = await withTenant(tenantId, (client) =>
    client.query('SELECT * FROM membership_plans WHERE tenant_id = $1 AND id = $2', [tenantId, planId]),
  );
  if (!res.rows[0]) throw ApiError.notFound('Membership plan not found');
  return shapePlan(res.rows[0]);
}

export async function createPlan(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const clash = await client.query('SELECT id FROM membership_plans WHERE tenant_id = $1 AND name = $2', [tenantId, input.name]);
    if (clash.rowCount) throw ApiError.conflict(`A plan named "${input.name}" already exists`);

    const durationDays = resolveDuration(input.billingCycle, input.durationDays);
    const inserted = await client.query(
      `INSERT INTO membership_plans (tenant_id, name, description, price, currency, billing_cycle, duration_days, features, access_rules, is_active, is_featured, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        tenantId, input.name, input.description ?? null, input.price, input.currency || 'USD',
        input.billingCycle || 'monthly', durationDays, JSON.stringify(input.features || []),
        JSON.stringify(input.accessRules || {}), input.isActive !== false, Boolean(input.isFeatured),
        input.sortOrder ?? 0,
      ],
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership_plan.created', entity: 'membership_plan', entityId: inserted.rows[0].id,
      metadata: { name: input.name, price: input.price, billingCycle: input.billingCycle },
    });
    return shapePlan(inserted.rows[0]);
  });
}

export async function updatePlan(tenantId, planId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM membership_plans WHERE tenant_id = $1 AND id = $2', [tenantId, planId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('Membership plan not found');

    const sets = [];
    const params = [tenantId, planId];
    const columns = {
      name: 'name', description: 'description', price: 'price', currency: 'currency',
      billingCycle: 'billing_cycle', isActive: 'is_active', isFeatured: 'is_featured', sortOrder: 'sort_order',
    };
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (input.durationDays !== undefined || input.billingCycle !== undefined) {
      const duration = resolveDuration(input.billingCycle ?? before.billing_cycle, input.durationDays ?? before.duration_days);
      params.push(duration);
      sets.push(`duration_days = $${params.length}`);
    }
    if (input.features !== undefined) {
      params.push(JSON.stringify(input.features));
      sets.push(`features = $${params.length}::jsonb`);
    }
    if (input.accessRules !== undefined) {
      params.push(JSON.stringify(input.accessRules));
      sets.push(`access_rules = $${params.length}::jsonb`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(
      `UPDATE membership_plans SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership_plan.updated', entity: 'membership_plan', entityId: planId,
      metadata: { before: { name: before.name, price: before.price }, after: { name: res.rows[0].name, price: res.rows[0].price } },
    });
    return shapePlan(res.rows[0]);
  });
}

export async function deletePlan(tenantId, planId, actor) {
  return withTenant(tenantId, async (client) => {
    const inUse = await client.query(
      "SELECT count(*)::int AS c FROM memberships WHERE plan_id = $1 AND status IN ('active','frozen')",
      [planId],
    );
    if (inUse.rows[0].c > 0) {
      // Plans with live memberships are retired, not deleted, so history stays intact.
      await client.query('UPDATE membership_plans SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenantId, planId]);
      await logAudit(client, {
        tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
        action: 'membership_plan.retired', entity: 'membership_plan', entityId: planId,
        metadata: { activeMemberships: inUse.rows[0].c },
      });
      return { ok: true, retired: true, activeMemberships: inUse.rows[0].c };
    }
    await client.query('DELETE FROM membership_plans WHERE tenant_id = $1 AND id = $2', [tenantId, planId]);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership_plan.deleted', entity: 'membership_plan', entityId: planId,
    });
    return { ok: true, retired: false };
  });
}

function resolveDuration(billingCycle, durationDays) {
  if (billingCycle !== 'custom') {
    const preset = BILLING_CYCLES.find((c) => c.key === billingCycle);
    if (preset?.days) return preset.days;
  }
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days <= 0) throw ApiError.badRequest('Custom plans need a duration in days');
  return Math.round(days);
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

const SORTABLE = {
  start_date: 'ms.start_date',
  end_date: 'ms.end_date',
  status: 'ms.status',
  price: 'ms.price',
  created_at: 'ms.created_at',
  member: 'm.last_name, m.first_name',
};

export async function listMemberships(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [];
  const where = [`ms.tenant_id = ${param(params, tenantId)}`];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(m.first_name ILIKE ${param(params, pattern)} OR m.last_name ILIKE ${param(params, pattern)}
      OR m.member_no ILIKE ${param(params, pattern)} OR ms.plan_name ILIKE ${param(params, pattern)})`);
  }
  if (q.status?.length) {
    const list = Array.isArray(q.status) ? q.status : [q.status];
    where.push(`ms.status IN (${list.map((s) => param(params, s)).join(', ')})`);
  }
  if (q.planId) where.push(`ms.plan_id = ${param(params, q.planId)}`);
  if (q.memberId) where.push(`ms.member_id = ${param(params, q.memberId)}`);
  if (q.trainerId) where.push(`m.trainer_id = ${param(params, q.trainerId)}`);
  if (q.expiringWithinDays !== undefined) {
    where.push(`ms.status = 'active' AND ms.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${param(params, Number(q.expiringWithinDays))}`);
  }
  if (q.changeType) where.push(`ms.change_type = ${param(params, q.changeType)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, SORTABLE, 'ms.created_at DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT ms.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no, m.status AS member_status,
                mp.name AS plan_current_name, mp.billing_cycle
         FROM memberships ms
         JOIN members m ON m.id = ms.member_id
         LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
         WHERE ${whereSql}
         ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(
        `SELECT count(*)::int AS total FROM memberships ms JOIN members m ON m.id = ms.member_id WHERE ${whereSql}`,
        countParams,
      ),
    ]);
    return listResponse(rows.rows.map(shapeMembership), pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function getMembership(tenantId, membershipId) {
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT ms.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no,
              concat(t.first_name, ' ', t.last_name) AS trainer_name
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id
       LEFT JOIN trainers t ON t.id = m.trainer_id
       WHERE ms.tenant_id = $1 AND ms.id = $2`,
      [tenantId, membershipId],
    ),
  );
  if (!res.rows[0]) throw ApiError.notFound('Membership not found');
  return shapeMembership(res.rows[0]);
}

export async function createMembership(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const member = await loadMember(client, tenantId, input.memberId);
    const plan = input.planId ? await loadPlan(client, tenantId, input.planId) : null;

    const startDate = input.startDate || todayISO();
    const durationDays = Number(input.durationDays ?? plan?.duration_days);
    if (!Number.isFinite(durationDays) || durationDays <= 0) throw ApiError.badRequest('Duration must be a positive number of days');
    const endDate = input.endDate || addDays(startDate, durationDays);
    if (daysBetween(startDate, endDate) < 0) throw ApiError.badRequest('End date cannot be before the start date');

    const price = input.price !== undefined ? Number(input.price) : Number(plan?.price ?? 0);

    // A backdated membership (imported history, a corrected record) must not
    // read as current - the member's status is derived from this.
    const initialStatus = endDate < todayISO() ? 'expired' : 'active';

    const inserted = await client.query(
      `INSERT INTO memberships (tenant_id, member_id, plan_id, plan_name, price, start_date, end_date, status, change_type, previous_membership_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        tenantId, member.id, plan?.id ?? null, plan?.name ?? input.planName ?? 'Custom',
        price, startDate, endDate, initialStatus, input.changeType || 'new',
        input.previousMembershipId ?? null, input.notes ?? null, actor?.userId ?? null,
      ],
    );

    await syncMemberStatus(client, tenantId, member.id);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership.created', entity: 'membership', entityId: inserted.rows[0].id,
      metadata: { memberNo: member.member_no, plan: plan?.name ?? input.planName, price, startDate, endDate },
    });

    return shapeMembership(inserted.rows[0]);
  });
}

/** Renewal starts the day after the current membership ends. */
export async function renewMembership(tenantId, membershipId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await loadMembership(client, tenantId, membershipId);
    if (current.status === 'cancelled') throw ApiError.badRequest('A cancelled membership cannot be renewed; create a new one');

    const plan = input.planId ? await loadPlan(client, tenantId, input.planId) : null;
    const startDate = input.startDate || addDays(current.end_date, 1);
    const durationDays = Number(input.durationDays ?? plan?.duration_days ?? daysBetween(current.start_date, current.end_date));
    const endDate = input.endDate || addDays(startDate, durationDays);

    const inserted = await client.query(
      `INSERT INTO memberships (tenant_id, member_id, plan_id, plan_name, price, start_date, end_date, status, change_type, previous_membership_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active','renewal',$8,$9,$10) RETURNING *`,
      [
        tenantId, current.member_id, plan?.id ?? current.plan_id,
        plan?.name ?? current.plan_name,
        input.price !== undefined ? Number(input.price) : Number(plan?.price ?? current.price),
        startDate, endDate, membershipId, input.notes ?? 'Renewal', actor?.userId ?? null,
      ],
    );

    await syncMemberStatus(client, tenantId, current.member_id);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership.renewed', entity: 'membership', entityId: inserted.rows[0].id,
      metadata: { previousMembershipId: membershipId, plan: inserted.rows[0].plan_name, endDate },
    });

    return shapeMembership(inserted.rows[0]);
  });
}

/**
 * Upgrade / downgrade: the current membership is closed and a new one starts
 * today on the new plan. The unused value of the old plan is reported so the
 * front desk can decide what to do with it (we never silently invent credit).
 */
export async function changeMembership(tenantId, membershipId, input, actor) {
  const direction = input.direction === 'downgrade' ? 'downgrade' : 'upgrade';
  return withTenant(tenantId, async (client) => {
    const current = await loadMembership(client, tenantId, membershipId);
    const plan = await loadPlan(client, tenantId, input.planId);

    if (direction === 'upgrade' && Number(plan.price) <= Number(current.price)) {
      throw ApiError.badRequest('That plan is not more expensive than the current one');
    }
    if (direction === 'downgrade' && Number(plan.price) >= Number(current.price)) {
      throw ApiError.badRequest('That plan is not cheaper than the current one');
    }

    const startDate = input.startDate || todayISO();
    const remainingDays = Math.max(0, daysBetween(startDate, current.end_date));
    const totalDays = Math.max(1, daysBetween(current.start_date, current.end_date));
    const unusedCredit = Math.round((Number(current.price) * remainingDays) / totalDays * 100) / 100;

    await client.query(`UPDATE memberships SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || $2 WHERE id = $1`, [
      membershipId,
      `${direction} to ${plan.name} on ${startDate}`,
    ]);

    // The replacement membership starts now, so its own end date decides
    // whether it reads as current.
    const newEndDate = input.endDate || addDays(startDate, plan.duration_days);
    const newStatus = newEndDate < todayISO() ? 'expired' : 'active';

    const inserted = await client.query(
      `INSERT INTO memberships (tenant_id, member_id, plan_id, plan_name, price, start_date, end_date, status, change_type, previous_membership_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        tenantId, current.member_id, plan.id, plan.name, Number(plan.price),
        startDate, newEndDate, newStatus, direction, membershipId,
        input.notes ?? `${direction} from ${current.plan_name}`, actor?.userId ?? null,
      ],
    );

    await syncMemberStatus(client, tenantId, current.member_id);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: `membership.${direction}d`, entity: 'membership', entityId: inserted.rows[0].id,
      metadata: { from: current.plan_name, to: plan.name, unusedCredit, remainingDays },
    });

    return { ...shapeMembership(inserted.rows[0]), unusedCredit, remainingDays };
  });
}

export async function freezeMembership(tenantId, membershipId, { days = 30, notes } = {}, actor) {
  const freezeDays = Math.max(1, Math.min(365, Number(days)));
  return withTenant(tenantId, async (client) => {
    const current = await loadMembership(client, tenantId, membershipId);
    if (current.status !== 'active') throw ApiError.badRequest('Only an active membership can be frozen');

    const used = await client.query(
      "SELECT COALESCE(SUM(freeze_days), 0)::int AS used FROM memberships WHERE member_id = $1 AND freeze_days > 0 AND start_date >= CURRENT_DATE - interval '365 days'",
      [current.member_id],
    );

    const frozenFrom = todayISO();
    const frozenTo = addDays(frozenFrom, freezeDays);
    const newEnd = addDays(current.end_date, freezeDays);

    const res = await client.query(
      `UPDATE memberships SET status = 'frozen', freeze_days = freeze_days + $3, frozen_from = $4, frozen_to = $5, end_date = $6,
              notes = COALESCE(notes || ' | ', '') || $7
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, membershipId, freezeDays, frozenFrom, frozenTo, newEnd, notes || `Frozen for ${freezeDays} days`],
    );

    await syncMemberStatus(client, tenantId, current.member_id);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership.frozen', entity: 'membership', entityId: membershipId,
      metadata: { days: freezeDays, frozenFrom, frozenTo, freezeDaysUsedThisYear: used.rows[0].used + freezeDays },
    });

    return shapeMembership(res.rows[0]);
  });
}

export async function resumeMembership(tenantId, membershipId, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await loadMembership(client, tenantId, membershipId);
    if (current.status !== 'frozen') throw ApiError.badRequest('Only a frozen membership can be resumed');

    // Resume gives back the unused part of the freeze window.
    const remainingFreeze = current.frozen_to ? Math.max(0, daysBetween(todayISO(), current.frozen_to)) : 0;
    const newEnd = remainingFreeze ? addDays(current.end_date, -remainingFreeze) : current.end_date;

    const res = await client.query(
      `UPDATE memberships SET status = 'active', frozen_from = NULL, frozen_to = NULL, end_date = $3,
              notes = COALESCE(notes || ' | ', '') || 'Resumed'
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, membershipId, newEnd],
    );

    await syncMemberStatus(client, tenantId, current.member_id);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership.resumed', entity: 'membership', entityId: membershipId,
      metadata: { releasedDays: remainingFreeze, newEnd },
    });
    return shapeMembership(res.rows[0]);
  });
}

export async function cancelMembership(tenantId, membershipId, { notes } = {}, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await loadMembership(client, tenantId, membershipId);
    if (current.status === 'cancelled') throw ApiError.badRequest('This membership is already cancelled');

    const res = await client.query(
      `UPDATE memberships SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || $3
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, membershipId, notes || 'Cancelled'],
    );

    await syncMemberStatus(client, tenantId, current.member_id);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'membership.cancelled', entity: 'membership', entityId: membershipId,
      metadata: { plan: current.plan_name, endDate: current.end_date, reason: notes ?? null },
    });
    return shapeMembership(res.rows[0]);
  });
}

/**
 * Keep member.status consistent with their memberships.
 * Manual states (suspended / inactive) always win over derived ones.
 */
export async function syncMemberStatus(client, tenantId, memberId) {
  const res = await client.query(
    `SELECT status, end_date FROM memberships
     WHERE member_id = $1 AND status IN ('active','frozen')
     ORDER BY end_date DESC LIMIT 1`,
    [memberId],
  );
  const best = res.rows[0];
  const derived = !best ? 'expired' : best.status === 'frozen' ? 'frozen' : 'active';

  await client.query(
    `UPDATE members SET status = $3 WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('suspended','inactive')`,
    [memberId, tenantId, derived],
  );
  return derived;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadMember(client, tenantId, memberId) {
  const res = await client.query('SELECT id, member_no, status FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, memberId]);
  if (!res.rows[0]) throw ApiError.notFound('Member not found');
  return res.rows[0];
}

async function loadPlan(client, tenantId, planId) {
  const res = await client.query('SELECT * FROM membership_plans WHERE tenant_id = $1 AND id = $2', [tenantId, planId]);
  if (!res.rows[0]) throw ApiError.notFound('Membership plan not found');
  return res.rows[0];
}

async function loadMembership(client, tenantId, membershipId) {
  const res = await client.query('SELECT * FROM memberships WHERE tenant_id = $1 AND id = $2', [tenantId, membershipId]);
  if (!res.rows[0]) throw ApiError.notFound('Membership not found');
  return res.rows[0];
}

function shapePlan(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    billingCycle: row.billing_cycle,
    billingCycleLabel: BILLING_CYCLES.find((c) => c.key === row.billing_cycle)?.label ?? row.billing_cycle,
    durationDays: row.duration_days,
    features: row.features || [],
    accessRules: row.access_rules || {},
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    sortOrder: row.sort_order,
    activeMembers: row.active_members,
    createdAt: row.created_at,
  };
}

function shapeMembership(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberNo: row.member_no,
    memberStatus: row.member_status,
    trainerName: row.trainer_name,
    planId: row.plan_id,
    planName: row.plan_name,
    price: Number(row.price),
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    freezeDays: row.freeze_days,
    frozenFrom: row.frozen_from,
    frozenTo: row.frozen_to,
    changeType: row.change_type,
    previousMembershipId: row.previous_membership_id,
    notes: row.notes,
    daysRemaining: daysBetween(todayISO(), row.end_date),
    createdAt: row.created_at,
  };
}

export { MEMBERSHIP_STATUSES };
