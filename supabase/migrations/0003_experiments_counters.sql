-- A/B experiment configuration + per-arm counters, and an atomic counter helper.

alter table experiments add column config jsonb not null default '{}'::jsonb;  -- { landingSlug, control: {...overrides}, variant: {...overrides} }

create table experiment_arms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  experiment_id uuid not null references experiments(id) on delete cascade,
  arm text not null check (arm in ('control','variant')),
  visitors int not null default 0 check (visitors >= 0),   -- page views (landing tests) or impressions (ad-side tests)
  spend numeric(12,2) not null default 0 check (spend >= 0),
  created_at timestamptz not null default now(),
  unique (experiment_id, arm)
);
create index experiment_arms_ws_idx on experiment_arms (workspace_id);

alter table experiment_arms enable row level security;
create policy experiment_arms_select on experiment_arms for select using (is_member(workspace_id));
create policy experiment_arms_insert on experiment_arms for insert with check (has_role(workspace_id, array['owner','admin','member']));
create policy experiment_arms_update on experiment_arms for update using (has_role(workspace_id, array['owner','admin','member'])) with check (has_role(workspace_id, array['owner','admin','member']));
create policy experiment_arms_delete on experiment_arms for delete using (has_role(workspace_id, array['owner','admin']));

-- Atomic increment (no read-modify-write races under concurrent page views). Allow-listed so it can't touch arbitrary columns.
-- SECURITY INVOKER: RLS still applies to whoever calls it; the server calls it with the service role.
create or replace function increment_counter(p_table text, p_workspace uuid, p_id uuid, p_column text, p_by numeric)
returns void language plpgsql security invoker as $$
begin
  if not ((p_table = 'experiment_arms' and p_column in ('visitors','spend'))) then
    raise exception 'increment_counter: % . % is not allowed', p_table, p_column;
  end if;
  execute format('update %I set %I = %I + $1 where id = $2 and workspace_id = $3', p_table, p_column, p_column) using p_by, p_id, p_workspace;
end $$;
revoke execute on function increment_counter(text, uuid, uuid, text, numeric) from anon, authenticated;
grant execute on function increment_counter(text, uuid, uuid, text, numeric) to service_role;
