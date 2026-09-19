import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/env.js';

/**
 * Local disk driver - development only.
 *
 * Serverless filesystems (Vercel) are ephemeral, so production deployments must
 * use STORAGE_DRIVER=s3 with any S3 compatible bucket.
 */
export function createLocalStorage() {
  const root = path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR);
  const baseUrl = (config.STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, '');

  return {
    name: 'local',
    root,
    async put({ key, buffer }) {
      const target = safeJoin(root, key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
      return { key, url: `${baseUrl}/storage/${key}` };
    },
    async get(key) {
      return fs.readFile(safeJoin(root, key));
    },
    async remove(key) {
      await fs.rm(safeJoin(root, key), { force: true });
    },
    urlFor(key) {
      return `${baseUrl}/storage/${key}`;
    },
    /** Absolute filesystem path, used to serve /storage statically in dev. */
    absolutePath(key) {
      return safeJoin(root, key);
    },
  };
}

/** Refuse `..` traversal before touching the filesystem. */
function safeJoin(root, key) {
  const target = path.resolve(root, key);
  if (!target.startsWith(path.resolve(root))) throw new Error('Unsafe storage key');
  return target;
}
