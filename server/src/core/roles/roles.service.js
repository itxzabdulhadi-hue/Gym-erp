import { withTenant } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { normalizePermissions, ALL_PERMISSION_KEYS } from '@erp/shared';
import { logAudit } from '../audit/audit.service.js';
import { invalidateAuthCache } from '../auth/authContext.js';

/**
 * Roles and the permission matrix.
 * Permissions are referenced by key from the shared catalogue, so a role can
 * never hold a capability that does not exist.
 */

export async function listRoles(tenantId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT r.id, r.key, r.name, r.description, r.is_system, r.created_at,
              COALESCE(json_agg(DISTINCT rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '[]') AS permissions,
              (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.tenant_id = $1
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name ASC`,
      [tenantId],
    );
    return res.rows;
  });
}

export async function getRole(tenantId, roleId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT r.*, COALESCE(json_agg(DISTINCT rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '[]') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.tenant_id = $1 AND r.id = $2 GROUP BY r.id`,
      [tenantId, roleId],
    );
    if (!res.rows[0]) throw ApiError.notFound('Role not found');
    return res.rows[0];
  });
}

export async function createRole(tenantId, input, actor) {
  const permissions = input.grantAll ? ALL_PERMISSION_KEYS : normalizePermissions(input.permissions || []);
  return withTenant(tenantId, async (client) => {
    const key = roleKey(input.name);
    const clash = await client.query('SELECT id FROM roles WHERE tenant_id = $1 AND key = $2', [tenantId, key]);
    if (clash.rowCount) throw ApiError.conflict('A role with that name already exists');

    const inserted = await client.query(
      `INSERT INTO roles (tenant_id, key, name, description, is_system) VALUES ($1, $2, $3, $4, false) RETURNING *`,
      [tenantId, key, input.name, input.description ?? null],
    );
    const role = inserted.rows[0];
    await replacePermissions(client, role.id, permissions);

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'role.created',
      entity: 'role',
      entityId: role.id,
      metadata: { name: role.name, permissions: permissions.length },
    });
    return { ...role, permissions, user_count: 0 };
  });
}

export async function updateRole(tenantId, roleId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM roles WHERE tenant_id = $1 AND id = $2', [tenantId, roleId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('Role not found');

    const fields = [];
    const params = [tenantId, roleId];
    if (input.name !== undefined) {
      params.push(input.name);
      fields.push(`name = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      fields.push(`description = $${params.length}`);
    }
    if (fields.length) {
      await client.query(`UPDATE roles SET ${fields.join(', ')} WHERE tenant_id = $1 AND id = $2`, params);
    }

    let permissions;
    if (input.permissions !== undefined || input.grantAll) {
      permissions = input.grantAll ? ALL_PERMISSION_KEYS : normalizePermissions(input.permissions || []);
      await replacePermissions(client, roleId, permissions);
    }

    const affected = await client.query(
      `SELECT user_id FROM user_roles WHERE role_id = $1`,
      [roleId],
    );
    for (const row of affected.rows) invalidateAuthCache({ userId: row.user_id, tenantId });

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'role.updated',
      entity: 'role',
      entityId: roleId,
      metadata: {
        before: { name: before.name },
        after: { name: input.name ?? before.name, permissions: permissions?.length },
        affectedUsers: affected.rowCount,
      },
    });

    return getRoleInTx(client, tenantId, roleId);
  });
}

export async function deleteRole(tenantId, roleId, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM roles WHERE tenant_id = $1 AND id = $2', [tenantId, roleId]);
    const role = current.rows[0];
    if (!role) throw ApiError.notFound('Role not found');
    if (role.is_system) throw ApiError.badRequest('Built-in roles cannot be deleted; edit their permissions instead');

    const assigned = await client.query('SELECT user_id FROM user_roles WHERE role_id = $1', [roleId]);
    if (assigned.rowCount) {
      const names = await client.query(
        `SELECT full_name FROM users WHERE id IN (SELECT user_id FROM user_roles WHERE role_id = $1) LIMIT 5`,
        [roleId],
      );
      throw ApiError.conflict(
        `This role is assigned to ${assigned.rowCount} user(s) (${names.rows.map((r) => r.full_name).join(', ')}). Reassign them first.`,
      );
    }

    await client.query('DELETE FROM roles WHERE tenant_id = $1 AND id = $2', [tenantId, roleId]);
    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'role.deleted',
      entity: 'role',
      entityId: roleId,
      metadata: { name: role.name },
    });
    return { ok: true };
  });
}

async function replacePermissions(client, roleId, permissions) {
  await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  for (const key of permissions) {
    await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      roleId,
      key,
    ]);
  }
}

async function getRoleInTx(client, tenantId, roleId) {
  const res = await client.query(
    `SELECT r.*, COALESCE(json_agg(DISTINCT rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '[]') AS permissions,
            (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
     FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE r.tenant_id = $1 AND r.id = $2 GROUP BY r.id`,
    [tenantId, roleId],
  );
  return res.rows[0];
}

export function roleKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}
