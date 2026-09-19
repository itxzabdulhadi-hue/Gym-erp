import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';

import config from './config/env.js';
import { ping } from './db/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './core/auth/auth.routes.js';
import tenantsRoutes, { publicRouter } from './core/tenants/tenants.routes.js';
import usersRoutes from './core/users/users.routes.js';
import rolesRoutes from './core/roles/roles.routes.js';
import permissionsRoutes from './core/permissions/permissions.routes.js';
import modulesRoutes from './core/modules/modules.routes.js';
import brandingRoutes from './core/branding/branding.routes.js';
import themesRoutes from './core/themes/themes.routes.js';
import filesRoutes from './core/files/files.routes.js';
import notificationsRoutes from './core/notifications/notifications.routes.js';
import settingsRoutes from './core/settings/settings.routes.js';
import dashboardRoutes from './core/dashboard/dashboard.routes.js';
import searchRoutes from './core/search/search.routes.js';
import insightsRoutes from './core/insights/insights.routes.js';
import auditRoutes from './core/audit/audit.routes.js';

// Gym vertical
import membersRoutes from './verticals/gym/members/members.routes.js';
import membershipsRoutes from './verticals/gym/memberships/memberships.routes.js';
import { plansRouter as membershipPlansRoutes } from './verticals/gym/memberships/memberships.routes.js';
import attendanceRoutes from './verticals/gym/attendance/attendance.routes.js';
import trainersRoutes from './verticals/gym/trainers/trainers.routes.js';
import workoutsRoutes from './verticals/gym/workouts/workouts.routes.js';
import progressRoutes from './verticals/gym/progress/progress.routes.js';
import paymentsRoutes from './verticals/gym/payments/payments.routes.js';
import expensesRoutes from './verticals/gym/expenses/expenses.routes.js';
import reportsRoutes from './verticals/gym/reports/reports.routes.js';

/**
 * Express application factory.
 *
 * Exported separately from the HTTP server so the same app can run under
 * `node src/index.js`, inside a test with supertest, or as a Vercel serverless
 * function (`server/api/index.js`).
 */
export function createApp() {
  const app = express();

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // The theme engine injects a <style> element with tenant CSS variables
          // and (optionally) tenant custom CSS, so inline styles are allowed.
          // Inline *scripts* are not.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", ...config.corsOrigins],
          manifestSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin requests (and non-browser clients) have no Origin header.
        if (!origin) return callback(null, true);
        if (!config.corsOrigins.length) return callback(null, true);
        return callback(null, config.corsOrigins.includes(origin));
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  if (!config.isTest) {
    app.use(morgan(config.isProduction ? 'combined' : 'dev', { skip: (req) => req.path === '/api/health' }));
  }

  // ------------------------------------------------------------- health
  app.get('/api/health', async (_req, res) => {
    try {
      const dbOk = await ping();
      res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk, ...config.public() });
    } catch (err) {
      res.status(503).json({ status: 'down', db: false, error: err.message });
    }
  });

  // ---------------------------------------------------------- platform API
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRoutes);
  app.use('/api', apiLimiter, tenantsRoutes);
  app.use('/api/users', apiLimiter, usersRoutes);
  app.use('/api/roles', apiLimiter, rolesRoutes);
  app.use('/api/permissions', apiLimiter, permissionsRoutes);
  app.use('/api/modules', apiLimiter, modulesRoutes);
  app.use('/api/branding', apiLimiter, brandingRoutes);
  app.use('/api/themes', apiLimiter, themesRoutes);
  app.use('/api/files', apiLimiter, filesRoutes);
  app.use('/api/notifications', apiLimiter, notificationsRoutes);
  app.use('/api/settings', apiLimiter, settingsRoutes);
  app.use('/api/dashboard', apiLimiter, dashboardRoutes);
  app.use('/api/search', apiLimiter, searchRoutes);
  app.use('/api/insights', apiLimiter, insightsRoutes);
  app.use('/api/audit-logs', apiLimiter, auditRoutes);

  // ------------------------------------------------------------- gym vertical
  app.use('/api/members', apiLimiter, membersRoutes);
  app.use('/api/memberships', apiLimiter, membershipsRoutes);
  app.use('/api/membership-plans', apiLimiter, membershipPlansRoutes);
  app.use('/api/attendance', apiLimiter, attendanceRoutes);
  app.use('/api/trainers', apiLimiter, trainersRoutes);
  app.use('/api/workouts', apiLimiter, workoutsRoutes);
  app.use('/api/progress', apiLimiter, progressRoutes);
  app.use('/api/payments', apiLimiter, paymentsRoutes);
  app.use('/api/expenses', apiLimiter, expensesRoutes);
  app.use('/api/reports', apiLimiter, reportsRoutes);

  // ------------------------------------------------- uploaded files (local dev)
  const storageRoot = path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR);
  if (fs.existsSync(storageRoot)) {
    app.use('/storage', express.static(storageRoot, { maxAge: '1d', index: false, dotfiles: 'deny' }));
  } else {
    app.use('/storage', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No local storage directory' } }));
  }

  // ------------------------------------------------- SPA (single service deploy)
  if (config.SERVE_WEB_DIST && fs.existsSync(config.WEB_DIST_DIR)) {
    app.use(express.static(config.WEB_DIST_DIR, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/storage).*/, (_req, res) => {
      res.sendFile(path.join(config.WEB_DIST_DIR, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
