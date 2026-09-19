import { query } from '../../db/index.js';
import { dispatchNotification } from './notification.service.js';
import { addDays, todayISO } from '../../utils/dates.js';
import logger from '../../utils/logger.js';

/**
 * Tenant maintenance.
 *
 * These are the jobs a scheduler (cron, Vercel cron, or `npm run maintenance`)
 * runs. Every job is idempotent and safe to run repeatedly, so nothing depends
 * on a timer being perfectly punctual.
 */

/**
 * Recompute member lifecycle state from their memberships and notify about
 * memberships that are expiring or have expired.
 */
export async function runMembershipMaintenance(tenantId, { notify = true } = {}) {
  const tenant = (await query('SELECT settings FROM tenants WHERE id = $1', [tenantId])).rows[0];
  if (!tenant) return { ok: false };
  const settings = tenant.settings?.memberships || {};
  const warningDays = Number(settings.expiryWarningDays ?? 7);
  const horizon = addDays(todayISO(), warningDays);

  // 1. Expire memberships whose end date has passed.
  const expired = await query(
    `UPDATE memberships SET status = 'expired'
     WHERE tenant_id = $1 AND status = 'active' AND end_date < CURRENT_DATE
     RETURNING id, member_id, plan_name, end_date`,
    [tenantId],
  );

  // 2. Resume frozen memberships whose freeze window ended.
  const resumed = await query(
    `UPDATE memberships SET status = 'active', frozen_from = NULL, frozen_to = NULL
     WHERE tenant_id = $1 AND status = 'frozen' AND frozen_to IS NOT NULL AND frozen_to < CURRENT_DATE
     RETURNING id, member_id`,
    [tenantId],
  );

  // 3. Sync member.status with their best current membership.
  const synced = await query(
    `WITH best AS (
       SELECT DISTINCT ON (m.id) m.id AS member_id, ms.status AS membership_status, ms.end_date
       FROM members m
       LEFT JOIN LATERAL (
         SELECT status, end_date FROM memberships
         WHERE member_id = m.id AND status IN ('active', 'frozen')
         ORDER BY end_date DESC LIMIT 1
       ) ms ON true
       WHERE m.tenant_id = $1
     )
     UPDATE members m
     SET status = CASE
       WHEN m.status IN ('suspended', 'inactive') THEN m.status
       WHEN b.membership_status = 'frozen' THEN 'frozen'
       WHEN b.membership_status = 'active' THEN 'active'
       ELSE 'expired'
     END
     FROM best b
     WHERE m.id = b.member_id AND m.status <> 'suspended' AND m.status <> 'inactive'
       AND m.status IS DISTINCT FROM (CASE
         WHEN b.membership_status = 'frozen' THEN 'frozen'
         WHEN b.membership_status = 'active' THEN 'active'
         ELSE 'expired' END)
     RETURNING m.id`,
    [tenantId],
  );

  const results = {
    expired: expired.rowCount,
    resumed: resumed.rowCount,
    statusSynced: synced.rowCount,
    notificationsSent: 0,
  };

  if (!notify) return results;

  // 4. Notifications for what just expired.
  for (const row of expired.rows) {
    await notifyStaff(tenantId, {
      type: 'membership_expired',
      title: 'Membership expired',
      body: `A ${row.plan_name} membership expired on ${row.end_date}.`,
      level: 'warning',
      entity: 'membership',
      entityId: row.id,
      dedupeKey: `expired:${row.id}`,
    });
    results.notificationsSent += 1;
  }

  // 5. Upcoming expiries (deduplicated per membership + horizon).
  const upcoming = await query(
    `SELECT ms.id, ms.member_id, ms.plan_name, ms.end_date,
            concat(m.first_name, ' ', m.last_name) AS member_name
     FROM memberships ms
     JOIN members m ON m.id = ms.member_id
     WHERE ms.tenant_id = $1 AND ms.status = 'active'
       AND ms.end_date BETWEEN CURRENT_DATE AND $2::date
     ORDER BY ms.end_date ASC
     LIMIT 200`,
    [tenantId, horizon],
  );

  for (const row of upcoming.rows) {
    const sent = await notifyStaff(tenantId, {
      type: 'membership_expiring',
      title: 'Membership expiring soon',
      body: `${row.member_name}'s ${row.plan_name} membership expires on ${row.end_date}.`,
      level: 'info',
      entity: 'membership',
      entityId: row.id,
      dedupeKey: `expiring:${row.id}:${horizon}`,
    });
    if (sent) results.notificationsSent += 1;
  }

  return results;
}

/**
 * Insert a staff notification once per dedupe key so repeated cron runs do not
 * spam the same event.
 */
async function notifyStaff(tenantId, { type, title, body, level, entity, entityId, dedupeKey }) {
  const existing = await query(
    `SELECT id FROM notifications
     WHERE tenant_id = $1 AND type = $2 AND entity_id = $3 AND data->>'dedupeKey' = $4
     LIMIT 1`,
    [tenantId, type, entityId, dedupeKey],
  );
  if (existing.rowCount) return false;

  const recipients = await query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.tenant_id = $1 AND u.status = 'active' AND r.key IN ('owner', 'manager', 'receptionist')`,
    [tenantId],
  );

  for (const recipient of recipients.rows) {
    await dispatchNotification({
      tenantId,
      userId: recipient.id,
      type,
      title,
      body,
      level,
      entity,
      entityId,
      data: { dedupeKey },
      channels: ['in_app', 'email'],
    });
  }
  return recipients.rowCount > 0;
}

/** Entry point for `npm run maintenance` and for a cron endpoint. */
export async function runMaintenance({ tenantId } = {}) {
  const tenants = tenantId
    ? [{ id: tenantId }]
    : (await query("SELECT id FROM tenants WHERE status <> 'suspended'")).rows;

  const summary = [];
  for (const tenant of tenants) {
    try {
      const result = await runMembershipMaintenance(tenant.id);
      summary.push({ tenantId: tenant.id, ...result });
    } catch (err) {
      logger.error('maintenance', `tenant ${tenant.id}: ${err.message}`);
      summary.push({ tenantId: tenant.id, error: err.message });
    }
  }
  return summary;
}
