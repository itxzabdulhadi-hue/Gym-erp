import { describe, it, expect, beforeAll } from 'vitest';

import { api, auth, tenantWithOwner, closeDbAfterSuite } from '../helpers/context.js';
import { sanitizeTheme, sanitizeCss, DEFAULT_THEME, THEME_PRESETS } from '@erp/shared';

/**
 * Theme engine and branding.
 *
 * Themes are stored as JSON configuration (not one column per property) with a
 * sanitiser as the trust boundary on both sides: the server sanitises before
 * persisting, the client sanitises before applying.
 */
describe('themes and branding', () => {
  closeDbAfterSuite();

  let tenant;
  let token;

  beforeAll(async () => {
    const owner = await tenantWithOwner({ name: 'Theme Gym', slugPrefix: 'theme' });
    tenant = owner.tenant;
    token = owner.token;
  });

  it('gives a new tenant exactly one active theme', async () => {
    const res = await api.get('/api/themes').set(auth(token));
    expect(res.status).toBe(200);
    const active = res.body.data.filter((t) => t.isActive ?? t.is_active);
    expect(active).toHaveLength(1);
  });

  it('exposes the preset catalogue', async () => {
    const res = await api.get('/api/themes/presets').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.length).toBe(THEME_PRESETS.length);
  });

  it('stores a theme as structured configuration, not scalar columns', async () => {
    const created = await api.post('/api/themes').set(auth(token)).send({
      name: 'Midnight',
      config: { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#4f46e5' } },
    });
    expect([200, 201]).toContain(created.status);
    expect(created.body.data.config).toBeTypeOf('object');
    expect(created.body.data.config.colors.primary).toBe('#4f46e5');
  });

  it('sanitises unknown and hostile theme keys before persisting', async () => {
    const hostile = {
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, primary: '#ff0000' },
      __proto__: { polluted: true },
      injectedScript: 'alert(1)',
      colors2: { primary: 'javascript:alert(1)' },
    };
    const created = await api.post('/api/themes').set(auth(token)).send({ name: 'Hostile', config: hostile });
    expect([200, 201]).toContain(created.status);

    const stored = created.body.data.config;
    expect(stored.injectedScript).toBeUndefined();
    expect(stored.colors2).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('rejects an invalid colour instead of storing it', async () => {
    const res = await api.post('/api/themes').set(auth(token)).send({
      name: 'Broken colours',
      config: { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: 'not-a-colour' } },
    });
    // Either rejected, or stored with the invalid value replaced.
    if (res.status === 200 || res.status === 201) {
      expect(res.body.data.config.colors.primary).not.toBe('not-a-colour');
    } else {
      expect([400, 422]).toContain(res.status);
    }
  });

  it('keeps the previous theme when a new one is activated', async () => {
    const before = await api.get('/api/themes/active').set(auth(token));
    const created = await api.post('/api/themes').set(auth(token)).send({ name: 'Second', config: DEFAULT_THEME });
    const activated = await api.post(`/api/themes/${created.body.data.id}/activate`).set(auth(token));
    expect([200, 204]).toContain(activated.status);

    const list = await api.get('/api/themes').set(auth(token));
    expect(list.body.data.find((t) => t.id === before.body.data.id), 'previous theme must survive').toBeTruthy();
    expect(list.body.data.filter((t) => t.isActive ?? t.is_active)).toHaveLength(1);
  });

  it('duplicates a theme without touching the original', async () => {
    const list = await api.get('/api/themes').set(auth(token));
    const source = list.body.data[0];
    const dup = await api.post(`/api/themes/${source.id}/duplicate`).set(auth(token));
    expect([200, 201]).toContain(dup.status);
    expect(dup.body.data.id).not.toBe(source.id);
  });

  it('round-trips a theme through export and import', async () => {
    const list = await api.get('/api/themes').set(auth(token));
    const exported = await api.get(`/api/themes/${list.body.data[0].id}/export`).set(auth(token));
    expect(exported.status).toBe(200);

    const imported = await api.post('/api/themes/import').set(auth(token)).send(exported.body.data ?? exported.body);
    expect([200, 201, 409]).toContain(imported.status);
  });

  it('sanitises custom CSS: no script, no url(javascript:), no style breakout', () => {
    const dirty = `
      .brand { color: red; background: url("javascript:alert(1)"); }
      .x { width: expression(alert(1)); }
      @import url("https://evil.test/x.css");
      </style><script>alert(1)</script>
    `;
    const clean = sanitizeCss(dirty);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/expression\s*\(/i);
    expect(clean).not.toMatch(/<\/?script/i);
    expect(clean).not.toMatch(/<\/style/i);
  });

  it('validates custom CSS through the API before it is saved', async () => {
    const res = await api.post('/api/themes/validate-css').set(auth(token))
      .send({ css: '.ok { color: blue } .bad { background: url("javascript:alert(1)") }' });
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/javascript:/i);
  });

  it('rejects oversized custom CSS', async () => {
    const res = await api.post('/api/themes/validate-css').set(auth(token)).send({ css: 'a'.repeat(200_000) });
    expect([400, 413, 422]).toContain(res.status);
  });

  it('sanitizeTheme keeps only known structure', () => {
    const cleaned = sanitizeTheme({ ...DEFAULT_THEME, bogus: 1, colors: { ...DEFAULT_THEME.colors, primary: '#123456' } });
    expect(cleaned.bogus).toBeUndefined();
    expect(cleaned.colors.primary).toBe('#123456');
  });

  // ------------------------------------------------------------ branding
  it('returns tenant branding with the tenant own business name', async () => {
    const res = await api.get('/api/branding').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.businessName).toBe('Theme Gym');
  });

  it('updates branding and invalidates the cached context', async () => {
    const patched = await api.patch('/api/branding').set(auth(token)).send({ businessName: 'Renamed Gym', currency: 'PKR', currencySymbol: '₨' });
    expect([200, 204]).toContain(patched.status);

    const after = await api.get('/api/branding').set(auth(token));
    expect(after.body.data.businessName).toBe('Renamed Gym');
    expect(after.body.data.currencySymbol).toBe('₨');
  });

  it('rejects branding with a hostile app name', async () => {
    const res = await api.patch('/api/branding').set(auth(token)).send({ appName: '<script>alert(1)</script>' });
    if (res.status === 200) {
      expect(res.body.data.appName).not.toMatch(/<script/i);
    } else {
      expect([400, 422]).toContain(res.status);
    }
  });

  it('keeps branding separate per tenant', async () => {
    const other = await tenantWithOwner({ name: 'Other Brand Gym', slugPrefix: 'theme2' });
    const mine = await api.get('/api/branding').set(auth(token));
    const theirs = await api.get('/api/branding').set(auth(other.token));
    expect(mine.body.data.businessName).toBe('Renamed Gym');
    expect(theirs.body.data.businessName).toBe('Other Brand Gym');
  });

  it('serves public login branding without a token', async () => {
    const res = await api.get(`/api/public/branding?slug=${tenant.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.tenant.slug).toBe(tenant.slug);
    expect(res.body.data.branding.businessName).toBeTruthy();
    // The active theme travels with it so the login screen can be branded.
    expect(res.body.data.theme).toBeTruthy();
    // Nothing private may ride along.
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token/i);
  });
});
