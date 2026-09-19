import { Router } from 'express';
import { withTenant } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireModule } from '../../middleware/guards.js';
import { validateSection } from './settings.validation.js';
import { updateTenantSettings, getBranding } from '../tenants/tenants.service.js';
import { listModules } from '../modules/modules.service.js';
import { listChannels } from '../notifications/notification.service.js';
import { runMembershipMaintenance } from '../notifications/maintenance.service.js';
import { logAudit } from '../audit/audit.service.js';
import { query } from '../../db/index.js';

export const router = Router();

router.use(requireAuth, requireModule('settings'));

/** GET /api/settings - everything the settings area renders, in one call. */
router.get('/', requirePermission('settings.view'), asyncHandler(async (req, res) => {
  const [branding, modules] = await Promise.all([getBranding(req.tenantId), listModules(req.tenantId)]);
  res.json({
    data: {
      general: req.ctx.tenant.settings?.general || {},
      memberships: req.ctx.tenant.settings?.memberships || {},
      attendance: req.ctx.tenant.settings?.attendance || {},
      payments: req.ctx.tenant.settings?.payments || {},
      security: req.ctx.tenant.settings?.security || {},
      notifications: req.ctx.tenant.settings?.notifications || {},
      data: req.ctx.tenant.settings?.data || {},
      branding,
      modules,
      channels: listChannels(),
      tenant: { id: req.ctx.tenant.id, slug: req.ctx.tenant.slug, vertical: req.ctx.tenant.vertical, plan: req.ctx.tenant.plan },
    },
  });
}));

router.get('/:section', requirePermission('settings.view'), asyncHandler(async (req, res) => {
  const section = req.params.section;
  const settings = req.ctx.tenant.settings || {};
  if (!(section in settings) && !validateSection(section, {})) throw ApiError.notFound('Unknown settings section');
  res.json({ data: settings[section] || {} });
}));

router.patch('/:section', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const section = req.params.section;
  const validated = validateSection(section, req.body || {});
  if (!validated) throw ApiError.badRequest(`Unknown settings section "${section}"`);
  if (validated.__error) throw ApiError.validation(Object.fromEntries(validated.__error.map((i) => [i.path.join('.') || '_', i.message])));

  const settings = await updateTenantSettings(req.tenantId, section, validated);
  await logAudit(query, {
    tenantId: req.tenantId,
    userId: req.userId,
    userLabel: req.ctx.user.fullName,
    action: 'settings.updated',
    entity: 'settings',
    entityId: section,
    metadata: { section, changedKeys: Object.keys(validated) },
  });
  res.json({ data: settings[section] });
}));

/** POST /api/settings/maintenance - run the membership/expiry jobs now. */
router.post('/maintenance', requirePermission('settings.manage'), asyncHandler(async (req, res) => {
  const result = await runMembershipMaintenance(req.tenantId);
  res.json({ data: result });
}));

/** GET /api/settings/export - full tenant data export (JSON). */
router.get('/export/data', requirePermission('data.manage'), asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const tables = {
    members: 'SELECT * FROM members WHERE tenant_id = $1',
    membershipPlans: 'SELECT * FROM membership_plans WHERE tenant_id = $1',
    memberships: 'SELECT * FROM memberships WHERE tenant_id = $1',
    attendance: 'SELECT * FROM attendance WHERE tenant_id = $1',
    payments: 'SELECT * FROM payments WHERE tenant_id = $1',
    expenses: 'SELECT * FROM expenses WHERE tenant_id = $1',
    trainers: 'SELECT * FROM trainers WHERE tenant_id = $1',
    exercises: 'SELECT * FROM exercises WHERE tenant_id = $1',
    workoutPlans: 'SELECT * FROM workout_plans WHERE tenant_id = $1',
    progressRecords: 'SELECT * FROM progress_records WHERE tenant_id = $1',
    users: 'SELECT id, email, full_name, status, created_at FROM users WHERE tenant_id = $1',
    roles: 'SELECT id, key, name FROM roles WHERE tenant_id = $1',
  };

  const payload = await withTenant(tenantId, async (client) => {
    const out = { exportedAt: new Date().toISOString(), tenantId, format: 'erp-export', version: 1 };
    for (const [key, sql] of Object.entries(tables)) {
      const res = await client.query(sql, [tenantId]);
      out[key] = res.rows;
    }
    return out;
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="export-${req.ctx.tenant.slug}.json"`);
  res.send(JSON.stringify(payload, null, 2));
}));

export default router;
