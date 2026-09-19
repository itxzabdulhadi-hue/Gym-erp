import { http, apiDownload } from '@/lib/apiClient';

/**
 * Attendance. Built around the reception desk: find a member fast, check them
 * in with one action, and see today at a glance.
 */
export const attendanceApi = {
  list: (params) => http.get('/attendance', { query: params }),
  today: (params) => http.get('/attendance/today', { query: params }),
  monthly: (params) => http.get('/attendance/stats/monthly', { query: params }),
  get: (id) => http.get(`/attendance/${id}`),
  update: (id, patch) => http.patch(`/attendance/${id}`, patch),
  remove: (id) => http.delete(`/attendance/${id}`),

  /** `alreadyCheckedIn` comes back true when the settings allow a second visit. */
  checkIn: (body) => http.post('/attendance/check-in', body),
  checkOut: (body) => http.post('/attendance/check-out', body),

  exportCsv: (params) => apiDownload('/attendance/export', { query: params }),
};

export default attendanceApi;
