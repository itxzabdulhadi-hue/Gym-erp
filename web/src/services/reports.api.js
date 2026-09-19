import { http, apiDownload } from '@/lib/apiClient';

/**
 * Reports. The catalogue is served by the API so a report added server side
 * appears in the UI without a client change - the list of reports is not
 * duplicated here.
 */
export const reportsApi = {
  catalogue: () => http.get('/reports/catalogue'),
  run: (report, params) => http.get(`/reports/${report}`, { query: params }),
  exportCsv: (report, params) => apiDownload(`/reports/${report}/export`, { query: params }),
};

export default reportsApi;
