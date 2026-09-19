import { ERROR_CODES } from '@erp/shared';

/**
 * The only error type controllers throw. The error handler maps it to a stable
 * JSON shape, so stack traces never reach the client.
 */
export class ApiError extends Error {
  constructor(status, message, { code, details, expose = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || defaultCode(status);
    this.details = details;
    // `expose: false` marks internal errors: the client gets a generic message.
    this.expose = expose;
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, { code: ERROR_CODES.VALIDATION, details });
  }

  static validation(details, message = 'Validation failed') {
    return new ApiError(422, message, { code: ERROR_CODES.VALIDATION, details });
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message, { code: ERROR_CODES.UNAUTHORIZED });
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, message, { code: ERROR_CODES.FORBIDDEN });
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, { code: ERROR_CODES.NOT_FOUND });
  }

  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message, { code: ERROR_CODES.CONFLICT });
  }

  static moduleDisabled(moduleKey) {
    return new ApiError(403, `The "${moduleKey}" module is disabled for this business`, {
      code: ERROR_CODES.MODULE_DISABLED,
    });
  }

  static internal(message = 'Something went wrong') {
    return new ApiError(500, message, { code: ERROR_CODES.INTERNAL, expose: false });
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.expose ? this.message : 'Something went wrong', details: this.details },
    };
  }
}

function defaultCode(status) {
  if (status === 400 || status === 422) return ERROR_CODES.VALIDATION;
  if (status === 401) return ERROR_CODES.UNAUTHORIZED;
  if (status === 403) return ERROR_CODES.FORBIDDEN;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 409) return ERROR_CODES.CONFLICT;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  return ERROR_CODES.INTERNAL;
}

export default ApiError;
