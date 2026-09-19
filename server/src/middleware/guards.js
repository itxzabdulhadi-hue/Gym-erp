import { hasPermission, hasAllPermissions } from '@erp/shared';
import ApiError from '../utils/ApiError.js';

/**
 * Authorisation guards. Components and routes both ask for permission keys -
 * nothing hardcodes "if user is owner" logic.
 */

export const requirePermission = (...keys) => (req, _res, next) => {
  if (!req.ctx) return next(ApiError.unauthorized());
  if (!hasPermission(req.ctx.permissions, keys[0]) && !hasAny(req.ctx.permissions, keys)) {
    return next(ApiError.forbidden(`Missing permission: ${keys.join(' or ')}`));
  }
  return next();
};

export const requireAll = (...keys) => (req, _res, next) => {
  if (!req.ctx) return next(ApiError.unauthorized());
  if (!hasAllPermissions(req.ctx.permissions, keys)) {
    return next(ApiError.forbidden(`Missing permission: ${keys.join(' and ')}`));
  }
  return next();
};

function hasAny(permissions, keys) {
  return keys.some((key) => hasPermission(permissions, key));
}

/**
 * Module guard. A disabled module is not just hidden in the navigation: its API
 * answers 403 MODULE_DISABLED, so deep links and scripted calls cannot bypass
 * the setting.
 */
export const requireModule = (moduleKey) => (req, _res, next) => {
  if (!req.ctx) return next(ApiError.unauthorized());
  const entry = req.ctx.modules[moduleKey];
  if (entry && entry.enabled === false) return next(ApiError.moduleDisabled(moduleKey));
  return next();
};

/** Convenience: module enabled AND the caller may use it. */
export const requireFeature = (moduleKey, ...permissions) => [
  requireModule(moduleKey),
  requirePermission(...permissions),
];
