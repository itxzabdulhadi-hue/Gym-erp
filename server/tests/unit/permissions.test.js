import { describe, it, expect } from 'vitest';

import {
  ALL_PERMISSIONS, ALL_PERMISSION_KEYS, MODULES, SYSTEM_ROLES, hasPermission, hasAnyPermission,
  WILDCARD, getModule,
} from '@erp/shared';

/**
 * The permission registry is the single source of truth: the API guards, the
 * admin matrix builder and the frontend all read it. These tests fail if a
 * permission is defined in one place and referenced in another.
 */
describe('permission registry', () => {
  it('exposes a non-trivial catalogue', () => {
    expect(ALL_PERMISSIONS.length).toBeGreaterThanOrEqual(60);
    expect(ALL_PERMISSION_KEYS).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('has unique keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('names every permission <module>.<action>', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key, key).toMatch(/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/);
    }
  });

  it('belongs every permission to a registered module', () => {
    const moduleKeys = new Set(MODULES.map((m) => m.key));
    const orphans = ALL_PERMISSIONS.filter((p) => !moduleKeys.has(p.module));
    expect(orphans.map((p) => p.key), 'permissions without a module').toEqual([]);
  });

  it('defines every permission key exactly once per module', () => {
    const byModule = {};
    for (const permission of ALL_PERMISSIONS) {
      (byModule[permission.module] ||= []).push(permission.key);
    }
    for (const [module, keys] of Object.entries(byModule)) {
      expect(new Set(keys).size, `duplicate keys in ${module}`).toBe(keys.length);
    }
  });

  it('only grants permissions that exist to system roles', () => {
    for (const role of SYSTEM_ROLES) {
      const unknown = role.permissions.filter((key) => key !== WILDCARD && !ALL_PERMISSION_KEYS.includes(key));
      expect(unknown, `${role.key} references unknown permissions`).toEqual([]);
    }
  });

  it('covers the granular actions the spec calls for', () => {
    const required = [
      'members.view', 'members.create', 'members.edit', 'members.delete',
      'payments.view', 'payments.create', 'payments.edit', 'payments.refund',
      'attendance.view', 'attendance.checkin',
      'reports.view', 'settings.view', 'theme.view', 'theme.manage',
    ];
    for (const key of required) {
      expect(ALL_PERMISSION_KEYS, `missing permission ${key}`).toContain(key);
    }
  });

  it('gives the owner role the wildcard and nobody else', () => {
    const owner = SYSTEM_ROLES.find((r) => r.key === 'owner');
    expect(owner.permissions).toEqual([WILDCARD]);
    for (const role of SYSTEM_ROLES.filter((r) => r.key !== 'owner')) {
      expect(role.permissions).not.toContain(WILDCARD);
    }
  });
});

describe('hasPermission', () => {
  it('denies when nothing is granted', () => {
    expect(hasPermission([], 'members.view')).toBe(false);
    expect(hasPermission(undefined, 'members.view')).toBe(false);
  });

  it('matches an exact key', () => {
    expect(hasPermission(['members.view'], 'members.view')).toBe(true);
    expect(hasPermission(['members.view'], 'members.edit')).toBe(false);
  });

  it('honours the wildcard', () => {
    expect(hasPermission([WILDCARD], 'anything.at.all')).toBe(true);
  });

  it('honours a module wildcard', () => {
    expect(hasPermission(['members.*'], 'members.delete')).toBe(true);
    expect(hasPermission(['members.*'], 'payments.view')).toBe(false);
  });

  it('does not treat a similar prefix as a grant', () => {
    expect(hasPermission(['members.view'], 'members.view_all')).toBe(false);
    expect(hasPermission(['member.view'], 'members.view')).toBe(false);
  });

  it('hasAnyPermission is true when one of the keys is granted', () => {
    expect(hasAnyPermission(['payments.view'], ['members.view', 'payments.view'])).toBe(true);
    expect(hasAnyPermission(['payments.view'], ['members.view'])).toBe(false);
  });
});

describe('module registry', () => {
  it('has unique module keys', () => {
    expect(new Set(MODULES.map((m) => m.key)).size).toBe(MODULES.length);
  });

  it('labels and orders every module', () => {
    for (const mod of MODULES) {
      expect(mod.label, mod.key).toBeTruthy();
      expect(typeof mod.order).toBe('number');
    }
  });

  it('resolves a module by key', () => {
    expect(getModule('members')?.key).toBe('members');
    expect(getModule('not-a-module')).toBeFalsy();
  });

  it('includes the gym modules the spec requires', () => {
    const keys = MODULES.map((m) => m.key);
    for (const key of ['members', 'memberships', 'attendance', 'payments', 'trainers', 'workouts', 'progress', 'expenses', 'reports', 'notifications']) {
      expect(keys, `missing module ${key}`).toContain(key);
    }
  });
});
