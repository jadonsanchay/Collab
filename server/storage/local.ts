import { createHmac, timingSafeEqual } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import type { ObjectStorage, PresignedUpload } from './index';

/** Keys are path-like; anything else is refused before it touches the disk. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/u;

export const isValidKey = (key: string) =>
  KEY_PATTERN.test(key) && !key.includes('..') && !key.includes('//');

/** How long a presigned local upload URL stays valid. */
export const PRESIGN_TTL_MS = 60_000;

export const UPLOAD_PATH = '/uploads';
export const UPLOAD_PUT_PATH = '/api/uploads/put';

/**
 * Object storage on this server's disk, served under `/uploads/<key>`.
 * Presigned uploads are a signed URL to `/api/uploads/put` that the Express
 * route in `server/storage/routes.ts` verifies before writing. Good for a
 * single node and for development; S3 for anything else.
 */
export class LocalStorage implements ObjectStorage {
  readonly kind = 'local' as const;

  constructor(
    private options: { dir: string; publicUrl?: string; secret: string },
  ) {}

  private pathFor(key: string) {
    if (!isValidKey(key)) throw new Error(`invalid storage key: ${key}`);

    return path.join(this.options.dir, key);
  }

  async put(key: string, body: Buffer, _contentType: string) {
    const file = this.pathFor(key);

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async delete(keys: string[]) {
    await Promise.all(keys.map((key) => rm(this.pathFor(key), { force: true })));
  }

  publicUrl(key: string) {
    const relative = `${UPLOAD_PATH}/${key}`;

    return this.options.publicUrl ? new URL(relative, this.options.publicUrl).toString() : relative;
  }

  keyFor(url: string): string | null {
    const marker = `${UPLOAD_PATH}/`;
    const index = url.indexOf(marker);

    if (index === -1) return null;

    // Either our relative path or our absolute origin; anything else is foreign.
    if (index !== 0 && !(this.options.publicUrl && url.startsWith(this.options.publicUrl))) {
      return null;
    }

    const key = url.slice(index + marker.length).split('?')[0];

    return isValidKey(key) ? key : null;
  }

  sign(key: string, contentType: string, maxBytes: number, expiresAt: number) {
    return createHmac('sha256', this.options.secret)
      .update([key, contentType, String(maxBytes), String(expiresAt)].join('\n'))
      .digest('base64url');
  }

  /** True when the signature matches and the URL has not expired. */
  verify(params: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresAt: number;
    signature: string;
  }, now = Date.now()) {
    if (!isValidKey(params.key) || params.expiresAt < now) return false;

    const expected = Buffer.from(
      this.sign(params.key, params.contentType, params.maxBytes, params.expiresAt),
    );
    const given = Buffer.from(params.signature);

    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    if (!isValidKey(key)) throw new Error(`invalid storage key: ${key}`);

    const expiresAt = Date.now() + PRESIGN_TTL_MS;
    const signature = this.sign(key, contentType, maxBytes, expiresAt);
    const query = new URLSearchParams({
      key,
      type: contentType,
      max: String(maxBytes),
      exp: String(expiresAt),
      sig: signature,
    });
    const relative = `${UPLOAD_PUT_PATH}?${query.toString()}`;

    return {
      method: 'PUT',
      url: this.options.publicUrl ? new URL(relative, this.options.publicUrl).toString() : relative,
      headers: { 'Content-Type': contentType },
      publicUrl: this.publicUrl(key),
      key,
      expiresAt,
    };
  }
}
