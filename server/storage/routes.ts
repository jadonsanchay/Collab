import { randomUUID } from 'crypto';
import path from 'path';
import express, { type Express } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { z } from 'zod';

import { userIdSchema } from '@/common/schemas/user';

import type { Config } from '../config';
import { logger } from '../logger';
import type { ObjectStorage } from './index';
import { LocalStorage, UPLOAD_PATH, UPLOAD_PUT_PATH } from './local';

const presignBodySchema = z.object({
  contentType: z.string().regex(/^image\/(png|jpeg|webp|gif)$/u),
  size: z.number().int().positive(),
});

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Twenty presigns a minute per user is a lot of pasting. */
const presignLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

/**
 * HTTP side of image uploads. `POST /api/uploads/presign` hands the browser
 * a one-time PUT URL; with local storage the PUT comes back to
 * `/api/uploads/put`, is checked against its signature, and lands in the
 * uploads directory, which is served under `/uploads`. With S3 the PUT goes
 * to the bucket and the routes here only presign.
 *
 * Identity for now is the client's stable user id in a header; Phase 3's
 * guest cookie and session take over in a later step.
 */
export const registerUploadRoutes = (
  app: Express,
  { storage, config }: { storage: ObjectStorage; config: Config },
) => {
  if (storage instanceof LocalStorage) {
    app.use(
      UPLOAD_PATH,
      express.static(path.resolve(process.cwd(), config.UPLOADS_DIR), {
        maxAge: '365d',
        immutable: true,
        fallthrough: false,
      }),
    );

    app.put(
      UPLOAD_PUT_PATH,
      express.raw({ type: () => true, limit: config.UPLOAD_MAX_BYTES }),
      async (req, res) => {
        const params = {
          key: String(req.query.key ?? ''),
          contentType: String(req.query.type ?? ''),
          maxBytes: Number(req.query.max),
          expiresAt: Number(req.query.exp),
          signature: String(req.query.sig ?? ''),
        };

        if (!storage.verify(params)) {
          res.status(403).json({ error: 'invalid or expired upload url' });
          return;
        }

        const body = req.body as Buffer;

        if (!Buffer.isBuffer(body) || body.length === 0 || body.length > params.maxBytes) {
          res.status(413).json({ error: 'upload too large or empty' });
          return;
        }

        try {
          await storage.put(params.key, body, params.contentType);
          res.status(204).end();
        } catch (error) {
          logger.error({ err: error, key: params.key }, 'upload failed');
          res.status(500).json({ error: 'upload failed' });
        }
      },
    );
  }

  app.post('/api/uploads/presign', express.json({ limit: '4kb' }), async (req, res) => {
    const user = userIdSchema.safeParse(req.header('x-collab-user'));

    if (!user.success) {
      res.status(401).json({ error: 'missing user id' });
      return;
    }

    try {
      await presignLimiter.consume(user.data);
    } catch {
      res.status(429).json({ error: 'too many uploads, slow down' });
      return;
    }

    const body = presignBodySchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'contentType must be an image type and size a positive integer' });
      return;
    }

    if (body.data.size > config.UPLOAD_MAX_BYTES) {
      res.status(413).json({ error: `images are limited to ${config.UPLOAD_MAX_BYTES} bytes` });
      return;
    }

    const now = new Date();
    const key = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXTENSIONS[body.data.contentType]}`;

    try {
      const upload = await storage.presignPut(key, body.data.contentType, body.data.size);

      res.json(upload);
    } catch (error) {
      logger.error({ err: error }, 'presign failed');
      res.status(500).json({ error: 'could not prepare the upload' });
    }
  });
};
