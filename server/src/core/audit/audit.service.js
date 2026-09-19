import { withTenant, query } from '../../db/index.js';
import { paginate, pageMeta, listResponse } from '../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../utils/sql.js';

/**
 * Audit trail.
 *
 * Every state changing service call logs one row: who did what, to which record,
 * with the before/after values that matter. Services pass the active
 * transaction client so the log entry is written atomically with the change.
 */
export async function logAudit(executor, entry) {
  // Accepts a transaction client, the pool, or the plain query() helper.
  const exec = typeof executor === 'function' ? { query: executor } : executor;
  const sql = `
    INSERT INTO audit_logs (tenant_id, user_id, user_label, action, entity, entity_id, metadata, ip, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;
  const values = [
    entry.tenantId,
    entry.userId ?? null,
    entry.userLabel ?? null,
    entry.action,
    entry.entity,
    entry.entityId ? String(entry.entityId) : null,
    JSON.stringify(entry.metadata ?? {}),
    entry.ip ?? null,
    entry.userAgent ?? null,
  ];
  await exec.query(sql, values);
}

/** Convenience wrapper for controllers that already have req.ctx. */
export function auditFromRequest(req, { action, entity, entityId, metadata }) {
  return {
    tenantId: req.tenantId,
    userId: req.userId,
    userLabel: req.ctx?.user?.fullName || req.ctx?.user?.email,
    action,
    entity,
    entityId,
    metadata,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300),
  };
}

const SORTABLE = {
  created_at: 'created_at',
  action: 'action',
  entity: 'entity',
  user: 'user_label',
};

export async function listAuditLogs(tenantId, rawQuery = {}) {
  const { page, limit, offset } = paginate(rawQuery);
  const params = [];
  const where = [`tenant_id = ${param(params, tenantId)}`];

  if (rawQuery.search) where.push(`(action ILIKE ${param(params, likePattern(rawQuery.search))} OR entity ILIKE ${param(params, likePattern(rawQuery.search))} OR user_label ILIKE ${param(params, likePattern(rawQuery.search))})`);
  if (rawQuery.entity) where.push(`entity = ${param(params, rawQuery.entity)}`);
  if (rawQuery.action) where.push(`action = ${param(params, rawQuery.action)}`);
  if (rawQuery.userId) where.push(`user_id = ${param(params, rawQuery.userId)}`);
  if (rawQuery.from) where.push(`created_at >= ${param(params, rawQuery.from)}`);
  if (rawQuery.to) where.push(`created_at <= ${param(params, rawQuery.to)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(rawQuery.sort, rawQuery.order, SORTABLE, 'created_at DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT id, user_id, user_label, action, entity, entity_id, metadata, created_at
         FROM audit_logs WHERE ${whereSql} ORDER BY ${orderSql}, id DESC
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM audit_logs WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows, pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function auditFacets(tenantId) {
  const [entities, actions] = await Promise.all([
    query('SELECT entity, count(*)::int AS count FROM audit_logs WHERE tenant_id = $1 GROUP BY entity ORDER BY count DESC LIMIT 30', [tenantId]),
    query('SELECT action, count(*)::int AS count FROM audit_logs WHERE tenant_id = $1 GROUP BY action ORDER BY count DESC LIMIT 30', [tenantId]),
  ]);
  return { entities: entities.rows, actions: actions.rows };
}
