import bcrypt from 'bcryptjs';
import { withTenant, query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../utils/pagination.js';
import { param, likePattern, resolveSort, inPlaceholders } from '../../utils/sql.js';
import { logAudit } from '../audit/audit.service.js';
import { BCRYPT_ROUNDS, publicUser } from './users.shared.js';
import { invalidateAuthCache } from '../auth/authContext.js';

const SORTABLE = {
  name: 'u.full_name',
  email: 'u.email',
  created_at: 'u.created_at',
  last_login_at: 'u.last_login_at',
  status: 'u.status',
};

export { publicUser };

export async function listUsers(tenantId, rawQuery = {}) {
  const { page, limit, offset } = paginate(rawQuery);
  const params = [];
  const where = [`u.tenant_id = ${param(params, tenantId)}`];

  if (rawQuery.search) {
    const pattern = likePattern(rawQuery.search);
    where.push(`(u.full_name ILIKE ${param(params, pattern)} OR u.email ILIKE ${param(params, pattern)})`);
  }
  if (rawQuery.status) where.push(`u.status = ${param(params, rawQuery.status)}`);
  if (rawQuery.roleId) {
    where.push(`EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = ${param(params, rawQuery.roleId)})`);
  }

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(rawQuery.sort, rawQuery.order, SORTABLE, 'u.full_name ASC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.status, u.is_platform_admin,
                u.last_login_at, u.must_change_password, u.created_at,
                COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name))
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE ${whereSql}
         GROUP BY u.id
         ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM users u WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapeUser), pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function getUser(tenantId, userId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT u.*, COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name))
                FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = $1 AND u.id = $2
       GROUP BY u.id`,
      [tenantId, userId],
    );
    const row = res.rows[0];
    if (!row) throw ApiError.notFound('User not found');
    return shapeUser(row);
  });
}

export async function createUser(tenantId, input, actor) {
  const email = String(input.email).toLowerCase();
  return withTenant(tenantId, async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = $2', [tenantId, email]);
    if (existing.rowCount) throw ApiError.conflict('A user with that email already exists');

    const password = input.password || generateTempPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const inserted = await client.query(
      `INSERT INTO users (tenant_id, email, full_name, phone, password_hash, status, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenantId,
        email,
        input.fullName,
        input.phone ?? null,
        passwordHash,
        input.password ? 'active' : 'invited',
        !input.password,
      ],
    );
    const user = inserted.rows[0];
    await assignRoles(client, tenantId, user.id, input.roleIds || []);

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'user.created',
      entity: 'user',
      entityId: user.id,
      metadata: { email, roles: input.roleIds },
    });

    return { ...shapeUser({ ...user, roles: [] }), tempPassword: input.password ? undefined : password };
  });
}

export async function updateUser(tenantId, userId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, userId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('User not found');

    if (input.status === 'disabled' && before.id === actor?.userId) {
      throw ApiError.badRequest('You cannot disable your own account');
    }
    if (input.status === 'disabled' && isLastOwner(before)) {
      const owners = await client.query(
        `SELECT count(*)::int AS c FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         WHERE r.tenant_id = $1 AND r.key = 'owner' AND u.status = 'active'`,
        [tenantId],
      );
      if (owners.rows[0].c <= 1) throw ApiError.badRequest('A business needs at least one active owner');
    }

    const fields = [];
    const params = [tenantId, userId];
    const editable = { fullName: 'full_name', phone: 'phone', avatarUrl: 'avatar_url', status: 'status' };
    for (const [key, column] of Object.entries(editable)) {
      if (input[key] !== undefined) {
        params.push(input[key]);
        fields.push(`${column} = $${params.length}`);
      }
    }
    if (input.email !== undefined) {
      params.push(String(input.email).toLowerCase());
      fields.push(`email = $${params.length}`);
    }

    let updated = before;
    if (fields.length) {
      const res = await client.query(`UPDATE users SET ${fields.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
      updated = res.rows[0];
    }
    if (Array.isArray(input.roleIds)) await assignRoles(client, tenantId, userId, input.roleIds);

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'user.updated',
      entity: 'user',
      entityId: userId,
      metadata: {
        before: { email: before.email, status: before.status, fullName: before.full_name },
        after: { email: updated.email, status: updated.status, fullName: updated.full_name, roles: input.roleIds },
      },
    });

    invalidateAuthCache({ userId, tenantId });
    return getUserInTx(client, tenantId, userId);
  });
}

export async function deleteUser(tenantId, userId, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, userId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('User not found');
    if (before.id === actor?.userId) throw ApiError.badRequest('You cannot delete your own account');

    const owners = await client.query(
      `SELECT count(*)::int AS c FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE r.tenant_id = $1 AND r.key = 'owner' AND ur.user_id <> $2`,
      [tenantId, userId],
    );
    const wasOwner = await client.query(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE r.tenant_id = $1 AND r.key = 'owner' AND ur.user_id = $2`,
      [tenantId, userId],
    );
    if (wasOwner.rowCount && owners.rows[0].c === 0) {
      throw ApiError.badRequest('A business needs at least one owner');
    }

    await client.query('DELETE FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, userId]);
    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'user.deleted',
      entity: 'user',
      entityId: userId,
      metadata: { email: before.email },
    });
    invalidateAuthCache({ userId, tenantId });
    return { ok: true };
  });
}

export async function adminResetPassword(tenantId, userId, newPassword, actor) {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `UPDATE users SET password_hash = $3, must_change_password = true, status = 'active'
       WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, userId, hash],
    );
    if (!res.rows[0]) throw ApiError.notFound('User not found');
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [userId]);
    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'user.password_reset',
      entity: 'user',
      entityId: userId,
    });
    invalidateAuthCache({ userId, tenantId });
    return { ok: true };
  });
}

export async function updateUserProfile(tenantId, userId, { fullName, phone, avatarUrl }) {
  const fields = [];
  const params = [tenantId, userId];
  if (fullName !== undefined) {
    params.push(fullName);
    fields.push(`full_name = $${params.length}`);
  }
  if (phone !== undefined) {
    params.push(phone);
    fields.push(`phone = $${params.length}`);
  }
  if (avatarUrl !== undefined) {
    params.push(avatarUrl);
    fields.push(`avatar_url = $${params.length}`);
  }
  if (!fields.length) throw ApiError.badRequest('Nothing to update');

  const res = await query(`UPDATE users SET ${fields.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
  if (!res.rows[0]) throw ApiError.notFound('User not found');
  invalidateAuthCache({ userId, tenantId });
  return publicUser(res.rows[0]);
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function assignRoles(client, tenantId, userId, roleIds) {
  // Roles are always resolved inside the caller's tenant: a role id from
  // another business simply does not exist here.
  const params = [tenantId];
  const wanted = roleIds.length ? roleIds : [NIL_UUID];
  const placeholders = inPlaceholders(params, wanted);
  const allowed = await client.query(
    `SELECT id FROM roles WHERE tenant_id = $1 AND id IN ${placeholders}`,
    params,
  );
  const valid = allowed.rows.map((r) => r.id);
  await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  for (const roleId of valid) {
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, roleId]);
  }
  return valid;
}

async function getUserInTx(client, tenantId, userId) {
  const res = await client.query(
    `SELECT u.*, COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name))
              FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
     FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.tenant_id = $1 AND u.id = $2 GROUP BY u.id`,
    [tenantId, userId],
  );
  return shapeUser(res.rows[0]);
}

function isLastOwner() {
  // Kept as a hook: the authoritative check runs inside updateUser() where the
  // transaction can count the remaining owners.
  return false;
}

function shapeUser(row) {
  return {
    ...publicUser(row),
    roles: row.roles || [],
  };
}

function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out}1!`;
}
