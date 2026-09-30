import { loadImage } from '@napi-rs/canvas';

import type { ImageLoader, LoadedImage } from '@/common/render/drawMove';

import type { ObjectStorage } from '../storage';

/**
 * The server's image loader: inline data URLs decode directly, our own
 * storage URLs are read from storage, and anything else is fetched. What
 * comes back draws with `@napi-rs/canvas` exactly as an `<img>` does in
 * the browser.
 */
export const createNodeImageLoader =
  (storage: ObjectStorage): ImageLoader =>
  async (source) => {
    if (source.startsWith('data:')) {
      const base64 = source.slice(source.indexOf(',') + 1);

      return (await loadImage(Buffer.from(base64, 'base64'))) as unknown as LoadedImage;
    }

    const key = storage.keyFor(source);

    if (key) {
      const bytes = await storage.get(key);

      if (!bytes) throw new Error(`missing object ${key}`);

      return (await loadImage(bytes)) as unknown as LoadedImage;
    }

    if (/^https?:\/\//u.test(source)) {
      const response = await fetch(source);

      if (!response.ok) throw new Error(`failed to fetch ${source}: ${response.status}`);

      return (await loadImage(Buffer.from(await response.arrayBuffer()))) as unknown as LoadedImage;
    }

    throw new Error('unsupported image source');
  };
