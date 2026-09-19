/**
 * Permission helpers shared by the API guard middleware and the web client.
 * Permissions are plain strings: `<module>.<action>`.
 */
import { ALL_PERMISSIONS, MODULES } from './modules.js';

export const WILDCARD = '*';

/** True when the permission set grants `key` (supports `*` and `module.*`). */
export function hasPermission(granted, key) {
  if (!granted || !granted.length) return false;
  if (granted.includes(WILDCARD)) return true;
  if (granted.includes(key)) return true;
  const module = key.split('.')[0];
  return granted.includes(`${module}.${WILDCARD}`);
}

export function hasAnyPermission(granted, keys = []) {
  return keys.some((k) => hasPermission(granted, k));
}

export function hasAllPermissions(granted, keys = []) {
  return keys.every((k) => hasPermission(granted, k));
}

/** Filter an unknown list down to permissions that actually exist. */
export function normalizePermissions(keys = []) {
  const known = new Set(ALL_PERMISSIONS.map((p) => p.key));
  const out = new Set();
  for (const key of keys) {
    if (key === WILDCARD || /^\w+\.\*$/.test(key)) {
      out.add(key);
    } else if (known.has(key)) {
      out.add(key);
    }
  }
  return [...out];
}

/** Group the catalogue for the role/permission matrix UI. */
export function permissionMatrix() {
  return MODULES.map((mod) => ({
    module: mod.key,
    label: mod.label,
    group: mod.group,
    permissions: ALL_PERMISSIONS.filter((p) => p.module === mod.key).map((p) => ({
      key: p.key,
      action: p.action,
      label: p.label,
    })),
  })).filter((entry) => entry.permissions.length > 0);
}

/** Extra cross-cutting permissions, grouped for the matrix UI. */
export function platformPermissionGroup() {
  return {
    module: 'platform',
    label: 'Platform',
    group: 'platform',
    permissions: ALL_PERMISSIONS.filter((p) => p.group === 'platform' && p.module === 'settings').map((p) => ({
      key: p.key,
      action: p.action,
      label: p.label,
    })),
  };
}
