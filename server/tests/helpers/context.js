import { afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

import { createApp } from '../../src/app.js';
import { closePool, query } from '../../src/db/index.js';
import { provisionTenant } from '../../src/core/tenants/tenants.service.js';

/**
 * Shared test context.
 *
 * Every suite runs against the real Express app (via supertest, no port
 * binding) and the real database from `DATABASE_URL`. Tenants are created per
 * test and deleted afterwards; `tenant_id` FKs are `ON DELETE CASCADE`, so
 * removing the tenant removes everything the test wrote.
 */
export const PASSWORD = 'Test1234!';
export const BCRYPT_ROUNDS = 4; // fast, and hashing strength is not under test

export const app = createApp();
export const api = request(app);

const tracked = new Set();

/** Register teardown for suites that touch the database. */
export function closeDbAfterSuite() {
  afterAll(async () => {
    for (const id of tracked) {
      await query('DELETE FROM tenants WHERE id = $1', [id]).catch(() => {});
    }
    tracked.clear();
    await closePool();
  });
}

let counter = 0;
export function uniqueSlug(prefix = 'test') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter}`;
}

/** Provision a tenant (roles, modules, branding and theme are seeded for it). */
export async function createTenant({ name = 'Test Business', slugPrefix = 'test', vertical = 'gym' } = {}) {
  const tenant = await provisionTenant({ name, slug: uniqueSlug(slugPrefix), vertical });
  tracked.add(tenant.id);
  return tenant;
}

export function trackTenant(id) {
  tracked.add(id);
  return id;
}

/** Insert a user directly and attach a seeded system role. */
export async function createUser(tenantId, { roleKey, email, fullName = 'Test User', status = 'active', password = PASSWORD }) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const inserted = await query(
    `INSERT INTO users (tenant_id, email, full_name, password_hash, status)
     VALUES ($1, lower($2), $3, $4, $5)
     RETURNING id, email, full_name, status`,
    [tenantId, email, fullName, hash, status],
  );
  const user = inserted.rows[0];
  if (roleKey) {
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE tenant_id = $2 AND key = $3`,
      [user.id, tenantId, roleKey],
    );
  }
  return user;
}

/** Log in through the real endpoint and return the access token. */
export async function login(email, password, tenantSlug) {
  const res = await api.post('/api/auth/login').send({ email, password, tenantSlug });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}@${tenantSlug}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken, refreshToken: res.body.refreshToken, body: res.body };
}

/** Convenience: tenant + owner + authenticated owner in one call. */
export async function tenantWithOwner({ name = 'Test Business', slugPrefix = 'test', email } = {}) {
  const tenant = await createTenant({ name, slugPrefix });
  const ownerEmail = email || `owner@${tenant.slug}.test`;
  const owner = await createUser(tenant.id, { roleKey: 'owner', email: ownerEmail, fullName: 'Owner Person' });
  const auth = await login(ownerEmail, PASSWORD, tenant.slug);
  return { tenant, owner, email: ownerEmail, token: auth.token, refreshToken: auth.refreshToken };
}

/** Authenticated user with a specific system role. */
export async function userWithRole(tenant, roleKey, { email } = {}) {
  const address = email || `${roleKey}@${tenant.slug}.test`;
  await createUser(tenant.id, { roleKey, email: address, fullName: `${roleKey} user` });
  const auth = await login(address, PASSWORD, tenant.slug);
  return { email: address, token: auth.token };
}

export const auth = (token) => ({ authorization: `Bearer ${token}` });
