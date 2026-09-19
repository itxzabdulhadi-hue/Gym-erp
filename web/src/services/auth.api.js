import { http, authToken } from '@/lib/apiClient';

/**
 * Authentication and session.
 *
 * Login answers flat ({ accessToken, user, tenant }) while most other endpoints
 * wrap in { data }; the API client normalises the wrapped ones, so only the
 * flat responses are read directly here.
 */

export const authApi = {
  async login({ email, password, tenantSlug }) {
    const result = await http.post('/auth/login', { email, password, tenantSlug });
    if (result?.accessToken) authToken.set(result.accessToken);
    return result;
  },

  async logout() {
    try {
      await http.post('/auth/logout', {});
    } finally {
      // Always drop the local token, even if the server call failed.
      authToken.clear();
    }
  },

  async logoutAll() {
    const result = await http.post('/auth/logout-all', {});
    authToken.clear();
    return result;
  },

  /** Session restoration on a cold load: relies on the httpOnly refresh cookie. */
  async restore() {
    const result = await http.post('/auth/refresh', {});
    if (result?.accessToken) authToken.set(result.accessToken);
    return result;
  },

  me: () => http.get('/auth/me'),

  sessions: () => http.get('/auth/sessions'),
  revokeSession: (id) => http.delete(`/auth/sessions/${id}`),

  updateProfile: (patch) => http.patch('/auth/profile', patch),
  changePassword: ({ currentPassword, newPassword }) =>
    http.post('/auth/change-password', { currentPassword, newPassword }),

  forgotPassword: ({ email, tenantSlug }) => http.post('/auth/forgot-password', { email, tenantSlug }),
  resetPassword: ({ token, password, tenantSlug }) =>
    http.post('/auth/reset-password', { token, password, tenantSlug }),
};

export default authApi;
