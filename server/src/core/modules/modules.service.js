import { MODULES, getVertical } from '@erp/shared';
import { withTenant } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { logAudit } from '../audit/audit.service.js';
import { invalidateAuthCache } from '../auth/authContext.js';

/**
 * Module registry per tenant.
 *
 * `enabled === false` is enforced by requireModule() on every route of that
 * module, and the web client drops the module from navigation, routes and
 * settings when it is off. Core platform modules can be switched off too,
 * except the ones the app cannot run without.
 */
const ALWAYS_ON = new Set(['settings', 'roles', 'users']);

export async function listModules(tenantId) {
  const rows = await withTenant(tenantId, (client) =>
    client.query('SELECT key, enabled, sort_order, settings FROM modules WHERE tenant_id = $1', [tenantId]),
  );
  const state = new Map(rows.rows.map((r) => [r.key, r]));
  const vertical = (await withTenant(tenantId, (c) => c.query('SELECT vertical FROM tenants WHERE id = $1', [tenantId])))
    .rows[0]?.vertical;

  return MODULES.map((mod) => {
    const row = state.get(mod.key);
    return {
      key: mod.key,
      label: mod.label,
      group: mod.group,
      icon: mod.icon,
      path: mod.path,
      order: mod.order,
      settingsOnly: Boolean(mod.settingsOnly),
      defaultEnabled: mod.defaultEnabled,
      locked: ALWAYS_ON.has(mod.key),
      belongsToVertical: mod.group !== 'gym' || vertical === 'gym',
      enabled: row ? row.enabled : mod.defaultEnabled,
    };
  }).sort((a, b) => a.order - b.order);
}

export async function setModules(tenantId, enabledKeys, actor) {
  const known = new Set(MODULES.map((m) => m.key));
  const unknown = enabledKeys.filter((k) => !known.has(k));
  if (unknown.length) throw ApiError.badRequest(`Unknown module(s): ${unknown.join(', ')}`);

  const next = new Set(enabledKeys);
  for (const key of ALWAYS_ON) next.add(key);

  return withTenant(tenantId, async (client) => {
    const before = await client.query('SELECT key, enabled FROM modules WHERE tenant_id = $1', [tenantId]);
    const beforeMap = new Map(before.rows.map((r) => [r.key, r.enabled]));

    for (const key of known) {
      const enabled = next.has(key);
      await client.query(
        `INSERT INTO modules (tenant_id, key, enabled, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [tenantId, key, enabled, MODULES.find((m) => m.key === key).order],
      );
    }

    const changes = [...known]
      .filter((k) => beforeMap.has(k) && beforeMap.get(k) !== next.has(k))
      .map((k) => ({ module: k, enabled: next.has(k) }));

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'modules.updated',
      entity: 'modules',
      entityId: tenantId,
      metadata: { changes },
    });

    invalidateAuthCache({ tenantId });
    return listModules(tenantId);
  });
}

export async function isModuleEnabled(tenantId, key) {
  const rows = await withTenant(tenantId, (client) =>
    client.query('SELECT enabled FROM modules WHERE tenant_id = $1 AND key = $2', [tenantId, key]),
  );
  const row = rows.rows[0];
  return row ? row.enabled : Boolean(MODULES.find((m) => m.key === key)?.defaultEnabled);
}

export { getVertical };
