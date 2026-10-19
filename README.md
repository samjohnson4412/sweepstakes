# SweepTrack

A SaaS web app and browser extension to **discover, get alerts on, enter, track, and manage**
sweepstakes, including mail-in **AMOE** entries, wins, and tax records.

See **[docs/SPEC.md](docs/SPEC.md)** for the product and architecture spec, the decisions made so far, the roadmap, and the open questions.

## What works

- **Accounts and profiles:** email/password sign-up; one entrant profile on Free, five per household on Pro.
- **Catalog:** sweepstakes flow in automatically from listing-site feeds (Online-Sweepstakes, Sweeties Sweeps,
  SweepsAdvantage), the newsletter inbox, users' forwarded newsletters, and links users add. Duplicates across sites
  are merged into one record keyed by the sponsor's entry page. You can browse and search by keyword, frequency,
  prize value, end date, your state's eligibility, and whether there's a mail-in option.
- **Rules parsing:** the app reads the sponsor page and official rules and extracts dates, entry frequency, eligibility,
  ARV, and AMOE details. When the parser isn't confident, Claude fills the gaps (optional). Submitters and admins
  can correct any details, and later crawls never overwrite those corrections.
- **Today dashboard, entry logging, mail-in planner, wins, and tax CSV:** as in the MVP.
- **Mail-on-behalf service (off by default):** users authorize each entry. It's only offered where the rules don't
  forbid third-party entries, and an admin reviews each sweepstakes' rules before printing and mailing.
- **Email:** a forwarding address, plus Gmail and Outlook connections (read-only; only sweepstakes-related mail is
  imported). Win notices and scam signals are flagged, and newsletter links feed the catalog.
- **Browser extension (Chrome + Firefox):** due list, assisted fill, **"Remember form"** (per-site field mappings,
  shared across users once several confirm them), mark entered, and track this page.
- **PWA:** installable; on Android, "Share → SweepTrack" adds a sweepstakes from any app.
- **Admin** (`ADMIN_EMAILS`): manage sources (enable, robots.txt, interval, run now, add feeds), job failures, and the
  mail-service queue.

## Layout

```
apps/web            Next.js 15 app (UI, server actions, extension API, email webhook, cron endpoint, OAuth)
apps/extension      MV3 extension → build/chrome and build/firefox (esbuild)
packages/core       Pure TS logic: frequency, rules parser, email classifier, form matcher, robots, feeds/sitemaps
packages/db         Drizzle ORM schema, migrations, seed, token encryption (Postgres)
packages/ingest     Server jobs: polite fetcher, catalog pipeline, newsletter import, Gmail/Outlook sync, Claude extraction, tick
infra/gcp           Cloud Run + Cloud Scheduler deploy script
infra/email-worker  Cloudflare Email Worker → inbound webhook
docs/SPEC.md        Product & architecture spec
```

## Getting started

```bash
pnpm install
docker compose up -d                 # Postgres 16 (or point DATABASE_URL at your own)
cp .env.example apps/web/.env.local  # adjust as needed
export DATABASE_URL=postgres://sweeptrack:sweeptrack@localhost:5432/sweeptrack
pnpm db:migrate
pnpm db:seed                         # demo@sweeptrack.local / demo-password
pnpm ingest seed-sources             # built-in catalog sources
pnpm dev                             # http://localhost:4100 (other port: pnpm dev -p 5000)
pnpm ingest run online-sweepstakes   # pull listings now (or: pnpm ingest tick)
```

**Ports:** the app uses 4100 (`pnpm dev -p <port>` to change it, and update `APP_URL` in `apps/web/.env.local` to
match). If something else already uses Postgres's 5432, start the database with `DB_PORT=5433 docker compose up -d`
and change `DATABASE_URL` to `localhost:5433` (in `apps/web/.env.local`, and in your shell for `pnpm db:*` / `pnpm ingest`).

**Extension:** run `pnpm --filter @sweeptrack/extension build`. In Chrome, open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select `apps/extension/build/chrome`. In Firefox, open
`about:debugging` and load `apps/extension/build/firefox/manifest.json` as a temporary add-on. In the extension's options, enter the app URL
and an API token created under **Settings → Browser extension**.

**Inbound email (local test):**

```bash
curl -X POST localhost:4100/api/inbound/email \
  -H 'content-type: application/json' -H 'x-inbound-secret: change-me' \
  -d '{"to":"u-<token>@in.sweeptrack.local","from":"prizes@brand.com","subject":"Potential Winner Notification","text":"Congratulations! Return the affidavit by Nov 1, 2026."}'
```

## Deploying (cheapest setup)

1. Create a free **Neon** Postgres database. Run `DATABASE_URL=<neon url> pnpm db:migrate && pnpm ingest seed-sources`.
2. In Google Cloud, create the secrets `DATABASE_URL`, `ENCRYPTION_KEY`, `INBOUND_WEBHOOK_SECRET` and `CRON_SECRET`
   (optional: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`).
3. Run `PROJECT=… APP_URL=https://… INBOUND_EMAIL_DOMAIN=in.yourdomain.com ADMIN_EMAILS=you@… ./infra/gcp/deploy.sh`.
   This deploys to Cloud Run and creates a 15-minute Cloud Scheduler job for `/api/cron/tick`.
4. **Email:** add your domain to Cloudflare, enable Email Routing for `in.yourdomain.com`, deploy
   `infra/email-worker` (`npx wrangler deploy`, then `npx wrangler secret put INBOUND_WEBHOOK_SECRET`), and route
   the catch-all address to the worker. Subscribe `catalog@in.yourdomain.com` to sweepstakes newsletters.
5. **Gmail/Outlook (optional):** create OAuth clients with redirect `${APP_URL}/api/oauth/google/callback` (or
   `/microsoft/callback`). Gmail stays in Google's "testing" mode (100 users) until it passes verification.

## Checks

```bash
pnpm test        # core unit tests + ingest pipeline tests (needs Postgres)
pnpm typecheck   # all packages
pnpm build       # web + extension
```

After editing `packages/db/src/schema.ts`, run `pnpm db:generate` to create a new migration.

## Not built yet

Alert delivery (email digests, web push, SMS) and Stripe billing are planned last. See the roadmap in the spec.
