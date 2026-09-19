import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody, optionalText, optionalUrl, optionalPhone, email } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';
import { getBranding, updateBranding } from './branding.service.js';

export const router = Router();

const updateSchema = z.object({
  businessName: z.string().trim().min(1).max(120).optional(),
  shortName: z.string().trim().max(20).optional(),
  appName: z.string().trim().max(60).optional(),
  browserTitle: z.string().trim().max(80).optional(),
  description: optionalText(500),
  tagline: optionalText(160),
  email: z.union([email, z.literal('')]).optional(),
  phone: optionalPhone,
  address: optionalText(250),
  city: optionalText(80),
  country: optionalText(80),
  website: optionalText(200),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  currencySymbol: z.string().trim().max(4).optional(),
  timezone: z.string().trim().max(60).optional(),
  locale: z.string().trim().max(10).optional(),
  logoUrl: optionalUrl,
  logoLightUrl: optionalUrl,
  logoDarkUrl: optionalUrl,
  faviconUrl: optionalUrl,
  loginLogoUrl: optionalUrl,
  loginBackgroundUrl: optionalUrl,
  appIconUrl: optionalUrl,
  splashUrl: optionalUrl,
  themeColor: z.string().trim().max(20).optional(),
  backgroundColor: z.string().trim().max(20).optional(),
  socialLinks: z.record(z.union([z.string().max(300), z.null()])).optional(),
  terminology: z.record(z.string().max(40)).optional(),
});

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: await getBranding(req.tenantId) });
}));

router.patch('/', requireAuth, requirePermission('branding.manage'), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const data = await updateBranding(req.tenantId, req.body, {
    userId: req.userId,
    userLabel: req.ctx.user.fullName,
  });
  res.json({ data });
}));

export default router;
