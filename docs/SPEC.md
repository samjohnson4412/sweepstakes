# SweepTrack — Product & Architecture Spec

> Working name. A SaaS web app + browser extension to **discover, alert on, enter,
> track, and manage** sweepstakes and contests — including AMOE (Alternate Method
> of Entry / mail-in) entries — for individuals and households.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Platform | Web app (installable PWA) + Chromium browser extension (MV3); Firefox later |
| Audience | Public SaaS, multi-tenant |
| Entry automation | **Assisted fill** — extension fills forms, the human clicks Submit |
| Data sources (v1) | Email inbox + sweepstakes listing sites |
| Email intake | Per-user forwarding address at launch; Gmail/Outlook OAuth after Google CASA verification |
| Catalog | Own sponsor-page crawler + user submissions + listing-site aggregation + newsletter parsing |
| Stack | TypeScript monorepo: Next.js, Postgres (Drizzle ORM), MV3 extension, shared `core` package |
| Monetization | Freemium subscription |
| AMOE | Deadline/postmark tracking, printable cards & envelopes, postage log, batch planner, **mail-on-behalf service** (see §6) |
| Alerts | Daily entry reminders, ending-soon/high-value matches, win detection |
| Wins | Full tracking incl. ARV, 1099, affidavit deadlines, yearly tax export |

## 2. Core concepts (domain model)

- **Account** — a paying/login user. Has a plan (`free` | `pro`).
- **Entrant profile** — a person who enters (account holder, spouse, adult kids).
  Holds autofill data (name, address, DOB, phone, email alias). One account → many profiles.
  Needed for "one entry per person / per household" rules.
- **Sweepstakes** — a global catalog record (shared across all users, de-duplicated by
  canonical URL). Fields: title, sponsor, URL, rules URL, start/end, entry frequency,
  prize description, total ARV, eligibility (age, countries/states), AMOE instructions,
  AMOE deadline type (postmarked-by vs received-by), source(s).
- **Tracked sweepstakes** — an account's subscription to a catalog item, with which
  profiles enter it, notes, and status (`active` | `paused` | `ended` | `hidden`).
- **Entry** — one entry event: profile, sweepstakes, method (`online` | `amoe` |
  `social` | `text` | `instant_win`), timestamp, result.
- **AMOE entry** — a mail-in entry with lifecycle `planned → prepared → mailed →
  (confirmed)`, mail-by date, postage cost, and whether it was self-mailed or sent by service.
- **Win** — prize, ARV, notified date, claim/affidavit deadline, W-9/1099 status,
  received date, tax year.
- **Inbound message** — an email received via forwarding/OAuth, classified as
  `win_notice` | `newsletter` | `confirmation` | `promo` | `other`, with extracted links.

## 3. Entry frequency rules

Frequency drives "what's due today". Supported:

- `once` — single entry for the whole promotion
- `daily` — once per **calendar day** in the sponsor's timezone (most common)
- `daily_24h` — once per rolling 24 hours from the last entry
- `weekly`, `monthly`
- `unlimited` / `per_purchase` (tracked, never "due")
- AMOE often has its own limit (e.g. "one per stamped envelope", "one per day by mail")

The `core` package computes `nextEligibleAt(frequency, lastEntryAt, sponsorTz)`.

## 4. Data sources

### 4.1 Email
- **Forwarding (v1):** every account gets `u-<token>@in.<domain>`. An inbound-mail provider
  (Postmark / SendGrid Inbound Parse / Mailgun / AWS SES) POSTs to `/api/inbound/email`.
  Users set a Gmail filter (e.g. from known sweepstakes senders, or subject contains
  "winner", "sweepstakes") to forward.
- **OAuth (v2):** Gmail `gmail.readonly` is a *restricted* scope → Google OAuth
  verification + annual CASA Tier 2 security assessment. Outlook via Microsoft Graph is
  lighter. Plan budget/time for this before GA.
- **Classifier:** heuristics first (keywords: "affidavit", "W-9", "potential winner",
  "claim your prize", "release", sender reputation), then an LLM pass for ambiguous
  messages. Win notices → urgent alert. **Also flag likely scams** ("pay a fee to claim").

### 4.2 Catalog sources
| Source | Method | Notes |
|---|---|---|
| Sponsor pages | Crawler + rules parser | Primary, legally cleanest. Parse official rules for dates, frequency, eligibility, AMOE. |
| User submissions | Paste URL / share target / extension "Add this page" | Dedup by canonical URL; community confirms details. |
| Listing sites (Online-Sweepstakes, ContestGirl, SweepsAdvantage, Sweepstakes Fanatics, Sweeties Sweeps, r/sweepstakes, etc.) | RSS where offered; otherwise adapters | **Review each site's ToS/robots.txt before enabling.** Store only facts + link to the sponsor page, never copy their editorial content. Pursue data partnerships. Online-Sweepstakes content is behind a paid membership — do not scrape logged-in content. |
| Newsletters | System inbox subscribed to sweepstakes newsletters | Same parser as user email. |

Adapters implement a common `SourceAdapter` interface (`fetch() → RawListing[]`) and feed a
normalize → dedup → rules-parse → enrich pipeline.

## 5. Assisted entry (extension)

- Extension authenticates with a per-user API token.
- Popup shows **Due today** list; clicking opens the entry page.
- On an entry page: **Fill** maps profile fields to form inputs (autocomplete attributes,
  name/id/label heuristics, per-domain learned mappings shared across users).
- User solves CAPTCHA (never bypassed) and clicks Submit; extension detects submit/thank-you
  page and logs the entry (or user clicks "Mark entered").
- "Add this sweepstakes" on any page → sends URL to the catalog pipeline.
- **No automated submission.** Most official rules void entries made by "automated,
  macro, script, robotic or other means" and this protects users' wins.

## 6. AMOE (mail-in)

- Parse AMOE instructions: address, required contents (name/address/phone/age, "hand-printed",
  3x5 card, #10 envelope, SASE), limit per envelope, postmark/received deadline.
- **Mail-by date** = received-by deadline − USPS transit buffer (default 5 business days),
  or postmark date itself.
- Printable 3x5 cards and #10 envelopes (print CSS / PDF), per profile.
- Postage log: stamp price × count, envelope cost → feeds ROI.
- Weekly **batch planner**: what to write and mail this week, grouped by deadline.

### 6.1 ⚠️ Mail-on-behalf service — legal review required
Users asked for a service that mails AMOE entries for them. Risks:
- Many rules require entries to be **hand-printed** or prohibit **mechanically reproduced**
  entries and entries **submitted by third parties**/entry services; violating these voids wins.
- Some rules limit entries per envelope and require the entrant's own return address.
- Could be seen as a commercial entry service; some sponsors explicitly ban them.

Plan: build it as a separately-gated feature. The rules parser sets
`amoe_third_party_allowed` = `yes | no | unknown`; the service is only offered when `yes`
(or after manual review), the user explicitly authorizes each submission, and fulfillment
(handwriting service/print partner) is logged per entry. **Get a sweepstakes attorney's
opinion before launching this.**

## 7. Alerts

| Alert | Trigger | Channels |
|---|---|---|
| Daily entries due | Morning digest at user-chosen time | Push (web push/extension badge), email |
| Ending soon | Tracked sweeps ending in ≤ N days | Push, email |
| New match | New catalog item matching saved filters (min ARV, category, frequency, eligibility state) | Push, email digest |
| AMOE mail-by | Mail-by date in ≤ N days | Push, email |
| Win detected | Inbound email classified `win_notice` | Push + email + SMS (pro), immediately |
| Claim deadline | Affidavit/claim deadline approaching | All channels |

## 8. Wins & taxes

- Win record: prize, ARV, sponsor, notified/claimed/received dates, affidavit deadline,
  W-9 submitted, 1099-MISC expected (ARV ≥ $600), forfeited/declined.
- Yearly summary + CSV export for tax preparation; ROI = wins ARV vs. postage + subscription.

## 9. Plans (freemium draft)

| | Free | Pro |
|---|---|---|
| Tracked sweepstakes | 25 active | Unlimited |
| Entrant profiles | 1 | 5 (household) |
| Extension autofill | 10 fills/day | Unlimited |
| Email forwarding & win detection | ✓ | ✓ |
| AMOE printing, batch planner, postage log | — | ✓ |
| SMS alerts | — | ✓ |
| Mail-on-behalf | — | Per-entry fee (if launched) |
| Tax export | Basic | Full CSV/PDF |

Billing via Stripe (not in MVP scaffold).

## 10. Architecture

```
apps/web         Next.js (App Router) — UI, REST API for extension, inbound email webhook
apps/extension   Chrome MV3 — popup, content script (autofill), background worker
packages/core    Pure TS — types, frequency logic, rules parser, email classifier, form-field matcher
packages/db      Drizzle schema + migrations + client (Postgres)
workers (later)  Crawler / ingestion jobs, alert scheduler (pg-boss or BullMQ)
```

- Postgres is the source of truth; jobs via `pg-boss` to avoid extra infra early.
- Rules parsing: deterministic regex/heuristics in `core`, with LLM extraction fallback
  for messy rules pages (stored with confidence scores; users can correct).
- Security: hashed passwords (scrypt), httpOnly session cookies, hashed API tokens,
  PII (DOB, phone, address) encrypted at rest in a later iteration; per-account data isolation.
- Compliance: privacy policy, CAN-SPAM for alert emails, honoring robots.txt/ToS for crawlers.

## 11. Roadmap

1. **MVP (this scaffold):** accounts, profiles, add-by-URL with rules parsing, tracking,
   due-today dashboard, entry logging, AMOE tracking + printable cards, wins + tax CSV,
   inbound email webhook + classifier, extension (due list, autofill, mark entered).
2. Alerts: scheduler, email digests, web push, extension badge.
3. Catalog: crawler, listing-site adapters (after ToS review), newsletter inbox, dedup, browse/search UI.
4. Stripe billing + plan limits.
5. Gmail/Outlook OAuth (after verification), LLM rules extraction, per-domain autofill mappings.
6. Mobile polish (PWA share target), Firefox extension, mail-on-behalf (after legal review).

## 12. Open questions
- Product name/domain?
- US-only at launch, or Canada too (skill-testing questions, different rules)?
- Which inbound email provider (Postmark / SES / SendGrid)?
- Hosting preference (Vercel + Neon/Supabase, Fly.io, AWS)?
- Attorney for sweepstakes/ToS review (listing aggregation and mail-on-behalf)?
