#!/usr/bin/env node
/**
 * API smoke test against a running server.
 *
 *   npm run smoke            (expects the API on http://localhost:4000)
 *   BASE_URL=https://… npm run smoke
 *
 * Exercises the things that must never silently break: authentication, tenant
 * isolation, role permissions, module gating, and the main domain endpoints.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';

let passed = 0;
let failed = 0;

async function call(method, path, { token, body, tenant, expect = 200 } = {}) {
  let res;
  let text = '';
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(tenant ? { 'x-tenant-id': tenant } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${method} ${path} -> no response (${err.message}). Is the API still running?`);
    return { status: 0, json: null };
  }

  // Out of quota is not a product failure. Wait the window out and try once more
  // so a suite run straight after another does not report a meaningless red.
  if (res.status === 429) {
    const waitSec = Math.min(Number(res.headers.get('retry-after')) || 60, 120);
    console.log(`  rate limited on ${method} ${path} - waiting ${waitSec}s and retrying`);
    await new Promise((r) => setTimeout(r, waitSec * 1000 + 500));
    return call(method, path, { token, body, tenant, expect });
  }

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  const ok = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
  if (!ok) {
    failed += 1;
    console.error(`  ✗ ${method} ${path} -> ${res.status} (expected ${expect}) ${JSON.stringify(json).slice(0, 220)}`);
  } else {
    passed += 1;
    console.log(`  ✓ ${method} ${path} -> ${res.status}`);
  }
  return { status: res.status, json };
}

async function login(email, password, tenantSlug) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  const json = await res.json();
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

console.log(`\nSmoke test against ${BASE}\n`);

// ---------------------------------------------------------------- platform
/**
 * The smoke run makes ~95 requests, so running it twice inside one rate-limit
 * window trips the limiter and every later assertion fails with 429. Wait the
 * window out first rather than reporting a red suite that means nothing. The
 * limiter itself is deliberately left alone.
 */
async function waitForRateLimitWindow() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // /api/health is mounted ahead of the limiter, so it stays 200 even when
    // everything else is throttled. Probe a limited route instead: unauthenticated
    // it answers 401 when the window has room and 429 when it does not.
    const res = await fetch(`${BASE}/api/members`).catch(() => null);
    if (!res) {
      console.error(`  ✗ no response from ${BASE}. Is the API running? (npm run dev:server)`);
      process.exit(1);
    }
    if (res.status !== 429) return;
    const retryAfter = Number(res.headers.get('retry-after')) || 60;
    const waitMs = Math.min(retryAfter, 120) * 1000 + 500;
    console.log(`  rate limit window exhausted - waiting ${Math.round(waitMs / 1000)}s before starting`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

await waitForRateLimitWindow();

await call('GET', '/api/health');
await call('GET', '/api/members', { expect: 401 }); // no token
await call('POST', '/api/auth/login', { body: { email: 'nobody@x.test', password: 'nope1234', tenantSlug: 'demo-gym' }, expect: 401 });

const owner = await login(process.env.SEED_OWNER_EMAIL || 'owner@demogym.test', process.env.SEED_OWNER_PASSWORD || 'Demo1234!', 'demo-gym');
const T = owner.accessToken;
console.log(`  ✓ logged in as ${owner.user.fullName} @ ${owner.tenant.slug}`);

const me = await call('GET', '/api/auth/me', { token: T });
if (me.json?.permissions?.length < 10) {
  failed += 1;
  console.error('  ✗ owner should hold the full permission catalogue');
} else {
  passed += 1;
  console.log(`  ✓ owner permissions: ${me.json.permissions.length}`);
}

// ------------------------------------------------------------------- read
await call('GET', '/api/dashboard', { token: T });
await call('GET', '/api/members?limit=5', { token: T });
await call('GET', '/api/members?search=a&status=active&limit=3', { token: T });

// The list payload feeds the members table, so its derived columns must be real.
const sampleMember = (await call('GET', '/api/members?limit=5', { token: T })).json?.data?.[0];
if (sampleMember && sampleMember.memberNo && sampleMember.totalVisits >= sampleMember.visits30d) {
  passed += 1;
  console.log(`  ✓ member shape ok (${sampleMember.memberNo}: ${sampleMember.totalVisits} visits, ${sampleMember.visits30d} in 30d)`);
} else {
  failed += 1;
  console.error(`  ✗ member shape wrong: ${JSON.stringify(sampleMember)?.slice(0, 200)}`);
}
await call('GET', '/api/membership-plans', { token: T });
await call('GET', '/api/memberships?limit=5', { token: T });
await call('GET', '/api/attendance/today', { token: T });
await call('GET', '/api/payments?limit=5', { token: T });
await call('GET', '/api/payments/summary', { token: T });
await call('GET', '/api/expenses?limit=5', { token: T });
await call('GET', '/api/trainers', { token: T });
await call('GET', '/api/workouts/plans', { token: T });
await call('GET', '/api/workouts/exercises?limit=5', { token: T });
await call('GET', '/api/progress?limit=5', { token: T });
await call('GET', '/api/reports/members', { token: T });
await call('GET', '/api/reports/finance', { token: T });
await call('GET', '/api/reports/attendance', { token: T });
await call('GET', '/api/reports/memberships', { token: T });
await call('GET', '/api/search?q=ah', { token: T });
await call('GET', '/api/audit-logs?limit=5', { token: T });
await call('GET', '/api/roles', { token: T });
await call('GET', '/api/permissions', { token: T });
await call('GET', '/api/modules', { token: T });
await call('GET', '/api/branding', { token: T });
await call('GET', '/api/themes', { token: T });
await call('GET', '/api/themes/active', { token: T });
await call('GET', '/api/settings', { token: T });
await call('GET', '/api/insights/finance', { token: T });
await call('GET', '/api/insights/churn', { token: T });
await call('GET', '/api/notifications', { token: T });
await call('GET', '/api/public/branding?slug=demo-gym', { expect: 200 });
await call('GET', '/api/attendance?limit=3', { token: T });
await call('GET', '/api/attendance/stats/monthly', { token: T });
await call('GET', '/api/users?limit=5', { token: T });
await call('GET', '/api/audit-logs/facets', { token: T });
await call('GET', '/api/dashboard/widgets', { token: T });
await call('GET', '/api/notifications/channels', { token: T });
await call('GET', '/api/insights/status', { token: T });
await call('GET', '/api/files?limit=5', { token: T });
await call('GET', '/api/themes/presets', { token: T });
await call('GET', '/api/settings/general', { token: T });
await call('GET', '/api/reports/catalogue', { token: T });
await call('GET', '/api/expenses/summary', { token: T });
await call('GET', '/api/progress/latest?limit=3', { token: T });
await call('GET', '/api/workouts/assignments?limit=3', { token: T });
await call('GET', '/api/workouts/logs?limit=3', { token: T });
await call('GET', '/api/members/import-template', { token: T });
await call('GET', '/api/members/export?limit=5', { token: T });
await call('GET', '/api/payments/export?limit=5', { token: T });
await call('GET', '/api/attendance/export?limit=5', { token: T });
await call('GET', '/api/expenses/export?limit=5', { token: T });
await call('GET', '/api/reports/members/export', { token: T });
await call('GET', '/api/public/verticals', { expect: 200 });

// ------------------------------------------------------------------ write
const created = await call('POST', '/api/members', {
  token: T,
  expect: 201,
  body: { firstName: 'Smoke', lastName: 'Test', email: `smoke+${Date.now()}@example.com`, phone: '+15550001111', joinDate: new Date().toISOString().slice(0, 10) },
});
const memberId = created.json?.data?.id;

if (memberId) {
  const plans = await call('GET', '/api/membership-plans?activeOnly=true', { token: T });
  const plan = plans.json?.data?.[0];
  if (!plan) throw new Error('seeded membership plan missing - run `npm run seed`');
  const membership = await call('POST', '/api/memberships', {
    token: T,
    expect: 201,
    body: { memberId, planId: plan.id },
  });
  const membershipId = membership.json?.data?.id;

  await call('POST', '/api/payments', {
    token: T,
    expect: 201,
    body: { memberId, membershipId, amount: Number(plan.price), method: 'card' },
  });
  await call('POST', '/api/attendance/check-in', { token: T, expect: 201, body: { memberId } });
  await call('GET', `/api/members/${memberId}`, { token: T });
  await call('PATCH', `/api/members/${memberId}`, { token: T, body: { notes: 'updated by smoke test' } });
  if (membershipId) {
    await call('POST', `/api/memberships/${membershipId}/freeze`, { token: T, body: { days: 7 } });
    await call('POST', `/api/memberships/${membershipId}/resume`, { token: T });
  }
  await call('GET', `/api/members/${memberId}/memberships`, { token: T });
  await call('GET', `/api/members/${memberId}/payments`, { token: T });
  await call('GET', `/api/members/${memberId}/attendance`, { token: T });
  await call('GET', `/api/members/${memberId}/progress`, { token: T });
  await call('GET', `/api/members/${memberId}/workouts`, { token: T });
  await call('GET', `/api/members/${memberId}/documents`, { token: T });
  await call('POST', '/api/expenses', { token: T, expect: 201, body: { category: 'supplies', amount: 12.5, title: 'Smoke test expense' } });
  await call('DELETE', `/api/members/${memberId}`, { token: T });
}

await call('POST', '/api/members', { token: T, expect: 422, body: { firstName: '' } }); // validation
await call('GET', '/api/members/not-a-uuid', { token: T, expect: 422 });
await call('GET', '/api/nope', { token: T, expect: 404 });

// ---------------------------------------------------- tenant isolation
const elite = await login('owner@elitefitness.test', process.env.SEED_OWNER_PASSWORD || 'Demo1234!', 'elite-fitness');
const E = elite.accessToken;
console.log(`  ✓ logged in as ${elite.user.fullName} @ ${elite.tenant.slug}`);

const titanMembers = await call('GET', '/api/members?limit=200', { token: T });
const eliteMembers = await call('GET', '/api/members?limit=200', { token: E });
const titanCount = titanMembers.json?.meta?.total ?? -1;
const eliteCount = eliteMembers.json?.meta?.total ?? -1;
const overlap = (titanMembers.json?.data || []).filter((m) =>
  (eliteMembers.json?.data || []).some((e) => e.id === m.id),
);
if (titanCount > eliteCount && overlap.length === 0) {
  passed += 1;
  console.log(`  ✓ tenant isolation: demo-gym=${titanCount} members, elite-fitness=${eliteCount}, no overlap`);
} else {
  failed += 1;
  console.error(`  ✗ tenant isolation broken (titan=${titanCount}, elite=${eliteCount}, overlap=${overlap.length})`);
}

const eliteDashboard = await call('GET', '/api/dashboard', { token: E });
if ((eliteDashboard.json?.data?.metrics?.totalMembers ?? -1) === eliteCount) {
  passed += 1;
  console.log(`  ✓ dashboard metrics are tenant scoped (${eliteCount})`);
} else {
  failed += 1;
  console.error(`  ✗ dashboard leaked across tenants: ${eliteDashboard.json?.data?.metrics?.totalMembers} != ${eliteCount}`);
}

// elite-fitness was seeded with the progress + workout modules disabled
const gated = await call('GET', '/api/progress', { token: E, expect: 403 });
if (gated.json?.error?.code === 'MODULE_DISABLED') {
  passed += 1;
  console.log('  ✓ disabled module is blocked at the API (MODULE_DISABLED)');
} else {
  failed += 1;
  console.error(`  ✗ module gating failed: ${JSON.stringify(gated.json)}`);
}
await call('GET', '/api/progress', { token: T, expect: 200 });

// ------------------------------------------------------- role permissions
const trainer = await login('coach@demogym.test', process.env.SEED_OWNER_PASSWORD || 'Demo1234!', 'demo-gym');
const TR = trainer.accessToken;
console.log(`  ✓ logged in as ${trainer.user.fullName} (trainer)`);

await call('GET', '/api/members?limit=2', { token: TR, expect: 200 });
const denied = await call('GET', '/api/payments', { token: TR, expect: 403 });
if (denied.json?.error?.code === 'FORBIDDEN') {
  passed += 1;
  console.log('  ✓ trainer cannot read payments (FORBIDDEN)');
} else {
  failed += 1;
  console.error(`  ✗ trainer permission check failed: ${JSON.stringify(denied.json)}`);
}
await call('POST', '/api/members', { token: TR, expect: 403, body: { firstName: 'No', lastName: 'Access' } });
await call('GET', '/api/settings', { token: TR, expect: 403 });

const receptionist = await login('front@demogym.test', process.env.SEED_OWNER_PASSWORD || 'Demo1234!', 'demo-gym');
await call('POST', '/api/attendance/check-in', { token: receptionist.accessToken, expect: [200, 201], body: { query: titanMembers.json?.data?.[0]?.memberNo } });
await call('DELETE', '/api/roles', { token: receptionist.accessToken, expect: [403, 404] });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
