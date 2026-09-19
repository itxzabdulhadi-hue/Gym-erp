import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { validateBody, validateQuery, validateParams, idParam, uuid, optionalText, optionalDate, optionalUrl } from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as progress from './progress.service.js';

export const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const measurement = z.coerce.number().min(0).max(500).optional();

const recordBody = z.object({
  memberId: uuid,
  recordedAt: optionalDate,
  weightKg: z.coerce.number().min(1).max(500).optional(),
  heightCm: z.coerce.number().min(30).max(300).optional(),
  bodyFatPct: z.coerce.number().min(0).max(80).optional(),
  chestCm: measurement,
  waistCm: measurement,
  hipsCm: measurement,
  armsCm: measurement,
  thighsCm: measurement,
  neckCm: measurement,
  photoUrls: z.array(optionalUrl.transform((v) => v)).max(8).optional(),
  notes: optionalText(2000),
});

const listSchema = z.object({
  ...listQueryShape(['recorded_at', 'weight_kg', 'created_at']),
  memberId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('progress'));

router.get('/', requirePermission('progress.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await progress.listRecords(req.tenantId, req.validatedQuery));
}));

router.get('/latest', requirePermission('progress.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await progress.latestPerMember(req.tenantId, req.validatedQuery));
}));

router.get('/member/:memberId', requirePermission('progress.view'), validateParams(z.object({ memberId: uuid })), asyncHandler(async (req, res) => {
  res.json({ data: await progress.memberTimeline(req.tenantId, req.validatedParams.memberId) });
}));

router.post('/', requirePermission('progress.create'), validateBody(recordBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await progress.createRecord(req.tenantId, req.body, actorOf(req)) });
}));

router.patch('/:id', requirePermission('progress.edit'), validateParams(idParam), validateBody(recordBody.partial().omit({ memberId: true })), asyncHandler(async (req, res) => {
  res.json({ data: await progress.updateRecord(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('progress.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await progress.deleteRecord(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

export default router;
