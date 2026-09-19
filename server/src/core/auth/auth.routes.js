import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import { validateBody } from '../../utils/validate.js';
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from './auth.validation.js';
import * as authService from './auth.service.js';
import {
  requireAuth,
  cookieOptions,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { invalidateAuthCache } from './authContext.js';
import { getTenantWorkspace } from '../tenants/tenants.service.js';

export const router = Router();

/** POST /api/auth/login */
router.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.login({
      ...req.body,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // The refresh token lives in an httpOnly cookie (web) and is also returned
    // in the body so non-browser clients (Capacitor wrappers) can store it.
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(authService.TOKEN_TTL.refreshMs));
    res.cookie(ACCESS_COOKIE, result.accessToken, cookieOptions(authService.TOKEN_TTL.accessMs));

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
      tenant: result.tenant,
    });
  }),
);

/** POST /api/auth/refresh */
router.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const token = req.body.refreshToken || req.cookies?.[REFRESH_COOKIE];
    const result = await authService.refresh({
      refreshToken: token,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(authService.TOKEN_TTL.refreshMs));
    res.cookie(ACCESS_COOKIE, result.accessToken, cookieOptions(authService.TOKEN_TTL.accessMs));
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
      tenant: result.tenant,
    });
  }),
);

/** POST /api/auth/logout */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout({
      refreshToken: req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE],
      userId: req.userId,
      tenantId: req.tenantId,
    });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

/** POST /api/auth/logout-all */
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await authService.logoutAllDevices({
      userId: req.userId,
      tenantId: req.tenantId,
      userLabel: req.ctx.user.fullName,
    });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.json(result);
  }),
);

/** GET /api/auth/sessions */
router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: await authService.listSessions({ userId: req.userId }) });
  }),
);

/** DELETE /api/auth/sessions/:id */
router.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(
      await authService.revokeSession({
        userId: req.userId,
        tenantId: req.tenantId,
        sessionId: req.params.id,
        userLabel: req.ctx.user.fullName,
      }),
    );
  }),
);

/** POST /api/auth/forgot-password */
router.post(
  '/forgot-password',
  authLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.requestPasswordReset(req.body);
    // Never reveal whether the account exists.
    res.json({ ok: true, message: 'If that account exists, a reset link is on its way.', devToken: result.token });
  }),
);

/** POST /api/auth/reset-password */
router.post(
  '/reset-password',
  authLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body);
    res.json({ ok: true });
  }),
);

/** GET /api/auth/me - identity + tenant workspace in one call. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspace = await getTenantWorkspace(req.tenantId);
    res.json({
      user: req.ctx.user,
      tenant: req.ctx.tenant,
      roles: req.ctx.roles,
      permissions: req.ctx.permissions,
      ...workspace,
    });
  }),
);

/** POST /api/auth/change-password */
router.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.changePassword({
      userId: req.userId,
      tenantId: req.tenantId,
      userLabel: req.ctx.user.fullName,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    invalidateAuthCache({ userId: req.userId });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

/** PATCH /api/auth/profile */
router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { fullName, phone, avatarUrl } = req.body || {};
    if (fullName === undefined && phone === undefined && avatarUrl === undefined) {
      throw ApiError.badRequest('Nothing to update');
    }
    const { updateUserProfile } = await import('../users/users.service.js');
    const user = await updateUserProfile(req.tenantId, req.userId, { fullName, phone, avatarUrl });
    invalidateAuthCache({ userId: req.userId });
    res.json({ data: user });
  }),
);

export default router;
