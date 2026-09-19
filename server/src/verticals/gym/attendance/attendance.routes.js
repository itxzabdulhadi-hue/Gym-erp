import { Router } from 'express';
import { z } from 'zod';
import { ATTENDANCE_METHODS } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { validateBody, validateQuery, validateParams, idParam, uuid, optionalText } from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as attendance from './attendance.service.js';

export const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const listSchema = z.object({
  ...listQueryShape(['check_in_at', 'member', 'visit_date']),
  memberId: uuid.optional(),
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  openOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});

const checkInSchema = z.object({
  query: z.string().trim().max(120).optional(),
  memberId: uuid.optional(),
  method: z.enum(ATTENDANCE_METHODS).default('manual'),
}).refine((v) => Boolean(v.query || v.memberId), { message: 'Provide a search term or memberId' });

const checkOutSchema = z.object({ attendanceId: uuid.optional(), memberId: uuid.optional() })
  .refine((v) => Boolean(v.attendanceId || v.memberId), { message: 'Provide attendanceId or memberId' });

const updateSchema = z.object({
  checkInAt: z.string().datetime({ offset: true }).optional(),
  checkOutAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
  note: optionalText(300),
});

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('attendance'));

router.get('/', requirePermission('attendance.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await attendance.listAttendance(req.tenantId, req.validatedQuery));
}));

router.get('/today', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  res.json({ data: await attendance.dailySummary(req.tenantId, req.query.date) });
}));

router.get('/stats/monthly', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  res.json({ data: await attendance.monthlyStats(req.tenantId, { months: req.query.months }) });
}));

router.get('/export', requirePermission('attendance.export'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  const csv = await attendance.exportCsv(req.tenantId, req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(csv);
}));

router.post('/check-in', requirePermission('attendance.checkin'), validateBody(checkInSchema), asyncHandler(async (req, res) => {
  const result = await attendance.checkIn(req.tenantId, req.body, actorOf(req));
  res.status(result.alreadyCheckedIn ? 200 : 201).json({ data: result });
}));

router.post('/check-out', requirePermission('attendance.checkout'), validateBody(checkOutSchema), asyncHandler(async (req, res) => {
  res.json({ data: await attendance.checkOut(req.tenantId, req.body, actorOf(req)) });
}));

router.patch('/:id', requirePermission('attendance.edit'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ data: await attendance.updateVisit(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('attendance.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await attendance.deleteVisit(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

export default router;
