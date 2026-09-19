import { http } from '@/lib/apiClient';

/**
 * Insights. These are real SQL-backed metrics, not model output. The /ask
 * endpoint is intentionally unimplemented on the server and answers 501, so the
 * UI does not offer it rather than pretending.
 */
export const insightsApi = {
  status: () => http.get('/insights/status'),
  finance: (params) => http.get('/insights/finance', { query: params }),
  churn: (params) => http.get('/insights/churn', { query: params }),
  attendance: (params) => http.get('/insights/attendance', { query: params }),
};

export default insightsApi;
