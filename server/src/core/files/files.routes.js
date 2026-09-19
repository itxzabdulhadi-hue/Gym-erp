import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/guards.js';
import { uploadFile, listFiles, deleteFile, getFile } from './files.service.js';
import { getStorage } from '../../storage/index.js';

export const router = Router();

// Memory storage: the buffer is handed straight to the storage driver, so
// nothing sensitive is written to a world-readable temp directory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: await listFiles(req.tenantId, { purpose: req.query.purpose, limit: req.query.limit }) });
}));

router.post('/', requireAuth, requirePermission('files.upload'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded (use the "file" field)');
  const purpose = String(req.body.purpose || req.query.purpose || 'other');
  const file = await uploadFile(req.tenantId, {
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    purpose,
    userId: req.userId,
    meta: req.body.meta ? JSON.parse(req.body.meta) : {},
  });
  res.status(201).json({ data: file });
}));

router.delete('/:id', requireAuth, requirePermission('files.upload'), asyncHandler(async (req, res) => {
  res.json(await deleteFile(req.tenantId, req.params.id, { userId: req.userId, userLabel: req.ctx.user.fullName }));
}));

/** Stream a stored file. Used when no public base URL is configured. */
router.get('/:id/download', requireAuth, asyncHandler(async (req, res) => {
  const row = await getFile(req.tenantId, req.params.id);
  const storage = await getStorage();
  const buffer = await storage.get(row.storage_key);
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${row.filename.replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}));

export const uploadSchema = z.object({ purpose: z.string().optional() });

export default router;
