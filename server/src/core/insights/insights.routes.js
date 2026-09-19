import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateQuery } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireModule } from '../../middleware/guards.js';
import { INSIGHT_ENDPOINTS, aiProviderStatus, askAi } from './insights.service.js';

export const router = Router();

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).optional(),
  weeks: z.coerce.number().int().min(1).max(52).optional(),
  days: z.coerce.number().int().min(1).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.use(requireAuth, requireModule('reports'), requirePermission('reports.view'));

router.get('/status', (_req, res) => {
  res.json({ data: { ai: aiProviderStatus(), insights: Object.keys(INSIGHT_ENDPOINTS) } });
});

router.get('/:insight', validateQuery(querySchema), asyncHandler(async (req, res) => {
  const handler = INSIGHT_ENDPOINTS[req.params.insight];
  if (!handler) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown insight' } });
  res.json({ data: await handler(req.tenantId, req.validatedQuery) });
}));

/**
 * Natural language analytics. Returns 501 NOT_CONFIGURED until a provider is
 * registered - the endpoint exists so a client can detect the capability, not
 * to fake an answer.
 */
router.post('/ask', asyncHandler(async (req, res) => {
  const question = String(req.body?.question || '').slice(0, 500);
  if (!question) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'question is required' } });
  res.json({ data: await askAi({ tenantId: req.tenantId, question, context: { permissions: req.ctx.permissions } }) });
}));

export default router;
