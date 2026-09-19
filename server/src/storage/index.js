import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { createLocalStorage } from './localStorage.js';

let driver = null;

/** Resolve (and memoise) the configured storage driver. */
export async function getStorage() {
  if (driver) return driver;

  if (config.STORAGE_DRIVER === 's3') {
    const { createS3Storage } = await import('./s3Storage.js');
    driver = await createS3Storage();
  } else {
    driver = createLocalStorage();
    if (config.isProduction) {
      // Not fatal, but a Vercel deployment loses uploads on every cold start.
      // eslint-disable-next-line no-console
      console.warn('[storage] local driver in production: uploads will not persist. Set STORAGE_DRIVER=s3.');
    }
  }
  return driver;
}

export function resetStorage() {
  driver = null;
}

/** Upload helpers shared by every module that stores a file. */
export const UPLOAD_RULES = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    allowed: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'],
    extensions: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' },
  },
  document: {
    maxBytes: 10 * 1024 * 1024,
    allowed: ['application/pdf'],
    extensions: { 'application/pdf': 'pdf' },
  },
};

/**
 * Detect the real type from the first bytes. The declared Content-Type comes
 * from the client and cannot be trusted on its own.
 */
export function sniffMimeType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hex = buffer.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (hex.startsWith('00000100') || hex.startsWith('00000200')) return 'image/x-icon';
  // SVG is deliberately not sniffed/allowed: it is an XML document that can
  // carry script, and logos/icons can always be exported as PNG or WebP.
  return null;
}

export function validateUpload(buffer, declaredMime, kind = 'image') {
  const rules = UPLOAD_RULES[kind] || UPLOAD_RULES.image;
  if (!buffer?.length) throw ApiError.badRequest('The uploaded file is empty');
  if (buffer.length > rules.maxBytes) {
    throw new ApiError(413, `File is larger than ${Math.round(rules.maxBytes / 1024 / 1024)} MB`, {
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  const detected = sniffMimeType(buffer);
  if (!detected) throw ApiError.badRequest('Unsupported or unrecognised file type');
  if (!rules.allowed.includes(detected)) throw ApiError.badRequest(`"${detected}" files are not allowed here`);
  if (declaredMime && declaredMime !== detected && !declaredMime.startsWith('image/')) {
    throw ApiError.badRequest('Declared file type does not match the file contents');
  }
  return { mimeType: detected, extension: rules.extensions[detected] || 'bin' };
}

export function buildStorageKey({ tenantId, purpose, extension }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `tenants/${tenantId}/${purpose}/${stamp}/${id}.${extension}`;
}
