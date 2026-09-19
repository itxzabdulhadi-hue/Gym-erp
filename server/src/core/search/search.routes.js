import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateQuery } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { globalSearch } from './search.service.js';

export const router = Router();

const schema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

router.get('/', requireAuth, validateQuery(schema), asyncHandler(async (req, res) => {
  res.json(
    await globalSearch(req.tenantId, {
      query: req.validatedQuery.q,
      permissions: req.ctx.permissions,
      limit: req.validatedQuery.limit,
    }),
  );
}));

export default router;
