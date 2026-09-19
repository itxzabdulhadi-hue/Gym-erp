# Deploying to Vercel

This document covers deploying the platform to Vercel as a **single project** that
serves the React SPA from its own output directory and the Express API from a
serverless function, so there is no CORS problem and the session cookies stay
same-site.

> **Status of this guide.** The configuration in `vercel.json` and `api/index.js`
> is written to be Vercel-compatible and has been verified locally (the build
> command produces the configured output directory, and the function entry point
> loads and exports a `(req, res)` handler). **No actual Vercel deployment has
> been run**, because deploying requires your Vercel account. Treat the first
> deploy as a verification pass and read the caveats at the end.

---

## 1. What you need before you start

| Requirement | Why |
| --- | --- |
| A **PostgreSQL** database reachable over the internet | Vercel functions are ephemeral. The local PGlite server used in development does not work there. [Neon](https://neon.tech) is the natural choice; it is already an optional dependency. |
| Your Vercel account and the Vercel CLI **or** the GitHub import flow | To create the project and set environment variables. |
| The repository pushed to GitHub | The import flow builds from a branch. |

## 2. Create the database

On Neon (or any managed Postgres), create a project and copy the **pooled**
connection string. It looks like:

```
postgresql://user:password@ep-xxxx-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Prefer the `-pooler` host: serverless functions open and close connections
constantly, and the pooler exists for exactly that.

## 3. Run the migrations

Migrations are **not** run during the Vercel build. A build runs in a
throwaway container, and a half-applied schema would be worse than none. Run
them yourself against the production database, from your machine:

```bash
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npm run migrate
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npm run migrate:status
```

An explicit `DATABASE_URL` on the command line takes precedence over `.env`
(`dotenv` does not overwrite variables that are already set), so this targets
production even if you have a local `.env`.

This also syncs the permission catalogue. **Re-run it after every deploy that
changes migrations** — it is idempotent and safe to run repeatedly.

## 4. Import the project into Vercel

Vercel → **Add New → Project** → import this repository.

The build settings are already in `vercel.json`, so you should not need to
override anything in the dashboard. If you prefer to set them in the UI, they
must match:

| Dashboard field | Value |
| --- | --- |
| Framework Preset | **Other** |
| Build Command | `npm run build --workspace web` |
| Output Directory | `web/dist` |
| Install Command | `npm ci` |
| Root Directory | *(leave empty — the repo root)* |

Do **not** set a Root Directory to `web/`. The serverless function lives in
`api/` at the repository root and needs the root `package.json` workspaces to
resolve `@erp/shared`.

## 5. Set the environment variables

Vercel → your project → **Settings → Environment Variables**. Set these for
**Production** and **Preview**:

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://…neon.tech/neondb?sslmode=require` | The pooled string from step 2. |
| `DATABASE_SSL` | `true` | Must be one of `auto` / `true` / `false`. **Not** `require`. |
| `JWT_ACCESS_SECRET` | *(32+ random chars)* | Generate one; see below. |
| `JWT_REFRESH_SECRET` | *(32+ different random chars)* | Must differ from the access secret. |
| `COOKIE_SECURE` | `true` | Required. Cookies are rejected by browsers over HTTPS otherwise. |
| `TRUST_PROXY` | `1` | Required. Makes Express read `X-Forwarded-*`, so the rate limiter and request logging see the real client IP instead of Vercel's edge. |
| `SERVE_WEB_DIST` | `false` | Vercel serves the static files itself; the Express SPA fallback would only conflict. |
| `STORAGE_DRIVER` | `s3` | See the storage note below. Leave as `local` only for a trial deploy. |
| `NODE_ENV` | `production` | Vercel sets this automatically. |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice and use a different value for each secret.

If you deploy the API and the frontend to **different** domains, also set
`CORS_ORIGINS` to your frontend origin (comma-separated). For the
single-project deployment described here, requests are same-origin and you can
leave it unset.

## 6. Deploy

Push to the branch you imported, or run `vercel --prod`.

After the first successful deploy:

1. Open the deployment URL. You should see the login page.
2. If the database is empty, run the seed locally against production to create
   a tenant, **or** create your first tenant through the API.
3. Verify `/api/health` returns 200.

---

## Caveats — read before you rely on this in production

These are real limitations of running this application on Vercel, not things
that have been solved.

### Rate limiting is per instance
`express-rate-limit` uses an in-memory store. Serverless functions scale to
multiple instances, and each keeps its own counters, so the effective limit is
roughly `limit × instance count` and resets whenever an instance recycles. It
still deters brute force against a single warm instance, but it is not a hard
guarantee. For a real guarantee, back it with a shared store (Upstash Redis has
a first-class `express-rate-limit` store).

### File uploads do not persist with the default driver
`STORAGE_DRIVER=local` writes to `server/storage/`, which is **wiped on every
cold start**. Avatars, logos and progress photos will silently disappear. Set
`STORAGE_DRIVER=s3` and provide `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`
and `S3_SECRET_ACCESS_KEY` before you let anyone upload anything.

### The `/storage` route only works with the local driver
The rewrite for `/storage/*` forwards to the function, which serves files from
the local filesystem. With S3 enabled you should serve files from the bucket
directly (or a CDN) instead, and can drop that rewrite.

### Row-Level Security is the real isolation boundary
Application-level tenant scoping is verified by tests. RLS is a second,
independent layer that only takes effect for a **non-superuser** database role.
Some managed providers create your role as a superuser, which silently disables
RLS. After connecting, confirm with:

```sql
SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user;
```

If `rolsuper` is `true`, create a dedicated application role and point
`DATABASE_URL` at it. See `docs/security.md`.

### The workspace dependency must survive bundling
The API function imports `@erp/shared`, which is a workspace package resolved
through `node_modules` as a symlink. Vercel's `includeFiles` entry for
`shared/**` is there to keep those files in the bundle. This is the single most
likely thing to fail on a first deploy, and it will fail loudly — the function
will throw `Cannot find module '@erp/shared'` in its logs. If it does, the fix
is to add `"@erp/shared"` to `server/package.json` `dependencies` (it already is)
and confirm the Root Directory is the repo root.

### Long-running jobs are not supported
Anything that assumes a persistent process — background timers, scheduled
tasks, long imports — will be cut off by the function timeout. Nothing in the
current API does this, but keep it in mind as you extend it.

---

## Alternative: deploy the two tiers separately

If you would rather run the API somewhere persistent (Render, Railway, a VPS),
which fixes the rate-limiting and storage caveats above:

- Set `CORS_ORIGINS=https://your-frontend.vercel.app` on the API host.
- Set `COOKIE_DOMAIN` to a parent domain shared by both, or switch to bearer-only
  auth. **Note:** the session cookies use `SameSite=Lax`, which browsers will not
  send on cross-site XHR. Truly separate domains means either a shared parent
  domain or moving to `Authorization` headers.

For most tenants the single-project deployment in this guide is the simpler and
safer choice.
