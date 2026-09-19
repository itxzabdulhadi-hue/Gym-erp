import { z } from 'zod';
import ApiError from './ApiError.js';

/**
 * Request validation.
 *
 * Every route declares its contract with a zod schema; the validated (and
 * coerced) result replaces req.body / req.query / req.params, so services can
 * trust their input and never see raw strings from the wire.
 */

function shapeIssues(error) {
  const issues = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!issues[key]) issues[key] = issue.message;
  }
  return issues;
}

export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(ApiError.validation(shapeIssues(result.error)));
  req.body = result.data;
  return next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) return next(ApiError.validation(shapeIssues(result.error)));
  req.validatedQuery = result.data;
  return next();
};

export const validateParams = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.params ?? {});
  if (!result.success) return next(ApiError.validation(shapeIssues(result.error)));
  req.validatedParams = result.data;
  return next();
};

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

export const uuid = z.string().uuid('Must be a valid id');

export const idParam = z.object({ id: uuid });

/** Trims and drops empty strings so `""` behaves like "not provided". */
export const trimmed = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v));

export const optionalText = (max = 2000) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null));

export const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email('Must be a valid email address');

export const optionalEmail = z
  .union([z.string().trim().toLowerCase().max(254).email('Must be a valid email address'), z.literal('')])
  .optional()
  .transform((v) => (v ? v : null));

export const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9+\-()\s.]+$/, 'Must be a valid phone number');

export const optionalPhone = z
  .union([phone, z.literal('')])
  .optional()
  .transform((v) => (v ? v : null));

export const money = z.coerce.number().min(0).max(99_999_999).multipleOf(0.01, 'At most 2 decimals');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a real date');

export const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url('Must be a valid URL')
  .refine((v) => /^https?:\/\//i.test(v), 'Must start with http:// or https://');

export const optionalUrl = z
  .union([httpUrl, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

/** Strong password rule shared by signup, invite and password reset. */
export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Must contain letters and numbers');

export const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'));
