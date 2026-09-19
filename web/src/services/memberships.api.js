import { http } from '@/lib/apiClient';

/**
 * Memberships and plans.
 *
 * Lifecycle actions are separate endpoints on the server (renew, change,
 * freeze, resume, cancel) rather than one PATCH with a status field, because
 * each has its own rules about dates and eligibility. The UI mirrors that.
 */
export const membershipsApi = {
  list: (params) => http.get('/memberships', { query: params }),
  get: (id) => http.get(`/memberships/${id}`),
  create: (body) => http.post('/memberships', body),
  update: (id, patch) => http.patch(`/memberships/${id}`, patch),
  remove: (id) => http.delete(`/memberships/${id}`),

  renew: (id, body) => http.post(`/memberships/${id}/renew`, body || {}),
  change: (id, { planId, direction }) => http.post(`/memberships/${id}/change`, { planId, direction }),
  freeze: (id, { days, reason }) => http.post(`/memberships/${id}/freeze`, { days, reason }),
  resume: (id, body) => http.post(`/memberships/${id}/resume`, body || {}),
  cancel: (id, { reason }) => http.post(`/memberships/${id}/cancel`, { reason }),

  plans: {
    list: (params) => http.get('/membership-plans', { query: params }),
    get: (id) => http.get(`/membership-plans/${id}`),
    create: (body) => http.post('/membership-plans', body),
    update: (id, patch) => http.patch(`/membership-plans/${id}`, patch),
    remove: (id) => http.delete(`/membership-plans/${id}`),
  },
};

export default membershipsApi;
