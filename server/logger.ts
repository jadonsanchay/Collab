import pino from 'pino';

// One shared instance for the whole server. The level is env-driven so
// production can be quieted without a code change, and tests stay silent
// unless LOG_LEVEL is set explicitly while debugging one.
export const logger = pino({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});
