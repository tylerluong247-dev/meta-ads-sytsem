-- Tenant isolation and permission-boundary tests. Run after the migrations. Raises on any failure.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a','alice@a.test'),
  ('00000000-0000-0000-0000-00000000000b','bob@b.test'),
  ('00000000-0000-0000-0000-00000000000c','carol-viewer@a.test');

-- Alice creates workspace A, Bob creates workspace B (via the safe RPC).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a', true);
select create_workspace('Workspace A','ws-a','roofing') as ws_a \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b', true);
select create_workspace('Workspace B','ws-b','hvac') as ws_b \gset

-- Seed one lead in each workspace as their owners.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a', true);
insert into leads (workspace_id, dedupe_key, first_name, email) values (:'ws_a', 'k1', 'Ann', 'ann@x.test');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b', true);
insert into leads (workspace_id, dedupe_key, first_name, email) values (:'ws_b', 'k1', 'Ben', 'ben@y.test');

-- 1. Isolation: each user sees only their own workspace's rows.
do $$ declare n int; begin
  select count(*) into n from leads; if n <> 1 then raise exception 'FAIL isolation: bob sees % leads', n; end if;
  select count(*) into n from workspaces; if n <> 1 then raise exception 'FAIL isolation: bob sees % workspaces', n; end if;
end $$;

-- 2. Cross-tenant writes are rejected.
select set_config('app.ws_a', :'ws_a', true);
do $$ declare n int; begin
  begin
    insert into leads (workspace_id, dedupe_key, first_name, email) values (current_setting('app.ws_a')::uuid, 'k2', 'Evil', 'e@x.test');
    raise exception 'FAIL: cross-tenant insert allowed';
  exception when insufficient_privilege then null; end;
  update leads set first_name = 'Hacked' where workspace_id = current_setting('app.ws_a')::uuid;
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: cross-tenant update touched % rows', n; end if;
  delete from leads where workspace_id = current_setting('app.ws_a')::uuid;
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: cross-tenant delete touched % rows', n; end if;
end $$;

-- 3. Direct workspace insert is blocked (must use create_workspace()).
do $$ begin
  begin
    insert into workspaces (name, slug) values ('Sneaky','sneaky');
    raise exception 'FAIL: direct workspace insert allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- 4. Viewer is read-only; non-members see nothing.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a', true);
insert into workspace_members (workspace_id, user_id, role) values (:'ws_a','00000000-0000-0000-0000-00000000000c','viewer');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c', true);
do $$ declare n int; begin
  select count(*) into n from leads; if n <> 1 then raise exception 'FAIL viewer should read 1 lead, saw %', n; end if;
  begin
    insert into leads (workspace_id, dedupe_key, first_name, email) values (current_setting('app.ws_a')::uuid, 'k3', 'V', 'v@x.test');
    raise exception 'FAIL: viewer insert allowed';
  exception when insufficient_privilege then null; end;
  update leads set first_name = 'x';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: viewer update touched % rows', n; end if;
end $$;

-- 5. Members cannot self-promote or add owners.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b', true);
do $$ begin
  begin
    insert into workspace_members (workspace_id, user_id, role) values (current_setting('app.ws_a')::uuid,'00000000-0000-0000-0000-00000000000b','owner');
    raise exception 'FAIL: outsider added self to workspace A';
  exception when insufficient_privilege then null; end;
end $$;

-- 6. Secrets and audit log are not writable/readable by clients.
do $$ begin
  begin perform * from integration_secrets; raise exception 'FAIL: secrets readable'; exception when insufficient_privilege then null; end;
  begin insert into audit_logs (action, entity_type) values ('x','y'); raise exception 'FAIL: audit insert allowed'; exception when insufficient_privilege then null; end;
end $$;

-- 7. Audit trail captured lead creation and is append-only even for the owner/service role.
reset role;
do $$ declare n int; begin
  select count(*) into n from audit_logs where action = 'lead_created'; if n < 2 then raise exception 'FAIL: lead_created not audited (%)', n; end if;
  begin update audit_logs set action = 'tampered'; raise exception 'FAIL: audit log mutable'; exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- 8. Unique constraints: dedupe and double-booking.
do $$ begin
  begin
    insert into leads (workspace_id, dedupe_key, first_name, email) values (current_setting('app.ws_a')::uuid,'k1','Dup','dup@x.test');
    raise exception 'FAIL: duplicate dedupe_key allowed';
  exception when unique_violation then null; end;
end $$;

-- 9. Deal contract_value is generated.
insert into deals (workspace_id, lead_id, initial_payment, recurring_payment, recurring_months, one_time_fees)
  select workspace_id, id, 1000, 500, 5, 100 from leads where first_name = 'Ann';
do $$ declare v numeric; begin
  select contract_value into v from deals; if v <> 3600 then raise exception 'FAIL contract_value %', v; end if;
end $$;

-- 10. Reporting view respects RLS (security_invoker).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b', true);
do $$ declare n int; begin
  select count(*) into n from campaign_funnel; if n <> 0 then raise exception 'FAIL: view leaked % rows', n; end if;
end $$;

rollback;
\echo 'RLS TESTS PASSED'
