# Database

Postgres via Supabase. Migrations: `supabase/migrations/0001_core_schema.sql` (tables, helpers, audit triggers, RLS), `0002_reporting_views.sql` (funnel views), `0003_experiments_counters.sql` (experiment arms, atomic counter RPC). Verified by `supabase/tests/run.sh`, which boots a throwaway Postgres, applies the migrations on a stub of Supabase's `auth` schema and runs cross-tenant and role tests (it fails if RLS is disabled).

## Entity map

```
auth.users ─┬─ profiles
            └─ workspace_members ─┐
                                  ▼
 workspaces  (one per client: targets, funnel-rate assumptions, sender, booking config, scoring config)
   ├─ businesses, offers                    client business details
   ├─ integrations ── integration_secrets   Meta/calendar/email/SMS connections; encrypted tokens (service-role only)
   ├─ campaigns ─ ad_sets ─ ads ── creatives
   ├─ landing_pages ── experiments ── experiment_arms
   ├─ leads ─┬─ lead_events                  timeline
   │         ├─ lead_scores                  score history + factors
   │         ├─ attribution                  first / last touch rows
   │         ├─ appointments                 calls
   │         ├─ communications               every email/SMS/note, incl. skipped (with reason)
   │         ├─ pipeline_events              stage history
   │         └─ deals ─ customers ─ revenue  money
   ├─ metrics                               daily spend/impressions/clicks per ad (Meta sync)
   ├─ automation_rules ─ automation_runs    follow-up definitions and scheduled executions
   ├─ webhook_events                        raw inbound events, idempotency, retry state
   └─ audit_logs                            append-only
```

Every tenant table has `workspace_id uuid not null references workspaces(id) on delete cascade`, an index leading with it, and RLS.

## Rules enforced by the database (not just the app)

| Rule | Mechanism |
|---|---|
| One lead per person per client | `unique (workspace_id, dedupe_key)` (key = workspace + normalized email + phone) |
| No double-booking | partial unique index on `(workspace_id, start_at)` for active appointment statuses |
| One won deal per lead | partial unique index on `deals(lead_id) where status = 'won'` |
| Contract value can't drift | `deals.contract_value` is a generated column: initial + recurring × months + one-time fees |
| Idempotent webhooks | `unique (provider, external_id)` on `webhook_events` |
| Idempotent automations | `unique (rule_id, lead_id, step_id)` on `automation_runs` |
| Valid enums and ranges | `check` constraints on stages, tiers, statuses, rates (0–1), budget/revenue bands |
| Audit can't be edited | `audit_logs` triggers raise on UPDATE/DELETE; row-change triggers on leads, deals, campaigns, automations, integrations, members, experiments, landing pages |
| Tokens unreadable | `integration_secrets` has RLS enabled and **no** policies; only the service role bypasses RLS |
| Counters are atomic | `increment_counter()` RPC with an allow-list of tables/columns (no dynamic SQL from input) |

## Row-level security

Helpers `is_member(ws)` and `has_role(ws, roles[])` are `security definer`, `stable`, `search_path`-pinned. Policies, summarised:

| Table group | select | insert / update | delete |
|---|---|---|---|
| `workspaces` | members | owner, admin | owner |
| `workspace_members` | members | owner/admin add (never `owner` role); owner changes roles | owner/admin (never the owner) |
| Tenant data tables (leads, campaigns, deals, …) | members | owner, admin, member | owner, admin |
| `integrations`, `webhook_events`, `audit_logs` | owner, admin | owner, admin (integrations) | — |
| `automation_rules` | members | owner, admin | owner, admin |
| `integration_secrets` | none | none | none |
| `workspaces` insert | — | via `create_workspace()` only | — |

Views (`campaign_funnel`, `creative_funnel`) are `security_invoker`, so they inherit the caller's RLS.

## Notes for operators
- The app's service-role client bypasses RLS by design for public flows and for mutations after a role check; keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Both the app (`audit()`) and DB triggers write audit rows, so a single user action can yield a semantic entry and a raw row-change entry. That is intentional.
- Revenue rows hold cash due at close (initial + one-time); recurring months should be inserted as collected. Dashboards use `deals.contract_value`.
- Back up with Supabase PITR; no soft-delete is implemented (deletes cascade from the workspace).
