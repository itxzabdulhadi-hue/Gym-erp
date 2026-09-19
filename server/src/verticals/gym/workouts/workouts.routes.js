import { Router } from 'express';
import { z } from 'zod';
import { DIFFICULTY_LEVELS, MUSCLE_GROUPS, EQUIPMENT, WORKOUT_ASSIGNMENT_STATUSES } from '@erp/shared';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  validateBody, validateQuery, validateParams, idParam,
  requiredText, optionalText, optionalUrl, uuid, optionalDate,
} from '../../../utils/validate.js';
import { listQueryShape } from '../../../utils/pagination.js';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission, requireModule } from '../../../middleware/guards.js';
import * as workouts from './workouts.service.js';

export const router = Router();

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.use(requireAuth, requireModule('workouts'));

// ---------------------------------------------------------------- exercises
const exerciseBody = z.object({
  name: requiredText(120),
  muscleGroup: z.enum(MUSCLE_GROUPS).default('full_body'),
  equipment: z.enum(EQUIPMENT).default('none'),
  difficulty: z.enum(DIFFICULTY_LEVELS).default('beginner'),
  instructions: optionalText(2000),
  mediaUrl: optionalUrl,
});

router.get('/exercises', requirePermission('workouts.view'), validateQuery(z.object({
  ...listQueryShape(['name', 'muscle_group', 'created_at']),
  muscleGroup: z.enum(MUSCLE_GROUPS).optional(),
  equipment: z.enum(EQUIPMENT).optional(),
  difficulty: z.enum(DIFFICULTY_LEVELS).optional(),
})), asyncHandler(async (req, res) => {
  res.json(await workouts.listExercises(req.tenantId, req.validatedQuery));
}));

router.post('/exercises', requirePermission('workouts.create'), validateBody(exerciseBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await workouts.createExercise(req.tenantId, req.body, actorOf(req)) });
}));

router.patch('/exercises/:id', requirePermission('workouts.edit'), validateParams(idParam), validateBody(exerciseBody.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await workouts.updateExercise(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/exercises/:id', requirePermission('workouts.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await workouts.deleteExercise(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

// -------------------------------------------------------------------- plans
const planItemSchema = z.object({
  exerciseId: uuid,
  sets: z.coerce.number().int().min(1).max(30).optional(),
  reps: z.string().trim().max(30).optional(),
  weightKg: z.coerce.number().min(0).max(1000).optional(),
  durationSec: z.coerce.number().int().min(1).max(7200).optional(),
  restSec: z.coerce.number().int().min(0).max(3600).optional(),
  notes: optionalText(500),
  sortOrder: z.coerce.number().int().min(0).max(500).optional(),
});

const planBody = z.object({
  name: requiredText(120),
  description: optionalText(2000),
  trainerId: z.union([uuid, z.null()]).optional(),
  level: z.enum(DIFFICULTY_LEVELS).default('beginner'),
  goal: optionalText(120),
  isActive: z.boolean().optional(),
  items: z.array(planItemSchema).max(60).optional(),
});

router.get('/plans', requirePermission('workouts.view'), validateQuery(z.object({
  ...listQueryShape(['name', 'created_at', 'level']),
  level: z.enum(DIFFICULTY_LEVELS).optional(),
  trainerId: uuid.optional(),
  activeOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
})), asyncHandler(async (req, res) => {
  res.json(await workouts.listPlans(req.tenantId, req.validatedQuery));
}));

router.post('/plans', requirePermission('workouts.create'), validateBody(planBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await workouts.createPlan(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/plans/:id', requirePermission('workouts.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await workouts.getPlan(req.tenantId, req.validatedParams.id) });
}));

router.patch('/plans/:id', requirePermission('workouts.edit'), validateParams(idParam), validateBody(planBody.partial()), asyncHandler(async (req, res) => {
  res.json({ data: await workouts.updatePlan(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/plans/:id', requirePermission('workouts.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await workouts.deletePlan(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

// -------------------------------------------------------------- assignments
const assignBody = z.object({
  planId: uuid,
  memberId: uuid,
  trainerId: z.union([uuid, z.null()]).optional(),
  status: z.enum(WORKOUT_ASSIGNMENT_STATUSES).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
});

router.get('/assignments', requirePermission('workouts.view'), validateQuery(z.object({
  ...listQueryShape(['assigned_at', 'status']),
  memberId: uuid.optional(),
  planId: uuid.optional(),
  trainerId: uuid.optional(),
  status: z.enum(WORKOUT_ASSIGNMENT_STATUSES).optional(),
})), asyncHandler(async (req, res) => {
  res.json(await workouts.listAssignments(req.tenantId, req.validatedQuery));
}));

router.post('/assignments', requirePermission('workouts.assign'), validateBody(assignBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await workouts.assignPlan(req.tenantId, req.body, actorOf(req)) });
}));

router.patch('/assignments/:id', requirePermission('workouts.edit'), validateParams(idParam), validateBody(assignBody.partial().omit({ planId: true, memberId: true })), asyncHandler(async (req, res) => {
  res.json({ data: await workouts.updateAssignment(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/assignments/:id', requirePermission('workouts.delete'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await workouts.deleteAssignment(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

// -------------------------------------------------------------------- logs
const logBody = z.object({
  memberId: uuid,
  assignmentId: uuid.optional(),
  loggedAt: z.string().datetime({ offset: true }).optional(),
  entries: z.array(z.object({
    itemId: uuid.optional(),
    exerciseName: z.string().max(120).optional(),
    sets: z.array(z.object({
      reps: z.coerce.number().int().min(0).max(200).optional(),
      weightKg: z.coerce.number().min(0).max(1000).optional(),
      durationSec: z.coerce.number().int().min(0).max(7200).optional(),
    })).max(20).optional(),
    note: z.string().max(300).optional(),
  })).max(60).default([]),
  notes: optionalText(1000),
});

router.get('/logs', requirePermission('workouts.view'), asyncHandler(async (req, res) => {
  res.json({ data: await workouts.listLogs(req.tenantId, { memberId: req.query.memberId, assignmentId: req.query.assignmentId, limit: req.query.limit }) });
}));

router.post('/logs', requirePermission('workouts.assign'), validateBody(logBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await workouts.logSession(req.tenantId, req.body, actorOf(req)) });
}));

export default router;
