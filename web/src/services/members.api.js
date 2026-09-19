import { http, apiDownload } from '@/lib/apiClient';

/**
 * Members. The list endpoint accepts search, filters, sort and paging; the
 * profile page pulls each sub-resource separately so a profile never drags
 * the whole history into one response.
 */
export const membersApi = {
  list: (params) => http.get('/members', { query: params }),
  get: (id) => http.get(`/members/${id}`),
  create: (body) => http.post('/members', body),
  update: (id, patch) => http.patch(`/members/${id}`, patch),
  remove: (id) => http.delete(`/members/${id}`),
  bulkStatus: (ids, status) => http.post('/members/bulk-status', { ids, status }),

  memberships: (id) => http.get(`/members/${id}/memberships`),
  payments: (id, params) => http.get(`/members/${id}/payments`, { query: params }),
  attendance: (id, params) => http.get(`/members/${id}/attendance`, { query: params }),
  progress: (id) => http.get(`/members/${id}/progress`),
  workouts: (id) => http.get(`/members/${id}/workouts`),
  documents: (id) => http.get(`/members/${id}/documents`),
  attachDocument: (id, body) => http.post(`/members/${id}/documents`, body),

  importTemplate: () => apiDownload('/members/import-template'),
  exportCsv: (params) => apiDownload('/members/export', { query: params }),

  /** Multipart upload; the server validates every row and reports line numbers. */
  importCsv: (file) => {
    const form = new FormData();
    form.append('file', file);
    return http.post('/members/import', form);
  },
};

export default membersApi;
