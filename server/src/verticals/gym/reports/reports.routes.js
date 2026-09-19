import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { validateQuery } from '../../../utils/validate.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import { runReport, exportReport, REPORTS } from './reports.service.js';

export const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const filterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  planId: z.string().uuid().optional(),
  trainerId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  status: z.string().max(30).optional(),
  method: z.string().max(30).optional(),
  category: z.string().max(30).optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
});

router.use(requireAuth, requireModule('reports'), requirePermission('reports.view'));

router.get('/catalogue', (_req, res) => {
  res.json({ data: Object.entries(REPORTS).map(([key, r]) => ({ key, label: r.label })) });
});

router.get('/:report', validateQuery(filterSchema), asyncHandler(async (req, res) => {
  res.json({ data: await runReport(req.tenantId, req.params.report, req.validatedQuery) });
}));

router.get('/:report/export', requirePermission('reports.export'), validateQuery(filterSchema), asyncHandler(async (req, res) => {
  const csv = await exportReport(req.tenantId, req.params.report, req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.report}.csv"`);
  res.send(csv);
}));

export default router;
