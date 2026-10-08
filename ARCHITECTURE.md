# Architecture

## The loop the system exists to close

```
Meta ad ─▶ landing page ─▶ lead capture ─▶ score / qualify ─▶ book call ─▶ reminders & follow-up
   ▲                                                                           │
   │                                                                      sales call
   └── profit dashboard ◀── revenue attribution ◀── won / lost ◀───────────────┘
```

Every arrow is a record in the database with a timestamp, so each stage can be counted, costed and traced back to the ad that started it.

## Layers

```
 Browser ──────────────────────────────────────────────────────────────────────────────
   public:  /[niche] landing + form · /book/[ws]/[token] · /api/unsubscribe/…
   private: /app/** dashboard (server-rendered; small client islands for board, forms, charts)
 ───────────────────────────────────────────────────────────────────────────────────────
 Route handlers (thin)       src/app/api/**
   validate → authorize → call a service → map errors to HTTP (errorResponse)
 ───────────────────────────────────────────────────────────────────────────────────────
 Services (I/O + rules)      src/lib/server/services/*
   leads · pipeline · deals · booking · followup · meta · webhooks · dashboard · rollup · analyst-ai
 ───────────────────────────────────────────────────────────────────────────────────────
 Core (pure functions)       src/lib/core/*     no network, no DB, no clock reads (time is injected)
   economics · metrics · scoring · pipeline rules · attribution · stats · compliance · followup rules
 ───────────────────────────────────────────────────────────────────────────────────────
 Repo (workspace-scoped)     src/lib/server/repo.ts    ← SupabaseRepo | MemoryRepo
 ───────────────────────────────────────────────────────────────────────────────────────
 Postgres (Supabase)         RLS on every tenant table · unique constraints · append-only audit
```

**Why this shape.** All money and decision logic lives in pure functions that are tested with plain numbers (including the $2,000 → $10,491 worked example). Services take a `Deps` object (`repo`, `mailer`, `now`, `appUrl`), so tests inject a clock and an in-memory repo and exercise the real service code with no mocks of our own logic. The `Repo` interface requires a `workspaceId` on every call, so a query that forgets tenant scoping does not compile.

## Multi-tenancy and authorization

- Tenant = **workspace** (one per agency client). Membership and role (`owner/admin/member/viewer`) live in `workspace_members`.
- **Two independent layers:**
  1. *Database:* RLS on every tenant table using `is_member()` / `has_role()` (security-definer helpers). Dashboard **reads** run with the signed-in user's JWT, so even an application bug cannot return another tenant's rows.
  2. *Application:* every dashboard mutation passes through `authorize(slug, minRole)`: authenticate (`auth.getUser()` validates the JWT with Supabase), resolve the workspace, check role. An unknown slug and a non-member get the identical 403, so slugs cannot be enumerated. Mutations then use the service-role repo, which is only reachable after that check.
- Public entry points (lead form, booking, unsubscribe, webhooks, cron) have no user. They use the service role but are narrow: each validates its input with zod, resolves the workspace from a slug or token, and writes only what that flow needs. Cron requires `Authorization: Bearer $CRON_SECRET`.
- `create_workspace()` is a security-definer RPC (there is no INSERT policy on `workspaces`) so the creator becomes owner atomically.
- Provider tokens live in `integration_secrets` (RLS on, **no policies**): unreachable from any browser role; AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`; never returned by any endpoint or written to the audit log.

## Auth

Supabase Auth, magic-link login (`/login` → `/auth/callback`). `src/proxy.ts` refreshes the session cookie on `/app/**`, redirects signed-out visitors to `/login`, and sets an anonymous `sw_vid` cookie on public pages for sticky A/B assignment. In demo mode (no Supabase env) a built-in user is used.

## Lead lifecycle

1. **Capture** (`createLead`): zod validation → honeypot (silently dropped) → dedupe key `(workspace, email, phone)` → attribution (UTMs, Meta ids, first/last touch) → configurable score and tier → stage (`QUALIFIED` for HOT/WARM, `NEW_LEAD` otherwise, `LOST` for hard disqualifiers) → consent timestamp/text → score history, event and audit rows → follow-up enrollment. The same function serves the landing form, Meta lead-ad webhook and manual add, so all three get identical rules.
2. **Book** (`bookAppointment`): slot must be in current availability; a partial unique index also prevents two active appointments at the same time; rebooking replaces the old one; the lead moves to `BOOKED`, nurture steps are cancelled, confirmation email goes out.
3. **Remind & follow up** (cron, every 5 min): `runDueAutomations` processes due steps, re-checking stop conditions before every send (booked, replied, opted out, disqualified, won/lost, no consent). `sendDueReminders` handles day-before and hour-before.
4. **Call outcome** (`markCallOutcome`): showed / no-show / reschedule / lost; no-show returns the lead to `QUALIFIED` and does not count as a show.
5. **Close** (`closeDeal`): the only way to reach `WON`. Writes customer, deal (attribution frozen onto it), revenue rows and audit entries.
6. **Report**: `buildRollup` aggregates; `getDashboard` computes KPIs, per-campaign and per-creative rows, alerts, speed-to-lead and the analyst's findings.

Pipeline moves are validated by a transition table (`core/pipeline.ts`): e.g. `NEW_LEAD → WON` is illegal, `WON` is terminal, `LOST` can only reopen to `QUALIFIED`.

## Funnel counting

Stage counts use "reached" timestamps (`qualified_at`, `booked_at`, `showed_at`, `won_at`), set on first arrival including stages passed implicitly. Two modes: **cohort** (default; leads created in the range, followed through to eventual outcome, which is what answers "did this spend pay back") and **period** (events that happened in the range). Revenue is the deal's contract value; spend comes from daily ad-level metrics synced from Meta. Filters by landing page, source or niche cannot be matched to ad spend, so cost metrics are suppressed for them and the UI says why.

## Attribution

`parseTouch` extracts `utm_*`, `fbclid` and numeric `meta_campaign_id / adset_id / ad_id` from the landing URL (junk or un-substituted macros are ignored). First touch is immutable; last touch moves forward but never gets blanked by an empty return visit. At capture, Meta ids are resolved to internal campaign/ad/creative rows; at close, they are copied onto the deal, so later edits cannot move revenue between campaigns.

## Meta Marketing API

`MetaClient` wraps the Graph API: token in the `Authorization` header (never the URL, so it can't land in logs), `appsecret_proof`, cursor pagination with a page cap, and error classification (`rate_limit`, `auth`, `permission`, `transient`, `invalid`). Rate limits and transient failures retry with exponential backoff; auth/permission/invalid errors do not retry. `syncMeta` never throws: failure is classified, stored on the integration (`expired` for auth errors so the UI can say "reconnect"), audited, and previously synced data is left untouched. Upserts key on Meta ids, so syncing is idempotent and doesn't overwrite user-owned fields (niche, plan). Writes (create campaign, status, budget) require `confirm: true`, admin role, and create campaigns **PAUSED**.

## Webhooks

- **Meta `leadgen`:** HMAC-SHA256 over the **raw body** is verified before parsing. Each `leadgen_id` is inserted into `webhook_events` (unique per provider + external id) *before* processing, so redeliveries are no-ops. Lead details are fetched from Graph; on failure the event stays `failed` with its payload and the cron retries it. The endpoint answers 200 after a valid signature so Meta does not hammer it.
- **Calendar (Cal.com):** HMAC verified; idempotency key `uid:event:start`; create/reschedule/cancel update appointments and pipeline; a booking made directly in the calendar creates the lead (the person asked for the call).

## Background jobs

Vercel Cron → `/api/cron/followups` (5 min) and `/api/cron/meta-sync` (hourly). Each iterates workspaces, isolating failures per tenant. All job work is idempotent (unique `(rule, lead, step)` runs; `already_sent` guard per step), so overlapping or repeated invocations are safe.

## Analyst

`analyzeCampaign` is deterministic and auditable: it walks the funnel, flags the weakest stage only if the sample is big enough, separates problem types (traffic, creative, offer, landing page, lead quality, sales, follow-up, show rate, tracking), and only returns `INCREASE` with ≥3 closed clients, CAC ≤80% of the ceiling and no warnings. `askAnalyst` optionally asks Claude to answer in prose, given **only aggregate numbers** (no personal data) and the same rules; with no key, or on error, it answers from the rule engine.

## Experiments

Sticky 50/50 assignment by hash of `(experiment, visitor cookie)`. Evaluation is a two-proportion z-test judged on **qualified-lead rate per visitor** (not raw leads), with minimum 200 visitors per arm and minimum conversions; otherwise "no winner yet".

## Compliance and safety

Consent is a required literal-true field plus stored text/time; SMS consent is separate and no SMS is sent. Emails: postal address required (held otherwise), one-click unsubscribe, `List-Unsubscribe`, opt-out honored before every send except transactional booking confirmations. `STOP/UNSUBSCRIBE/CANCEL/END/QUIT` replies opt out. Ad copy is screened for guarantees, unrealistic speed and income claims. Social proof renders only when marked verified. Honeypot, per-IP rate limits, same-origin + JSON-only checks on cookie-authenticated mutations, security headers in `next.config.ts`, HTML-escaped email bodies. Audit: application-level semantic entries (`audit()`) plus database triggers on key tables; `audit_logs` rejects UPDATE/DELETE.

## Error handling

Domain errors (`ValidationError`, `PermissionError`, `NotFoundError`, `InvalidTransitionError`, `UniqueViolation`, `MetaApiError`) map to 400/401/403/404/409/502 in one place (`errorResponse`). Unknown errors are logged server-side and returned without internals. Public forms get per-field messages. Background jobs record the failure and continue.

## Deployment shape

Stateless Next.js on Vercel (or any Node host) + Supabase. No server-side session state; the only per-process state is the best-effort rate limiter (documented limitation) and the demo-mode store.
