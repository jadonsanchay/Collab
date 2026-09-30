import type { Express } from 'express';

import { logger } from '../logger';
import { registry } from './metrics';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

/**
 * Liveness, readiness and metrics.
 *
 * `/healthz` says the process is up. `/readyz` runs every dependency check
 * (a database ping, a Redis ping) and answers 503 when one fails, so a load
 * balancer stops routing joins to a node that cannot serve them while
 * existing sockets keep working. `/metrics` is Prometheus text.
 */
export const registerOpsRoutes = (app: Express, checks: ReadinessCheck[]) => {
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/readyz', async (_req, res) => {
    const results = await Promise.all(
      checks.map(async ({ name, check }) => {
        try {
          await check();

          return { name, ok: true as const };
        } catch (error) {
          logger.warn({ err: error, check: name }, 'readiness check failed');

          return { name, ok: false as const, error: (error as Error).message };
        }
      }),
    );

    const ready = results.every((result) => result.ok);

    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: results });
  });

  app.get('/metrics', async (_req, res) => {
    res.setHeader('content-type', registry.contentType);
    res.send(await registry.metrics());
  });
};
