import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isValidKey, LocalStorage } from './local';

describe('LocalStorage', () => {
  let dir: string;
  let storage: LocalStorage;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'collab-storage-'));
    storage = new LocalStorage({ dir, secret: 'test-secret' });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes, reads, lists a public URL, and deletes', async () => {
    await storage.put('boards/abc/thumb.webp', Buffer.from('bytes'), 'image/webp');

    expect((await readFile(path.join(dir, 'boards/abc/thumb.webp'))).toString()).toBe('bytes');
    expect((await storage.get('boards/abc/thumb.webp'))?.toString()).toBe('bytes');
    expect(storage.publicUrl('boards/abc/thumb.webp')).toBe('/uploads/boards/abc/thumb.webp');

    await storage.delete(['boards/abc/thumb.webp']);

    expect(await storage.get('boards/abc/thumb.webp')).toBeNull();
  });

  it('maps its own URLs back to keys and rejects foreign ones', () => {
    expect(storage.keyFor('/uploads/boards/abc/x.png')).toBe('boards/abc/x.png');
    expect(storage.keyFor('/uploads/boards/abc/x.png?v=2')).toBe('boards/abc/x.png');
    expect(storage.keyFor('https://elsewhere.example/uploads/x.png')).toBeNull();
    expect(storage.keyFor('data:image/png;base64,AAAA')).toBeNull();

    const absolute = new LocalStorage({
      dir,
      secret: 's',
      publicUrl: 'https://collab.example',
    });

    expect(absolute.publicUrl('k.png')).toBe('https://collab.example/uploads/k.png');
    expect(absolute.keyFor('https://collab.example/uploads/k.png')).toBe('k.png');
  });

  it('refuses keys that could escape the directory', async () => {
    expect(isValidKey('../etc/passwd')).toBe(false);
    expect(isValidKey('/absolute')).toBe(false);
    expect(isValidKey('a//b')).toBe(false);
    expect(isValidKey('boards/ok_1.png')).toBe(true);

    await expect(storage.put('../escape', Buffer.from(''), 'text/plain')).rejects.toThrow(/invalid/);
  });

  it('presigns an upload that verifies until it expires or is tampered with', async () => {
    const signed = await storage.presignPut('img/one.webp', 'image/webp', 1000);
    const url = new URL(signed.url, 'http://localhost');
    const params = {
      key: url.searchParams.get('key') ?? '',
      contentType: url.searchParams.get('type') ?? '',
      maxBytes: Number(url.searchParams.get('max')),
      expiresAt: Number(url.searchParams.get('exp')),
      signature: url.searchParams.get('sig') ?? '',
    };

    expect(signed.method).toBe('PUT');
    expect(signed.publicUrl).toBe('/uploads/img/one.webp');
    expect(storage.verify(params)).toBe(true);
    expect(storage.verify({ ...params, maxBytes: 999_999 })).toBe(false);
    expect(storage.verify({ ...params, key: 'img/other.webp' })).toBe(false);
    expect(storage.verify(params, params.expiresAt + 1)).toBe(false);
  });
});
