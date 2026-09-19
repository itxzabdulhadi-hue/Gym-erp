import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import { ERROR_CODES } from '@erp/shared';

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  // The integration suite drives this app in-process and makes several hundred
  // requests on purpose; throttling it produces red tests that mean nothing.
  // Real clients in every other environment are limited exactly as configured.
  skip: () => config.isTest,
  // Behind a proxy (Vercel) the real client IP arrives in x-forwarded-for.
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests, please slow down' },
    }),
};

/** General API throttle. */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
});

/** Much tighter on credential endpoints to blunt password guessing. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  max: config.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
});
