import { Router } from 'express';
import { z } from 'zod';
import { MEMBERSHIP_STATUSES, BILLING_CYCLES } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  validateBody, validateQuery, validateParams, idParam,
  requiredText, optionalText, optionalDate, money, uuid, booleanish,
} from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as memberships from './memberships.service.js';

export const router = Router();
export const plansRouter = Router();

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const planBody = z.object({
  name: requiredText(80),
  description: optionalText(500),
  price: money,
  currency: z.string().trim().length(3).toUpperCase().optional(),
  billingCycle: z.enum(BILLING_CYCLES.map((c) => c.key)).default('monthly'),
  durationDays: z.coerce.number().int().min(1).max(3650).optional(),
  features: z.array(z.string().max(120)).max(30).optional(),
  accessRules: z.record(z.union([z.string().max(60), z.number(), z.boolean(), z.array(z.string().max(40))])).optional(),
  isActive: booleanish.optional(),
  isFeatured: booleanish.optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

plansRouter.use(requireAuth, requireModule('memberships'));

plansRouter.get('/', requirePermission('memberships.view'), asyncHandler(async (req, res) => {
  res.json({
    data: await memberships.listPlans(req.tenantId, {
      includeInactive: req.query.includeInactive === 'true' || req.query.includeInactive === true,
      activeOnly: req.query.activeOnly === 'true',
    }),
  });
}));

plansRouter.post('/', requirePermission('memberships.create'), validateBody(planBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await memberships.createPlan(req.tenantId, req.body, actorOf(req)) });
}));

plansRouter.get('/:id', requirePermission('memberships.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await memberships.getPlan(req.tenantId, req.validatedParams.id) });
}));

plansRouter.patch('/:id', requirePermission('memberships.edit'), validateParams(idParam), validateBody(planBody.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await memberships.updatePlan(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

plansRouter.delete('/:id', requirePermission('memberships.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await memberships.deletePlan(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

const listSchema = z.object({
  ...listQueryShape(['start_date', 'end_date', 'status', 'price', 'created_at', 'member']),
  status: z
    .union([z.enum(MEMBERSHIP_STATUSES), z.string()])
    .optional()
    .transform((v) => (typeof v === 'string' && v.includes(',') ? v.split(',').filter(Boolean) : v)),
  planId: uuid.optional(),
  memberId: uuid.optional(),
  trainerId: uuid.optional(),
  changeType: z.enum(['new', 'renewal', 'upgrade', 'downgrade']).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

const createSchema = z.object({
  memberId: uuid,
  planId: uuid.optional(),
  planName: requiredText(80).optional(),
  price: money.optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  durationDays: z.coerce.number().int().min(1).max(3650).optional(),
  changeType: z.enum(['new', 'renewal', 'upgrade', 'downgrade']).optional(),
  notes: optionalText(500),
});

const renewSchema = z.object({
  planId: uuid.optional(),
  price: money.optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  durationDays: z.coerce.number().int().min(1).max(3650).optional(),
  notes: optionalText(500),
});

const changeSchema = z.object({
  planId: uuid,
  direction: z.enum(['upgrade', 'downgrade']).default('upgrade'),
  startDate: optionalDate,
  endDate: optionalDate,
  notes: optionalText(500),
});

const freezeSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), notes: optionalText(300) });
const cancelSchema = z.object({ notes: optionalText(300) });

router.use(requireAuth, requireModule('memberships'));

router.get('/', requirePermission('memberships.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await memberships.listMemberships(req.tenantId, req.validatedQuery));
}));

router.post('/', requirePermission('memberships.create'), validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await memberships.createMembership(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requirePermission('memberships.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await memberships.getMembership(req.tenantId, req.validatedParams.id) });
}));

router.post('/:id/renew', requirePermission('memberships.renew'), validateParams(idParam), validateBody(renewSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await memberships.renewMembership(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.post('/:id/change', requirePermission('memberships.edit'), validateParams(idParam), validateBody(changeSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await memberships.changeMembership(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.post('/:id/freeze', requirePermission('memberships.freeze'), validateParams(idParam), validateBody(freezeSchema), asyncHandler(async (req, res) => {
  res.json({ data: await memberships.freezeMembership(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.post('/:id/resume', requirePermission('memberships.freeze'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await memberships.resumeMembership(req.tenantId, req.validatedParams.id, actorOf(req)) });
}));

router.post('/:id/cancel', requirePermission('memberships.cancel'), validateParams(idParam), validateBody(cancelSchema), asyncHandler(async (req, res) => {
  res.json({ data: await memberships.cancelMembership(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

export default router;
