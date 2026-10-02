-- ============================================================
-- Audit: columns, RPC, policies, triggers
-- Fixed: do NOT coalesce enum user_role with ''
-- ============================================================

alter table audit_logs add column if not exists summary text;
alter table audit_logs add column if not exists source text;
alter table audit_logs add column if not exists changed_fields text[];

create index if not exists idx_audit_performed_at on audit_logs(performed_at desc);
create index if not exists idx_audit_table on audit_logs(table_name);
create index if not exists idx_audit_action on audit_logs(action);

-- RPC (bypasses RLS) for login/logout and client events
create or replace function public.log_audit_event(
  p_table_name text,
  p_action text,
  p_record_id uuid default null,
  p_summary text default null,
  p_new_data jsonb default null,
  p_old_data jsonb default null,
  p_performed_by uuid default null,
  p_source text default 'client'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_by uuid := coalesce(p_performed_by, auth.uid());
begin
  insert into audit_logs(
    table_name, record_id, action, old_data, new_data, performed_by, summary, source
  ) values (
    p_table_name,
    p_record_id,
    p_action,
    p_old_data,
    p_new_data,
    v_by,
    coalesce(p_summary, p_action),
    p_source
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_audit_event(text, text, uuid, text, jsonb, jsonb, uuid, text) to authenticated;
grant execute on function public.log_audit_event(text, text, uuid, text, jsonb, jsonb, uuid, text) to anon;
grant execute on function public.log_audit_event(text, text, uuid, text, jsonb, jsonb, uuid, text) to service_role;

alter table audit_logs enable row level security;

-- SELECT: any signed-in user can read audit (tighten later if needed)
drop policy if exists audit_select on audit_logs;
drop policy if exists audit_select_all_auth on audit_logs;
create policy audit_select_all_auth on audit_logs
  for select
  using (auth.uid() is not null);

-- INSERT: open for auth events + fallback (RPC is preferred)
drop policy if exists audit_insert on audit_logs;
drop policy if exists audit_insert_auth on audit_logs;
drop policy if exists audit_insert_auth_anon on audit_logs;
drop policy if exists audit_insert_any on audit_logs;
create policy audit_insert_any on audit_logs
  for insert
  with check (true);

-- Data-change trigger function
create or replace function write_audit_log() returns trigger as $$
declare
  v_user uuid := auth.uid();
  v_changed text[] := array[]::text[];
  v_key text;
  v_summary text;
  v_old jsonb;
  v_new jsonb;
begin
  if (tg_op = 'INSERT') then
    insert into audit_logs(table_name, record_id, action, new_data, performed_by, summary, source)
    values (tg_table_name, new.id, 'INSERT', to_jsonb(new), v_user, tg_table_name || ' created', 'db_trigger');
    return new;
  elsif (tg_op = 'UPDATE') then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for v_key in select jsonb_object_keys(v_new)
    loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) and v_key <> 'updated_at' then
        v_changed := array_append(v_changed, v_key);
      end if;
    end loop;
    if (v_old ? 'is_deleted') and (v_old->>'is_deleted') = 'false' and (v_new->>'is_deleted') = 'true' then
      v_summary := tg_table_name || ' soft-deleted';
    else
      v_summary := tg_table_name || ' updated'
        || case when array_length(v_changed, 1) is not null
             then (': ' || array_to_string(v_changed, ', '))
             else '' end;
    end if;
    insert into audit_logs(table_name, record_id, action, old_data, new_data, performed_by, changed_fields, summary, source)
    values (tg_table_name, new.id, 'UPDATE', v_old, v_new, v_user, v_changed, v_summary, 'db_trigger');
    return new;
  elsif (tg_op = 'DELETE') then
    insert into audit_logs(table_name, record_id, action, old_data, performed_by, summary, source)
    values (tg_table_name, old.id, 'DELETE', to_jsonb(old), v_user, tg_table_name || ' hard-deleted', 'db_trigger');
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

-- Attach triggers to all business tables that exist
do $$
declare
  t text;
  tables text[] := array[
    'profiles','estates','estate_property_types','offers','allocation_records',
    'ownership_changes','payments','approvals_expenditures','refunds',
    'contract_awards','construction_units','custom_fields','custom_tabs',
    'custom_tab_records','documents','edit_requests'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('drop trigger if exists trg_audit_%s on %I', t, t);
      execute format(
        'create trigger trg_audit_%s after insert or update or delete on %I for each row execute procedure write_audit_log()',
        t, t
      );
    end if;
  end loop;
end $$;
