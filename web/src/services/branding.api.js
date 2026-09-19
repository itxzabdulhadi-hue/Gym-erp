import { http } from '@/lib/apiClient';

/**
 * Tenant branding, including the public lookup used by the login screen before
 * anybody is authenticated.
 */

const SOCIAL_PLATFORMS = ['x', 'instagram', 'facebook', 'linkedin', 'youtube', 'tiktok'];

/** Normalises whatever the API returned into a predictable object. */
export function normalizeBranding(input) {
  const b = input || {};
  return {
    businessName: b.businessName || '',
    shortName: b.shortName || '',
    appName: b.appName || '',
    browserTitle: b.browserTitle || '',
    description: b.description || '',
    tagline: b.tagline || '',
    email: b.email || '',
    phone: b.phone || '',
    address: b.address || '',
    city: b.city || '',
    country: b.country || '',
    website: b.website || '',
    socialLinks: b.socialLinks || {},
    currency: b.currency || 'USD',
    currencySymbol: b.currencySymbol || '$',
    timezone: b.timezone || 'UTC',
    locale: b.locale || 'en',
    logoUrl: b.logoUrl || null,
    logoLightUrl: b.logoLightUrl || null,
    logoDarkUrl: b.logoDarkUrl || null,
    faviconUrl: b.faviconUrl || null,
    loginLogoUrl: b.loginLogoUrl || null,
    loginBackgroundUrl: b.loginBackgroundUrl || null,
    appIconUrl: b.appIconUrl || null,
    splashUrl: b.splashUrl || null,
    themeColor: b.themeColor || null,
    backgroundColor: b.backgroundColor || null,
    terminology: b.terminology || {},
    tenant: b.tenant || null,
  };
}

/**
 * Per-tenant wording. A gym says "Member" and "Check-in"; the same platform
 * serving a clinic would say "Patient" and "Appointment". Everything user
 * facing reads these instead of hardcoded nouns.
 */
const FALLBACK_TERMS = {
  customer: 'Customer',
  customerPlural: 'Customers',
  staff: 'Staff',
  staffPlural: 'Staff',
  visit: 'Visit',
  visitPlural: 'Visits',
  location: 'Location',
  subscription: 'Subscription',
  subscriptionPlural: 'Subscriptions',
};

export function terminologyFor(branding) {
  return { ...FALLBACK_TERMS, ...(branding?.terminology || {}) };
}

export const brandingApi = {
  get: async () => normalizeBranding(await http.get('/branding')),

  update: async (patch) => normalizeBranding(await http.patch('/branding', patch)),

  /** Unauthenticated: the login screen needs the brand before a session exists. */
  public: async (slug) => {
    const result = await http.get('/public/branding', { query: { slug } });
    return {
      found: !!result?.found,
      tenant: result?.tenant || null,
      branding: normalizeBranding(result?.branding),
      theme: result?.theme || null,
    };
  },

  /** Upload a branding image. `kind` selects the storage rule on the server. */
  upload: async (kind, file) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return http.post('/files', form);
  },
};

export { SOCIAL_PLATFORMS };
export default brandingApi;
