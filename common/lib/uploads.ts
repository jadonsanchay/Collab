import { getMyUserId } from './identity';

export type UploadedImage = { url: string; width: number; height: number };

type Presigned = {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  publicUrl: string;
};

const measure = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();

    img.addEventListener('load', () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight }),
    );
    img.addEventListener('error', () => reject(new Error('unreadable image')));
    img.src = dataUrl;
  });

/**
 * Uploads a pasted or moved image through the presigned-PUT flow and
 * returns what the move should carry. Null when anything fails, in which
 * case the caller sends the image inline as before and the server offloads
 * it; the drawing must never be lost to an upload hiccup.
 */
export const uploadImage = async (dataUrl: string): Promise<UploadedImage | null> => {
  try {
    const [blob, size] = await Promise.all([
      fetch(dataUrl).then((response) => response.blob()),
      measure(dataUrl),
    ]);

    const presign = await fetch('/api/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-collab-user': getMyUserId() },
      body: JSON.stringify({ contentType: blob.type, size: blob.size }),
    });

    if (!presign.ok) return null;

    const upload = (await presign.json()) as Presigned;

    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: blob,
    });

    if (!put.ok) return null;

    return { url: upload.publicUrl, ...size };
  } catch {
    return null;
  }
};
