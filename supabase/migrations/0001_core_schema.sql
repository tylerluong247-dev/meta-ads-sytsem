-- ScaleWaves Media — Agency Acquisition OS
-- Core schema. Tenancy boundary = workspace. Every business table carries workspace_id and has RLS.
-- Requires Supabase (auth schema, auth.uid()).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  website text,
  industry text not null default 'general',
  location text,
  offer text,
  timezone text not null default 'America/New_York',
  avg_client_value numeric(12,2) not null default 0 check (avg_client_value >= 0),
  gross_margin numeric(5,4) not null default 1 check (gross_margin between 0 and 1),
  desired_profit_margin numeric(5,4) not null default 0.2 check (desired_profit_margin between 0 and 1),
  target_cac numeric(12,2) not null default 0,
  target_cpl numeric(12,2) not null default 0,
  target_booked_call_cost numeric(12,2) not null default 0,
  target_roas numeric(8,2) not null default 0,
  close_rate numeric(5,4) not null default 0.25 check (close_rate between 0 and 1),
  show_rate numeric(5,4) not null default 0.7 check (show_rate between 0 and 1),
  qualified_rate numeric(5,4) not null default 0.3 check (qualified_rate between 0 and 1),
  booked_rate numeric(5,4) not null default 0.5 check (booked_rate between 0 and 1),
  avg_sales_cycle_days int not null default 14 check (avg_sales_cycle_days >= 0),
  monthly_ad_budget numeric(12,2) not null default 0,
  monthly_revenue_target numeric(12,2) not null default 0,
  scoring_config jsonb not null default '{}'::jsonb,
  speed_target_minutes int not null default 5,
  speed_critical_minutes int not null default 15,
  sender_name text,
  sender_email text,
  postal_address text,           -- required in commercial email footers
  booking_url text,
  booking_config jsonb not null default '{}'::jsonb,  -- { weekdays, startHour, endHour, durationMinutes, minNoticeMinutes, meetingUrl }
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspaces_updated before update on workspaces for each row execute function set_updated_at();

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members (user_id);

-- Membership helpers. SECURITY DEFINER so policies on workspace_members don't recurse into themselves.
create or replace function is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function has_role(ws uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role = any(roles));
$$;

-- Safe workspace creation: the creator becomes owner atomically. Direct inserts into workspaces are not allowed.
create or replace function create_workspace(p_name text, p_slug text, p_industry text default 'general')
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into workspaces (name, slug, industry, created_by) values (p_name, p_slug, p_industry, auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  return ws;
end $$;

-- ---------------------------------------------------------------------------
-- Business / offer / integrations
-- ---------------------------------------------------------------------------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  website text,
  meta_business_id text,
  meta_page_id text,
  instagram_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_ws_idx on businesses (workspace_id);
create trigger businesses_updated before update on businesses for each row execute function set_updated_at();

create table offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  name text not null,
  headline text,
  client_value numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offers_ws_idx on offers (workspace_id);
create trigger offers_updated before update on offers for each row execute function set_updated_at();

create table integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (provider in ('meta','calendar','email','sms')),
  status text not null default 'disconnected' check (status in ('connected','disconnected','error','expired')),
  meta_ad_account_id text,
  meta_page_id text,
  instagram_account_id text,
  external_account_id text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);
create trigger integrations_updated before update on integrations for each row execute function set_updated_at();

-- Tokens live in their own table with RLS on and NO policies: only the service role can read them.
create table integration_secrets (
  integration_id uuid primary key references integrations(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  encrypted_token text not null,   -- AES-256-GCM, key in TOKEN_ENCRYPTION_KEY (never in the database)
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Campaign structure
-- ---------------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  offer_id uuid references offers(id) on delete set null,
  name text not null,
  niche text,
  objective text,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  daily_budget numeric(12,2),
  meta_campaign_id text,
  meta_ad_account_id text,
  plan jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, meta_campaign_id)
);
create index campaigns_ws_idx on campaigns (workspace_id, status);
create trigger campaigns_updated before update on campaigns for each row execute function set_updated_at();

create table ad_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  audience text,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  daily_budget numeric(12,2),
  meta_adset_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, meta_adset_id)
);
create index ad_sets_campaign_idx on ad_sets (campaign_id);
create trigger ad_sets_updated before update on ad_sets for each row execute function set_updated_at();

create table creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  name text not null,
  hook text,
  angle text check (angle in ('problem','outcome','educational','case_study','offer','local_credibility','objection','other')),
  format text check (format in ('image','video','carousel','text')),
  audience text,
  primary_text text,
  headline text,
  description text,
  cta text,
  media_url text,
  launch_date date,
  status text not null default 'TESTING' check (status in ('WINNER','TESTING','UNDERPERFORMER','PAUSED')),
  meta_creative_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index creatives_ws_idx on creatives (workspace_id, status);
create index creatives_campaign_idx on creatives (campaign_id);
create trigger creatives_updated before update on creatives for each row execute function set_updated_at();

create table ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_set_id uuid references ad_sets(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  creative_id uuid references creatives(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  meta_ad_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, meta_ad_id)
);
create index ads_ws_idx on ads (workspace_id);
create index ads_creative_idx on ads (creative_id);
create trigger ads_updated before update on ads for each row execute function set_updated_at();

create table landing_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  niche text not null,
  published boolean not null default false,
  content jsonb not null default '{}'::jsonb,   -- headline, subheadline, problem, benefits, proof, process, faq, offer, cta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create trigger landing_pages_updated before update on landing_pages for each row execute function set_updated_at();

-- Experiments (A/B tests)
create table experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  type text not null check (type in ('headline','offer','landing_page','creative_hook','media','cta','qualification_question')),
  status text not null default 'running' check (status in ('draft','running','completed','stopped')),
  control_label text not null default 'Control',
  variant_label text not null default 'Variant',
  landing_page_id uuid references landing_pages(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index experiments_ws_idx on experiments (workspace_id, status);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  dedupe_key text not null,
  first_name text not null,
  last_name text,
  email text not null,
  phone text,
  business_name text,
  industry text,
  website text,
  city text,
  state text,
  monthly_revenue text check (monthly_revenue in ('under_10k','10k_30k','30k_100k','over_100k')),
  current_lead_gen_method text,
  primary_problem text,
  desired_outcome text,
  budget_range text check (budget_range in ('under_1k','1k_3k','3k_10k','over_10k')),
  timeline text check (timeline in ('asap','within_30_days','within_90_days','exploring')),
  ready_to_invest boolean,
  stage text not null default 'NEW_LEAD' check (stage in ('NEW_LEAD','QUALIFIED','BOOKED','CONFIRMED','SHOWED','PROPOSAL','WON','LOST')),
  tier text not null default 'COLD' check (tier in ('HOT','WARM','COLD','DISQUALIFIED')),
  score int not null default 0 check (score between 0 and 100),
  disqualified_reason text,
  lost_reason text,
  campaign_id uuid references campaigns(id) on delete set null,
  ad_set_id uuid references ad_sets(id) on delete set null,
  ad_id uuid references ads(id) on delete set null,
  creative_id uuid references creatives(id) on delete set null,
  landing_page_id uuid references landing_pages(id) on delete set null,
  source text not null default 'landing_page' check (source in ('landing_page','meta_lead_form','manual','import')),
  experiment_id uuid references experiments(id) on delete set null,
  experiment_arm text check (experiment_arm in ('control','variant')),
  -- consent + compliance
  contact_consent_at timestamptz,
  sms_consent_at timestamptz,
  consent_text text,
  consent_ip inet,
  opted_out_email boolean not null default false,
  opted_out_sms boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid(),
  -- funnel timestamps: a lead "reached" a stage once, regardless of where it is now
  qualified_at timestamptz,
  booked_at timestamptz,
  showed_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  first_response_at timestamptz,
  last_activity_at timestamptz not null default now(),
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);
create index leads_ws_created_idx on leads (workspace_id, created_at desc);
create index leads_ws_stage_idx on leads (workspace_id, stage);
create index leads_campaign_idx on leads (campaign_id);
create index leads_creative_idx on leads (creative_id);
create index leads_ad_idx on leads (ad_id);
create index leads_awaiting_response_idx on leads (workspace_id, created_at) where first_response_at is null;
create unique index leads_unsubscribe_token_idx on leads (unsubscribe_token);
create trigger leads_updated before update on leads for each row execute function set_updated_at();

create table lead_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  type text not null,           -- created, scored, email_opened, booked, note, ...
  data jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events (lead_id, created_at desc);
create index lead_events_ws_idx on lead_events (workspace_id, created_at desc);

create table lead_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  score int not null,
  tier text not null,
  factors jsonb not null default '[]'::jsonb,
  config_version text,
  created_at timestamptz not null default now()
);
create index lead_scores_lead_idx on lead_scores (lead_id, created_at desc);

-- One row per touch type, so first-touch can never be overwritten.
create table attribution (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  touch text not null check (touch in ('first','last')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  fbclid text,
  landing_page text,
  referrer text,
  occurred_at timestamptz not null default now(),
  unique (lead_id, touch)
);
create index attribution_ws_idx on attribution (workspace_id);
create index attribution_meta_ad_idx on attribution (meta_ad_id);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  provider text not null default 'internal',
  external_id text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'UTC',
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','CONFIRMED','SHOWED','NO_SHOW','RESCHEDULED','CANCELLED')),
  meeting_url text,
  reminder_day_sent_at timestamptz,
  reminder_hour_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  unique (workspace_id, provider, external_id)
);
create index appointments_ws_start_idx on appointments (workspace_id, start_at);
create index appointments_lead_idx on appointments (lead_id);
create trigger appointments_updated before update on appointments for each row execute function set_updated_at();
-- Prevent double-booking the same host slot (active appointments only).
create unique index appointments_no_double_book on appointments (workspace_id, start_at) where status in ('SCHEDULED','CONFIRMED');

create table communications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null check (channel in ('email','sms','note','call')),
  direction text not null check (direction in ('outbound','inbound')),
  step_id text,
  subject text,
  body text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','skipped','received')),
  skip_reason text,
  provider_message_id text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index communications_lead_idx on communications (lead_id, created_at desc);
create index communications_due_idx on communications (scheduled_for) where status = 'queued';

create table pipeline_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index pipeline_events_lead_idx on pipeline_events (lead_id, created_at desc);
create index pipeline_events_ws_idx on pipeline_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  name text not null,
  company text,
  email text,
  started_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index customers_ws_idx on customers (workspace_id);

create table deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  status text not null default 'won' check (status in ('won','lost','open')),
  client_value numeric(12,2) not null default 0 check (client_value >= 0),
  initial_payment numeric(12,2) not null default 0 check (initial_payment >= 0),
  recurring_payment numeric(12,2) not null default 0 check (recurring_payment >= 0),
  recurring_months int not null default 0 check (recurring_months >= 0),
  one_time_fees numeric(12,2) not null default 0 check (one_time_fees >= 0),
  contract_value numeric(12,2) generated always as (initial_payment + recurring_payment * recurring_months + one_time_fees) stored,
  close_date date not null default current_date,
  salesperson text,
  campaign_id uuid references campaigns(id) on delete set null,
  ad_id uuid references ads(id) on delete set null,
  creative_id uuid references creatives(id) on delete set null,
  loss_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_ws_close_idx on deals (workspace_id, close_date);
create index deals_campaign_idx on deals (campaign_id);
create index deals_creative_idx on deals (creative_id);
create unique index deals_one_won_per_lead on deals (lead_id) where status = 'won';
create trigger deals_updated before update on deals for each row execute function set_updated_at();

create table revenue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  kind text not null check (kind in ('initial','recurring','one_time','refund')),
  amount numeric(12,2) not null,
  received_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index revenue_ws_date_idx on revenue (workspace_id, received_on);

-- Daily ad-platform metrics at ad level; campaign/creative/workspace views roll these up.
create table metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  date date not null,
  campaign_id uuid references campaigns(id) on delete cascade,
  ad_set_id uuid references ad_sets(id) on delete cascade,
  ad_id uuid references ads(id) on delete cascade,
  creative_id uuid references creatives(id) on delete set null,
  spend numeric(12,2) not null default 0 check (spend >= 0),
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  platform_leads int not null default 0,
  source text not null default 'meta',
  synced_at timestamptz not null default now(),
  unique (workspace_id, date, ad_id)
);
create index metrics_ws_date_idx on metrics (workspace_id, date);
create index metrics_campaign_date_idx on metrics (campaign_id, date);
create index metrics_creative_date_idx on metrics (creative_id, date);

-- ---------------------------------------------------------------------------
-- Automation, webhooks, audit
-- ---------------------------------------------------------------------------
create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  trigger text not null check (trigger in ('lead_created','lead_booked','appointment_reminder','no_show','stage_changed')),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,   -- { steps: [{id, delayMinutes, channel, subject, body}], stopOn: [...] }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_rules_ws_idx on automation_rules (workspace_id, trigger) where enabled;
create trigger automation_rules_updated before update on automation_rules for each row execute function set_updated_at();

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  rule_id uuid not null references automation_rules(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  step_id text not null,
  status text not null default 'scheduled' check (status in ('scheduled','sent','skipped','failed','cancelled')),
  scheduled_for timestamptz not null,
  executed_at timestamptz,
  skip_reason text,
  error text,
  created_at timestamptz not null default now(),
  unique (rule_id, lead_id, step_id)        -- idempotency: a step runs at most once per lead
);
create index automation_runs_due_idx on automation_runs (scheduled_for) where status = 'scheduled';
create index automation_runs_ws_idx on automation_runs (workspace_id, created_at desc);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  provider text not null check (provider in ('meta','calendar','email','sms')),
  external_id text,                          -- provider event id, for idempotency
  event_type text,
  payload jsonb not null,
  signature_valid boolean not null default false,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id)
);
create index webhook_events_status_idx on webhook_events (status, received_at);

create table audit_logs (
  id bigserial primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_id uuid,
  actor_type text not null default 'user' check (actor_type in ('user','system','automation','webhook','public')),
  action text not null,
  entity_type text not null,
  entity_id text,
  campaign_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_ws_idx on audit_logs (workspace_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);

-- Generic audit trigger: records who (auth.uid()) changed what, with before/after images.
create or replace function audit_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  ws uuid;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ws := nullif(rec->>'workspace_id','')::uuid;
  if tg_table_name = 'workspaces' then ws := (rec->>'id')::uuid; end if;
  insert into audit_logs (workspace_id, actor_id, actor_type, action, entity_type, entity_id, campaign_id, before, after)
  values (
    ws,
    auth.uid(),
    case when auth.uid() is null then 'system' else 'user' end,
    lower(tg_op),
    tg_table_name,
    rec->>'id',
    case when tg_table_name = 'campaigns' then (rec->>'id')::uuid else nullif(rec->>'campaign_id','')::uuid end,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_workspaces after insert or update or delete on workspaces for each row execute function audit_trigger();
create trigger audit_campaigns after insert or update or delete on campaigns for each row execute function audit_trigger();
create trigger audit_ad_sets after insert or update or delete on ad_sets for each row execute function audit_trigger();
create trigger audit_ads after insert or update or delete on ads for each row execute function audit_trigger();
create trigger audit_creatives after insert or update or delete on creatives for each row execute function audit_trigger();
create trigger audit_automation_rules after insert or update or delete on automation_rules for each row execute function audit_trigger();
create trigger audit_deals after insert or update or delete on deals for each row execute function audit_trigger();
create trigger audit_experiments after insert or update or delete on experiments for each row execute function audit_trigger();
create trigger audit_landing_pages after insert or update or delete on landing_pages for each row execute function audit_trigger();
create trigger audit_workspace_members after insert or update or delete on workspace_members for each row execute function audit_trigger();
create trigger audit_integrations after insert or update or delete on integrations for each row execute function audit_trigger();
-- Leads: audit creation and stage/consent changes only (not every touch of last_activity_at).
create or replace function audit_lead_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_logs (workspace_id, actor_id, actor_type, action, entity_type, entity_id, campaign_id, after)
    values (new.workspace_id, auth.uid(), case when auth.uid() is null then 'public' else 'user' end, 'lead_created', 'leads', new.id::text, new.campaign_id, jsonb_build_object('source', new.source, 'stage', new.stage, 'tier', new.tier));
  elsif new.stage is distinct from old.stage or new.opted_out_email is distinct from old.opted_out_email or new.opted_out_sms is distinct from old.opted_out_sms then
    insert into audit_logs (workspace_id, actor_id, actor_type, action, entity_type, entity_id, campaign_id, before, after)
    values (new.workspace_id, auth.uid(), case when auth.uid() is null then 'system' else 'user' end, 'lead_updated', 'leads', new.id::text, new.campaign_id,
      jsonb_build_object('stage', old.stage, 'opted_out_email', old.opted_out_email, 'opted_out_sms', old.opted_out_sms),
      jsonb_build_object('stage', new.stage, 'opted_out_email', new.opted_out_email, 'opted_out_sms', new.opted_out_sms));
  end if;
  return new;
end $$;
create trigger audit_leads after insert or update on leads for each row execute function audit_lead_trigger();

-- Audit logs are append-only.
create or replace function audit_logs_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on audit_logs for each row execute function audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Roles: owner/admin = full control; member = day-to-day work (leads, pipeline, creatives); viewer = read-only.
-- Public lead capture and webhooks run server-side with the service role, which bypasses RLS after server-side validation.

alter table profiles enable row level security;
create policy profiles_self on profiles for select using (id = auth.uid() or exists (
  select 1 from workspace_members a join workspace_members b on a.workspace_id = b.workspace_id where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

alter table workspaces enable row level security;
create policy workspaces_select on workspaces for select using (is_member(id));
create policy workspaces_update on workspaces for update using (has_role(id, array['owner','admin'])) with check (has_role(id, array['owner','admin']));
create policy workspaces_delete on workspaces for delete using (has_role(id, array['owner']));
-- no INSERT policy: use create_workspace()

alter table workspace_members enable row level security;
create policy members_select on workspace_members for select using (is_member(workspace_id));
create policy members_insert on workspace_members for insert with check (has_role(workspace_id, array['owner','admin']) and role <> 'owner');
create policy members_update on workspace_members for update using (has_role(workspace_id, array['owner'])) with check (has_role(workspace_id, array['owner']));
create policy members_delete on workspace_members for delete using (has_role(workspace_id, array['owner','admin']) and role <> 'owner');

-- Tables everyone in the workspace can read; owner/admin/member can write; viewers read-only.
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','offers','campaigns','ad_sets','creatives','ads','landing_pages','experiments',
    'leads','lead_events','lead_scores','attribution','appointments','communications','pipeline_events',
    'customers','deals','revenue','metrics','automation_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_member(workspace_id))', t || '_select', t);
    execute format('create policy %I on %I for insert with check (has_role(workspace_id, array[''owner'',''admin'',''member'']))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_role(workspace_id, array[''owner'',''admin'',''member''])) with check (has_role(workspace_id, array[''owner'',''admin'',''member'']))', t || '_update', t);
    execute format('create policy %I on %I for delete using (has_role(workspace_id, array[''owner'',''admin'']))', t || '_delete', t);
  end loop;
end $$;

-- Configuration that changes how money is spent or messages go out: owner/admin only for writes.
alter table integrations enable row level security;
create policy integrations_select on integrations for select using (has_role(workspace_id, array['owner','admin']));
create policy integrations_write on integrations for all using (has_role(workspace_id, array['owner','admin'])) with check (has_role(workspace_id, array['owner','admin']));

alter table automation_rules enable row level security;
create policy automation_rules_select on automation_rules for select using (is_member(workspace_id));
create policy automation_rules_write on automation_rules for all using (has_role(workspace_id, array['owner','admin'])) with check (has_role(workspace_id, array['owner','admin']));

-- Secrets: RLS on, zero policies => unreadable to anyone but the service role.
alter table integration_secrets enable row level security;

-- Webhook payloads contain raw third-party data: admin read only; writes are service-role only.
alter table webhook_events enable row level security;
create policy webhook_events_select on webhook_events for select using (workspace_id is not null and has_role(workspace_id, array['owner','admin']));

-- Audit logs: admins read; nobody writes directly (triggers and the service role do).
alter table audit_logs enable row level security;
create policy audit_logs_select on audit_logs for select using (workspace_id is not null and has_role(workspace_id, array['owner','admin']));

-- Lock down direct privileges: anon gets nothing; authenticated is constrained by the policies above.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on audit_logs from authenticated;
revoke all on integration_secrets from authenticated;
revoke insert, update, delete on webhook_events from authenticated;
