import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_STATUSES, PAYMENT_METHODS } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  validateBody, validateQuery, validateParams, idParam,
  money, uuid, optionalText, optionalDate,
} from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as payments from './payments.service.js';

export const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const listSchema = z.object({
  ...listQueryShape(['paid_at', 'amount', 'status', 'created_at', 'member', 'invoice_no']),
  status: z.union([z.enum(PAYMENT_STATUSES), z.string()]).optional()
    .transform((v) => (typeof v === 'string' && v.includes(',') ? v.split(',').filter(Boolean) : v)),
  method: z.enum(PAYMENT_METHODS).optional(),
  memberId: uuid.optional(),
  membershipId: uuid.optional(),
  receivedBy: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const createSchema = z.object({
  memberId: uuid,
  membershipId: uuid.optional(),
  amount: money,
  discount: money.optional(),
  amountPaid: money.optional(),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  paidAt: optionalDate,
  invoiceNo: z.string().trim().max(40).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  reference: optionalText(120),
  notes: optionalText(1000),
});

const updateSchema = createSchema.partial().omit({ memberId: true });

const refundSchema = z.object({ reason: optionalText(300), amount: money.optional() });

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('payments'));

router.get('/', requirePermission('payments.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await payments.listPayments(req.tenantId, req.validatedQuery));
}));

router.get('/summary', requirePermission('payments.view'), asyncHandler(async (req, res) => {
  res.json({ data: await payments.summary(req.tenantId, { from: req.query.from, to: req.query.to }) });
}));

router.get('/export', requirePermission('payments.export'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  const csv = await payments.exportCsv(req.tenantId, req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
  res.send(csv);
}));

router.post('/', requirePermission('payments.create'), validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await payments.createPayment(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requirePermission('payments.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await payments.getPayment(req.tenantId, req.validatedParams.id) });
}));

/** GET /api/payments/:id/receipt - structured data for the printable receipt. */
router.get('/:id/receipt', requirePermission('payments.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await payments.receiptData(req.tenantId, req.validatedParams.id) });
}));

router.patch('/:id', requirePermission('payments.edit'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ data: await payments.updatePayment(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.post('/:id/refund', requirePermission('payments.refund'), validateParams(idParam), validateBody(refundSchema), asyncHandler(async (req, res) => {
  res.json({ data: await payments.refundPayment(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('payments.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await payments.deletePayment(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

export default router;
