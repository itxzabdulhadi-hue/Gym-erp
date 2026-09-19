import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireModule } from '../../middleware/guards.js';
import { getDashboardMetrics, getWidgetData } from './dashboard.service.js';
import { getLayout, saveLayout, resetLayout, widgetCatalogue } from './dashboardLayout.service.js';

export const router = Router();

const layoutSchema = z.object({
  widgets: z
    .array(
      z.union([
        z.string().max(40),
        z.object({ id: z.string().max(40), width: z.number().int().min(1).max(12).optional(), height: z.number().int().min(1).max(6).optional() }),
      ]),
    )
    .max(40),
});

router.use(requireAuth, requireModule('dashboard'), requirePermission('dashboard.view'));

router.get('/', asyncHandler(async (req, res) => {
  const [data, layout] = await Promise.all([
    getDashboardMetrics(req.tenantId, {
      expiryWarningDays: req.ctx.tenant.settings?.memberships?.expiryWarningDays,
    }),
    getLayout(req.tenantId, req.userId),
  ]);
  res.json({ data: { ...data, layout } });
}));

router.get('/widgets', (_req, res) => {
  res.json({ data: widgetCatalogue() });
});

router.get('/widget/:id', asyncHandler(async (req, res) => {
  res.json({ data: await getWidgetData(req.tenantId, req.params.id) });
}));

router.get('/layout', asyncHandler(async (req, res) => {
  res.json({ data: await getLayout(req.tenantId, req.userId) });
}));

router.put('/layout', requirePermission('dashboard.customize'), validateBody(layoutSchema), asyncHandler(async (req, res) => {
  res.json({ data: await saveLayout(req.tenantId, req.userId, req.body.widgets) });
}));

router.post('/layout/reset', requirePermission('dashboard.customize'), asyncHandler(async (req, res) => {
  res.json({ data: await resetLayout(req.tenantId, req.userId) });
}));

export default router;
