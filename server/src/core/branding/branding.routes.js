import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody, optionalText, optionalUrl, optionalPhone, email, plainText } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';
import { getBranding, updateBranding } from './branding.service.js';

export const router = Router();

const updateSchema = z.object({
  businessName: plainText(120, { required: true }).optional(),
  shortName: plainText(20).optional(),
  appName: plainText(60).optional(),
  browserTitle: plainText(80).optional(),
  description: plainText(500).optional(),
  tagline: plainText(160).optional(),
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

router.get('/', requireAuth, requirePermission('branding.view'), asyncHandler(async (req, res) => {
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
