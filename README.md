# White-label ERP Platform

A multi-tenant, white-label ERP platform. Nothing about a specific business is
hardcoded: the name, logo, colours, fonts, navigation, enabled modules and
permission matrix are all per-tenant data. **Gym management is the first
vertical** built on the platform - the same architecture is intended to host
salon, clinic, school, restaurant and general-business ERPs without a rebuild.

| | |
| --- | --- |
| Modules | 15 (gym vertical + platform core) |
| Permissions | 68 granular `<module>.<action>` keys |
| API endpoints | 168 (see [`docs/api.md`](docs/api.md)) |
| Tables | 30, of which 25 are tenant-scoped with row level security |
| Tests | 326 vitest + 94 HTTP smoke assertions |

---

## Architecture

Monorepo of three npm workspaces. The rule throughout: a layer may only call
downward.

```
shared/    Contract used by both sides: module registry, permission catalogue,
           system roles, theme sanitiser, vertical definitions, constants.
           No I/O, no framework imports.

server/    Node 20 + Express 5 style REST API.
           api/            Vercel serverless entry (thin wrapper)
           src/app.js      middleware, CSP, CORS, routers, error handling
           src/core/       platform domains: auth, tenants, users, roles,
                           permissions, modules, themes, branding, audit,
                           notifications, settings, search, files, insights
           src/verticals/  gym/ - members, memberships, attendance, payments,
                           trainers, workouts, progress, expenses, reports
           src/db/         one pg Pool, ambient transaction client, migrations
           migrations/     0001 platform, 0002 gym, 0003 RLS, 0004 hosting,
                           0005 tenant indexes

web/       Vite + React. Consumes the API and the shared contract; holds no
           business rules and no SQL.
```

Within each domain the split is:

```
routes        path, permission, module gate, request schema
  controllers   read the validated request, choose the status code
    services      business rules, transactions, audit entries, response shape
      repositories  every SQL statement
```

`members/` is the reference implementation of that layering; the remaining gym
domains are still single `*.service.js` files holding their own SQL. Converting
them is mechanical - copy the members pattern - and the test suite is what makes
that safe to do incrementally.

### Multi-tenant isolation

Isolation is enforced at three levels, so a UI bug cannot leak another
business's data:

1. **Token** - every access token carries `tenant_id`. `requireAuth` loads the
   caller's tenant, roles, permissions and enabled modules onto `req.ctx`.
2. **Query** - every statement filters on `tenant_id` explicitly. Services take
   `tenantId` as an argument rather than reading a global.
3. **Database** - `withTenant()` opens a transaction and runs
   `SELECT set_config('app.tenant_id', $1, true)`. Row level security policies
   on all 25 tenant tables compare `tenant_id` to that setting, so even a query
   that forgot its filter returns nothing.

A platform administrator may act on another tenant with an `X-Tenant-Id`
header. For any other caller the header is ignored - the request stays scoped to
the tenant in their token, so it cannot be used to probe another business.

### Permissions and modules

`shared/src/modules.js` is the single source of truth. It defines the module
registry, the permission catalogue, the five system roles and the dashboard
widget list. The server upserts the catalogue into the database on migrate, the
API guards check it, and the UI reads the same keys - so a permission is never
hardcoded in a component.

Disabling a module for a tenant removes it from navigation **and** makes every
one of its endpoints return `403 MODULE_DISABLED`.

---

## Getting started

```bash
npm install
cp .env.example .env        # then set both JWT secrets
npm run db:up               # local PGlite server on :5432 (no Docker needed)
npm run migrate
npm run seed
npm run dev                 # API on :4000 and web on :5173
```

`npm run db:up` runs a real PostgreSQL wire-protocol server backed by PGlite, so
local development needs no Docker and no Neon account. Point `DATABASE_URL` at
Neon instead and nothing else changes.

### Demo accounts

Seeding creates two tenants. Password for every account: `Demo1234!`

| Tenant | Login | Role |
| --- | --- | --- |
| `demo-gym` (Titan Fitness) | `owner@demogym.test` | Owner - everything |
| | `manager@demogym.test` | Manager - no settings, roles or audit |
| | `front@demogym.test` | Reception - no expenses, reports or users |
| | `coach@demogym.test` | Trainer - workouts, progress, check-in |
| | `books@demogym.test` | Accountant - payments, expenses, reports |
| `elite-fitness` (Elite Fitness) | `owner@elitefitness.test` | Owner |

The demo gym has 36 members, 45 payments, 904 visits and 84 expenses. Seeding is
idempotent; `npm run db:reset` drops and rebuilds everything.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web together, with prefixed logs |
| `npm run dev:server` / `dev:web` | Either one alone |
| `npm run migrate` / `migrate:status` | Apply migrations, sync the permission catalogue |
| `npm run seed` / `db:reset` | Demo data / full rebuild |
| `npm run test` | 326 vitest tests (unit, db, integration over real HTTP) |
| `npm run smoke` | 94 assertions against a running server |
| `npm run check` | Loads every server module to catch import errors |
| `npm run lint` | Syntax + guardrail rules (secrets, console, SQL concatenation) |
| `npm run docs` | Regenerates `docs/api.md` from the live route table |
| `npm run build` / `start` | Build the SPA / run the API in production |
| `npm run verify` | lint + check + test + smoke, in that order |
| `npm run maintenance` | Nightly jobs: expiring memberships, overdue payments, pruning |

---

## Configuration

Every setting is read through `server/src/config/env.js`, which validates with
zod and **fails fast at boot** rather than misbehaving at request time. In
production the three secrets are required; in development they fall back to
clearly-marked dev tokens so a fresh clone runs immediately.

Nothing secret is ever exposed to the browser. `config.public()` is the only
subset that reaches the client, and the web workspace has no `VITE_` secret
variables. See `.env.example` for the full annotated list.

---

## Deployment

### Vercel

`vercel.json` builds `web/` to static files and routes `/api/*` and
`/storage/*` to `server/api/index.js`, with an SPA fallback for everything else.
Set in the Vercel dashboard:

```
DATABASE_URL            Neon pooled connection string (?sslmode=require)
DATABASE_SSL            true
JWT_ACCESS_SECRET       48+ random bytes (min 16 enforced)
JWT_REFRESH_SECRET      48+ random bytes (min 16 enforced)
TRUST_PROXY             1
COOKIE_SECURE           true
CORS_ORIGINS            https://your-domain.com
STORAGE_DRIVER          s3        (local storage is ephemeral on serverless)
```

Run migrations from a one-off task or locally against the production database -
serverless functions should not migrate on cold start.

Because Vercel's filesystem is ephemeral, `STORAGE_DRIVER=local` is development
only. Any S3-compatible bucket works (AWS S3, Cloudflare R2, MinIO, Wasabi);
`@aws-sdk/client-s3` is imported lazily so it is not needed for local storage.

### Docker

```bash
docker compose up          # Postgres 16 + API, migrations run on boot
```

Set `SERVE_WEB_DIST=true` and copy `web/dist` into the image to have the single
Node process serve the SPA as well.

### Any Node host

`npm run build && npm start` serves the API, and with `SERVE_WEB_DIST=true` the
built SPA too. Needs Node 20+ and a reachable Postgres.

---

## Security

Detailed review in [`docs/security.md`](docs/security.md). Summary:

- **Passwords** - bcrypt at cost 11 (`BCRYPT_ROUNDS`). No plaintext stored or
  logged; login failures return one non-enumerating message.
- **Sessions** - short-lived access JWT plus a refresh token stored only as a
  SHA-256 hash, in an `httpOnly`, `sameSite=lax` cookie (`secure` follows
  `COOKIE_SECURE`). Refreshing revokes the presented token and issues a new one;
  a revoked or expired token is refused, and `POST /api/auth/logout-all` revokes
  every session for the user.
- **Tenant isolation** - token, query and RLS, as above.
- **Validation** - every body, query and param goes through zod. Failures return
  `422` with field details and never a stack trace.
- **Headers** - helmet, with `script-src 'self'` and `object-src 'none'`. Inline
  *styles* are allowed because the theme engine injects tenant CSS variables;
  inline scripts are not. `img-src` still allows any `https:` origin, which is
  the one directive worth tightening - see `docs/security.md`.
- **Uploads** - extension, declared type and sniffed magic bytes must all agree;
  SVG is rejected; size capped; stored outside the web root behind the API.
- **CSV** - exports neutralise cells starting `=`, `+`, `-`, `@`, tab or CR so a
  spreadsheet cannot execute an imported formula.
- **Rate limiting** - per IP, with a separate 15-minute bucket on the auth
  endpoints.
- **Audit trail** - every state change records who, what, which record, and the
  before/after values that matter.

---

## Testing

```bash
npm run verify     # lint, module load, 326 tests, 94 smoke assertions
```

The integration tests run against a real database over real HTTP, which is how
they found genuine defects rather than tautologies: a `$2` type clash that made
every settings update fail, memberships that stayed `active` when backdated,
overpayments silently clamped instead of rejected, a report that accepted a
foreign trainer id, CSV formula injection, branding fields that accepted HTML,
and a logout that was never audited because the route is unauthenticated.

**Known limitation:** the local PGlite server authenticates every client as its
superuser, and PostgreSQL exempts superusers from row level security even with
`FORCE ROW LEVEL SECURITY`. The tenant-context test therefore asserts that
`app.tenant_id` is applied to every query and branches on the role's
`rolsuper`/`rolbypassrls` flags. Actual RLS filtering needs to be verified
against Neon with a non-superuser role; the assertion is written and waiting.

---

## Status

**Backend: complete and verified.** 168 endpoints, tenant isolation, RBAC,
modules, themes, branding, audit, notifications, settings, search, uploads,
reports and CSV import/export, all behind the test suite.

**Frontend: not started.** `web/src/` is empty. The API contract it needs is in
`docs/api.md` and `shared/`.

**Not built yet**, deliberately, so nothing pretends to work:

- Email/SMS/WhatsApp/push delivery. The channel ports exist and return
  `NOT_CONFIGURED`; only in-app notifications are live.
- AI features. `POST /api/insights/ask` returns `501 NOT_IMPLEMENTED`. Real SQL
  metrics are available under `/api/insights/*`.
- PDF generation. Receipt and report endpoints are print-ready HTML/CSV; a PDF
  renderer is not wired in.
- The layers below `members/` still hold their SQL in the service file.
