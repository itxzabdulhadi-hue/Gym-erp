import { MODULES } from '@erp/shared';
import { moduleIcon } from './icons';

/**
 * Navigation model.
 *
 * One definition drives the sidebar, the mobile nav and the route guards, so a
 * page can never be reachable in the router while hidden in the menu (or the
 * other way round). Visibility is derived from two server-side facts only:
 * which modules the tenant has enabled, and which permissions the caller holds.
 *
 * Nothing here decides access on its own - the API re-checks every request.
 */

const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** `requires` is any-of: the first permission the caller holds is enough. */
export const NAV_ITEMS = [
  {
    group: null,
    items: [
      { to: '/', key: 'dashboard', module: 'dashboard', label: 'Dashboard' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/members', key: 'members', module: 'members', requires: ['members.view'] },
      { to: '/memberships', key: 'memberships', module: 'memberships', requires: ['memberships.view'] },
      { to: '/attendance', key: 'attendance', module: 'attendance', requires: ['attendance.view'] },
      { to: '/payments', key: 'payments', module: 'payments', requires: ['payments.view'] },
    ],
  },
  {
    group: 'Programs',
    items: [
      { to: '/trainers', key: 'trainers', module: 'trainers', requires: ['trainers.view'] },
      { to: '/workouts', key: 'workouts', module: 'workouts', requires: ['workouts.view'] },
      { to: '/progress', key: 'progress', module: 'progress', requires: ['progress.view'] },
    ],
  },
  {
    group: 'Finance',
    items: [
      { to: '/expenses', key: 'expenses', module: 'expenses', requires: ['expenses.view'] },
      { to: '/reports', key: 'reports', module: 'reports', requires: ['reports.view'] },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/notifications', key: 'notifications', module: 'notifications', requires: ['notifications.view'] },
      { to: '/users', key: 'users', module: 'users', requires: ['users.view'] },
      { to: '/roles', key: 'roles', module: 'roles', requires: ['roles.view'] },
      { to: '/audit', key: 'audit', module: 'audit', requires: ['audit.view'] },
      { to: '/settings', key: 'settings', module: 'settings', requires: ['settings.view'] },
    ],
  },
];

/** The five destinations that stay reachable on a phone's bottom bar. */
export const MOBILE_NAV_KEYS = ['dashboard', 'members', 'attendance', 'payments', 'settings'];

export function navMeta(key) {
  const entry = NAV_ITEMS.flatMap((s) => s.items).find((i) => i.key === key);
  const module = entry?.module ? MODULE_BY_KEY[entry.module] : null;
  return {
    label: entry?.label || module?.label || key,
    icon: moduleIcon(module?.icon),
    module: entry?.module || null,
  };
}

/**
 * Filter the model for one caller. Returns groups with only the items they can
 * see, dropping any group that ends up empty.
 */
export function visibleNavigation({ moduleEnabled, can, terminology }) {
  const terms = terminology || {};
  const relabel = (label) =>
    label
      .replace(/\bMembers\b/g, terms.customerPlural || 'Members')
      .replace(/\bMemberships\b/g, terms.subscriptionPlural || 'Memberships')
      .replace(/\bTrainers\b/g, terms.staffPlural || 'Trainers');

  return NAV_ITEMS.map((section) => ({
    ...section,
    group: section.group ? relabel(section.group) : null,
    items: section.items
      .filter((item) => {
        if (item.module && !moduleEnabled(item.module)) return false;
        if (item.requires && !can(item.requires)) return false;
        return true;
      })
      .map((item) => {
        const meta = navMeta(item.key);
        return { ...item, label: relabel(meta.label), icon: meta.icon };
      }),
  })).filter((section) => section.items.length > 0);
}

/** Flat list, used by the router and the global search palette. */
export function allNavItems() {
  return NAV_ITEMS.flatMap((section) => section.items);
}

export default NAV_ITEMS;
