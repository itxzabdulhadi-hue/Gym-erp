import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MEMBER_STATUSES, GENDERS } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
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
import { membersController as c } from './members.controller.js';

/**
 * Members - routes.
 *
 * Declares the endpoints, their permission, their module gate and their request
 * schema. Nothing else: `asyncHandler` wraps each controller method so a
 * rejected promise reaches the error handler.
 */

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

router.use(requireAuth, requireModule('members'));

router.get('/', requirePermission('members.view'), validateQuery(listSchema), asyncHandler(c.list));
router.get('/import-template', requirePermission('members.import'), c.importTemplate);
router.get('/export', requirePermission('members.export'), validateQuery(listSchema), asyncHandler(c.export));
router.post('/import', requirePermission('members.import'), upload.single('file'), asyncHandler(c.import));
router.post('/bulk-status', requirePermission('members.edit'), validateBody(bulkSchema), asyncHandler(c.bulkStatus));
router.post('/', requirePermission('members.create'), validateBody(memberBody), asyncHandler(c.create));

router.get('/:id', requirePermission('members.view'), validateParams(idParam), asyncHandler(c.read));
router.patch('/:id', requirePermission('members.edit'), validateParams(idParam), validateBody(updateSchema), asyncHandler(c.update));
router.delete('/:id', requirePermission('members.delete'), validateParams(idParam), asyncHandler(c.remove));

router.get('/:id/memberships', requirePermission('memberships.view'), validateParams(idParam), asyncHandler(c.memberships));
router.get('/:id/payments', requirePermission('payments.view'), validateParams(idParam), asyncHandler(c.payments));
router.get('/:id/attendance', requirePermission('attendance.view'), validateParams(idParam), asyncHandler(c.attendance));
router.get('/:id/progress', requirePermission('progress.view'), validateParams(idParam), asyncHandler(c.progress));
router.get('/:id/workouts', requirePermission('workouts.view'), validateParams(idParam), asyncHandler(c.workouts));
router.get('/:id/documents', requirePermission('members.view'), validateParams(idParam), asyncHandler(c.documents));
router.post('/:id/documents', requirePermission('members.edit'), validateParams(idParam), validateBody(z.object({ fileId: uuid, label: optionalText(120) })), asyncHandler(c.attachDocument));

export default router;
