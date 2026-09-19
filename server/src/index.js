import { createApp } from './app.js';
import config from './config/env.js';
import { closePool } from './db/index.js';
import logger from './utils/logger.js';

const app = createApp();

let listenRetries = 0;
const server = app.listen(config.PORT, '0.0.0.0', () => {
  logger.info('server', `API listening on http://0.0.0.0:${config.PORT} (${config.NODE_ENV})`);
});

// `node --watch` can restart before the previous process has released the port.
// Retry briefly instead of dying, which would leave the dev server silently down.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && listenRetries < 10) {
    listenRetries += 1;
    logger.warn('server', `Port ${config.PORT} is still busy - retry ${listenRetries}/10`);
    setTimeout(() => server.listen(config.PORT, '0.0.0.0'), 400);
    return;
  }
  logger.error('server', `Cannot start: ${err.message}`);
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server', `${signal} received, shutting down`);

  server.close(async () => {
    try {
      await closePool();
    } finally {
      process.exit(0);
    }
  });
  // Keep-alive connections would otherwise hold the port open past the timeout
  // below and make the next `node --watch` restart fail with EADDRINUSE.
  server.closeAllConnections?.();

  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('process', `unhandled rejection: ${reason?.message || reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error('process', `uncaught exception: ${err.message}`);
  shutdown('uncaughtException');
});

export default server;
