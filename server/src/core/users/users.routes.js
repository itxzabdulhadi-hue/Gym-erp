import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody, validateQuery, validateParams, idParam, email, password, requiredText, optionalPhone, optionalText, uuid } from '../../utils/validate.js';
import { listQueryShape } from '../../utils/pagination.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireModule } from '../../middleware/guards.js';
import * as users from './users.service.js';

export const router = Router();

const listSchema = z.object({
  ...listQueryShape(['name', 'email', 'created_at', 'last_login_at', 'status']),
  status: z.enum(['active', 'invited', 'disabled']).optional(),
  roleId: uuid.optional(),
});

const createSchema = z.object({
  email,
  fullName: requiredText(120),
  phone: optionalPhone,
  password: password.optional(),
  roleIds: z.array(uuid).max(20).default([]),
});

const updateSchema = z.object({
  email: email.optional(),
  fullName: requiredText(120).optional(),
  phone: optionalPhone,
  avatarUrl: optionalText(500),
  status: z.enum(['active', 'invited', 'disabled']).optional(),
  roleIds: z.array(uuid).max(20).optional(),
});

const resetSchema = z.object({ password });

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('users'));

router.get('/', requirePermission('users.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await users.listUsers(req.tenantId, req.validatedQuery));
}));

router.post('/', requirePermission('users.create'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const user = await users.createUser(req.tenantId, req.body, actorOf(req));
  res.status(201).json({ data: user });
}));

router.get('/:id', requirePermission('users.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await users.getUser(req.tenantId, req.validatedParams.id) });
}));

router.patch('/:id', requirePermission('users.edit'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ data: await users.updateUser(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('users.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await users.deleteUser(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

router.post('/:id/reset-password', requirePermission('users.edit'), validateParams(idParam), validateBody(resetSchema), asyncHandler(async (req, res) => {
  res.json(await users.adminResetPassword(req.tenantId, req.validatedParams.id, req.body.password, actorOf(req)));
}));

export default router;
