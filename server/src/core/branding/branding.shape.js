/**
 * Branding row -> API shape.
 *
 * Kept free of imports so both the branding service and the tenant workspace
 * can use it without creating a cycle. The API answers in camelCase everywhere;
 * the snake_case database row never leaves the server.
 */
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
