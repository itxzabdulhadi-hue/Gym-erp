import { Router } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { z } from 'zod';
import { THEME_PRESETS, sanitizeTheme, sanitizeCss, MODULES, getVertical } from '@erp/shared';
import config from '../../config/env.js';
import { query, tx } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateBody, validateQuery } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';
import {
  onboardingStartSchema,
  onboardingBrandingSchema,
  onboardingThemeSchema,
  onboardingModulesSchema,
  onboardingOwnerSchema,
} from '../auth/auth.validation.js';
import {
  provisionTenant,
  createOwnerUser,
  getTenantById,
  getBranding,
  listTenants,
  updateTenant,
  seedModules,
  seedTheme,
} from './tenants.service.js';
import { updateBranding } from '../branding/branding.service.js';
import { updateTheme, listThemes, getActiveTheme, ensurePresetThemes } from '../themes/themes.service.js';
import { listModules, setModules } from '../modules/modules.service.js';
import { uploadFile } from '../files/files.service.js';
import { login } from '../auth/auth.service.js';
import { cookieOptions, REFRESH_COOKIE, ACCESS_COOKIE } from '../../middleware/auth.js';
import { logAudit } from '../audit/audit.service.js';
import { runMembershipMaintenance } from '../notifications/maintenance.service.js';
import { dispatchNotification } from '../notifications/notification.service.js';

export const router = Router();
export const publicRouter = Router();

const ONBOARDING_TTL = '2h';

function signOnboardingToken(tenantId) {
  return jwt.sign({ kind: 'onboarding', tid: tenantId }, config.JWT_ACCESS_SECRET, { expiresIn: ONBOARDING_TTL });
}

/** Guards the wizard: an onboarding token can only touch its own tenant. */
async function requireOnboarding(req, _res, next) {
  const token = req.headers['x-onboarding-token'] || req.body?.onboardingToken || req.query?.token;
  if (!token) return next(ApiError.unauthorized('Onboarding session required'));
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (payload.kind !== 'onboarding') throw new Error('wrong token kind');
    const tenant = await getTenantById(payload.tid);
    if (!tenant) throw new Error('tenant missing');
    req.onboarding = { tenantId: tenant.id, tenant };
    return next();
  } catch {
    return next(ApiError.unauthorized('This setup session has expired - start the setup again'));
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** GET /api/public/branding?slug=… - unauthenticated branding for the login page. */
publicRouter.get(
  '/branding',
  validateQuery(z.object({ slug: z.string().trim().min(1).max(60).optional(), domain: z.string().trim().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const { getLoginBranding } = await import('../branding/branding.service.js');
    const result = await getLoginBranding({
      slug: req.validatedQuery.slug,
      domain: req.validatedQuery.domain || req.hostname,
    });
    if (!result) return res.json({ data: null });
    res.json({ data: result });
  }),
);

/** GET /api/public/verticals - what products this deployment offers. */
publicRouter.get('/verticals', (_req, res) => {
  res.json({ data: [getVertical('gym')].filter(Boolean) });
});

// ---------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------

/** POST /api/onboarding/start - step 1: create the business shell. */
router.post('/onboarding/start', validateBody(onboardingStartSchema), asyncHandler(async (req, res) => {
  const { businessName, slug, vertical, timezone, currency } = req.body;
  const tenant = await provisionTenant({ name: businessName, slug, vertical });

  await updateBranding(tenant.id, {
    businessName,
    ...(timezone ? { timezone } : {}),
    ...(currency ? { currency, currencySymbol: currencySymbol(currency) } : {}),
  });

  await ensurePresetThemes(tenant.id, ['Default']);

  res.status(201).json({
    data: {
      onboardingToken: signOnboardingToken(tenant.id),
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, vertical: tenant.vertical },
    },
  });
}));

/** GET /api/onboarding/state - where the wizard is up to. */
router.get('/onboarding/state', requireOnboarding, asyncHandler(async (req, res) => {
  const tenantId = req.onboarding.tenantId;
  const [branding, themes, modules, owner] = await Promise.all([
    getBranding(tenantId),
    listThemes(tenantId),
    listModules(tenantId),
    query('SELECT count(*)::int AS c FROM users WHERE tenant_id = $1', [tenantId]),
  ]);

  res.json({
    data: {
      tenant: { id: req.onboarding.tenant.id, slug: req.onboarding.tenant.slug, name: req.onboarding.tenant.name },
      steps: {
        business: true,
        branding: Boolean(branding?.logoUrl || branding?.businessName),
        theme: Boolean(themes.length),
        modules: modules.some((m) => m.group === 'gym' && m.enabled),
        owner: owner.rows[0].c > 0,
      },
      branding,
      themes,
      modules,
    },
  });
}));

/** PATCH /api/onboarding/branding - step 1/2 details. */
router.patch('/onboarding/branding', requireOnboarding, validateBody(onboardingBrandingSchema), asyncHandler(async (req, res) => {
  const data = await updateBranding(req.onboarding.tenantId, req.body);
  res.json({ data });
}));

/** POST /api/onboarding/logo - step 2: upload logo / favicon / icons. */
router.post('/onboarding/logo', requireOnboarding, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded (use the "file" field)');
  const slot = String(req.body.slot || 'logo');
  const allowed = ['logo', 'logo_light', 'logo_dark', 'favicon', 'login_logo', 'login_background', 'app_icon', 'splash'];
  if (!allowed.includes(slot)) throw ApiError.badRequest(`Unknown branding slot "${slot}"`);

  const file = await uploadFile(req.onboarding.tenantId, {
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    purpose: slot,
  });

  const fieldMap = {
    logo: 'logoUrl',
    logo_light: 'logoLightUrl',
    logo_dark: 'logoDarkUrl',
    favicon: 'faviconUrl',
    login_logo: 'loginLogoUrl',
    login_background: 'loginBackgroundUrl',
    app_icon: 'appIconUrl',
    splash: 'splashUrl',
  };

  const patch = { [fieldMap[slot]]: file.url };
  if (slot === 'app_icon') patch.themeColor = undefined;

  const branding = await updateBranding(req.onboarding.tenantId, patch);
  res.status(201).json({ data: { file, branding } });
}));

/** PUT /api/onboarding/theme - step 3: pick a preset or bring a config. */
router.put('/onboarding/theme', requireOnboarding, validateBody(onboardingThemeSchema), asyncHandler(async (req, res) => {
  const tenantId = req.onboarding.tenantId;
  const preset = THEME_PRESETS.find((p) => p.name === req.body.name);
  const configIn = preset ? preset.config : req.body.config;

  const existing = await listThemes(tenantId);
  const match = existing.find((t) => t.name === req.body.name);

  const theme = match
    ? await updateTheme(tenantId, match.id, { config: sanitizeTheme(configIn), customCss: sanitizeCss(req.body.customCss || ''), activate: true })
    : await seedTheme(query, tenantId, { name: req.body.name, config: configIn, customCss: sanitizeCss(req.body.customCss || '') });

  if (!match) await activateOnly(tenantId, theme.rows?.[0]?.id);
  res.json({ data: await getActiveTheme(tenantId) });
}));

/** PUT /api/onboarding/modules - step 4. */
router.put('/onboarding/modules', requireOnboarding, validateBody(onboardingModulesSchema), asyncHandler(async (req, res) => {
  const unknown = req.body.enabled.filter((k) => !MODULES.some((m) => m.key === k));
  if (unknown.length) throw ApiError.badRequest(`Unknown module(s): ${unknown.join(', ')}`);
  await setModules(req.onboarding.tenantId, req.body.enabled, { userLabel: 'Setup wizard' });
  res.json({ data: await listModules(req.onboarding.tenantId) });
}));

/** POST /api/onboarding/owner - step 5: create the owner and sign in. */
router.post('/onboarding/owner', requireOnboarding, validateBody(onboardingOwnerSchema), asyncHandler(async (req, res) => {
  const tenantId = req.onboarding.tenantId;
  const existing = await query('SELECT count(*)::int AS c FROM users WHERE tenant_id = $1', [tenantId]);
  if (existing.rows[0].c > 0) throw ApiError.conflict('An owner account already exists for this business');

  await createOwnerUser(tenantId, req.body);

  await dispatchNotification({
    tenantId,
    type: 'system',
    title: `Welcome to ${req.onboarding.tenant.name}`,
    body: 'Your business is set up. Add your first members, plans and staff from the dashboard.',
    level: 'success',
    channels: ['in_app'],
  });

  const session = await login({
    email: req.body.email,
    password: req.body.password,
    tenantSlug: req.onboarding.tenant.slug,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(30 * 86_400_000));
  res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(15 * 60_000));
  res.status(201).json({ data: session });
}));

// ---------------------------------------------------------------------------
// Authenticated tenant endpoints
// ---------------------------------------------------------------------------

router.get('/current', requireAuth, asyncHandler(async (req, res) => {
  const [tenant, branding, modules] = await Promise.all([
    getTenantById(req.tenantId),
    getBranding(req.tenantId),
    listModules(req.tenantId),
  ]);
  res.json({ data: { tenant, branding, modules } });
}));

router.patch('/current', requireAuth, requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const allowed = ['name', 'shortName', 'domain', 'plan'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (patch.domain) patch.domain = String(patch.domain).toLowerCase();
  const tenant = await updateTenant(req.tenantId, patch);
  await logAudit(query, {
    tenantId: req.tenantId,
    userId: req.userId,
    userLabel: req.ctx.user.fullName,
    action: 'tenant.updated',
    entity: 'tenant',
    entityId: req.tenantId,
    metadata: { changedKeys: Object.keys(patch) },
  });
  res.json({ data: tenant });
}));

/** Platform administration (cross-tenant). */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  if (!req.ctx.user.isPlatformAdmin) throw ApiError.forbidden('Platform administrator access required');
  res.json({ data: await listTenants({ search: req.query.search, status: req.query.status }) });
}));

/** POST /api/tenants - platform admin creates a business. */
router.post('/', requireAuth, validateBody(onboardingStartSchema), asyncHandler(async (req, res) => {
  if (!req.ctx.user.isPlatformAdmin) throw ApiError.forbidden('Platform administrator access required');
  const tenant = await provisionTenant(req.body);
  await ensurePresetThemes(tenant.id, ['Default']);
  res.status(201).json({ data: tenant });
}));

/** POST /api/tenants/:id/maintenance - run jobs for one tenant. */
router.post('/:id/maintenance', requireAuth, requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  if (req.params.id !== req.tenantId && !req.ctx.user.isPlatformAdmin) throw ApiError.forbidden();
  res.json({ data: await runMembershipMaintenance(req.params.id) });
}));

async function activateOnly(tenantId, themeId) {
  if (!themeId) return;
  await query('UPDATE themes SET is_active = (id = $2) WHERE tenant_id = $1', [tenantId, themeId]);
}

function currencySymbol(currency) {
  const map = { USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SAR: '﷼', INR: '₹', PKR: '₨', BDT: '৳', EGP: 'E£', TRY: '₺', AUD: 'A$', CAD: 'C$' };
  return map[String(currency).toUpperCase()] || String(currency).toUpperCase();
}

export { seedModules };
export default router;
