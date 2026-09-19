import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';
import { listModules, setModules } from './modules.service.js';

export const router = Router();

const setSchema = z.object({ enabled: z.array(z.string().max(40)).max(100) });

router.get('/', requireAuth, requirePermission('settings.view'), asyncHandler(async (req, res) => {
  res.json({ data: await listModules(req.tenantId) });
}));

router.put('/', requireAuth, requirePermission('modules.manage'), validateBody(setSchema), asyncHandler(async (req, res) => {
  const data = await setModules(req.tenantId, req.body.enabled, {
    userId: req.userId,
    userLabel: req.ctx.user.fullName,
  });
  res.json({ data });
}));

export default router;
