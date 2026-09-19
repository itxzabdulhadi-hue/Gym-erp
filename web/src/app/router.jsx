import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { RequireAuth, RequireModule, RequirePermission, RedirectIfAuthenticated } from './guards';
import { PageLoader } from '@/components/ui/States';
import { NotFoundPage } from '@/pages/errors/StatusPages';

/**
 * Routes.
 *
 * Every screen is lazily imported so the initial bundle carries only the shell,
 * the design system and the first paint. The ERP has too many screens to ship
 * as one file, and a gym receptionist opening the attendance screen should not
 * download the report builder.
 */
const LoginPage = lazy(() => import('@/pages/Login'));
const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const ComingSoon = lazy(() => import('@/pages/ComingSoon'));
const MembersPage = lazy(() => import('@/features/members/MembersPage'));
const MemberProfilePage = lazy(() => import('@/features/members/MemberProfilePage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const ThemeSettingsPage = lazy(() => import('@/pages/settings/ThemeSettingsPage'));

const screen = (element, { permission, module: moduleName } = {}) => (
  <RequireModule module={moduleName}>
    <RequirePermission permission={permission}>{element}</RequirePermission>
  </RequireModule>
);

const withSuspense = (node) => <Suspense fallback={<PageLoader />}>{node}</Suspense>;

export const router = createBrowserRouter([
  {
    path: '/login',
    element: withSuspense(
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>,
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: withSuspense(<DashboardPage />) },

      {
        path: 'members',
        element: withSuspense(screen(<MembersPage />, { module: 'members', permission: ['members.view'] })),
      },
      {
        path: 'members/:id',
        element: withSuspense(screen(<MemberProfilePage />, { module: 'members', permission: ['members.view'] })),
      },
      { path: 'memberships', element: withSuspense(screen(<ComingSoon />, { module: 'memberships', permission: ['memberships.view'] })) },
      { path: 'attendance', element: withSuspense(screen(<ComingSoon />, { module: 'attendance', permission: ['attendance.view'] })) },
      { path: 'payments', element: withSuspense(screen(<ComingSoon />, { module: 'payments', permission: ['payments.view'] })) },
      { path: 'trainers', element: withSuspense(screen(<ComingSoon />, { module: 'trainers', permission: ['trainers.view'] })) },
      { path: 'workouts', element: withSuspense(screen(<ComingSoon />, { module: 'workouts', permission: ['workouts.view'] })) },
      { path: 'progress', element: withSuspense(screen(<ComingSoon />, { module: 'progress', permission: ['progress.view'] })) },
      { path: 'expenses', element: withSuspense(screen(<ComingSoon />, { module: 'expenses', permission: ['expenses.view'] })) },
      { path: 'reports', element: withSuspense(screen(<ComingSoon />, { module: 'reports', permission: ['reports.view'] })) },
      { path: 'notifications', element: withSuspense(screen(<ComingSoon />, { module: 'notifications', permission: ['notifications.view'] })) },
      { path: 'users', element: withSuspense(screen(<ComingSoon />, { module: 'users', permission: ['users.view'] })) },
      { path: 'roles', element: withSuspense(screen(<ComingSoon />, { module: 'roles', permission: ['roles.view'] })) },
      { path: 'audit', element: withSuspense(screen(<ComingSoon />, { module: 'audit', permission: ['audit.view'] })) },
      {
        path: 'settings',
        element: withSuspense(screen(<SettingsPage />, { module: 'settings', permission: ['settings.view'] })),
        children: [
          { index: true, element: withSuspense(<ComingSoon />) },
          { path: 'theme', element: withSuspense(<ThemeSettingsPage />) },
          { path: 'branding', element: withSuspense(<ComingSoon />) },
          { path: 'modules', element: withSuspense(<ComingSoon />) },
          { path: 'users', element: withSuspense(<ComingSoon />) },
          { path: 'roles', element: withSuspense(<ComingSoon />) },
          { path: 'notifications', element: withSuspense(<ComingSoon />) },
          { path: 'membership', element: withSuspense(<ComingSoon />) },
          { path: 'attendance', element: withSuspense(<ComingSoon />) },
          { path: 'payments', element: withSuspense(<ComingSoon />) },
          { path: 'security', element: withSuspense(<ComingSoon />) },
          { path: 'audit', element: withSuspense(<ComingSoon />) },
          { path: 'profile', element: withSuspense(<ComingSoon />) },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default router;
