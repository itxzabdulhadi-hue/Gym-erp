import { http } from '@/lib/apiClient';

export const searchApi = {
  /** Cross-entity search used by the global palette. */
  query: (q, params) => http.get('/search', { query: { q, ...params } }),
};

export default searchApi;
