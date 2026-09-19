import { http, apiDownload } from '@/lib/apiClient';

export const trainersApi = {
  list: (params) => http.get('/trainers', { query: params }),
  get: (id) => http.get(`/trainers/${id}`),
  create: (body) => http.post('/trainers', body),
  update: (id, patch) => http.patch(`/trainers/${id}`, patch),
  remove: (id) => http.delete(`/trainers/${id}`),
  members: (id, params) => http.get(`/trainers/${id}/members`, { query: params }),
  performance: (id, params) => http.get(`/trainers/${id}/performance`, { query: params }),
  linkUser: (id, body) => http.post(`/trainers/${id}/link-user`, body),
};

export default trainersApi;
