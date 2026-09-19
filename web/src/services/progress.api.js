import { http } from '@/lib/apiClient';

export const progressApi = {
  list: (params) => http.get('/progress', { query: params }),
  latest: (params) => http.get('/progress/latest', { query: params }),
  get: (id) => http.get(`/progress/${id}`),
  create: (body) => http.post('/progress', body),
  update: (id, patch) => http.patch(`/progress/${id}`, patch),
  remove: (id) => http.delete(`/progress/${id}`),
  photos: (memberId) => http.get(`/progress/photos`, { query: { memberId } }),
};

export default progressApi;
