import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateQuery, validateParams, idParam, booleanish } from '../../utils/validate.js';
import { listQueryShape } from '../../utils/pagination.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/guards.js';
import {
  listNotifications,
  markRead,
  markAllRead,
  deleteNotification,
  listChannels,
  dispatchNotification,
} from './notification.service.js';

export const router = Router();

const listSchema = z.object({
  ...listQueryShape(),
  unreadOnly: booleanish.optional(),
  type: z.string().max(40).optional(),
});

router.use(requireAuth, requireModule('notifications'));

router.get('/', validateQuery(listSchema), asyncHandler(async (req, res) => {
  res.json(await listNotifications(req.tenantId, req.userId, req.validatedQuery));
}));

router.get('/channels', asyncHandler(async (_req, res) => {
  res.json({ data: listChannels() });
}));

router.post('/test', asyncHandler(async (req, res) => {
  const row = await dispatchNotification({
    tenantId: req.tenantId,
    userId: req.userId,
    type: 'system',
    title: 'Test notification',
    body: 'This is a test notification sent from the notification settings.',
    level: 'info',
    data: { source: 'settings' },
    channels: ['in_app'],
  });
  res.json({ data: row });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  res.json(await markAllRead(req.tenantId, req.userId));
}));

router.post('/:id/read', validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await markRead(req.tenantId, req.userId, req.validatedParams.id));
}));

router.delete('/:id', validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await deleteNotification(req.tenantId, req.userId, req.validatedParams.id));
}));

export default router;
