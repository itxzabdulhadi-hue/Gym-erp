import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateQuery } from '../../utils/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireModule } from '../../middleware/guards.js';
import { listAuditLogs, auditFacets } from './audit.service.js';
import { toCsv } from '../../utils/csv.js';
import { withTenant } from '../../db/index.js';
import { PAGINATION } from '@erp/shared';

export const router = Router();

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(25),
  search: z.string().trim().max(120).optional(),
  entity: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
  userId: z.string().uuid().optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  sort: z.enum(['created_at', 'action', 'entity', 'user']).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

router.use(requireAuth, requireModule('audit'), requirePermission('audit.view'));

router.get('/', validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await listAuditLogs(req.tenantId, req.validatedQuery));
}));

router.get('/facets', asyncHandler(async (req, res) => {
  res.json({ data: await auditFacets(req.tenantId) });
}));

router.get('/export', requirePermission('audit.export'), validateQuery(listSchema), asyncHandler(async (req, res) => {
  const rows = await withTenant(req.tenantId, (client) =>
    client.query(
      `SELECT created_at, user_label, action, entity, entity_id, metadata
       FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.tenantId, PAGINATION.exportMaxRows],
    ),
  );
  const csv = toCsv(rows.rows, [
    { key: 'created_at', header: 'Timestamp' },
    { key: 'user_label', header: 'User' },
    { key: 'action', header: 'Action' },
    { key: 'entity', header: 'Entity' },
    { key: 'entity_id', header: 'Entity ID' },
    { key: 'metadata', header: 'Metadata', value: (r) => JSON.stringify(r.metadata ?? {}) },
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
  res.send(csv);
}));

export default router;
