/**
 * The single HTTP boundary for the whole app.
 *
 * No component calls fetch() directly. Everything goes through here so that
 * authentication, the tenant header, error shape and 401 recovery behave the
 * same everywhere - and so an API change is a one file edit.
 */

const BASE = '/api';

/**
 * Raised for any non-2xx response. Carries the server's error envelope so the
 * UI can show a real message and, for validation errors, the offending fields.
 */
export class ApiError extends Error {
  constructor(status, code, message, details, raw) {
    super(message || code || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'UNKNOWN';
    this.details = details || null;
    this.raw = raw;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isValidation() {
    return this.status === 422 || this.code === 'VALIDATION_ERROR';
  }
  get isModuleDisabled() {
    return this.code === 'MODULE_DISABLED';
  }

  /** Validation errors as a { field: message } map, for form display. */
  fieldErrors() {
    const out = {};
    const list = Array.isArray(this.details) ? this.details : [];
    for (const d of list) {
      const key = d.path?.join?.('.') || d.field || d.key;
      if (key) out[key] = d.message;
    }
    return out;
  }
}

let accessToken = null;
let onUnauthorized = null;
let tenantOverride = null;

export const authToken = {
  set(token) {
    accessToken = token || null;
  },
  get() {
    return accessToken;
  },
  clear() {
    accessToken = null;
  },
};

/** Called once per 401 so the app can drop the session and show the login. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

/** Platform admins may scope a request to another tenant. */
export function setTenantOverride(tenantId) {
  tenantOverride = tenantId || null;
}

function buildHeaders({ token, body, headers, isForm }) {
  const out = { Accept: 'application/json', ...headers };
  if (token) out.Authorization = `Bearer ${token}`;
  if (tenantOverride) out['X-Tenant-Id'] = tenantOverride;
  if (body !== undefined && !isForm) out['Content-Type'] = 'application/json';
  return out;
}

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function toError(status, payload) {
  const err = payload?.error || {};
  return new ApiError(status, err.code, err.message, err.details, payload);
}

let refreshing = null;

/**
 * A 401 with a refresh cookie present is usually an expired access token, not
 * a signed-out user. Try one refresh - shared across concurrent callers so a
 * burst of failing requests cannot stampede the endpoint - then replay.
 */
async function tryRefresh() {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        const data = await parse(res);
        if (!res.ok) throw toError(res.status, data);
        return data;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api(path, options = {}) {
  const {
    method = 'GET',
    body,
    query: queryParams,
    headers,
    token = authToken.get(),
    signal,
    raw = false,
    retryOn401 = true,
    isForm = body instanceof FormData,
  } = options;

  let url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (queryParams) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v !== undefined && v !== null && v !== '') search.append(key, String(v));
        }
      } else {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    // Cookies carry the refresh token, so credentials must always be sent.
    credentials: 'include',
    headers: buildHeaders({ token, body, headers, isForm }),
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal,
  });

  if (res.status === 401 && retryOn401) {
    try {
      const renewed = await tryRefresh();
      if (renewed?.accessToken) {
        authToken.set(renewed.accessToken);
        return api(path, { ...options, token: renewed.accessToken, retryOn401: false });
      }
    } catch {
      /* fall through to the unauthorized handler below */
    }
    authToken.clear();
    onUnauthorized?.();
    throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }

  if (res.status === 401) {
    authToken.clear();
    onUnauthorized?.();
  }

  const payload = await parse(res);

  if (!res.ok) throw toError(res.status, payload);

  if (raw) return payload;

  // The API wraps resources in { data } and lists in { data, meta }; a couple
  // of endpoints (login, refresh) answer flat. Normalise both.
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.meta ? { data: payload.data, meta: payload.meta } : payload.data;
  }
  return payload;
}

/** Blob download for the CSV/PDF endpoints the API already exposes. */
export async function apiDownload(path, { query: queryParams, token = authToken.get(), filename } = {}) {
  let url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (queryParams) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v !== undefined && v !== null && v !== '') search.append(key, String(v));
        }
      } else {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const response = await fetch(url, {
    credentials: 'include',
    headers: buildHeaders({ token }),
  });
  if (!response.ok) throw toError(response.status, await parse(response));

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const name = filename || match?.[1] || 'download';

  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return { filename: name, size: blob.size };
}

export const http = {
  get: (path, options) => api(path, { ...options, method: 'GET' }),
  post: (path, body, options) => api(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => api(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => api(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => api(path, { ...options, method: 'DELETE' }),
};
