import { http, apiDownload } from '@/lib/apiClient';

/**
 * Theme management. The theme object itself is owned by @erp/shared - the
 * studio edits it, and ThemeProvider turns it into CSS variables with the
 * shared `themeToCssVars`, so the server and the browser cannot disagree
 * about what a theme means.
 */
export const themesApi = {
  list: () => http.get('/themes'),
  get: (id) => http.get(`/themes/${id}`),
  active: () => http.get('/themes/active'),
  presets: () => http.get('/themes/presets'),

  create: ({ name, description, config }) => http.post('/themes', { name, description, config }),
  update: (id, patch) => http.patch(`/themes/${id}`, patch),
  remove: (id) => http.delete(`/themes/${id}`),
  activate: (id) => http.post(`/themes/${id}/activate`, {}),
  duplicate: (id) => http.post(`/themes/${id}/duplicate`, {}),

  exportTheme: (id) => apiDownload(`/themes/${id}/export`),
  importTheme: (payload) => http.post('/themes/import', payload),

  /** Server-side sanitiser check, so the CSS editor reports the same verdict
   *  the save will get instead of silently dropping rules later. */
  validateCss: (css) => http.post('/themes/validate-css', { css }),
};

export default themesApi;
