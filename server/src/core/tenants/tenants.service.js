import { MODULES, SYSTEM_ROLES, ALL_PERMISSION_KEYS, DEFAULT_THEME, sanitizeTheme, getVertical, normalizePermissions } from '@erp/shared';
import bcrypt from 'bcryptjs';
import { tx, withTenant, query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { slugify } from '../../utils/ids.js';
import logger from '../../utils/logger.js';
import { shapeBranding } from '../branding/branding.shape.js';
import { shapeTheme } from '../themes/theme.shape.js';

export const BCRYPT_ROUNDS = 11;

/** Default settings every new business starts with. */
export const DEFAULT_TENANT_SETTINGS = {
  general: { fiscalYearStartMonth: 1, weekStartsOn: 'monday' },
  memberships: { graceDays: 3, autoExpire: true, allowFreeze: true, maxFreezeDaysPerYear: 60, expiryWarningDays: 7 },
  attendance: { allowMultipleCheckinsPerDay: true, autoCheckoutHours: 12, requireCheckout: false },
  payments: { invoicePrefix: 'INV', taxRate: 0, currency: 'USD', allowPartialPayments: true, lowBalanceThreshold: 0 },
  security: { passwordMinLength: 8, sessionTimeoutMinutes: 60, requireStrongPassword: true },
  notifications: {
    channels: { in_app: true, email: false, sms: false, whatsapp: false, push: false },
    events: {
      membership_expiring: { in_app: true },
      membership_expired: { in_app: true },
      payment_reminder: { in_app: true },
      payment_received: { in_app: true },
      birthday: { in_app: true },
    },
  },
  data: { retentionMonths: 0 },
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getTenantBySlug(slug) {
  const res = await query('SELECT * FROM tenants WHERE slug = $1', [slug]);
  return res.rows[0] || null;
}

export async function getTenantByDomain(domain) {
  const res = await query('SELECT * FROM tenants WHERE domain = $1', [String(domain).toLowerCase()]);
  return res.rows[0] || null;
}

export async function getTenantById(id) {
  const res = await query('SELECT * FROM tenants WHERE id = $1', [id]);
  return res.rows[0] || null;
}

export async function slugAvailable(slug) {
  const res = await query('SELECT 1 FROM tenants WHERE slug = $1', [slug]);
  return res.rowCount === 0;
}

export async function listTenants({ search, status } = {}) {
  const params = [];
  const where = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR slug ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const res = await query(
    `SELECT id, slug, name, short_name, vertical, status, plan, created_at, onboarded_at,
            (SELECT count(*)::int FROM users u WHERE u.tenant_id = tenants.id) AS user_count,
            (SELECT count(*)::int FROM members m WHERE m.tenant_id = tenants.id) AS member_count
     FROM tenants
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC`,
    params,
  );
  return res.rows;
}

export async function getBranding(tenantId) {
  const res = await query('SELECT * FROM branding WHERE tenant_id = $1', [tenantId]);
  // Shape it: /api/auth/me spreads the workspace into its response, and the
  // rest of the API answers camelCase. Returning the raw row here made that
  // one endpoint leak snake_case column names to the client.
  return shapeBranding(res.rows[0] || null);
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Create a fully usable tenant: branding row, system roles with permissions,
 * module rows, a default theme and default settings. Idempotent per slug.
 */
export async function provisionTenant({ name, slug, vertical = 'gym', domain = null, createdBy = null }) {
  const finalSlug = slug || slugify(name);
  if (!finalSlug) throw ApiError.badRequest('A business name or slug is required');
  if (!(await slugAvailable(finalSlug))) throw ApiError.conflict(`The code "${finalSlug}" is already taken`);

  const verticalDef = getVertical(vertical);
  if (!verticalDef) throw ApiError.badRequest(`Unknown vertical "${vertical}"`);

  return tx(async (client) => {
    const tenant = await client.query(
      `INSERT INTO tenants (slug, name, vertical, status, settings)
       VALUES ($1, $2, $3, 'trial', $4)
       RETURNING *`,
      [finalSlug, name, vertical, JSON.stringify(DEFAULT_TENANT_SETTINGS)],
    );
    const tenantRow = tenant.rows[0];

    await client.query(
      `INSERT INTO branding (tenant_id, business_name, short_name, app_name, browser_title, currency, currency_symbol, terminology)
       VALUES ($1, $2, $3, $4, $5, 'USD', '$', $6)`,
      [
        tenantRow.id,
        name,
        shortNameFor(name),
        shortNameFor(name),
        shortNameFor(name),
        JSON.stringify(verticalDef.terminology),
      ],
    );

    await seedRoles(client, tenantRow.id);
    await seedModules(client, tenantRow.id, { vertical, enabledKeys: verticalDef.defaultModules });
    await seedTheme(client, tenantRow.id, { name: 'Default', config: DEFAULT_THEME, createdBy });

    logger.info('tenants', `provisioned tenant ${finalSlug}`);
    return tenantRow;
  });
}

export async function seedRoles(client, tenantId) {
  for (const role of SYSTEM_ROLES) {
    const inserted = await client.query(
      `INSERT INTO roles (tenant_id, key, name, description, is_system)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tenantId, role.key, role.name, role.description],
    );
    const roleId = inserted.rows[0].id;
    const keys = role.permissions.includes('*') ? ALL_PERMISSION_KEYS : normalizePermissions(role.permissions);
    for (const key of keys) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [roleId, key],
      );
    }
  }
}

export async function seedModules(client, tenantId, { vertical, enabledKeys }) {
  const enabled = new Set(enabledKeys || []);
  for (const mod of MODULES) {
    const shouldBeOn = enabled.size ? enabled.has(mod.key) : mod.defaultEnabled;
    await client.query(
      `INSERT INTO modules (tenant_id, key, enabled, sort_order, settings)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, key) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [tenantId, mod.key, Boolean(shouldBeOn), mod.order, JSON.stringify({ vertical: mod.group === 'gym' ? vertical : mod.group })],
    );
  }
}

export async function seedTheme(client, tenantId, { name, config, description = '', createdBy = null, customCss = '' }) {
  const sanitized = sanitizeTheme(config);
  return client.query(
    `INSERT INTO themes (tenant_id, name, description, config, custom_css, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, NOT EXISTS (SELECT 1 FROM themes WHERE tenant_id = $1 AND is_active), $6)
     RETURNING *`,
    [tenantId, name, description, JSON.stringify(sanitized), customCss, createdBy],
  );
}

function shortNameFor(name) {
  const words = String(name).trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 24);
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Owner account
// ---------------------------------------------------------------------------

/** Create the first (owner) account for a tenant and return the user row. */
export async function createOwnerUser(tenantId, { email, fullName, password, phone = null }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return tx(async (client) => {
    const inserted = await client.query(
      `INSERT INTO users (tenant_id, email, full_name, phone, password_hash, status)
       VALUES ($1, lower($2), $3, $4, $5, 'active')
       RETURNING id, email, full_name, phone, avatar_url, status, created_at`,
      [tenantId, email, fullName, phone, passwordHash],
    );
    const user = inserted.rows[0];
    const role = await client.query(`SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'`, [tenantId]);
    if (role.rows[0]) {
      await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        user.id,
        role.rows[0].id,
      ]);
    }
    await client.query(`UPDATE tenants SET onboarded_at = now() WHERE id = $1 AND onboarded_at IS NULL`, [tenantId]);
    return user;
  });
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export async function updateTenant(tenantId, patch) {
  const fields = [];
  const params = [tenantId];
  const allowed = {
    name: 'name',
    shortName: 'short_name',
    vertical: 'vertical',
    status: 'status',
    plan: 'plan',
    domain: 'domain',
  };
  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      fields.push(`${column} = $${params.length}`);
    }
  }
  if (!fields.length) return getTenantById(tenantId);
  const res = await query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
  return res.rows[0];
}

/** Deep-merge one settings namespace (general, payments, security, ...). */
export async function updateTenantSettings(tenantId, namespace, patch) {
  if (!DEFAULT_TENANT_SETTINGS[namespace]) throw ApiError.badRequest(`Unknown settings section "${namespace}"`);
  // `$2` cannot be reused for both the jsonb path (text[]) and the key lookup
  // (text): PostgreSQL fails with "inconsistent types deduced for parameter".
  const res = await query(
    `UPDATE tenants
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              $2::text[],
              COALESCE(settings -> $3::text, '{}'::jsonb) || $4::jsonb
            )
      WHERE id = $1
      RETURNING settings`,
    [tenantId, `{${namespace}}`, namespace, JSON.stringify(patch)],
  );
  return res.rows[0]?.settings || {};
}

export async function getPublicBranding({ slug, domain }) {
  const tenant = slug ? await getTenantBySlug(slug) : domain ? await getTenantByDomain(domain) : null;
  if (!tenant) return null;
  const [branding, theme] = await Promise.all([
    getBranding(tenant.id),
    query('SELECT id, name, config, custom_css FROM themes WHERE tenant_id = $1 AND is_active LIMIT 1', [tenant.id]),
  ]);
  return {
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, vertical: tenant.vertical, status: tenant.status },
    branding,
    theme: theme.rows[0] || null,
  };
}

/** Everything the app shell needs in one round trip after login. */
export async function getTenantWorkspace(tenantId) {
  const [modules, branding, theme, plans] = await Promise.all([
    withTenant(tenantId, (c) => c.query('SELECT key, enabled, sort_order FROM modules WHERE tenant_id = $1 ORDER BY sort_order', [tenantId])),
    getBranding(tenantId),
    query('SELECT id, name, config, custom_css FROM themes WHERE tenant_id = $1 AND is_active LIMIT 1', [tenantId]),
    withTenant(tenantId, (c) =>
      c.query('SELECT count(*)::int AS total FROM membership_plans WHERE tenant_id = $1 AND is_active', [tenantId]),
    ),
  ]);
  return {
    modules: modules.rows,
    branding,
    theme: shapeTheme(theme.rows[0] || null),
    counts: { membershipPlans: plans.rows[0]?.total ?? 0 },
  };
}
