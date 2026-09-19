/** Minimal structured logger. Never logs secrets or full request bodies. */
import config from '../config/env.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const active = LEVELS[config.LOG_LEVEL] ?? LEVELS.info;

function write(level, scope, message, meta) {
  if (LEVELS[level] > active) return;
  const line = { ts: new Date().toISOString(), level, scope, message };
  if (meta !== undefined) line.meta = meta;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  error: (scope, message, meta) => write('error', scope, message, meta),
  warn: (scope, message, meta) => write('warn', scope, message, meta),
  info: (scope, message, meta) => write('info', scope, message, meta),
  debug: (scope, message, meta) => write('debug', scope, message, meta),
  child(scope) {
    return {
      error: (m, meta) => write('error', scope, m, meta),
      warn: (m) => write('warn', scope, m),
      info: (m, meta) => write('info', scope, m, meta),
      debug: (m, meta) => write('debug', scope, m, meta),
    };
  },
};

export default logger;
