import { withTenant } from '../../db/index.js';
import { DASHBOARD_WIDGETS, DEFAULT_DASHBOARD_LAYOUT } from '@erp/shared';

/**
 * Dashboard layouts.
 *
 * A layout is an ordered list of widget ids with sizes. Users get their own;
 * the tenant default (user_id IS NULL) is the fallback, so an owner can ship a
 * layout to everyone and individuals can still rearrange their own.
 */

export function widgetCatalogue() {
  return DASHBOARD_WIDGETS.map((w) => ({ ...w }));
}

export async function getLayout(tenantId, userId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT id, name, layout, user_id, updated_at
       FROM dashboard_layouts
       WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)
       ORDER BY user_id NULLS LAST LIMIT 1`,
      [tenantId, userId],
    );
    const row = res.rows[0];
    if (!row) return { id: null, name: 'Default', widgets: DEFAULT_DASHBOARD_LAYOUT, isCustom: false };

    const valid = new Set(DASHBOARD_WIDGETS.map((w) => w.id));
    const widgets = (row.layout || [])
      .filter((id) => valid.has(id))
      .map((entry) => (typeof entry === 'string' ? { id: entry } : entry));

    return { id: row.id, name: row.name, widgets, isCustom: Boolean(row.user_id), updatedAt: row.updated_at };
  });
}

export async function saveLayout(tenantId, userId, widgets) {
  const valid = new Set(DASHBOARD_WIDGETS.map((w) => w.id));
  const cleaned = [];
  const seen = new Set();
  for (const raw of widgets || []) {
    const entry = typeof raw === 'string' ? { id: raw } : raw;
    if (!entry?.id || !valid.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    cleaned.push({
      id: entry.id,
      width: clamp(entry.width, 1, 12),
      height: clamp(entry.height, 1, 6),
    });
  }

  return withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO dashboard_layouts (tenant_id, user_id, name, layout, is_default)
       VALUES ($1, $2, 'Default', $3::jsonb, true)
       ON CONFLICT (tenant_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
       DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()`,
      [tenantId, userId, JSON.stringify(cleaned)],
    );
    return getLayout(tenantId, userId);
  });
}

export async function resetLayout(tenantId, userId) {
  return withTenant(tenantId, async (client) => {
    await client.query('DELETE FROM dashboard_layouts WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
    return getLayout(tenantId, userId);
  });
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min === 1 ? 6 : 3;
  return Math.min(max, Math.max(min, Math.round(n)));
}
