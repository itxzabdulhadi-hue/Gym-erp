import { sanitizeTheme, sanitizeCss, DEFAULT_THEME, THEME_PRESETS, MAX_CUSTOM_CSS_LENGTH } from '@erp/shared';
import { withTenant, query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { logAudit } from '../audit/audit.service.js';
import { invalidateAuthCache } from '../auth/authContext.js';

/**
 * Themes.
 *
 * A theme is a sanitised JSON config plus optional tenant CSS. Tenants can keep
 * several named themes, switch between them, duplicate, export and import them.
 * The active theme is what the client applies on boot, so branding is never
 * baked into the bundle.
 */

import { shapeTheme as shape } from './theme.shape.js';

export async function listThemes(tenantId) {
  const res = await query(
    'SELECT * FROM themes WHERE tenant_id = $1 ORDER BY is_active DESC, created_at ASC',
    [tenantId],
  );
  return res.rows.map(shape);
}

export async function getTheme(tenantId, themeId) {
  const res = await query('SELECT * FROM themes WHERE tenant_id = $1 AND id = $2', [tenantId, themeId]);
  if (!res.rows[0]) throw ApiError.notFound('Theme not found');
  return shape(res.rows[0]);
}

export async function getActiveTheme(tenantId) {
  const res = await query('SELECT * FROM themes WHERE tenant_id = $1 AND is_active LIMIT 1', [tenantId]);
  if (res.rows[0]) return shape(res.rows[0]);
  // A tenant without a theme row still gets the platform default.
  return { id: null, name: 'Default', config: sanitizeTheme(DEFAULT_THEME), customCss: '', isActive: true };
}

export async function createTheme(tenantId, input, actor) {
  const name = String(input.name || 'Untitled theme').trim().slice(0, 60);
  const config = sanitizeTheme(input.config || DEFAULT_THEME);
  const customCss = sanitizeCss(input.customCss || '');

  return withTenant(tenantId, async (client) => {
    const clash = await client.query('SELECT id FROM themes WHERE tenant_id = $1 AND name = $2', [tenantId, name]);
    if (clash.rowCount) throw ApiError.conflict(`A theme named "${name}" already exists`);

    const inserted = await client.query(
      `INSERT INTO themes (tenant_id, name, description, config, custom_css, is_active, is_preset, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7) RETURNING *`,
      [
        tenantId,
        name,
        input.description ?? null,
        JSON.stringify(config),
        customCss,
        Boolean(input.activate),
        actor?.userId ?? null,
      ],
    );
    if (input.activate) await clearActive(client, tenantId, inserted.rows[0].id);

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'theme.created',
      entity: 'theme',
      entityId: inserted.rows[0].id,
      metadata: { name },
    });
    invalidateAuthCache({ tenantId });
    return shape(inserted.rows[0]);
  });
}

export async function updateTheme(tenantId, themeId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM themes WHERE tenant_id = $1 AND id = $2', [tenantId, themeId]);
    const before = current.rows[0];
    if (!before) throw ApiError.notFound('Theme not found');

    const sets = [];
    const params = [tenantId, themeId];

    if (input.name !== undefined) {
      const name = String(input.name).trim().slice(0, 60);
      const clash = await client.query('SELECT id FROM themes WHERE tenant_id = $1 AND name = $2 AND id <> $3', [
        tenantId,
        name,
        themeId,
      ]);
      if (clash.rowCount) throw ApiError.conflict(`A theme named "${name}" already exists`);
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      sets.push(`description = $${params.length}`);
    }
    if (input.config !== undefined) {
      params.push(JSON.stringify(sanitizeTheme({ ...before.config, ...input.config })));
      sets.push(`config = $${params.length}::jsonb`);
    }
    if (input.customCss !== undefined) {
      const css = sanitizeCss(input.customCss);
      params.push(css);
      sets.push(`custom_css = $${params.length}`);
    }
    if (input.activate) sets.push('is_active = true');

    if (!sets.length) throw ApiError.badRequest('Nothing to update');
    if (input.activate) await clearActive(client, tenantId, themeId);

    const res = await client.query(
      `UPDATE themes SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'theme.updated',
      entity: 'theme',
      entityId: themeId,
      metadata: { name: res.rows[0].name, activated: Boolean(input.activate), changedKeys: Object.keys(input) },
    });

    invalidateAuthCache({ tenantId });
    return shape(res.rows[0]);
  });
}

export async function deleteTheme(tenantId, themeId, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM themes WHERE tenant_id = $1 AND id = $2', [tenantId, themeId]);
    const theme = current.rows[0];
    if (!theme) throw ApiError.notFound('Theme not found');

    const count = await client.query('SELECT count(*)::int AS c FROM themes WHERE tenant_id = $1', [tenantId]);
    if (count.rows[0].c <= 1) throw ApiError.badRequest('Keep at least one theme');

    await client.query('DELETE FROM themes WHERE tenant_id = $1 AND id = $2', [tenantId, themeId]);

    // If we deleted the active theme, promote another one so the UI never
    // renders without styling.
    if (theme.is_active) {
      await client.query(
        `UPDATE themes SET is_active = true WHERE id = (SELECT id FROM themes WHERE tenant_id = $1 ORDER BY created_at LIMIT 1)`,
        [tenantId],
      );
    }

    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'theme.deleted',
      entity: 'theme',
      entityId: themeId,
      metadata: { name: theme.name },
    });
    invalidateAuthCache({ tenantId });
    return { ok: true };
  });
}

export async function duplicateTheme(tenantId, themeId, input, actor) {
  const source = await getTheme(tenantId, themeId);
  return createTheme(
    tenantId,
    {
      name: input?.name || `${source.name} (copy)`,
      description: source.description,
      config: source.config,
      customCss: source.customCss,
      activate: Boolean(input?.activate),
    },
    actor,
  );
}

export async function activateTheme(tenantId, themeId, actor) {
  return withTenant(tenantId, async (client) => {
    const exists = await client.query('SELECT id FROM themes WHERE tenant_id = $1 AND id = $2', [tenantId, themeId]);
    if (!exists.rowCount) throw ApiError.notFound('Theme not found');
    await clearActive(client, tenantId, themeId);
    const res = await client.query('UPDATE themes SET is_active = true WHERE id = $1 RETURNING *', [themeId]);
    await logAudit(client, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'theme.activated',
      entity: 'theme',
      entityId: themeId,
      metadata: { name: res.rows[0].name },
    });
    invalidateAuthCache({ tenantId });
    return shape(res.rows[0]);
  });
}

async function clearActive(client, tenantId, exceptId) {
  await client.query('UPDATE themes SET is_active = false WHERE tenant_id = $1 AND id <> $2', [tenantId, exceptId]);
}

/** Seed the preset library into a tenant that has no themes yet. */
export async function ensurePresetThemes(tenantId, presetNames = []) {
  const wanted = presetNames.length ? presetNames : ['Default'];
  for (const name of wanted) {
    const preset = THEME_PRESETS.find((p) => p.name === name) || THEME_PRESETS[0];
    await withTenant(tenantId, async (client) => {
      const exists = await client.query('SELECT id FROM themes WHERE tenant_id = $1 AND name = $2', [tenantId, preset.name]);
      if (exists.rowCount) return;
      await client.query(
        `INSERT INTO themes (tenant_id, name, description, config, custom_css, is_active, is_preset)
         VALUES ($1, $2, $3, $4, '', NOT EXISTS (SELECT 1 FROM themes WHERE tenant_id = $1 AND is_active), true)`,
        [tenantId, preset.name, preset.description, JSON.stringify(sanitizeTheme(preset.config))],
      );
    });
  }
  return listThemes(tenantId);
}

/** Export payload used by the "Export theme" button (JSON download client side). */
export async function exportTheme(tenantId, themeId) {
  const theme = await getTheme(tenantId, themeId);
  return {
    format: 'erp-theme',
    version: 1,
    exportedAt: new Date().toISOString(),
    name: theme.name,
    description: theme.description,
    config: sanitizeTheme(theme.config),
    customCss: (theme.customCss || '').slice(0, MAX_CUSTOM_CSS_LENGTH),
  };
}

/** Import a previously exported theme file. Invalid tokens fall back to defaults. */
export async function importTheme(tenantId, payload, actor) {
  if (!payload || typeof payload !== 'object') throw ApiError.badRequest('Invalid theme file');
  const config = payload.config && typeof payload.config === 'object' ? payload.config : DEFAULT_THEME;
  return createTheme(
    tenantId,
    {
      name: String(payload.name || 'Imported theme').slice(0, 60),
      description: payload.description ?? 'Imported theme',
      config: sanitizeTheme(config),
      customCss: sanitizeCss(payload.customCss || ''),
      activate: Boolean(payload.activate),
    },
    actor,
  );
}

/** Validate-only endpoint: reports whether custom CSS was accepted or stripped. */
export function previewCustomCss(css) {
  const sanitized = sanitizeCss(css);
  return {
    accepted: sanitized.length > 0,
    length: sanitized.length,
    css: sanitized,
    message:
      !css || !String(css).trim()
        ? 'Empty'
        : sanitized
          ? 'Custom CSS accepted'
          : 'Custom CSS rejected: unbalanced braces or disallowed syntax',
  };
}
