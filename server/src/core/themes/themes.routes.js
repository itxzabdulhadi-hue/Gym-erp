import { Router } from 'express';
import { z } from 'zod';
import { THEME_PRESETS, MAX_CUSTOM_CSS_LENGTH } from '@erp/shared';
import { asyncHandler } from '../../utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import { validateBody, validateParams, idParam, booleanish } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';
import * as themes from './themes.service.js';

export const router = Router();

const themeConfigSchema = z.object({
  colors: z.record(z.string().max(64)).optional(),
  appearance: z.record(z.union([z.string().max(30), z.number(), z.boolean()])).optional(),
  typography: z.record(z.union([z.string().max(300), z.number()])).optional(),
  layout: z.record(z.union([z.string().max(30), z.number(), z.boolean()])).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  config: themeConfigSchema,
  customCss: z.string().max(MAX_CUSTOM_CSS_LENGTH).optional(),
  activate: booleanish.default(false),
});

const updateSchema = createSchema.partial();

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

router.get('/presets', requireAuth, (_req, res) => {
  res.json({ data: THEME_PRESETS.map((p) => ({ name: p.name, description: p.description, config: p.config })) });
});

router.get('/', requireAuth, requirePermission('theme.view'), asyncHandler(async (req, res) => {
  res.json({ data: await themes.listThemes(req.tenantId) });
}));

router.get('/active', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: await themes.getActiveTheme(req.tenantId) });
}));

router.post('/', requireAuth, requirePermission('theme.manage'), validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await themes.createTheme(req.tenantId, req.body, actorOf(req)) });
}));

router.post('/import', requireAuth, requirePermission('theme.manage'), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await themes.importTheme(req.tenantId, req.body, actorOf(req)) });
}));

router.get('/:id', requireAuth, requirePermission('theme.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await themes.getTheme(req.tenantId, req.validatedParams.id) });
}));

router.get('/:id/export', requireAuth, requirePermission('theme.view'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await themes.exportTheme(req.tenantId, req.validatedParams.id));
}));

router.post('/:id/duplicate', requireAuth, requirePermission('theme.manage'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await themes.duplicateTheme(req.tenantId, req.validatedParams.id, req.body || {}, actorOf(req)),
  });
}));

router.post('/:id/activate', requireAuth, requirePermission('theme.manage'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json({ data: await themes.activateTheme(req.tenantId, req.validatedParams.id, actorOf(req)) });
}));

router.patch('/:id', requireAuth, requirePermission('theme.manage'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  res.json({ data: await themes.updateTheme(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
}));

router.delete('/:id', requireAuth, requirePermission('theme.manage'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await themes.deleteTheme(req.tenantId, req.validatedParams.id, actorOf(req)));
}));

/** POST /api/themes/validate-css - used by the Custom CSS editor. */
router.post('/validate-css', requireAuth, requirePermission('theme.manage'), asyncHandler(async (req, res) => {
  const css = typeof req.body?.css === 'string' ? req.body.css : '';
  if (css.length > MAX_CUSTOM_CSS_LENGTH) throw ApiError.badRequest(`Custom CSS is limited to ${MAX_CUSTOM_CSS_LENGTH} characters`);
  res.json(themes.previewCustomCss(css));
}));

export default router;
