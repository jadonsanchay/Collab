import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppServer } from '../app';
import { loadConfig } from '../config';

describe('ops endpoints', () => {
  let server: ReturnType<typeof createAppServer>;
  let origin: string;

  beforeAll(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: loadConfig({ DEFAULT_ENGINE: 'raster' }),
      readinessChecks: [
        { name: 'always-ok', check: async () => {} },
        {
          name: 'broken',
          check: async () => {
            throw new Error('dependency down');
          },
        },
      ],
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });
    origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.rooms.stop();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('is live', async () => {
    const response = await fetch(`${origin}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is not ready while a dependency check fails, and names it', async () => {
    const response = await fetch(`${origin}/readyz`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'not_ready',
      checks: expect.arrayContaining([
        { name: 'always-ok', ok: true },
        { name: 'broken', ok: false, error: 'dependency down' },
      ]),
    });
  });

  it('exposes Prometheus metrics with the app gauges', async () => {
    const response = await fetch(`${origin}/metrics`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
    expect(text).toMatch(/collab_connected_sockets 0/);
    expect(text).toMatch(/collab_active_rooms 0/);
    expect(text).toMatch(/collab_moves_total/);
    expect(text).toMatch(/collab_process_/);
  });
});
