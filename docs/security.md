# Security Review

Every claim below points at the code that implements it. Where a control is
weaker than it should be, that is stated rather than glossed.

## Authentication

**Passwords.** `bcryptjs` at cost 11 (`BCRYPT_ROUNDS`, `core/users/users.shared.js`
and `core/tenants/tenants.service.js`). Only the hash is stored; nothing logs or
returns a plaintext password.

**Login failures.** One non-enumerating message - `email or password is
incorrect` - for a wrong password, an unknown email and a disabled account alike,
so the endpoint cannot be used to discover which addresses exist.

**Tokens.** Access token is a short-lived JWT (default `15m`, `ACCESS_TOKEN_TTL`)
carrying `sub`, `tenant_id` and a `jti`. Refresh token defaults to `30d`
(`REFRESH_TOKEN_TTL`). Both signing secrets are required with a 16-character
minimum and there is no development fallback, so a missing secret stops the
server at boot instead of signing with a guess.

**Refresh handling.** Only `sha256(jti)` is stored in `refresh_tokens`. Refresh
takes the row `FOR UPDATE`, refuses it if it is revoked or expired, marks it
revoked and issues a replacement (`core/auth/auth.service.js`).
`POST /api/auth/logout-all` revokes every session for the user.

*Not implemented:* reuse of an already-rotated token is refused, but it does not
revoke the whole token family. Adding family revocation on reuse would turn a
stolen-token replay into a detectable event.

**Cookies.** `httpOnly`, `sameSite=lax`, `path=/`, `secure` following
`COOKIE_SECURE` (`middleware/auth.js:cookieOptions`). Set `COOKIE_SECURE=true`
and `TRUST_PROXY=1` behind TLS.

**Password reset.** A random 32-byte token, stored as SHA-256 with a one hour
expiry. The raw token is returned in the response only when `NODE_ENV` is not
`production`; in production it goes out through a notification channel. The
endpoint always answers `ok` whether or not the address exists.

## Authorisation

**RBAC.** Permissions are `<module>.<action>` keys defined once in
`shared/src/modules.js` (68 of them). `requirePermission` checks the caller's
granted set; nothing branches on a role name. The five system roles are
starting points only - a tenant can build any matrix.

**Module gating.** `requireModule` returns `403 MODULE_DISABLED` when the tenant
has the module off, independent of permissions. Disabling a module therefore
closes its API surface, not just its navigation entry.

**Cross-tenant access.** `X-Tenant-Id` is honoured only when
`ctx.user.isPlatformAdmin`; for everyone else it is ignored and the request
stays scoped to the token's tenant (`middleware/auth.js`). Direct access by id
across tenants is covered by `tests/integration/tenant-isolation.test.js`, which
asserts a 404 for another tenant's member, membership, payment and attendance
record.

## Multi-tenant data isolation

Three independent layers:

1. `tenant_id` in the access token, resolved to `req.tenantId`.
2. An explicit `tenant_id = $n` predicate in every query; services receive
   `tenantId` as an argument rather than reading a global.
3. Row level security. `withTenant()` runs
   `SELECT set_config('app.tenant_id', $1, true)` and all 25 tenant-scoped
   tables carry a policy comparing `tenant_id` to that setting (27 policies).

**Limitation, stated plainly.** The local PGlite wire server authenticates every
client as its superuser, and PostgreSQL exempts superusers from RLS even with
`FORCE ROW LEVEL SECURITY`. So layer 3 cannot be exercised locally.
`tests/db/tenant-context.test.js` asserts that `app.tenant_id` is set for every
query and branches on `rolsuper`/`rolbypassrls`; against a non-superuser role on
Neon the same test asserts real filtering. **RLS enforcement is therefore
unverified in this environment.**

## Input handling

**Validation.** Every body, query and param passes through zod. Failures return
`422 VALIDATION_ERROR` with per-field details. A malformed UUID is a 422, not a
500.

**SQL.** Parameterised throughout. `utils/sql.js` provides `param`,
`likePattern`, `startsWithPattern` and `resolveSort`; sort keys are resolved
against a per-endpoint allowlist, so `?sort=` cannot inject. `npm run lint`
flags SQL built by concatenating a variable.

**CSV export.** `neutraliseFormula()` in `utils/csv.js` prefixes a cell starting
`=` `+` `-` `@`, tab or CR with a single quote (numeric values are left alone),
so a spreadsheet cannot execute an imported formula.

**Stored markup.** Branding text fields use `plainText()`, which rejects `<` and
`>`. Before that guard existed, `PATCH /api/branding` accepted
`<script>alert(1)</script>` as a business name.

**Tenant custom CSS.** Sanitised by `sanitizeCss` in `shared/src/theme.js`
before storage, and injected as a `<style>` element scoped to the tenant.

## HTTP surface

**Headers.** helmet with `default-src 'self'`, `script-src 'self'`,
`object-src 'none'`, `manifest-src`/`worker-src 'self' blob:`.

*Weak points, deliberately noted:* `style-src` includes `'unsafe-inline'`
because the theme engine injects tenant CSS variables as an inline `<style>`
block, and `img-src` allows any `https:` origin. Tightening `img-src` to the
tenant's own storage origin is the highest-value remaining change.

**CORS.** `isAllowedOrigin()` is shared by the CORS middleware and the CSP
`connect-src`, so the two cannot drift apart.

**Rate limiting.** A general per-IP bucket (`RATE_LIMIT_WINDOW_MS`,
`RATE_LIMIT_MAX`) over all `/api` routes, plus a stricter 15-minute bucket on
login, register, refresh and password reset (`AUTH_RATE_LIMIT_MAX`).

**Errors.** `middleware/errorHandler.js` always answers
`{ error: { code, message, details? } }`. The stack is logged server-side and
never returned. Unknown `/api` routes get `404 NOT_FOUND`.

## Uploads

`storage/index.js` enforces, per kind: an extension allowlist, a maximum size
(5 MB images, 10 MB documents), and a magic-byte sniff that must agree with the
declared type. **SVG is rejected** because it can carry script. Files are stored
outside the web root and served back through the API under `/storage`, so an
upload cannot become an executable page.

Local driver for development, S3-compatible driver for production. Serverless
filesystems are ephemeral - `STORAGE_DRIVER=local` on Vercel loses files on the
next cold start.

## Audit trail

Every state change writes a row: actor id and display name, action, entity,
entity id, and the before/after values that matter. Logout is included even
though the endpoint is unauthenticated - the actor is taken from the refresh
token payload.

*Gap:* file upload writes no audit row (`file.deleted` exists, `file.uploaded`
does not).

## Secrets

All configuration is read through `server/src/config/env.js`, validated with zod
at boot. `config` is frozen, and `config.public()` is the only projection that
reaches a client - it contains no secret. The web workspace defines no `VITE_`
secret variables; anything the browser needs comes from the API.

## Verification status

| Check | Result |
| --- | --- |
| `npm run lint` | 88 files, syntax + 4 guardrail rules |
| `npm run check` | 76 server modules load |
| `npm run test` | 326 passed |
| `npm run smoke` | 94 assertions against a live server |
| RLS filtering against a non-superuser role | **not verified** - needs Neon |
| Vercel deployment | **not verified** - no deployment performed |
| Docker image build | **not verified** - no Docker in this environment |
