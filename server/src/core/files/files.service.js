import { query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { getStorage, validateUpload, buildStorageKey } from '../../storage/index.js';
import { logAudit } from '../audit/audit.service.js';
import { FILE_PURPOSES } from '@erp/shared';

/**
 * File uploads.
 *
 * Storage is behind a driver interface, so switching from the local disk
 * (development) to S3/R2 (production) is a config change. Files are namespaced
 * per tenant and every row records the purpose, so a tenant can never read
 * another tenant's object through this API.
 */

export async function uploadFile(tenantId, { buffer, originalName, mimeType, purpose = 'other', userId, meta = {} }) {
  if (!FILE_PURPOSES.includes(purpose)) throw ApiError.badRequest(`Unknown upload purpose "${purpose}"`);

  const kind = ['document', 'expense_receipt'].includes(purpose) ? 'document' : 'image';
  const { mimeType: detected, extension } = validateUpload(buffer, mimeType, kind);

  const storage = await getStorage();
  const key = buildStorageKey({ tenantId, purpose, extension });
  const stored = await storage.put({ key, buffer, contentType: detected });

  const res = await query(
    `INSERT INTO files (tenant_id, uploaded_by, bucket, storage_key, filename, mime_type, byte_size, purpose, url, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      tenantId,
      userId ?? null,
      storage.name,
      key,
      String(originalName || `upload.${extension}`).slice(0, 200),
      detected,
      buffer.length,
      purpose,
      stored.url || storage.urlFor?.(key) || `/api/files/${key}/download`,
      JSON.stringify(meta),
    ],
  );

  return shape(res.rows[0]);
}

export async function listFiles(tenantId, { purpose, limit = 50 } = {}) {
  const params = [tenantId, Math.min(Number(limit) || 50, 200)];
  let sql = 'SELECT * FROM files WHERE tenant_id = $1';
  if (purpose) {
    params.push(purpose);
    sql += ' AND purpose = $3';
  }
  sql += ' ORDER BY created_at DESC LIMIT $2';
  const res = await query(sql, params);
  return res.rows.map(shape);
}

export async function getFile(tenantId, fileId) {
  const res = await query('SELECT * FROM files WHERE tenant_id = $1 AND id = $2', [tenantId, fileId]);
  if (!res.rows[0]) throw ApiError.notFound('File not found');
  return res.rows[0];
}

export async function deleteFile(tenantId, fileId, actor) {
  const file = await getFile(tenantId, fileId);
  const storage = await getStorage();
  await storage.remove(file.storage_key).catch(() => {
    /* the object may already be gone; the row is the source of truth */
  });
  await query('DELETE FROM files WHERE tenant_id = $1 AND id = $2', [tenantId, fileId]);
  await logAudit(query, {
    tenantId,
    userId: actor?.userId,
    userLabel: actor?.userLabel,
    action: 'file.deleted',
    entity: 'file',
    entityId: fileId,
    metadata: { filename: file.filename, purpose: file.purpose },
  });
  return { ok: true };
}

function shape(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    purpose: row.purpose,
    url: row.url,
    storageKey: row.storage_key,
    meta: row.meta || {},
    createdAt: row.created_at,
  };
}
