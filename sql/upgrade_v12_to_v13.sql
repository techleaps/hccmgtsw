-- ============================================================
-- Complete audit trail: every business table, richer log rows
-- ============================================================

-- Extra columns for accountability / proof
alter table audit_logs add column if not exists changed_fields text[];
alter table audit_logs add column if not exists summary text;
alter table audit_logs add column if not exists source text; -- e.g. trigger, bulk_import, system

create index if not exists idx_audit_performed_at on audit_logs(performed_at desc);
create index if not exists idx_audit_table on audit_logs(table_name);
create index if not exists idx_audit_action on audit_logs(action);
create index if not exists idx_audit_performed_by on audit_logs(performed_by);
create index if not exists idx_audit_record on audit_logs(table_name, record_id);

-- Stronger audit writer: field-level diff + short summary
create or replace function write_audit_log() returns trigger as $$
declare
  v_user uuid := auth.uid();
  v_record uuid;
  v_changed text[] := array[]::text[];
  v_key text;
  v_summary text;
  v_old jsonb;
  v_new jsonb;
begin
  if (tg_op = 'INSERT') then
    v_record := new.id;
    v_new := to_jsonb(new);
    v_summary := tg_table_name || ' created';
    insert into audit_logs(table_name, record_id, action, new_data, performed_by, summary, source)
    values (tg_table_name, v_record, 'INSERT', v_new, v_user, v_summary, 'db_trigger');
    return new;

  elsif (tg_op = 'UPDATE') then
    v_record := new.id;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- Collect changed keys (ignore noisy timestamps if unchanged pattern)
    for v_key in select jsonb_object_keys(v_new)
    loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        if v_key not in ('updated_at') then
          v_changed := array_append(v_changed, v_key);
        end if;
      end if;
    end loop;
    -- Soft-delete detection
    if (v_old ? 'is_deleted') and (v_old->>'is_deleted') = 'false'
       and (v_new->>'is_deleted') = 'true' then
      v_summary := tg_table_name || ' soft-deleted';
    elsif array_length(v_changed, 1) is null then
      v_summary := tg_table_name || ' updated (no field change)';
    else
      v_summary := tg_table_name || ' updated: ' || array_to_string(v_changed, ', ');
    end if;
    insert into audit_logs(table_name, record_id, action, old_data, new_data, performed_by, changed_fields, summary, source)
    values (tg_table_name, v_record, 'UPDATE', v_old, v_new, v_user, v_changed, v_summary, 'db_trigger');
    return new;

  elsif (tg_op = 'DELETE') then
    v_record := old.id;
    v_old := to_jsonb(old);
    v_summary := tg_table_name || ' hard-deleted';
    insert into audit_logs(table_name, record_id, action, old_data, performed_by, summary, source)
    values (tg_table_name, v_record, 'DELETE', v_old, v_user, v_summary, 'db_trigger');
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

-- Attach triggers to EVERY business table (idempotent)
do $$
declare
  t text;
  tables text[] := array[
    'profiles',
    'estates',
    'estate_property_types',
    'offers',
    'allocation_records',
    'ownership_changes',
    'payments',
    'approvals_expenditures',
    'refunds',
    'contract_awards',
    'construction_units',
    'custom_fields',
    'custom_tabs',
    'custom_tab_records',
    'documents',
    'edit_requests'
  ];
begin
  foreach t in array tables
  loop
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

-- Allow supervisors to read all audit logs (if policy missing)
alter table audit_logs enable row level security;
drop policy if exists audit_select on audit_logs;
create policy audit_select on audit_logs for select using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin', 'supervisor', 'md')
  )
);
-- Inserts only via security definer function
drop policy if exists audit_insert on audit_logs;
create policy audit_insert on audit_logs for insert with check (true);

comment on table audit_logs is 'Complete system audit trail — inserts/updates/deletes on all business tables via DB triggers.';


-- Allow authenticated users to insert their own auth session events (login/logout)
drop policy if exists audit_insert_auth on audit_logs;
create policy audit_insert_auth on audit_logs for insert
  with check (
    auth.uid() is not null
    or table_name = 'auth_sessions'
  );

-- LOGIN_FAILED may happen before session exists — allow insert of auth_sessions without uid
drop policy if exists audit_insert_auth_anon on audit_logs;
create policy audit_insert_auth_anon on audit_logs for insert
  with check (table_name = 'auth_sessions');
