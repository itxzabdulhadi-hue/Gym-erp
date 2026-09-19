import { http, apiDownload } from '@/lib/apiClient';

/**
 * Centralised settings. Values live in a namespaced jsonb column server side;
 * `section` is one of the keys the API validates (general, membership,
 * attendance, payment, notification, security).
 */
export const settingsApi = {
  all: () => http.get('/settings'),
  section: (name) => http.get(`/settings/${name}`),
  update: (name, patch) => http.patch(`/settings/${name}`, patch),

  maintenance: () => http.post('/settings/maintenance', {}),
  exportData: () => apiDownload('/settings/export/data'),
};

export const SETTINGS_SECTIONS = [
  { key: 'general', label: 'General' },
  { key: 'membership', label: 'Membership' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payment', label: 'Payment' },
  { key: 'notification', label: 'Notifications' },
  { key: 'security', label: 'Security' },
];

export default settingsApi;
