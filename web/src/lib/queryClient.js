import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient for the app.
 *
 * Stale time is deliberately short for operational data (attendance, payments)
 * and longer for catalogues that rarely change (plans, permissions), so the UI
 * feels live without hammering the API.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        // Never retry an authorisation or validation failure - it will not fix itself.
        if (error?.status && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/** Keys grouped so a mutation can invalidate precisely what it changed. */
export const queryKeys = {
  me: ['me'],
  members: (params) => ['members', params ?? {}],
  member: (id) => ['members', id],
  memberSub: (id, section) => ['members', id, section],
  plans: (params) => ['membership-plans', params ?? {}],
  memberships: (params) => ['memberships', params ?? {}],
  membership: (id) => ['memberships', id],
  attendance: (params) => ['attendance', params ?? {}],
  attendanceToday: ['attendance', 'today'],
  payments: (params) => ['payments', params ?? {}],
  payment: (id) => ['payments', id],
  paymentsSummary: ['payments', 'summary'],
  trainers: (params) => ['trainers', params ?? {}],
  trainer: (id) => ['trainers', id],
  exercises: (params) => ['exercises', params ?? {}],
  workoutPlans: (params) => ['workout-plans', params ?? {}],
  progress: (params) => ['progress', params ?? {}],
  expenses: (params) => ['expenses', params ?? {}],
  expensesSummary: ['expenses', 'summary'],
  reports: (name, params) => ['reports', name, params ?? {}],
  dashboard: ['dashboard'],
  dashboardLayout: ['dashboard', 'layout'],
  notifications: (params) => ['notifications', params ?? {}],
  themes: ['themes'],
  branding: ['branding'],
  modules: ['modules'],
  settings: (section) => ['settings', section ?? 'all'],
  users: (params) => ['users', params ?? {}],
  roles: ['roles'],
  permissions: ['permissions'],
  auditLogs: (params) => ['audit-logs', params ?? {}],
  insights: (name) => ['insights', name],
};

export default queryClient;
