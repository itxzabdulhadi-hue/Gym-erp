import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody, validateParams, idParam, requiredText, optionalText, booleanish } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireModule } from '../../middleware/guards.js';
import * as roles from './roles.service.js';

export const router = Router();

const createSchema = z.object({
  name: requiredText(60),
  description: optionalText(300),
  permissions: z.array(z.string().max(60)).max(200).default([]),
  grantAll: booleanish.default(false),
});

const updateSchema = z.object({
  name: requiredText(60).optional(),
  description: optionalText(300),
  permissions: z.array(z.string().max(60)).max(200).optional(),
  grantAll: booleanish.optional(),
});

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('roles'));

router.get('/', requirePermission('roles.view'), asyncHandler(async (req, res) => {
  res.json({ data: await roles.listRoles(req.tenantId) });
}));

router.post('/', requirePermission('roles.create'), validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await roles.createRole(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requirePermission('roles.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await roles.getRole(req.tenantId, req.validatedParams.id) });
}));

router.patch('/:id', requirePermission('roles.edit'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ data: await roles.updateRole(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('roles.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await roles.deleteRole(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

export default router;
