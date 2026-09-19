import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  validateBody, validateQuery, validateParams, idParam,
  requiredText, optionalText, optionalEmail, optionalPhone, optionalDate, optionalUrl, uuid, money,
} from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as trainers from './trainers.service.js';

export const router = Router();

const scheduleSchema = z.array(
  z.object({
    day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
  }),
).max(40);

const trainerBody = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  email: optionalEmail,
  phone: optionalPhone,
  photoUrl: optionalUrl,
  specialization: optionalText(120),
  bio: optionalText(2000),
  hireDate: optionalDate,
  salary: money.optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  schedule: scheduleSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: optionalText(2000),
  userId: z.union([uuid, z.null()]).optional(),
});

const listSchema = z.object({
  ...listQueryShape(['name', 'created_at', 'status', 'members']),
  status: z.enum(['active', 'inactive']).optional(),
});

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('trainers'));

router.get('/', requirePermission('trainers.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await trainers.listTrainers(req.tenantId, req.validatedQuery));
}));

router.post('/', requirePermission('trainers.create'), validateBody(trainerBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await trainers.createTrainer(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requirePermission('trainers.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await trainers.getTrainer(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/members', requirePermission('members.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await trainers.trainerMembers(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/plans', requirePermission('workouts.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await trainers.trainerPlans(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/performance', requirePermission('reports.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await trainers.trainerPerformance(req.tenantId, req.validatedParams.id, { days: req.query.days }) });
}));

router.post('/:id/link-user', requirePermission('trainers.edit'), validateParams(idParam), validateBody(z.object({ userId: uuid })), asyncHandler(async (req, res) => {
  res.json({ data: await trainers.linkUser(req.tenantId, req.validatedParams.id, req.body.userId, actorOf(req)) });
}));

router.patch('/:id', requirePermission('trainers.edit'), validateParams(idParam), validateBody(trainerBody.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await trainers.updateTrainer(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('trainers.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await trainers.deleteTrainer(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

export default router;
