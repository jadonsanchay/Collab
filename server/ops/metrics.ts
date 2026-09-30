import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';

/**
 * Prometheus metrics for `/metrics`. One registry per process; the gauges
 * that describe live state are set from callbacks so they are always
 * current when scraped.
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'collab_process_' });

export const connectedSockets = new Gauge({
  name: 'collab_connected_sockets',
  help: 'Sockets currently connected to this node.',
  registers: [registry],
});

export const activeRooms = new Gauge({
  name: 'collab_active_rooms',
  help: 'Rooms held in memory on this node.',
  registers: [registry],
});

export const movesTotal = new Counter({
  name: 'collab_moves_total',
  help: 'Moves accepted and stored.',
  registers: [registry],
});

export const aiJobsTotal = new Counter({
  name: 'collab_ai_jobs_total',
  help: 'AI requests by final status.',
  labelNames: ['kind', 'status'] as const,
  registers: [registry],
});

export const aiTokensTotal = new Counter({
  name: 'collab_ai_tokens_total',
  help: 'Model tokens used by AI requests.',
  labelNames: ['direction'] as const,
  registers: [registry],
});

export const jobQueueDepth = new Gauge({
  name: 'collab_job_queue_depth',
  help: 'Jobs waiting or running, by queue.',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const persistenceBatchesDropped = new Counter({
  name: 'collab_persistence_batches_dropped_total',
  help: 'Write batches given up on after retries.',
  registers: [registry],
});
