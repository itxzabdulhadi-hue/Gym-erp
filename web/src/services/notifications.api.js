import { http } from '@/lib/apiClient';

export const notificationsApi = {
  list: (params) => http.get('/notifications', { query: params }),
  markRead: (id) => http.post(`/notifications/${id}/read`, {}),
  markAllRead: () => http.post('/notifications/read-all', {}),
  remove: (id) => http.delete(`/notifications/${id}`),
  channels: () => http.get('/notifications/channels'),
  /** Only in_app is configured today; others answer NOT_CONFIGURED from the server. */
  test: (channel, payload) => http.post('/notifications/test', { channel, ...payload }),
};

export default notificationsApi;
