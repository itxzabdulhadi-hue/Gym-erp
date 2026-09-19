/**
 * Vercel serverless entry point.
 *
 * Vercel invokes the default export per request instead of listening on a port,
 * so the only difference from `src/index.js` is that nothing calls
 * app.listen() and there is no graceful-shutdown hook. The Express app itself
 * is built by the same `createApp()` factory, which is what keeps local,
 * Docker and serverless behaviour identical.
 *
 * The app (and therefore the pg Pool inside it) is created once per warm
 * instance and reused across invocations rather than per request.
 */
import { createApp } from '../src/app.js';
import { logger } from '../src/utils/logger.js';

const app = createApp();

export default function handler(req, res) {
  app(req, res, (err) => {
    // Reached only when no route matched and the 404 handler did not respond.
    if (err) logger.error('unhandled error in serverless handler', { err: err.stack });
    if (res.headersSent) return;
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  });
}
