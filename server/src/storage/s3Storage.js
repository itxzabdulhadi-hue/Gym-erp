import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * S3 compatible driver (AWS S3, Cloudflare R2, MinIO, Wasabi, ...).
 *
 * The AWS SDK is an optional dependency: it is imported lazily so a project
 * that only uses local storage never needs it installed.
 */
export async function createS3Storage() {
  const {
    S3_BUCKET: bucket,
    S3_REGION: region,
    S3_ENDPOINT: endpoint,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
    S3_FORCE_PATH_STYLE: forcePathStyle,
  } = config;

  if (!bucket) {
    throw new ApiError(500, 'Object storage is not configured (S3_BUCKET is empty)', {
      code: 'STORAGE_UNAVAILABLE',
    });
  }

  let sdk;
  try {
    sdk = await import('@aws-sdk/client-s3');
  } catch {
    throw new ApiError(500, 'S3 storage is selected but @aws-sdk/client-s3 is not installed. Run: npm i @aws-sdk/client-s3', {
      code: 'STORAGE_UNAVAILABLE',
    });
  }
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = sdk;

  const client = new S3Client({
    region: region || 'auto',
    endpoint: endpoint || undefined,
    forcePathStyle: Boolean(forcePathStyle),
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
  });

  const publicBase = (config.STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, '');

  return {
    name: 's3',
    async put({ key, buffer, contentType }) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
      return { key, url: publicBase ? `${publicBase}/${key}` : undefined };
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    urlFor(key) {
      return publicBase ? `${publicBase}/${key}` : undefined;
    },
  };
}
