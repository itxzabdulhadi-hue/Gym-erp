import { http } from '@/lib/apiClient';
import { MODULES } from '@erp/shared';

/**
 * Module registry. The server is authoritative: toggling here calls the API,
 * and the navigation is rebuilt from whatever the server says is enabled.
 * Nothing is hidden locally and left enabled upstream.
 */

export const modulesApi = {
  list: () => http.get('/modules'),
  /** `enabled` is the full desired list; the server force-adds always-on modules. */
  setEnabled: (enabled) => http.put('/modules', { enabled }),
};

/** Static catalogue: label, icon and description per module key. */
export function moduleMeta(key) {
  return MODULES.find((m) => m.key === key) || { key, label: key, icon: 'Box' };
}

/** /api/auth/me returns modules as an array of { key, enabled, sort_order }. */
export function normalizeModules(input) {
  if (Array.isArray(input)) {
    return input
      .map((m) => ({ key: m.key, enabled: m.enabled !== false, sortOrder: m.sort_order ?? 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  if (input && typeof input === 'object') {
    return Object.entries(input)
      .map(([key, value]) => ({
        key,
        enabled: value?.enabled !== false,
        sortOrder: value?.sort_order ?? 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return [];
}

export function enabledKeys(modules) {
  return new Set(normalizeModules(modules).filter((m) => m.enabled).map((m) => m.key));
}

export default modulesApi;
