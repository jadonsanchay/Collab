import type { Config } from '../config';
import { logger } from '../logger';
import { LocalStorage } from './local';
import { S3Storage } from './s3';

/** A URL the browser can PUT bytes to, once, soon. */
export type PresignedUpload = {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  /** Where the object will be readable once uploaded. */
  publicUrl: string;
  key: string;
  expiresAt: number;
};

/**
 * Where binary things live: pasted images, board snapshots, thumbnails.
 * Keys are paths such as `boards/<id>/snapshots/<seq>.png`. The local
 * implementation is a directory served by this server; the S3 one works
 * with R2 and MinIO. Both hand the browser a presigned PUT so image bytes
 * never travel through the socket.
 */
export interface ObjectStorage {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Null when the object is not there. Used by the server-side renderer. */
  get(key: string): Promise<Buffer | null>;
  delete(keys: string[]): Promise<void>;
  publicUrl(key: string): string;
  /** The key a public URL of ours refers to, or null for a foreign URL. */
  keyFor(url: string): string | null;
  presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
}

export const createStorage = (config: Config): ObjectStorage => {
  if (config.S3_BUCKET) {
    if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
      throw new Error('S3_BUCKET requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    }

    logger.info({ bucket: config.S3_BUCKET, endpoint: config.S3_ENDPOINT }, 'storage: s3');

    return new S3Storage({
      bucket: config.S3_BUCKET,
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      publicUrl: config.S3_PUBLIC_URL,
    });
  }

  logger.info({ dir: config.UPLOADS_DIR }, 'storage: local filesystem');

  return new LocalStorage({
    dir: config.UPLOADS_DIR,
    publicUrl: config.PUBLIC_URL,
    secret: config.AUTH_SECRET ?? 'dev-only-upload-secret',
  });
};
