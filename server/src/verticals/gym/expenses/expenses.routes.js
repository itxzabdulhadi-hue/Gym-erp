import { Router } from 'express';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  validateBody, validateQuery, validateParams, idParam,
  money, requiredText, optionalText, optionalDate, optionalUrl,
} from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as expenses from './expenses.service.js';

export const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const listSchema = z.object({
  ...listQueryShape(['expense_date', 'amount', 'category', 'created_at', 'title']),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const expenseBody = z.object({
  category: z.enum(EXPENSE_CATEGORIES).default('other'),
  amount: money,
  expenseDate: optionalDate,
  title: requiredText(160),
  description: optionalText(2000),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  vendor: optionalText(120),
  attachmentUrl: optionalUrl,
  notes: optionalText(1000),
});

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('expenses'));

router.get('/', requirePermission('expenses.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await expenses.listExpenses(req.tenantId, req.validatedQuery));
}));

router.get('/summary', requirePermission('expenses.view'), asyncHandler(async (req, res) => {
  res.json({ data: await expenses.summary(req.tenantId, { from: req.query.from, to: req.query.to }) });
}));

router.get('/export', requirePermission('expenses.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  const csv = await expenses.exportCsv(req.tenantId, req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
  res.send(csv);
}));

router.post('/', requirePermission('expenses.create'), validateBody(expenseBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await expenses.createExpense(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requirePermission('expenses.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await expenses.getExpense(req.tenantId, req.validatedParams.id) });
}));

router.patch('/:id', requirePermission('expenses.edit'), validateParams(idParam), validateBody(expenseBody.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await expenses.updateExpense(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('expenses.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await expenses.deleteExpense(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

export default router;
