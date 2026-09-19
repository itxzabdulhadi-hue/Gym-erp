import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { invalidateAuthCache, loadAuthContext } from '../core/auth/authContext.js';

export const ACCESS_COOKIE = 'erp_at';
export const REFRESH_COOKIE = 'erp_rt';

export function signAccessToken(payload) {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL,
    issuer: 'erp-platform',
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.REFRESH_TOKEN_TTL,
    issuer: 'erp-platform',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: 'erp-platform' });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.JWT_REFRESH_SECRET, { issuer: 'erp-platform' });
}

export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    domain: config.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: maxAgeMs,
  };
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.[ACCESS_COOKIE]) return req.cookies[ACCESS_COOKIE];
  return null;
}

/**
 * Populates `req.ctx` = { user, tenant, roles, permissions, modules, branding, theme }.
 * Everything downstream (guards, services, repositories) reads the tenant from
 * here - never from a request parameter - so a client cannot ask for another
 * tenant's data by changing an id.
 */
export async function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized());

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session';
    return next(ApiError.unauthorized(message));
  }

  try {
    const ctx = await loadAuthContext({ userId: payload.sub, tenantId: payload.tid });
    if (!ctx.user) return next(ApiError.unauthorized('Account no longer exists'));
    if (ctx.user.status !== 'active') return next(ApiError.forbidden('This account is disabled'));
    if (ctx.tenant.status === 'suspended') return next(ApiError.forbidden('This business account is suspended'));

    // Platform admins may act on another tenant by saying so explicitly.
    const override = req.headers['x-tenant-id'];
    if (override && ctx.user.isPlatformAdmin && override !== ctx.tenant.id) {
      const scoped = await loadAuthContext({ userId: payload.sub, tenantId: override, asPlatformAdmin: true });
      if (!scoped.tenant) return next(ApiError.notFound('Business not found'));
      req.ctx = { ...scoped, actingAsPlatformAdmin: true };
    } else {
      req.ctx = ctx;
    }

    req.tenantId = req.ctx.tenant.id;
    req.userId = req.ctx.user.id;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Attaches the context when a token is present but never rejects the request. */
export async function optionalAuth(req, _res, next) {
  if (!extractToken(req)) return next();
  return requireAuth(req, _res, (err) => next(err));
}

// `invalidateAuthCache` is intentionally not re-exported from here: consumers
// import it from core/auth/authContext.js directly.
export { invalidateAuthCache as clearAuthCache };
