import { http } from '@/lib/apiClient';

export const usersApi = {
  list: (params) => http.get('/users', { query: params }),
  get: (id) => http.get(`/users/${id}`),
  create: (body) => http.post('/users', body),
  update: (id, patch) => http.patch(`/users/${id}`, patch),
  remove: (id) => http.delete(`/users/${id}`),
  resetPassword: (id, body) => http.post(`/users/${id}/reset-password`, body || {}),
};

export default usersApi;
