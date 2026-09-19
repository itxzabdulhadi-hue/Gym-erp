import bcrypt from 'bcryptjs';
import { query, tx } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { randomToken, sha256 } from '../../utils/ids.js';
import config from '../../config/env.js';
import logger from '../../utils/logger.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../middleware/auth.js';
import { invalidateAuthCache } from './authContext.js';
import { logAudit } from '../audit/audit.service.js';
import { BCRYPT_ROUNDS, getTenantBySlug, getTenantById } from '../tenants/tenants.service.js';

const GENERIC_CREDENTIAL_ERROR = 'Email or password is incorrect';

/** "15m" / "30d" / "3600" -> milliseconds. */
export function parseDuration(value, fallbackMs) {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(String(value).trim());
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unit = match[2] || 's';
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * factor;
}

const ACCESS_TTL_MS = parseDuration(config.ACCESS_TOKEN_TTL, 15 * 60_000);
const REFRESH_TTL_MS = parseDuration(config.REFRESH_TOKEN_TTL, 30 * 86_400_000);

export const TOKEN_TTL = { accessMs: ACCESS_TTL_MS, refreshMs: REFRESH_TTL_MS };

// ---------------------------------------------------------------------------
// Login / refresh / logout
// ---------------------------------------------------------------------------

export async function login({ email, password, tenantSlug, ip, userAgent }) {
  const tenant = await getTenantBySlug(String(tenantSlug || '').toLowerCase());
  if (!tenant) throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR);

  const userRes = await query('SELECT * FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)', [
    tenant.id,
    email,
  ]);
  const user = userRes.rows[0];

  // Always run a hash comparison so timing does not reveal whether the account exists.
  const hash = user?.password_hash || '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const valid = await bcrypt.compare(password, hash);
  if (!user || !valid) throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR);
  if (user.status !== 'active') throw ApiError.forbidden('This account is disabled');
  if (tenant.status === 'suspended') throw ApiError.forbidden('This business account is suspended');

  const tokens = await issueSession({ user, tenant, ip, userAgent });
  await query('UPDATE users SET last_login_at = now(), last_login_ip = $2 WHERE id = $1', [user.id, ip ?? null]);
  await logAudit(query, {
    tenantId: tenant.id,
    userId: user.id,
    userLabel: user.full_name,
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
    metadata: { ip, userAgent: userAgent?.slice(0, 200) },
  });

  return { ...tokens, user: publicUser(user), tenant: publicTenant(tenant) };
}

async function issueSession({ user, tenant, ip, userAgent }) {
  const accessToken = signAccessToken({ sub: user.id, tid: tenant.id, email: user.email });
  const jti = randomToken(24);
  const refreshToken = signRefreshToken({ sub: user.id, tid: tenant.id, jti });

  await query(
    `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' milliseconds')::interval)`,
    [tenant.id, user.id, sha256(jti), userAgent?.slice(0, 300) ?? null, ip ?? null, String(REFRESH_TTL_MS)],
  );

  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
}

export async function refresh({ refreshToken, ip, userAgent }) {
  if (!refreshToken) throw ApiError.unauthorized('Missing refresh token');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Session expired');
  }

  const hash = sha256(payload.jti || '');
  const result = await tx(async (client) => {
    const found = await client.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hash],
    );
    const row = found.rows[0];
    if (!row || row.revoked_at || row.expires_at < new Date()) {
      if (row) throw ApiError.unauthorized('Session expired');
      throw ApiError.unauthorized('Invalid session');
    }
    // Rotation: the presented token is single use.
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);

    const [userRes, tenantRes] = await Promise.all([
      client.query('SELECT * FROM users WHERE id = $1', [row.user_id]),
      client.query('SELECT * FROM tenants WHERE id = $1', [row.tenant_id]),
    ]);
    const user = userRes.rows[0];
    const tenant = tenantRes.rows[0];
    if (!user || user.status !== 'active' || !tenant || tenant.status === 'suspended') {
      throw ApiError.forbidden('Account or business is not active');
    }

    const jti = randomToken(24);
    await client.query(
      `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' milliseconds')::interval)`,
      [tenant.id, user.id, sha256(jti), userAgent?.slice(0, 300) ?? null, ip ?? null, String(REFRESH_TTL_MS)],
    );

    return {
      user,
      tenant,
      accessToken: signAccessToken({ sub: user.id, tid: tenant.id, email: user.email }),
      refreshToken: signRefreshToken({ sub: user.id, tid: tenant.id, jti }),
    };
  });

  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    user: publicUser(result.user),
    tenant: publicTenant(result.tenant),
  };
}

export async function logout({ refreshToken, userId, tenantId }) {
  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(payload.jti || '')]);
    } catch {
      // An already invalid token still counts as logged out.
    }
  }
  if (userId) {
    invalidateAuthCache({ userId });
    await logAudit(query, { tenantId, userId, action: 'auth.logout', entity: 'user', entityId: userId });
  }
  return { ok: true };
}

export async function logoutAllDevices({ userId, tenantId, userLabel }) {
  const res = await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  invalidateAuthCache({ userId });
  await logAudit(query, {
    tenantId,
    userId,
    userLabel,
    action: 'auth.logout_all',
    entity: 'user',
    entityId: userId,
    metadata: { revokedSessions: res.rowCount },
  });
  return { revoked: res.rowCount };
}

export async function listSessions({ userId }) {
  const res = await query(
    `SELECT id, user_agent, ip, created_at, expires_at, revoked_at,
            (SELECT count(*) = 0 FROM refresh_tokens r2 WHERE r2.user_id = refresh_tokens.user_id AND r2.revoked_at IS NULL AND r2.id > refresh_tokens.id) AS unused
     FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  return res.rows;
}

export async function revokeSession({ userId, sessionId, tenantId, userLabel }) {
  const res = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 RETURNING id',
    [sessionId, userId],
  );
  if (!res.rows[0]) throw ApiError.notFound('Session not found');
  await logAudit(query, { tenantId, userId, userLabel, action: 'auth.session_revoked', entity: 'session', entityId: sessionId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function changePassword({ userId, tenantId, userLabel, currentPassword, newPassword }) {
  const res = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const row = res.rows[0];
  if (!row) throw ApiError.notFound('User not found');
  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');

  await setPassword(userId, newPassword);
  await query('UPDATE users SET must_change_password = false WHERE id = $1', [userId]);
  await logoutAllDevices({ userId, tenantId, userLabel });
  await logAudit(query, { tenantId, userId, userLabel, action: 'auth.password_changed', entity: 'user', entityId: userId });
  return { ok: true };
}

export async function setPassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
  invalidateAuthCache({ userId });
}

/**
 * Always resolves successfully (when the address is valid) so the endpoint
 * cannot be used to enumerate accounts. The reset link is handed to the
 * notification dispatcher, which delivers it over whatever channel is enabled.
 */
export async function requestPasswordReset({ email, tenantSlug }) {
  const tenant = await getTenantBySlug(String(tenantSlug || '').toLowerCase());
  const result = { ok: true, delivered: false, token: null };
  if (!tenant) return result;

  const userRes = await query('SELECT * FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)', [tenant.id, email]);
  const user = userRes.rows[0];
  if (!user || user.status !== 'active') return result;

  const rawToken = randomToken(32);
  await query(
    `INSERT INTO password_resets (tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [tenant.id, user.id, sha256(rawToken)],
  );

  // In development (no mail provider configured) surface the token so the flow
  // is testable; in production it is only ever sent through a configured channel.
  if (!config.isProduction) result.token = rawToken;

  const { dispatchNotification } = await import('../notifications/notification.service.js');
  await dispatchNotification({
    tenantId: tenant.id,
    userId: user.id,
    type: 'system',
    title: 'Password reset requested',
    body: 'Use the reset link to choose a new password. It expires in one hour.',
    level: 'info',
    entity: 'user',
    entityId: user.id,
    data: { resetToken: rawToken, email: user.email },
    channels: ['in_app', 'email'],
  });

  result.delivered = true;
  logger.info('auth', `password reset requested for ${user.email}`);
  return result;
}

export async function resetPassword({ token, password }) {
  const hash = sha256(token);
  const found = await query(
    'SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
    [hash],
  );
  const row = found.rows[0];
  if (!row) throw ApiError.badRequest('This reset link is invalid or has expired');

  await tx(async (client) => {
    const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await client.query('UPDATE users SET password_hash = $2, must_change_password = false, status = $3 WHERE id = $1', [
      row.user_id,
      newHash,
      'active',
    ]);
    await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [row.user_id]);
    await client.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id)
       VALUES ($1, $2, 'auth.password_reset', 'user', $2)`,
      [row.tenant_id, row.user_id],
    );
  });

  invalidateAuthCache({ userId: row.user_id, tenantId: row.tenant_id });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Serialisation (never expose password_hash)
// ---------------------------------------------------------------------------

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    status: user.status,
    isPlatformAdmin: Boolean(user.is_platform_admin),
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

export function publicTenant(tenant) {
  if (!tenant) return null;
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    shortName: tenant.short_name,
    vertical: tenant.vertical,
    status: tenant.status,
    plan: tenant.plan,
    settings: tenant.settings || {},
    onboardedAt: tenant.onboarded_at,
  };
}

export async function tenantExists(tenantId) {
  return Boolean(await getTenantById(tenantId));
}
