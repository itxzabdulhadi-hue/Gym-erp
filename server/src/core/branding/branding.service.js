import { withTenant, query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { logAudit } from '../audit/audit.service.js';
import { invalidateAuthCache } from '../auth/authContext.js';

/**
 * White-label branding.
 *
 * Nothing in the UI is allowed to hardcode a product name, logo or colour: every
 * visible identity detail comes from this row. The same payload drives the
 * login page, the app shell, the PWA manifest, the favicon and the document
 * title.
 */

const COLUMNS = {
  businessName: 'business_name',
  shortName: 'short_name',
  appName: 'app_name',
  browserTitle: 'browser_title',
  description: 'description',
  tagline: 'tagline',
  email: 'email',
  phone: 'phone',
  address: 'address',
  city: 'city',
  country: 'country',
  website: 'website',
  currency: 'currency',
  currencySymbol: 'currency_symbol',
  timezone: 'timezone',
  locale: 'locale',
  logoUrl: 'logo_url',
  logoLightUrl: 'logo_light_url',
  logoDarkUrl: 'logo_dark_url',
  faviconUrl: 'favicon_url',
  loginLogoUrl: 'login_logo_url',
  loginBackgroundUrl: 'login_background_url',
  appIconUrl: 'app_icon_url',
  splashUrl: 'splash_url',
  themeColor: 'theme_color',
  backgroundColor: 'background_color',
};

const JSON_COLUMNS = { socialLinks: 'social_links', terminology: 'terminology' };

export function shapeBranding(row, tenant) {
  if (!row) return null;
  return {
    businessName: row.business_name,
    shortName: row.short_name,
    appName: row.app_name,
    browserTitle: row.browser_title,
    description: row.description,
    tagline: row.tagline,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    country: row.country,
    website: row.website,
    socialLinks: row.social_links || {},
    currency: row.currency,
    currencySymbol: row.currency_symbol,
    timezone: row.timezone,
    locale: row.locale,
    logoUrl: row.logo_url,
    logoLightUrl: row.logo_light_url,
    logoDarkUrl: row.logo_dark_url,
    faviconUrl: row.favicon_url,
    loginLogoUrl: row.login_logo_url,
    loginBackgroundUrl: row.login_background_url,
    appIconUrl: row.app_icon_url,
    splashUrl: row.splash_url,
    themeColor: row.theme_color,
    backgroundColor: row.background_color,
    terminology: row.terminology || {},
    updatedAt: row.updated_at,
    tenant: tenant
      ? { id: tenant.id, slug: tenant.slug, name: tenant.name, vertical: tenant.vertical }
      : undefined,
  };
}

export async function getBranding(tenantId) {
  const [branding, tenant] = await Promise.all([
    query('SELECT * FROM branding WHERE tenant_id = $1', [tenantId]),
    query('SELECT id, slug, name, vertical FROM tenants WHERE id = $1', [tenantId]),
  ]);
  return shapeBranding(branding.rows[0], tenant.rows[0]);
}

export async function updateBranding(tenantId, patch, actor) {
  const sets = [];
  const params = [tenantId];

  for (const [key, column] of Object.entries(COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key] === '' ? null : patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  for (const [key, column] of Object.entries(JSON_COLUMNS)) {
    if (patch[key] === undefined) continue;
    params.push(JSON.stringify(patch[key] ?? {}));
    sets.push(`${column} = $${params.length}::jsonb`);
  }

  if (!sets.length) throw ApiError.badRequest('Nothing to update');

  const before = await query('SELECT * FROM branding WHERE tenant_id = $1', [tenantId]);

  const res = await query(
    `UPDATE branding SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`,
    params,
  );
  if (!res.rows[0]) throw ApiError.notFound('Branding not found for this business');

  const changed = sets
    .map((s) => s.split(' =')[0])
    .filter((column) => {
      const key = Object.keys(COLUMNS).find((k) => COLUMNS[k] === column);
      return key ? before.rows[0]?.[column] !== patch[key] : true;
    });

  await logAudit(query, {
    tenantId,
    userId: actor?.userId,
    userLabel: actor?.userLabel,
    action: 'branding.updated',
    entity: 'branding',
    entityId: tenantId,
    metadata: { changed },
  });

  invalidateAuthCache({ tenantId });
  return shapeBranding(res.rows[0]);
}

/**
 * Public (unauthenticated) branding for the login screen, resolved by business
 * code or custom domain. Returns only what a visitor is meant to see.
 */
export async function getLoginBranding({ slug, domain }) {
  const tenant = slug
    ? (await query('SELECT * FROM tenants WHERE slug = $1', [String(slug).toLowerCase()])).rows[0]
    : domain
      ? (await query('SELECT * FROM tenants WHERE domain = $1', [String(domain).toLowerCase()])).rows[0]
      : null;

  if (!tenant) return null;

  const [branding, theme] = await Promise.all([
    query('SELECT * FROM branding WHERE tenant_id = $1', [tenant.id]),
    query('SELECT id, name, config, custom_css FROM themes WHERE tenant_id = $1 AND is_active LIMIT 1', [tenant.id]),
  ]);

  const b = shapeBranding(branding.rows[0], tenant);
  return {
    found: true,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, vertical: tenant.vertical, status: tenant.status },
    branding: b,
    theme: theme.rows[0] || null,
  };
}

/** Used by the PWA manifest generator. */
export async function getManifestBranding(tenantId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query('SELECT * FROM branding WHERE tenant_id = $1', [tenantId]);
    return shapeBranding(res.rows[0]);
  });
}
