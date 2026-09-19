import { z } from 'zod';
import { PAGINATION } from '@erp/shared';

/**
 * Pagination / sorting / search contract for every list endpoint.
 * Modules spread `listQueryShape(sortable)` into their own query schema and add
 * their filters, so pagination behaves identically across the whole API.
 */
export const listQueryShape = (sortable = []) => ({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  sort: sortable.length
    ? z.enum(sortable).optional()
    : z
        .string()
        .trim()
        .max(60)
        .optional()
        .transform((v) => (v ? v : undefined)),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export function paginate(query) {
  const page = Number(query?.page) || 1;
  const limit = Math.min(Number(query?.limit) || PAGINATION.defaultLimit, PAGINATION.maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

export function pageMeta({ page, limit }, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasMore: page * limit < total,
  };
}

/** Envelope used by every list endpoint so the client can rely on one shape. */
export function listResponse(rows, meta, extra = {}) {
  return { data: rows, meta, ...extra };
}
