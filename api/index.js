/**
 * Vercel function entry point.
 *
 * Vercel's Filesystem API only discovers functions inside an `api/` directory at
 * the project root, so this shim exists purely to put the handler where the
 * platform looks for it. The implementation stays in `server/api/index.js` -
 * there is still exactly one serverless entry point, and this file adds no
 * behaviour of its own.
 *
 * Routing (see vercel.json):
 *   /api/*      -> rewritten to this function, Express receives the original
 *                  path, so the app's own `/api` routers match unchanged.
 *   /storage/*  -> same function; served by the app's static handler.
 *   everything else -> the built SPA in web/dist.
 */
import handler from '../server/api/index.js';

export default handler;
