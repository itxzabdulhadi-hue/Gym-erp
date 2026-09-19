import { withTenant, query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../utils/pagination.js';
import { param } from '../../utils/sql.js';
import logger from '../../utils/logger.js';

/**
 * Notification service.
 *
 * The service owns *what* happened; channels own *how* it is delivered. A
 * provider is registered per channel, so adding email/SMS/WhatsApp/push later
 * means registering a provider - no change to business logic and no coupling to
 * one vendor.
 */

const providers = new Map();

/**
 * Register a delivery provider.
 *   registerChannel('email', { send: async ({ to, title, body, data }) => {...} })
 */
export function registerChannel(name, provider) {
  providers.set(name, provider);
}

export function listChannels() {
  return ['in_app', 'email', 'sms', 'whatsapp', 'push'].map((name) => ({
    name,
    configured: providers.has(name),
  }));
}

/**
 * Create a notification and fan it out to the requested channels.
 * In-app delivery is always available; other channels are attempted only when a
 * provider is registered, and the outcome is recorded on the row.
 */
export async function dispatchNotification({
  tenantId,
  userId = null,
  type = 'system',
  channel = 'in_app',
  title,
  body = null,
  level = 'info',
  entity = null,
  entityId = null,
  data = {},
  channels = ['in_app'],
}) {
  if (!tenantId) throw new Error('dispatchNotification requires tenantId');

  const inserted = await query(
    `INSERT INTO notifications (tenant_id, user_id, type, channel, title, body, level, entity, entity_id, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      tenantId,
      userId,
      type,
      channel,
      title,
      body,
      level,
      entity,
      entityId,
      JSON.stringify(data ?? {}),
    ],
  );
  const row = inserted.rows[0];

  const delivery = {};
  for (const name of channels) {
    if (name === 'in_app') {
      delivery.in_app = { status: 'delivered', at: new Date().toISOString() };
      continue;
    }
    const provider = providers.get(name);
    if (!provider) {
      delivery[name] = { status: 'not_configured', at: new Date().toISOString() };
      continue;
    }
    try {
      await provider.send({ tenantId, userId, title, body, data, notification: row });
      delivery[name] = { status: 'sent', at: new Date().toISOString() };
    } catch (err) {
      delivery[name] = { status: 'failed', error: err.message, at: new Date().toISOString() };
      logger.warn('notifications', `channel ${name} failed: ${err.message}`);
    }
  }

  await query('UPDATE notifications SET delivery = $2 WHERE id = $1', [row.id, JSON.stringify(delivery)]);
  return { ...row, delivery };
}

export async function listNotifications(tenantId, userId, rawQuery = {}) {
  const { page, limit, offset } = paginate({ ...rawQuery, limit: Math.min(Number(rawQuery.limit) || 20, 100) });
  // `param()` appends to this array and returns the placeholder for it, so the
  // tenant and user filters are added below - pre-seeding them here produced
  // $1/$2 that no statement ever referenced.
  const params = [];
  const base = [`tenant_id = ${param(params, tenantId)}`, `(user_id = ${param(params, userId)} OR user_id IS NULL)`];
  if (rawQuery.type) base.push(`type = ${param(params, rawQuery.type)}`);

  const unreadOnly = rawQuery.unreadOnly === true || rawQuery.unreadOnly === 'true';
  const whereSql = unreadOnly ? [...base, 'read_at IS NULL'].join(' AND ') : base.join(' AND ');
  const unreadSql = [...base, 'read_at IS NULL'].join(' AND ');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count, unread] = await Promise.all([
      client.query(
        `SELECT id, type, channel, title, body, level, entity, entity_id, data, read_at, created_at
         FROM notifications WHERE ${whereSql}
         ORDER BY created_at DESC LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM notifications WHERE ${whereSql}`, countParams),
      client.query(
        `SELECT count(*)::int AS unread FROM notifications WHERE ${unreadSql}`,
        countParams,
      ),
    ]);
    return {
      ...listResponse(rows.rows, pageMeta({ page, limit }, count.rows[0].total)),
      unread: unread.rows[0].unread,
    };
  });
}

export async function markRead(tenantId, userId, notificationId) {
  const res = await query(
    `UPDATE notifications SET read_at = now()
     WHERE tenant_id = $1 AND id = $2 AND (user_id = $3 OR user_id IS NULL) RETURNING id`,
    [tenantId, notificationId, userId],
  );
  if (!res.rows[0]) throw ApiError.notFound('Notification not found');
  return { ok: true };
}

export async function markAllRead(tenantId, userId) {
  const res = await query(
    `UPDATE notifications SET read_at = now()
     WHERE tenant_id = $1 AND read_at IS NULL AND (user_id = $2 OR user_id IS NULL)`,
    [tenantId, userId],
  );
  return { updated: res.rowCount };
}

export async function deleteNotification(tenantId, userId, notificationId) {
  const res = await query(
    `DELETE FROM notifications WHERE tenant_id = $1 AND id = $2 AND (user_id = $3 OR user_id IS NULL) RETURNING id`,
    [tenantId, notificationId, userId],
  );
  if (!res.rows[0]) throw ApiError.notFound('Notification not found');
  return { ok: true };
}
