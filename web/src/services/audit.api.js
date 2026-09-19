import { http } from '@/lib/apiClient';

export const auditApi = {
  list: (params) => http.get('/audit-logs', { query: params }),
  facets: () => http.get('/audit-logs/facets'),
  get: (id) => http.get(`/audit-logs/${id}`),
};

export default auditApi;
