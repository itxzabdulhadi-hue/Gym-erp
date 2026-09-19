import { http } from '@/lib/apiClient';

/**
 * Dashboard metrics and per-user layout.
 *
 * Every number here comes from the server - the client renders whatever the
 * API returns and never substitutes a placeholder value.
 */
export const dashboardApi = {
  /** All widgets the caller is allowed to see, in one call. */
  overview: () => http.get('/dashboard'),
  /** Catalogue of available widgets (id, label, default size). */
  widgets: () => http.get('/dashboard/widgets'),
  /** A single widget refreshed on its own, for pull-to-refresh on one card. */
  widget: (id) => http.get(`/dashboard/widget/${id}`),

  layout: () => http.get('/dashboard/layout'),
  saveLayout: (layout) => http.put('/dashboard/layout', { layout }),
  resetLayout: () => http.post('/dashboard/layout/reset', {}),
};

export default dashboardApi;
