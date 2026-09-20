# Deployment Guide — Vercel + Neon

How to deploy this platform as **one Vercel project**: the React SPA from the
build output, the Express API from a serverless function, both on the same
domain, backed by Neon PostgreSQL.

> **Verification status.** Everything in this guide that can be checked without
> your Vercel and Neon accounts has been checked in this repository — see
> "What is verified" at the end. **No Vercel deployment has been performed and
> no Neon connection has been tested from here.** Those require your accounts.

---

## 1. Architecture

```
GitHub
   ↓  (push)
Vercel  ── one project, one domain
   ├── React / Vite frontend        buildCommand → web/dist (static)
   ├── api/index.js                 serverless function (Express)
   │      ↓  /api/*  and  /storage/*
   │   Neon PostgreSQL              (pooled connection string)
   │      ↓
   └── S3-compatible object storage (logos, avatars, progress photos)
```

Same-origin by design: the browser calls `/api/...` on the same host that served
the page, so there is no CORS negotiation and the session cookies are
first-party. Do not split the API onto a separate domain unless you also read
the note in §9.

**Routing.** Three rewrites in `vercel.json` decide where a request goes:

| Pattern | Destination |
| --- | --- |
| `/api/(.*)` | `api/index.js` — Express sees the original path, so its own routers match unchanged |
| `/storage/(.*)` | `api/index.js` — served by the app's storage handler |
| `/((?!api/\|storage/).*)` | `/index.html` — SPA fallback for client-side routes |

Static files in `web/dist` (`/assets/*`, `/favicon.svg`, `/manifest.webmanifest`)
are served by the platform **before** rewrites are evaluated, so hashed bundles
never reach the SPA fallback.

## 2. Required services

| Service | Required? | Notes |
| --- | --- | --- |
| Neon PostgreSQL (or any managed Postgres 14+) | **Yes** | Vercel functions are ephemeral; the local PGlite dev server will not work. |
| Vercel | **Yes** | Hosting. |
| S3-compatible object storage | **Yes for production** | Without it, uploads vanish on every cold start. Any S3 API works: AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO. |
| Redis (e.g. Upstash) | No | Only if you need hard rate limits — see §8. |

## 3. Environment variables

This is the authoritative list. It is generated from the schema in
`server/src/config/env.js`; every name below exists there.

**"Frontend-exposed"** means the value would end up in the browser bundle. This
project reads **no `VITE_*` variables at all** — the API base URL is the relative
path `/api` (`web/src/lib/apiClient.js`). So no secret can leak into the bundle,
and you should not add `VITE_` variables for anything sensitive.

### Required in production

| Variable | Value type | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | Neon **pooled** connection string. Use the `-pooler` host. |
| `JWT_ACCESS_SECRET` | random, ≥16 chars | Signs access tokens. |
| `JWT_REFRESH_SECRET` | random, ≥16 chars, **different** from the above | Signs refresh tokens. |
| `COOKIE_SECURE` | `true` | Required. Without it browsers reject the session cookies over HTTPS. |
| `TRUST_PROXY` | `true` | Required. Makes Express read `X-Forwarded-For`, so rate limiting and logs see the real client IP instead of Vercel's edge. |
| `SERVE_WEB_DIST` | `false` | Required. Vercel serves the static files; the Express fallback would only conflict. |

Generate secrets (run twice, use a different value each time):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Required only if `STORAGE_DRIVER=s3`

| Variable | Value type | Purpose |
| --- | --- | --- |
| `STORAGE_DRIVER` | `s3` | Selects the object-storage driver. |
| `S3_BUCKET` | string | Bucket name. |
| `S3_REGION` | string | e.g. `auto` for Cloudflare R2, `us-east-1` for AWS. |
| `S3_ACCESS_KEY_ID` | secret | Leave empty to use the function's IAM role instead. |
| `S3_SECRET_ACCESS_KEY` | secret | Paired with the key id. |
| `S3_ENDPOINT` | URL | Only for non-AWS providers (R2, MinIO, Wasabi). Leave empty for AWS. |
| `S3_FORCE_PATH_STYLE` | `true`/`false` | Usually `true` for MinIO, `false` otherwise. |
| `STORAGE_PUBLIC_BASE_URL` | URL | Public CDN base for serving stored files. Optional. |

### Optional — sane defaults, override only if needed

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Vercel sets `production` automatically. |
| `PORT` | `4000` | Ignored on Vercel (the platform assigns the port). |
| `LOG_LEVEL` | `info` | `silent`/`error`/`warn`/`info`/`debug`. |
| `DATABASE_SSL` | `auto` | **Leave unset for Neon** — `auto` enables TLS unless the host is localhost or the URL says `sslmode=disable`. Must be exactly `auto`, `true` or `false`; values like `require` fail validation at boot. |
| `DATABASE_POOL_MAX` | `10` | Lower this (e.g. `3`) if you hit Neon connection limits. |
| `ACCESS_TOKEN_TTL` | `15m` | Any `ms`-style duration. |
| `REFRESH_TOKEN_TTL` | `30d` | Any `ms`-style duration. |
| `COOKIE_DOMAIN` | *(empty)* | Leave empty for same-origin. Set only for a shared parent domain. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated. Leave empty for same-origin. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | General limiter window. |
| `RATE_LIMIT_MAX` | `300` | Requests per window, general. |
| `AUTH_RATE_LIMIT_MAX` | `20` | Per 15 min on credential endpoints. |
| `STORAGE_LOCAL_DIR` | `./storage/uploads` | Local driver only. |

### Development / seeding only — do not set in production

| Variable | Default | Notes |
| --- | --- | --- |
| `DEMO_TENANT_SLUG` | `demo-gym` | Used by the seed script. |
| `SEED_OWNER_EMAIL` | `owner@demogym.test` | Seed only. |
| `SEED_OWNER_PASSWORD` | `Demo1234!` | Seed only. **Never reuse in production.** |

`SMTP_*` and `TWILIO_*` appear in `.env.example` but are **not read by any
code**. In-app is the only working notification channel; those keys are reserved
for future adapters. Setting them does nothing.

`VITE_PROXY_TARGET` is read only by `web/vite.config.js` for the local dev
proxy. It has no effect in a production build.

## 4. Neon setup and migrations

Migrations are **never** run during a Vercel build. A build runs in a throwaway
container, and a half-applied schema is worse than none. The flow is:

```
create Neon database → set DATABASE_URL → run migrations from your machine
        → deploy Vercel → the app connects to an existing schema
```

### 4.1 Create the database

In the Neon console: create a project, then copy the **pooled** connection
string (the host contains `-pooler`). Serverless functions open and close
connections constantly; the pooler exists for exactly that.

### 4.2 Install dependencies

From the repository root:

```bash
npm ci
```

### 4.3 Run the migrations

**PowerShell**

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST-POOLer.REGION.aws.neon.tech/DBNAME?sslmode=require"
npm run migrate
npm run migrate:status
```

**CMD**

```cmd
set DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require
npm run migrate
npm run migrate:status
```

**macOS / Linux / Git Bash**

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require" npm run migrate
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require" npm run migrate:status
```

An explicit `DATABASE_URL` wins over `.env` — `dotenv` does not overwrite a
variable that is already set — so this targets production even when you have a
local `.env`.

`npm run migrate` applies all 5 migrations and syncs the permission catalogue
(68 permissions). It is idempotent. **Re-run it after every deploy that adds a
migration.**

### 4.4 Verify the schema

```bash
npm run migrate:status
```

Expected: 5 migrations applied. Then confirm RLS is actually enforced — it only
takes effect for a **non-superuser** role:

```sql
SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user;
```

If `rolsuper` is `true`, RLS is silently bypassed. Create a dedicated
application role, grant it the tables, and point `DATABASE_URL` at it. See
`docs/security.md`.

### 4.5 Create your first tenant

The database is empty until you provision a tenant. Either run the seed against
production (creates the `demo-gym` demo tenant — useful for a Preview, **change
or remove it before going live**), or provision through the API.

## 5. Vercel setup

1. **Import** the GitHub repository (Vercel → Add New → Project).
2. **Build settings.** These are already declared in `vercel.json`, so the
   dashboard should pick them up. If you set them manually they must match:

   | Field | Value |
   | --- | --- |
   | Framework Preset | **Other** |
   | Build Command | `npm run build --workspace web` |
   | Output Directory | `web/dist` |
   | Install Command | `npm ci --include=dev` |
   | Root Directory | *(leave empty)* |

   Do **not** set Root Directory to `web/`. The function lives in `api/` at the
   repository root and needs the root workspaces to resolve `@erp/shared`.

   `vercel.json` deliberately contains **no `builds` property**. That property
   is legacy; when it is present Vercel ignores Build & Development Settings
   entirely and it cannot be combined with `functions` at all.

3. **Environment variables.** Add the six required ones from §3, plus the S3
   group if you are using object storage. Set them for **Production** and
   **Preview**.
4. **Deploy a Preview first.** Do not promote to Production until §6 passes.
5. **Verify** with the checklist in §6, then promote.

## 6. Post-deploy verification

Run these against your Preview URL. `npm run simulate:deploy` performs the same
checks locally against the real handler — 34 assertions covering routing,
authentication, tenant isolation and response shapes.

1. `GET /api/health` → `{"status":"ok","db":true,...}`
2. Load `/` → login page renders with your tenant's branding.
3. Log in → redirects to the dashboard, no console errors.
4. Hard-refresh `/members` (a client-side route) → still renders, not a 404.
5. `GET /api/members` in the browser → JSON, not HTML (proves the SPA fallback
   is not swallowing API routes).
6. Log out → cookie cleared, redirected to `/login`.
7. Upload a logo → reload in a **new** deployment or after a cold start → still
   there (proves storage persists).

## 7. Storage

`STORAGE_DRIVER=local` writes to `server/storage/uploads` inside the function's
filesystem, which is **discarded on every cold start**. On Vercel that means
logos, avatars and progress photos disappear unpredictably. The code detects
this and logs a warning in production:

```
[storage] local driver in production: uploads will not persist. Set STORAGE_DRIVER=s3.
```

`STORAGE_DRIVER=s3` uses the real AWS SDK (`@aws-sdk/client-s3`, declared in
`server/package.json` `optionalDependencies`) against any S3-compatible
provider. Configure it with the variables in §3.

Uploads are validated by magic bytes, not by the client's declared type, and
**SVG is rejected** because it can carry script.

With S3 enabled, serve files from the bucket or a CDN via
`STORAGE_PUBLIC_BASE_URL`; the `/storage/*` rewrite is then only a fallback.

## 8. Rate limiting

`express-rate-limit` is configured with an **in-memory store**. On serverless
each instance keeps its own counters, so the effective limit is roughly
`limit × instance count`, and it resets whenever an instance recycles. It still
blunts a brute-force attempt against one warm instance, but it is **not** a hard
guarantee.

For a real guarantee, back it with a shared store — Upstash Redis has a
first-class `express-rate-limit` store. This is a pre-production hardening item,
not a blocker for a Preview.

## 9. Splitting the API onto another domain

If you later host the API separately, set `CORS_ORIGINS` on the API host. Be
aware that the session cookies use `SameSite=Lax`, which browsers will not send
on cross-site XHR. Separate domains therefore require either a shared parent
domain (`COOKIE_DOMAIN`) or switching to `Authorization` headers. The
single-project layout in this guide avoids the problem entirely.

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `POST /api/auth/login` returns 500 `INTERNAL_ERROR` | Almost always the schema is missing: migrations were never run against the production database. The log line reads `relation "tenants" does not exist`. | Run `npm run migrate` with `DATABASE_URL` pointed at production (§4.3). `GET /api/health` now reports `"schema":false` with a hint when this is the cause. |
| `/api/health` returns 503 with `"schema":false` | Database is reachable but unmigrated. | `npm run migrate`, then re-check. |
| `/api/health` returns 503 with `"db":false` | The database is unreachable — wrong `DATABASE_URL`, SSL, or Neon IP allow-list. The response `error` field carries the driver's own message. | Fix the connection string; check Neon's allow-list. |
| Build fails: `vite: command not found` (exit 127) | Vercel builds with `NODE_ENV=production`, and npm omits devDependencies in that mode — so `vite`, `tailwindcss`, `postcss` and `autoprefixer` are never installed. | Install Command must be `npm ci --include=dev`. |
| Build fails: `Cannot find module 'pg'` | Dependencies not installed from the lockfile. | Set Install Command to `npm ci --include=dev`. `pg` is declared in `server/package.json`. |
| Function throws `Invalid environment configuration` | A required variable is missing, or `DATABASE_SSL` is not `auto`/`true`/`false`. | Check the boot error in the function log — it names the exact variable. |
| Function throws `Cannot find module '@erp/shared'` | Workspace files were not traced into the bundle. | Confirm Root Directory is the repo root (not `web/`); `functions.includeFiles` in `vercel.json` keeps `shared/**`. |
| `/api/*` returns the HTML login page | SPA fallback is matching API paths. | Confirm the `/api/(.*)` rewrite is present and ordered before the fallback. |
| Client route (e.g. `/members`) 404s on refresh | SPA fallback missing or wrong. | Confirm the `/((?!api/\|storage/).*)` rewrite exists. |
| Login succeeds but every later request is 401 | `COOKIE_SECURE` is not `true`, so the browser drops the cookie over HTTPS. | Set `COOKIE_SECURE=true`. |
| Rate limits never trigger, or logs show one IP for everyone | `TRUST_PROXY` is off. | Set `TRUST_PROXY=true`. |
| Uploads disappear after a while | `STORAGE_DRIVER=local` on serverless. | Set `STORAGE_DRIVER=s3` — see §7. |
| Migrations fail with a TLS/SSL error | `DATABASE_SSL` set to an unsupported value. | Use `auto` (or unset it) for Neon. |
| `429` responses during a seed or import | The general limiter (`RATE_LIMIT_MAX`, 300/min). | Raise it temporarily, or run the work server-side. |
| Data from another tenant appears | RLS bypassed by a superuser role. | See §4.4. |

## What is verified in this repository

Checked here, without Vercel or Neon access:

- `npm ci --include=dev` installs cleanly from the committed lockfile **with
  `NODE_ENV=production`** — the exact condition Vercel builds under. A bare
  `npm ci` omits devDependencies in that mode and the build fails with
  `vite: command not found`.
- The `installCommand` and `buildCommand` read out of `vercel.json` were run
  from a wiped `node_modules` and `web/dist` under `NODE_ENV=production`:
  install 390 packages, build exit 0, `web/dist/index.html` produced.
- `npm run lint` — 92 files.
- `npm run check` — 78 server modules load.
- `npm run test` — 16 files, 326 tests.
- `npm run smoke` — 94 assertions against a live API.
- `npm run simulate:deploy` — 34 assertions driving the real `api/index.js`
  handler through `http.createServer(handler)`, exactly how Vercel invokes it:
  routing, login, httpOnly cookies, cookie-only session restoration, tenant
  isolation (demo-gym 36 members vs elite-fitness 8, zero overlap), camelCase
  theme/branding shapes, and rewrite-pattern semantics.
- `npm run build --workspace web` produces `web/dist/index.html`.
- The S3 driver instantiates with `put`/`get`/`remove` once the SDK is present.

**Not** verified from here: an actual Vercel deployment, real Neon connectivity,
and RLS enforcement against a non-superuser role.
