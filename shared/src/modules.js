/**
 * Module registry.
 *
 * This is the single source of truth for "what features exist".
 * Both the API (for route guarding) and the web client (for navigation,
 * route registration and settings) read from this file, so enabling or
 * disabling a module happens in exactly one place per tenant.
 *
 * Adding a future vertical (salon, clinic, school, ...) means adding entries
 * here plus the matching tables/routes - the shell, auth, theming, users,
 * roles, audit log and settings never change.
 */

/** Actions that every "resource" module understands unless overridden. */
const CRUD = ['view', 'create', 'edit', 'delete'];

const MODULE_DEFS = [
  // ---------------------------------------------------------------- core ---
  {
    key: 'dashboard',
    group: 'core',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    path: '/dashboard',
    order: 10,
    defaultEnabled: true,
    actions: ['view', 'customize'],
  },
  {
    key: 'members',
    group: 'gym',
    label: 'Members',
    icon: 'Users',
    path: '/members',
    order: 20,
    defaultEnabled: true,
    actions: [...CRUD, 'import', 'export'],
  },
  {
    key: 'memberships',
    group: 'gym',
    label: 'Memberships',
    icon: 'CreditCard',
    path: '/memberships',
    order: 30,
    defaultEnabled: true,
    actions: [...CRUD, 'renew', 'freeze', 'cancel'],
  },
  {
    key: 'attendance',
    group: 'gym',
    label: 'Attendance',
    icon: 'Fingerprint',
    path: '/attendance',
    order: 40,
    defaultEnabled: true,
    actions: ['view', 'checkin', 'checkout', 'edit', 'delete', 'export'],
  },
  {
    key: 'trainers',
    group: 'gym',
    label: 'Trainers',
    icon: 'Dumbbell',
    path: '/trainers',
    order: 50,
    defaultEnabled: true,
    actions: CRUD,
  },
  {
    key: 'workouts',
    group: 'gym',
    label: 'Workout Plans',
    icon: 'ClipboardList',
    path: '/workouts',
    order: 60,
    defaultEnabled: true,
    actions: [...CRUD, 'assign'],
  },
  {
    key: 'progress',
    group: 'gym',
    label: 'Progress Tracking',
    icon: 'TrendingUp',
    path: '/progress',
    order: 70,
    defaultEnabled: true,
    actions: CRUD,
  },
  {
    key: 'payments',
    group: 'gym',
    label: 'Payments',
    icon: 'Banknote',
    path: '/payments',
    order: 80,
    defaultEnabled: true,
    actions: [...CRUD, 'refund', 'export'],
  },
  {
    key: 'expenses',
    group: 'gym',
    label: 'Expenses',
    icon: 'Receipt',
    path: '/expenses',
    order: 90,
    defaultEnabled: true,
    actions: CRUD,
  },
  {
    key: 'reports',
    group: 'gym',
    label: 'Reports',
    icon: 'BarChart3',
    path: '/reports',
    order: 100,
    defaultEnabled: true,
    actions: ['view', 'export'],
  },
  // ------------------------------------------------------------- platform --
  {
    key: 'users',
    group: 'platform',
    label: 'Users',
    icon: 'UserCog',
    path: '/settings/users',
    order: 200,
    defaultEnabled: true,
    settingsOnly: true,
    actions: [...CRUD, 'impersonate'],
  },
  {
    key: 'roles',
    group: 'platform',
    label: 'Roles & Permissions',
    icon: 'ShieldCheck',
    path: '/settings/roles',
    order: 210,
    defaultEnabled: true,
    settingsOnly: true,
    actions: CRUD,
  },
  {
    key: 'notifications',
    group: 'platform',
    label: 'Notifications',
    icon: 'Bell',
    path: '/notifications',
    order: 220,
    defaultEnabled: true,
    actions: ['view', 'manage'],
  },
  {
    key: 'audit',
    group: 'platform',
    label: 'Audit Log',
    icon: 'ScrollText',
    path: '/settings/audit',
    order: 230,
    defaultEnabled: true,
    settingsOnly: true,
    actions: ['view', 'export'],
  },
  {
    key: 'settings',
    group: 'platform',
    label: 'Settings',
    icon: 'Settings',
    path: '/settings',
    order: 240,
    defaultEnabled: true,
    settingsOnly: true,
    actions: ['view', 'manage'],
  },
];

/** Flat list of modules, sorted by navigation order. */
export const MODULES = MODULE_DEFS.map((m) => Object.freeze({ ...m })).sort(
  (a, b) => a.order - b.order,
);

export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Modules that are part of the always-on platform core. */
export const CORE_MODULE_KEYS = MODULES.filter((m) => m.group !== 'gym').map((m) => m.key);

/**
 * Permission catalogue, derived from the module registry.
 * Nothing is hardcoded per-component: components ask for `hasPermission('members.create')`.
 */
export const PERMISSIONS = MODULE_DEFS.flatMap((mod) =>
  mod.actions.map((action) => ({
    key: `${mod.key}.${action}`,
    module: mod.key,
    action,
    label: humanizeAction(action, mod.label),
    description: `${humanizeAction(action, mod.label)} (${mod.label} module)`,
    group: mod.group,
  })),
);

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Extra cross-cutting permissions that are not tied to a single module. */
export const PLATFORM_PERMISSIONS = [
  {
    key: 'branding.view',
    module: 'settings',
    action: 'view',
    label: 'View branding',
    description: 'See business name, logos and contact details',
    group: 'platform',
  },
  {
    key: 'branding.manage',
    module: 'settings',
    action: 'manage',
    label: 'Manage branding',
    description: 'Change business name, logos, favicon and contact details',
    group: 'platform',
  },
  {
    key: 'theme.view',
    module: 'settings',
    action: 'view',
    label: 'View themes',
    description: 'See the available themes and the active one',
    group: 'platform',
  },
  {
    key: 'theme.manage',
    module: 'settings',
    action: 'manage',
    label: 'Manage theme',
    description: 'Create, edit and apply themes and custom CSS',
    group: 'platform',
  },
  {
    key: 'modules.manage',
    module: 'settings',
    action: 'manage',
    label: 'Manage modules',
    description: 'Enable or disable platform modules for this business',
    group: 'platform',
  },
  {
    key: 'files.upload',
    module: 'settings',
    action: 'upload',
    label: 'Upload files',
    description: 'Upload logos, photos and documents',
    group: 'platform',
  },
  {
    key: 'data.manage',
    module: 'settings',
    action: 'manage',
    label: 'Manage tenant data',
    description: 'Export or wipe business data',
    group: 'platform',
  },
];

export const ALL_PERMISSIONS = [...PERMISSIONS, ...PLATFORM_PERMISSIONS];
export const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map((p) => p.key);

function humanizeAction(action, moduleLabel) {
  const verb = {
    view: 'View',
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    import: 'Import',
    export: 'Export',
    renew: 'Renew',
    freeze: 'Freeze',
    cancel: 'Cancel',
    checkin: 'Check in',
    checkout: 'Check out',
    assign: 'Assign',
    refund: 'Refund',
    manage: 'Manage',
    customize: 'Customize',
    impersonate: 'Impersonate',
  }[action];
  return `${verb || action} ${moduleLabel.toLowerCase()}`;
}

/**
 * System roles shipped with every new tenant. `permissions: ['*']` means all.
 * These are editable by the owner at runtime - they are only the starting point.
 */
export const SYSTEM_ROLES = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access to every module, setting and financial record.',
    permissions: ['*'],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Operational access: members, staff, finances and reports.',
    permissions: [
      'dashboard.view', 'dashboard.customize',
      'members.view', 'members.create', 'members.edit', 'members.delete', 'members.import', 'members.export',
      'memberships.view', 'memberships.create', 'memberships.edit', 'memberships.renew', 'memberships.freeze', 'memberships.cancel',
      'attendance.view', 'attendance.checkin', 'attendance.checkout', 'attendance.edit', 'attendance.export',
      'trainers.view', 'trainers.create', 'trainers.edit',
      'workouts.view', 'workouts.create', 'workouts.edit', 'workouts.assign',
      'progress.view', 'progress.create', 'progress.edit',
      'payments.view', 'payments.create', 'payments.edit', 'payments.refund', 'payments.export',
      'expenses.view', 'expenses.create', 'expenses.edit',
      'reports.view', 'reports.export',
      'notifications.view',
      'users.view',
      'files.upload',
    ],
  },
  {
    key: 'receptionist',
    name: 'Receptionist',
    description: 'Front desk: members, attendance, memberships and payments.',
    permissions: [
      'dashboard.view',
      'members.view', 'members.create', 'members.edit',
      'memberships.view', 'memberships.create', 'memberships.renew', 'memberships.freeze',
      'attendance.view', 'attendance.checkin', 'attendance.checkout',
      'trainers.view',
      'payments.view', 'payments.create',
      'notifications.view',
      'files.upload',
    ],
  },
  {
    key: 'trainer',
    name: 'Trainer',
    description: 'Assigned members, workout plans and progress tracking.',
    permissions: [
      'dashboard.view',
      'members.view',
      'memberships.view',
      'attendance.view', 'attendance.checkin',
      'trainers.view',
      'workouts.view', 'workouts.create', 'workouts.edit', 'workouts.assign',
      'progress.view', 'progress.create', 'progress.edit',
      'notifications.view',
    ],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Payments, expenses and financial reporting.',
    permissions: [
      'dashboard.view',
      'members.view',
      'memberships.view',
      'payments.view', 'payments.create', 'payments.edit', 'payments.refund', 'payments.export',
      'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete',
      'reports.view', 'reports.export',
      'notifications.view',
    ],
  },
];

/**
 * Dashboard widget catalogue. Layouts are stored per user and reference these ids,
 * so the dashboard is data driven rather than a fixed page.
 */
export const DASHBOARD_WIDGETS = [
  { id: 'stat.totalMembers', type: 'stat', label: 'Total members', metric: 'totalMembers', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.activeMembers', type: 'stat', label: 'Active members', metric: 'activeMembers', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.newMembers', type: 'stat', label: 'New members (30d)', metric: 'newMembers', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.expiringMemberships', type: 'stat', label: 'Expiring in 7 days', metric: 'expiringMemberships', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.expiredMemberships', type: 'stat', label: 'Expired memberships', metric: 'expiredMemberships', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.todayCheckins', type: 'stat', label: "Today's check-ins", metric: 'todayCheckins', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.revenue', type: 'stat', label: 'Revenue (30d)', metric: 'revenue30d', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.pendingPayments', type: 'stat', label: 'Pending payments', metric: 'pendingPayments', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.expenses', type: 'stat', label: 'Expenses (30d)', metric: 'expenses30d', defaultSize: { w: 3, h: 1 } },
  { id: 'stat.netRevenue', type: 'stat', label: 'Net revenue (30d)', metric: 'netRevenue30d', defaultSize: { w: 3, h: 1 } },
  { id: 'chart.attendance', type: 'chart', label: 'Attendance (14 days)', metric: 'attendanceTrend', defaultSize: { w: 6, h: 3 } },
  { id: 'chart.revenue', type: 'chart', label: 'Revenue (12 months)', metric: 'revenueTrend', defaultSize: { w: 6, h: 3 } },
  { id: 'chart.membershipGrowth', type: 'chart', label: 'Membership growth', metric: 'membershipGrowth', defaultSize: { w: 6, h: 3 } },
  { id: 'chart.planDistribution', type: 'chart', label: 'Plan distribution', metric: 'planDistribution', defaultSize: { w: 6, h: 3 } },
  { id: 'list.recentPayments', type: 'list', label: 'Recent payments', metric: 'recentPayments', defaultSize: { w: 6, h: 3 } },
  { id: 'list.recentMembers', type: 'list', label: 'Recent members', metric: 'recentMembers', defaultSize: { w: 6, h: 3 } },
  { id: 'list.expiringSoon', type: 'list', label: 'Expiring soon', metric: 'expiringList', defaultSize: { w: 6, h: 3 } },
];

export const DEFAULT_DASHBOARD_LAYOUT = [
  'stat.totalMembers', 'stat.activeMembers', 'stat.newMembers', 'stat.todayCheckins',
  'stat.revenue', 'stat.pendingPayments', 'stat.expenses', 'stat.netRevenue',
  'chart.revenue', 'chart.attendance',
  'list.recentPayments', 'list.recentMembers',
];

export function getModule(key) {
  return MODULES.find((m) => m.key === key) || null;
}
