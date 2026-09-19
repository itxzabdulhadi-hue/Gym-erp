import { http } from '@/lib/apiClient';

export const filesApi = {
  list: (params) => http.get('/files', { query: params }),
  remove: (id) => http.delete(`/files/${id}`),
  /** `kind` selects the server-side upload rule (image, document, logo, ...). */
  upload: (kind, file, extra = {}) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    return http.post('/files', form);
  },
};

export default filesApi;
