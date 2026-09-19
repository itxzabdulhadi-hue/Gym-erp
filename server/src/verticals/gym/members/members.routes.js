import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MEMBER_STATUSES, GENDERS } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import ApiError from '../../../utils/ApiError.js';
import {
  validateBody,
  validateQuery,
  validateParams,
  idParam,
  requiredText,
  optionalText,
  optionalEmail,
  optionalPhone,
  optionalDate,
  optionalUrl,
  uuid,
} from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as members from './members.service.js';

export const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const listSchema = z.object({
  ...listQueryShape(['name', 'created_at', 'join_date', 'status', 'member_no']),
  status: z
    .union([z.enum(MEMBER_STATUSES), z.array(z.enum(MEMBER_STATUSES)), z.string()])
    .optional()
    .transform((v) => (typeof v === 'string' && v.includes(',') ? v.split(',').filter(Boolean) : v)),
  gender: z.enum(GENDERS).optional(),
  trainerId: uuid.optional(),
  planId: uuid.optional(),
  joinedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  joinedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

const memberBody = z.object({
  memberNo: z.string().trim().max(20).optional(),
  firstName: requiredText(80),
  lastName: requiredText(80),
  dob: optionalDate,
  gender: z.enum(GENDERS).optional(),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(250),
  city: optionalText(80),
  emergencyContact: optionalText(120),
  emergencyPhone: optionalPhone,
  photoUrl: optionalUrl,
  joinDate: optionalDate,
  trainerId: z.union([uuid, z.null()]).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  bloodGroup: optionalText(10),
  occupation: optionalText(80),
  notes: optionalText(2000),
  customFields: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
});

const updateSchema = memberBody.partial();

const bulkSchema = z.object({ ids: z.array(uuid).min(1).max(200), status: z.enum(MEMBER_STATUSES) });

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('members'));

router.get('/', requirePermission('members.view'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await members.listMembers(req.tenantId, req.validatedQuery));
}));

router.get('/import-template', requirePermission('members.import'), (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="members-import-template.csv"');
  res.send(members.importTemplateCsv());
});

router.get('/export', requirePermission('members.export'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  const csv = await members.exportMembersCsv(req.tenantId, req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
  res.send(csv);
}));

router.post('/import', requirePermission('members.import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Upload a CSV file in the "file" field');
  const result = await members.importMembers(req.tenantId, req.file.buffer.toString('utf8'), actorOf(req));
  res.status(result.imported ? 201 : 422).json({ data: result });
}));

router.post('/bulk-status', requirePermission('members.edit'), validateBody(bulkSchema), asyncHandler(async (req, res) => {
  res.json(await members.bulkUpdateStatus(req.tenantId, req.body.ids, req.body.status, actorOf(req)));
}));

router.post('/', requirePermission('members.create'), validateBody(memberBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await members.createMember(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requirePermission('members.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await members.getMember(req.tenantId, req.validatedParams.id) });
}));

router.patch('/:id', requirePermission('members.edit'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ data: await members.updateMember(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requirePermission('members.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await members.deleteMember(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

router.get('/:id/memberships', requirePermission('memberships.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await members.memberMemberships(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/payments', requirePermission('payments.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await members.memberPayments(req.tenantId, req.validatedParams.id, req.query.limit) });
}));

router.get('/:id/attendance', requirePermission('attendance.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({
    data: await members.memberAttendance(req.tenantId, req.validatedParams.id, {
      limit: req.query.limit,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}));

router.get('/:id/progress', requirePermission('progress.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await members.memberProgress(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/workouts', requirePermission('workouts.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await members.memberWorkouts(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/documents', requirePermission('members.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await members.memberDocuments(req.tenantId, req.validatedParams.id) });
}));

router.post('/:id/documents', requirePermission('members.edit'), validateParams(idParam), validateBody(z.object({ fileId: uuid, label: optionalText(120) })), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await members.attachDocument(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

export default router;
