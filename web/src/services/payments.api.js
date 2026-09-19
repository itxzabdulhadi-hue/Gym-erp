import { http, apiDownload } from '@/lib/apiClient';

export const paymentsApi = {
  list: (params) => http.get('/payments', { query: params }),
  get: (id) => http.get(`/payments/${id}`),
  create: (body) => http.post('/payments', body),
  update: (id, patch) => http.patch(`/payments/${id}`, patch),
  remove: (id) => http.delete(`/payments/${id}`),
  summary: (params) => http.get('/payments/summary', { query: params }),

  /** Printable receipt data - rendered client side and printed with window.print(). */
  receipt: (id) => http.get(`/payments/${id}/receipt`),
  refund: (id, { reason, amount }) => http.post(`/payments/${id}/refund`, { reason, amount }),

  exportCsv: (params) => apiDownload('/payments/export', { query: params }),
};

export default paymentsApi;
