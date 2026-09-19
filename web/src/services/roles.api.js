import { http } from '@/lib/apiClient';

export const rolesApi = {
  list: () => http.get('/roles'),
  get: (id) => http.get(`/roles/${id}`),
  create: (body) => http.post('/roles', body),
  update: (id, patch) => http.patch(`/roles/${id}`, patch),
  remove: (id) => http.delete(`/roles/${id}`),
  /** Permission catalogue grouped by module, for the matrix builder. */
  permissions: () => http.get('/permissions'),
};

export default rolesApi;
