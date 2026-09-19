#!/usr/bin/env node
/**
 * Run tenant maintenance jobs once (expiry, frozen resumes, status sync,
 * notifications). Wire this to cron / Vercel cron in production.
 */
import { runMaintenance } from '../src/core/notifications/maintenance.service.js';
import { closePool } from '../src/db/index.js';

try {
  const summary = await runMaintenance();
  console.log(JSON.stringify(summary, null, 2));
} catch (err) {
  console.error(`[maintenance] failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
