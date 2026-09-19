/**
 * Deployment simulation for the Vercel serverless entry point.
 *
 * Vercel invokes the default export of api/index.js per request; it never calls
 * app.listen(). This script reproduces that exact contract by wrapping the
 * handler in http.createServer(handler) and driving it over a real socket, so
 * routing, cookies, CORS and the 404 handler are exercised the way the platform
 * will exercise them.
 *
 * Run: node scripts/simulate-vercel.mjs
 */
import http from 'node:http';

// Emulate the production Vercel configuration before the app (and therefore
// server/src/config/env.js) is loaded. On Vercel the SPA is served from
// web/dist by the platform, so the Express fallback must stay off - that is what
// makes the /((?!api/|storage/).*) rewrite necessary and testable here.
process.env.SERVE_WEB_DIST = 'false';

const { default: handler } = await import('../api/index.js');

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
let failures = 0;

function check(name, pass, detail) {
  results.push(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
  if (!pass) failures += 1;
}

async function req(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual', ...opts });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

// --- 1. The handler is a real (req, res) function -------------------------
check('handler is a function', typeof handler === 'function', typeof handler);
check('handler takes (req, res)', handler.length === 2, `arity ${handler.length}`);

// --- 2. API routes resolve through the function, not the SPA --------------
const health = await req('/api/health');
check('GET /api/health -> 200', health.status === 200, `${health.status}`);
check(
  'health body is JSON with db flag',
  health.headers.get('content-type')?.includes('application/json') && /"db":/.test(health.text),
  health.text.slice(0, 70),
);

// A deep API path proves the /api/(.*) -> /api rewrite target keeps the full
// original path visible to Express (this is what makes the app's own routers
// match unchanged on Vercel).
const unauth = await req('/api/members');
check('GET /api/members unauthenticated -> 401', unauth.status === 401, `${unauth.status}`);
check(
  'unauthenticated API returns JSON error, not index.html',
  !unauth.text.includes('<!doctype html>'),
  unauth.text.slice(0, 60),
);

const unknownApi = await req('/api/definitely-not-a-route');
check('GET /api/unknown -> 404 JSON', unknownApi.status === 404, `${unknownApi.status}`);
check(
  'unknown API route is JSON not the SPA shell',
  !unknownApi.text.includes('<!doctype html>'),
  unknownApi.text.slice(0, 60),
);

// --- 3. A full authenticated round trip through the handler ---------------
const login = await req('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'owner@demogym.test',
    password: 'Demo1234!',
    tenantSlug: 'demo-gym',
  }),
});
check('POST /api/auth/login -> 200', login.status === 200, `${login.status}`);
const setCookie = login.headers.getSetCookie?.() ?? [];
check('login sets httpOnly cookies', setCookie.some((c) => /erp_at=/.test(c) && /HttpOnly/i.test(c)), `${setCookie.length} cookies`);
const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');

const body = JSON.parse(login.text);
const token = body.accessToken;
check('login returns accessToken', typeof token === 'string' && token.length > 20, `${String(token).length} chars`);

const me = await req('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
check('GET /api/auth/me -> 200', me.status === 200, `${me.status}`);
const meBody = JSON.parse(me.text);
check('/me returns camelCase permissions array', Array.isArray(meBody.permissions), `permissions=${meBody.permissions?.length}`);
check('/me theme is camelCase shape', meBody.theme && 'customCss' in meBody.theme && !('custom_css' in meBody.theme), Object.keys(meBody.theme ?? {}).join(','));
check('/me branding is camelCase', meBody.branding && 'businessName' in meBody.branding, meBody.branding?.businessName);

// --- 4. Tenant isolation through the serverless path ----------------------
const eliteLogin = await req('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'owner@elitefitness.test', password: 'Demo1234!', tenantSlug: 'elite-fitness' }),
});
const eliteToken = JSON.parse(eliteLogin.text).accessToken;
const aMembers = JSON.parse((await req('/api/members?limit=200', { headers: { authorization: `Bearer ${token}` } })).text);
const bMembers = JSON.parse((await req('/api/members?limit=200', { headers: { authorization: `Bearer ${eliteToken}` } })).text);
const aIds = new Set((aMembers.data ?? []).map((m) => m.id));
const overlap = (bMembers.data ?? []).filter((m) => aIds.has(m.id));
check(
  'tenant isolation holds through the handler',
  overlap.length === 0 && aMembers.data.length > 0 && bMembers.data.length > 0,
  `A=${aMembers.data?.length} B=${bMembers.data?.length} overlap=${overlap.length}`,
);

// --- 5. Cookie-only session restoration (same-origin Vercel model) --------
const meCookie = await req('/api/auth/me', { headers: { cookie: cookieHeader } });
check('GET /api/auth/me with cookies only -> 200', meCookie.status === 200, `${meCookie.status}`);

// --- 6. Public branding is camelCase and tenant resolved by slug ----------
const brand = await req('/api/public/branding?slug=demo-gym');
check('GET /api/public/branding -> 200', brand.status === 200, `${brand.status}`);
const brandBody = JSON.parse(brand.text);
check('public branding camelCase', brandBody.data?.branding && 'businessName' in brandBody.data.branding, brandBody.data?.branding?.businessName);

// Regression guard: every theme payload must come from shapeTheme(). Two sites
// used to return the raw row (custom_css) or a narrow SELECT that dropped
// is_active, so /me reported isActive:false for the active theme.
const publicTheme = brandBody.data?.theme ?? {};
check('public branding theme is shaped (customCss, not custom_css)', 'customCss' in publicTheme && !('custom_css' in publicTheme), Object.keys(publicTheme).join(','));
check('public branding theme isActive is true', publicTheme.isActive === true, `isActive=${publicTheme.isActive}`);
check('/me theme isActive is true', meBody.theme.isActive === true, `isActive=${meBody.theme.isActive}`);
check('/me and /public/branding agree on the active theme', meBody.theme.id === publicTheme.id, `${meBody.theme.id} vs ${publicTheme.id}`);

// --- 7. SPA fallback: a client route must NOT be answered by Express ------
// On Vercel the /((?!api/|storage/).*) rewrite sends these to /index.html from
// web/dist, so the function is never reached. We assert the negative: the app
// itself has no route for it, which is what makes the rewrite necessary.
const spa = await req('/members');
check('GET /members is not an API route (SPA rewrite required)', spa.status === 404, `${spa.status}`);

// --- 8. Storage path is handled by the app, not the SPA -------------------
const storage = await req('/storage/uploads/does-not-exist.png');
check('GET /storage/* reaches the app (not 404 JSON from fallback)', storage.status === 404, `${storage.status}`);

// --- 9. Rewrite pattern semantics (path-to-regexp compiles these to regex) -
const cases = [
  ['/api/members', true, 'api'],
  ['/api/auth/login', true, 'api'],
  ['/storage/uploads/x.png', true, 'storage'],
  ['/members', false, 'spa'],
  ['/settings/theme', false, 'spa'],
  ['/assets/index-abc123.js', false, 'spa (static file wins first)'],
  ['/manifest.webmanifest', false, 'spa (static file wins first)'],
];
const spaRe = /^\/((?!api\/|storage\/).*)$/;
for (const [path, expectApi, label] of cases) {
  const isApi = /^\/api\//.test(path) || /^\/storage\//.test(path);
  const hitsSpa = spaRe.test(path);
  const ok = isApi === expectApi && (expectApi ? !hitsSpa : hitsSpa);
  check(`route ${path} -> ${label}`, ok, `api=${isApi} spa=${hitsSpa}`);
}

// --- 10. Security headers on the API surface ------------------------------
check('X-Content-Type-Options present', health.headers.get('x-content-type-options') === 'nosniff', health.headers.get('x-content-type-options'));
check('CSP header present', Boolean(health.headers.get('content-security-policy')), (health.headers.get('content-security-policy') ?? '').slice(0, 40));

server.close();

console.log('\nVercel deployment simulation\n');
console.log(results.join('\n'));
console.log(`\n${results.length - failures} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
