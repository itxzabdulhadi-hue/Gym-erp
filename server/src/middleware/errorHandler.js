import { ERROR_CODES } from '@erp/shared';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `No route matches ${req.method} ${req.originalUrl}`, { code: ERROR_CODES.NOT_FOUND }));
}

/**
 * Single error exit point for the API.
 * Clients always receive `{ error: { code, message, details? } }`; stack traces
 * stay in the server log.
 */
// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
export function errorHandler(err, req, res, _next) {
  const error = normalize(err);

  if (error.status >= 500) {
    logger.error('http', error.message, {
      method: req.method,
      path: req.originalUrl,
      code: error.code,
      detail: error.debug,
      // Log the *original* error: the normalized ApiError is created inside
      // this file, so its stack points at nothing useful.
      stack: (err.stack || error.stack)?.split('\n').slice(0, 6).join(' | '),
    });
  }

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.expose === false ? 'Something went wrong' : error.message,
      details: error.details,
      ...(process.env.NODE_ENV === 'development' && error.status >= 500 ? { debug: error.debug } : {}),
    },
  });
}

function normalize(err) {
  if (err instanceof ApiError) return err;

  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return new ApiError(400, 'Request body is not valid JSON', { code: ERROR_CODES.VALIDATION });
  }
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large', { code: ERROR_CODES.PAYLOAD_TOO_LARGE });
  }
  // multer file errors
  if (err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return new ApiError(status, err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message, {
      code: status === 413 ? ERROR_CODES.PAYLOAD_TOO_LARGE : ERROR_CODES.VALIDATION,
    });
  }
  // Postgres errors: never leak SQL or constraint names to the client.
  if (err.code && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    const pgMap = {
      '23505': { status: 409, message: 'That record already exists' },
      '23503': { status: 409, message: 'This record is still referenced by other data' },
      '23514': { status: 422, message: 'A value is outside the allowed range' },
      '23502': { status: 422, message: 'A required value is missing' },
      '22P02': { status: 422, message: 'A value has the wrong format' },
      '42601': { status: 500, message: 'Something went wrong' },
      57014: { status: 504, message: 'The query took too long' },
    };
    const mapped = pgMap[err.code];
    if (mapped) return new ApiError(mapped.status, mapped.message, { debug: err.message });
    return new ApiError(500, 'Something went wrong', { expose: false, debug: err.message });
  }

  const status = Number(err.status || err.statusCode) || 500;
  return new ApiError(status, status >= 500 ? 'Something went wrong' : err.message, {
    expose: status < 500,
    debug: err.message,
  });
}
