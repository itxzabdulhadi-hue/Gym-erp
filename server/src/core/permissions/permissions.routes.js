import { Router } from 'express';
import { ALL_PERMISSIONS, permissionMatrix, platformPermissionGroup } from '@erp/shared';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';

export const router = Router();

/** GET /api/permissions - the full catalogue, grouped for the matrix UI. */
router.get('/', requireAuth, requirePermission('roles.view'), (_req, res) => {
  res.json({
    data: ALL_PERMISSIONS,
    matrix: [...permissionMatrix(), platformPermissionGroup()],
  });
});

export default router;
