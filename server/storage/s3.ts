import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ObjectStorage, PresignedUpload } from './index';

const PRESIGN_TTL_S = 60;

/**
 * S3-compatible storage: Cloudflare R2, MinIO, or S3 itself. The bucket must
 * allow public GET (or sit behind `S3_PUBLIC_URL`) and CORS from the app
 * origin, so the browser can PUT to the presigned URL and the canvas stays
 * untainted when it draws the result.
 */
export class S3Storage implements ObjectStorage {
  readonly kind = 's3' as const;

  private client: S3Client;

  constructor(
    private options: {
      bucket: string;
      endpoint?: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      publicUrl?: string;
    },
  ) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      const bytes = await result.Body?.transformToByteArray();

      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }

  async delete(keys: string[]) {
    if (!keys.length) return;

    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.options.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  }

  publicUrl(key: string) {
    if (this.options.publicUrl) return new URL(key, `${this.options.publicUrl}/`).toString();

    const base = this.options.endpoint ?? `https://s3.${this.options.region}.amazonaws.com`;

    return `${base.replace(/\/$/u, '')}/${this.options.bucket}/${key}`;
  }

  keyFor(url: string): string | null {
    const prefix = this.publicUrl('');

    return url.startsWith(prefix) ? url.slice(prefix.length).split('?')[0] : null;
  }

  async presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: maxBytes,
      }),
      { expiresIn: PRESIGN_TTL_S },
    );

    return {
      method: 'PUT',
      url,
      headers: { 'Content-Type': contentType },
      publicUrl: this.publicUrl(key),
      key,
      expiresAt: Date.now() + PRESIGN_TTL_S * 1000,
    };
  }
}
