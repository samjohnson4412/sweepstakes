# SweepTrack

A SaaS web app and browser extension to **discover, get alerts on, enter, track, and manage**
sweepstakes, including mail-in **AMOE** entries, wins, and tax records.

See **[docs/SPEC.md](docs/SPEC.md)** for the product and architecture spec, the decisions made so far, the roadmap, and the open questions.

## What works today (MVP scaffold)

- **Accounts:** email/password sign-up, session cookies, and entrant profiles (1 on Free, 5 for a Pro household).
- **Add a sweepstakes by URL:** fetches the page and its official-rules link (with SSRF protection), then parses
  start/end dates, entry frequency, age and state eligibility, ARV, and AMOE details (address, postmarked-by vs received-by,
  hand-print requirement, 3x5 card, SASE, one-per-envelope, and whether third-party or mechanical entries are banned).
- **Today dashboard:** what's due per entrant (handles daily vs. rolling 24h, the sponsor's timezone, weekly/monthly limits),
  sweepstakes ending soon, mail-in deadlines, open wins, and win-notice alerts.
- **Mail-in planner:** mail-by dates (with a USPS transit buffer), a weekly batch view, status tracking, a postage log,
  and printable 3x5 cards and #10 envelopes.
- **Wins:** prize, ARV, status, claim/affidavit deadlines, W-9/affidavit checkboxes, likely-1099 flag, and a yearly CSV tax export.
- **Email:** a per-user forwarding address and a `/api/inbound/email` webhook. Messages are classified as win notice,
  confirmation, newsletter, or promo, with **scam-signal detection**; likely-real win notices create a draft win automatically,
  and sweepstakes links in newsletters can be tracked with one click.
- **Browser extension (Chrome MV3):** due-now list, **assisted form fill** from the selected profile (the user always clicks
  Submit and solves any CAPTCHA), "Mark entered", and "Track this page".

## Layout

```
apps/web         Next.js 15 app (UI, server actions, extension API, inbound email webhook)
apps/extension   Chrome MV3 extension (esbuild)
packages/core    Pure TS domain logic: frequency rules, rules parser, email classifier, form matcher, AMOE, tax, sources
packages/db      Drizzle ORM schema, migrations, seed (Postgres)
docs/SPEC.md     Product & architecture spec
```

## Getting started

```bash
pnpm install
docker compose up -d                 # Postgres 16 (or point DATABASE_URL at your own)
cp .env.example apps/web/.env.local  # adjust as needed
export DATABASE_URL=postgres://sweeptrack:sweeptrack@localhost:5432/sweeptrack
pnpm db:migrate
pnpm db:seed                         # demo@sweeptrack.local / demo-password
pnpm dev                             # http://localhost:3000
```

**Extension:** run `pnpm --filter @sweeptrack/extension build`, then in Chrome open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select `apps/extension/build`. In the extension's options, enter the app URL
and an API token created under **Settings → Browser extension**.

**Inbound email (local test):**

```bash
curl -X POST localhost:3000/api/inbound/email \
  -H 'content-type: application/json' -H 'x-inbound-secret: change-me' \
  -d '{"to":"u-<token>@in.sweeptrack.local","from":"prizes@brand.com","subject":"Potential Winner Notification","text":"Congratulations! Return the affidavit by Nov 1, 2026."}'
```

## Checks

```bash
pnpm test        # core unit tests (vitest)
pnpm typecheck   # all packages
pnpm build       # web + extension
```

After editing `packages/db/src/schema.ts`, run `pnpm db:generate` to create a new migration.

## Not built yet (see roadmap in the spec)

Alert delivery (email digests, web push, SMS), the crawler and listing-site adapters (pending a terms-of-service review),
Stripe billing, Gmail/Outlook OAuth, LLM-assisted rules extraction, and the mail-on-behalf AMOE service (pending legal review).
