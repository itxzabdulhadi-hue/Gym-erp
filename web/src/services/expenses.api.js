import { http, apiDownload } from '@/lib/apiClient';

export const expensesApi = {
  list: (params) => http.get('/expenses', { query: params }),
  get: (id) => http.get(`/expenses/${id}`),
  create: (body) => http.post('/expenses', body),
  update: (id, patch) => http.patch(`/expenses/${id}`, patch),
  remove: (id) => http.delete(`/expenses/${id}`),
  summary: (params) => http.get('/expenses/summary', { query: params }),
  categories: () => http.get('/expenses/categories'),
  exportCsv: (params) => apiDownload('/expenses/export', { query: params }),
};

export default expensesApi;
