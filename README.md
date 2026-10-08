# ScaleWaves Client Acquisition OS

Multi-tenant system that takes a local-service client from **Meta ad → landing page → lead → qualification → booked call → follow-up → sales call → won/lost → revenue**, and reports on profit (qualified leads, booked calls, shows, closed clients, CAC, ROAS, ROI), not clicks.

Each client of the agency is a **workspace**. Everything (leads, campaigns, deals, targets, automations, audit log) is scoped to one.

## Run it in two minutes (demo mode)

```bash
npm install
npm run dev          # http://localhost:3000  → redirects to /app
```

With no Supabase variables set, the app runs against a seeded in-memory store as a built-in demo user. The **Roofing** workspace reproduces the example funnel exactly: **$2,000 spend → 58 leads → 24 qualified → 14 booked → 10 showed → 3 clients → $10,491 revenue** (CAC $667, ROAS 5.25x). A second **HVAC test** workspace is deliberately unprofitable so alerts and the analyst have something to flag. Demo data resets when the server restarts.

Landing pages (public): `/roofing`, `/hvac`, `/med-spa`, `/law`, `/contractors`, `/remodeling`, `/epoxy`. Add `?ws=<workspace-slug>` to point a page at a specific client.

## Verify

```bash
npm run typecheck && npm run lint && npm test && npm run build   # or: npm run check
bash supabase/tests/run.sh      # applies migrations to a throwaway Postgres and runs the RLS tests
```

## Stack

Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript (strict), Tailwind v4, Supabase (Postgres + Auth + RLS), zod, recharts, dnd-kit, Vitest. Email via Resend. Calendar: built-in availability engine plus a Cal.com webhook adapter. AI analyst: Anthropic API with a deterministic rule-based fallback.

## What is where

| Area | Location |
|---|---|
| Pure business logic (economics, metrics, scoring, funnel rules, stats, compliance) | `src/lib/core/*` — no I/O, fully unit-tested |
| Services (lead capture, pipeline, booking, follow-up, Meta, webhooks, analyst) | `src/lib/server/services/*` |
| Data access (workspace-scoped `Repo`; Supabase + in-memory implementations) | `src/lib/server/{repo,supabase-repo,memory-repo}.ts` |
| Authenticated dashboard | `src/app/app/[ws]/*` |
| Dashboard mutations (one table of actions with required roles) | `src/lib/server/api/app-actions.ts` → `/api/app/[ws]/[...path]` |
| Public endpoints | `src/app/api/{leads,slots,book,track,unsubscribe,webhooks,cron}` |
| Public landing pages and booking | `src/app/[niche]`, `src/app/book/[ws]/[token]` |
| Database | `supabase/migrations/*.sql`, `supabase/tests/*` |

See [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md).

## Going live

### 1. Supabase
1. Create a project. Run the migrations in order (`supabase db push`, or paste `supabase/migrations/0001…0003` into the SQL editor).
2. Auth → URL configuration: set Site URL to your app URL and add `<app-url>/auth/callback` as a redirect. Login is by magic link.
3. Copy the project URL, anon key and **service role key** into the environment variables below. The service key is server-only.
4. Sign in once, then create your first workspace from `/app`. The creator becomes its owner.

### 2. Environment variables
See `.env.example`. Required for production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`). Add `META_*`, `RESEND_API_KEY`, `CAL_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` as you enable each integration.

### 3. Deploy (Vercel)
Import the repo, set the variables, deploy. `vercel.json` registers two cron jobs: `/api/cron/followups` (every 5 minutes: due follow-ups, call reminders, retry of failed lead-ad deliveries) and `/api/cron/meta-sync` (hourly). Vercel sends `Authorization: Bearer $CRON_SECRET`. Sub-hourly crons need a paid Vercel plan; otherwise point any external scheduler at the same URLs with the same header.

### 4. Meta Ads setup
1. At developers.facebook.com create a **Business** app. Add the **Marketing API** product (and **Webhooks** if you use Instant Forms).
2. Create a System User in Business Manager, assign the ad account and Page, and generate a token with `ads_read` and `leads_retrieval` (add `ads_management` only if you will use the pause/budget/create actions). Use a long-lived/system-user token.
3. In the app: **Settings → Meta Ads**, enter ad account ID, Page ID and token. The token is verified against Meta, then stored AES-256-GCM encrypted in a table no browser role can read.
4. **Sync last 30 days** pulls campaigns, ad sets, ads and daily ad-level insights. The cron keeps it fresh.
5. Lead-form webhook (optional): set callback URL to `<app-url>/api/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`, subscribe the Page to `leadgen`, set `META_APP_SECRET`. Signatures are checked on the raw body; Meta redeliveries are idempotent.
6. Tag landing-page ads (URL parameters): `utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&meta_campaign_id={{campaign.id}}&meta_adset_id={{adset.id}}&meta_ad_id={{ad.id}}`. That is what ties revenue back to an ad.

Campaigns created from the app are always created **PAUSED**, and every write to Meta requires an explicit confirmation. Ads Manager stays the place where ad sets and ads are finalized and switched on.

### 5. Calendar setup
- **Built-in (default, no setup):** set a time zone in Settings. Availability defaults to weekdays 9–5 in that zone with 30-minute calls and 2 hours' notice (`bookingConfig` on the workspace). Right after the form, the lead sees times and books; confirmation and reminder emails go out.
- **Cal.com (optional):** create a webhook in Cal.com to `<app-url>/api/webhooks/calendar/<workspace-slug>` with a secret, set `CAL_WEBHOOK_SECRET`, and (optionally) put your Cal.com link in Settings → Booking link. Bookings, reschedules and cancellations then update the pipeline.
- Google Calendar free/busy is **not** wired up (see limitations).

### 6. Email
Set `RESEND_API_KEY`, verify your sending domain in Resend, then fill in Settings: sender name, sender email, and your **business mailing address**. Marketing email is held (and logged as skipped) until an address exists. Every email includes the address and a one-click unsubscribe link.

## Roles
`owner > admin > member > viewer`. Viewers read. Members work leads, creatives, tests. Admins change settings, integrations, automations, landing pages and see the audit log.

## Design decisions (simplest production-ready choice, documented)
- **Funnel counted by reached-stage timestamps.** A lead that books has qualified, even if it skipped the stage. Dashboard default is **cohort** (leads created in range, followed to outcome); **events in range** is a toggle.
- **Revenue = contract value** (first payment + monthly × months + fees), attributed at close and frozen on the deal. Cash rows record what is due at close; recurring months are recorded as collected.
- **Speed to lead counts the first human response**; auto-acknowledgement emails do not count.
- **Qualified = WARM or better** under a configurable score (weights, thresholds, service area, excluded industries). Hard disqualifiers send the lead to LOST with a reason and no follow-up.
- **Reads go through Postgres RLS** (user JWT); **writes use the service role only after a role check**. Two independent isolation layers.
- **Statistics:** no A/B winner or INCREASE-budget advice without minimum samples (200 visitors/arm; ≥3 closed clients and CAC ≤80% of ceiling for budget increases).
- **Booking link = the lead's unguessable token**; no account needed.

## Known limitations (read before relying on it)
- **SMS is not sent.** Consent capture, STOP handling and quiet-hours logic exist, but delivery is deliberately unwired: it needs a registered A2P 10DLC campaign and a provider. SMS steps are logged as skipped (`sms_not_configured`).
- **Rate limiting is per-process memory.** On serverless, put a shared limiter or WAF in front of `/api/leads` and `/api/book`.
- **Not tested against live services.** Meta and Supabase were exercised with fakes and a throwaway local Postgres (migrations + RLS tests), not a real Meta account or hosted Supabase project. Do a supervised first connection.
- **Meta writes are minimal:** campaign creation (paused), status, daily budget. Ad sets, ads and creative upload are done in Ads Manager.
- **Google Calendar free/busy is not integrated;** the built-in engine only knows its own bookings (plus Cal.com events pushed by webhook).
- **No visual landing-page editor.** Copy overrides go through the `landing-pages/:slug` action; page templates live in `src/lib/landing-content.ts`.
- **No Supabase seed command.** Demo data is in-memory; to load sample data into a real project, create leads through the UI/API.
- **Landing-page niche pages are templates.** They contain no testimonials or results; social proof renders only for items explicitly marked verified.
- Time-zone-aware but single-host availability (one calendar per workspace).

## Compliance posture
No fake identities, scraped contacts, purchased lists, cold calling or bulk texting. Leads must tick explicit consent (and separate SMS consent) before submission; consent text/time is stored. Ad copy is checked for guarantees, income claims and unrealistic timelines. Case studies and testimonials publish only when marked verified. Every state-changing action is written to an append-only audit log.
