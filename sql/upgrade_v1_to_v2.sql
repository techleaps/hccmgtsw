-- =====================================================================
-- NAFILHCC ADMIN SYSTEM — UPGRADE v1 -> v2
-- Run this ONCE in the SQL Editor of your EXISTING live Supabase project.
-- It only ADDS things and MIGRATES your existing data into the new,
-- richer "subscribers" register — it never deletes your old data.
-- Your old "allocations" table is kept, renamed to "allocations_legacy",
-- as a permanent backup. Safe to run more than once (it checks first).
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 1. PROFILES: username + forced password change
-- ---------------------------------------------------------------
alter table profiles add column if not exists username text;
do $$ begin
  alter table profiles add constraint profiles_username_key unique (username);
exception when duplicate_object then null; end $$;
alter table profiles add column if not exists must_change_password boolean not null default true;

-- existing users keep working as-is; only new accounts are forced to change password
update profiles set must_change_password = false where must_change_password is null;

create or replace function get_login_email(p_username text)
returns text as $$
  select email from profiles where lower(username) = lower(p_username) and is_active = true limit 1;
$$ language sql stable security definer;

grant execute on function get_login_email(text) to anon, authenticated;

-- make the new-user trigger aware of username + role passed at creation time
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    new.raw_user_meta_data->>'username',
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'user')
  );
  return new;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------
-- 2. SUBSCRIBERS (new register, replaces the old PO/FA "allocations")
-- ---------------------------------------------------------------
create table if not exists subscribers (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  subscriber_name text not null,
  pon text,
  file_number text,
  property_type text,
  phone_number text,
  email_address text,

  offer_made boolean not null default false,
  offer_printed boolean not null default false,
  offer_collected boolean not null default false,
  offer_collected_by text,
  offer_collected_date date,
  date_offer_signed date,

  allocation_made boolean not null default false,
  allocation_no text,
  allocation_collected_by text,
  allocation_collected_date date,
  date_allocation_signed date,

  amount_paid_property numeric(15,2) not null default 0,
  amount_paid_infrastructure numeric(15,2) not null default 0,
  legal_tdp text,

  comments text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_subscribers_estate on subscribers(estate_id);

-- migrate data out of the old allocations table (only runs if that table
-- exists and subscribers is still empty, so it is safe to re-run)
do $$
declare
  a record;
  v_sub_id uuid;
  v_existing uuid;
begin
  if to_regclass('public.allocations') is not null
     and (select count(*) from subscribers) = 0 then

    create temporary table _migration_alloc_map (allocation_id uuid, subscriber_id uuid) on commit drop;

    for a in select * from allocations order by created_at asc loop
      select id into v_existing from subscribers
        where estate_id = a.estate_id and lower(subscriber_name) = lower(a.owner_name)
        limit 1;

      if v_existing is null then
        insert into subscribers (
          estate_id, subscriber_name, property_type,
          offer_made, allocation_no, allocation_made,
          pon, date_offer_signed, offer_collected_by, offer_collected_date,
          date_allocation_signed, allocation_collected_by, allocation_collected_date,
          comments, remarks, created_by, created_at, is_deleted
        ) values (
          a.estate_id, a.owner_name, a.property_type,
          (a.doc_type = 'PO'), case when a.doc_type = 'FA' then a.allocation_no else null end, (a.doc_type = 'FA'),
          case when a.doc_type = 'PO' then a.document_ref_no else null end,
          case when a.doc_type = 'PO' then a.date_signed else null end,
          case when a.doc_type = 'PO' then a.signed_by else null end,
          case when a.doc_type = 'PO' then a.date_collected else null end,
          case when a.doc_type = 'FA' then a.date_signed else null end,
          case when a.doc_type = 'FA' then a.signed_by else null end,
          case when a.doc_type = 'FA' then a.date_collected else null end,
          a.comments, a.remarks, a.created_by, a.created_at, a.is_deleted
        ) returning id into v_sub_id;
      else
        v_sub_id := v_existing;
        if a.doc_type = 'PO' then
          update subscribers set offer_made = true,
            pon = coalesce(pon, a.document_ref_no),
            date_offer_signed = coalesce(date_offer_signed, a.date_signed),
            offer_collected_by = coalesce(offer_collected_by, a.signed_by),
            offer_collected_date = coalesce(offer_collected_date, a.date_collected)
          where id = v_sub_id;
        else
          update subscribers set allocation_made = true,
            allocation_no = coalesce(allocation_no, a.allocation_no),
            date_allocation_signed = coalesce(date_allocation_signed, a.date_signed),
            allocation_collected_by = coalesce(allocation_collected_by, a.signed_by),
            allocation_collected_date = coalesce(allocation_collected_date, a.date_collected)
          where id = v_sub_id;
        end if;
      end if;

      insert into _migration_alloc_map values (a.id, v_sub_id);
    end loop;

    -- carry the ownership-change history across to the new subscriber ids
    if to_regclass('public.ownership_changes') is not null then
      alter table ownership_changes add column if not exists subscriber_id uuid references subscribers(id);
      update ownership_changes oc
        set subscriber_id = m.subscriber_id
        from _migration_alloc_map m
        where oc.allocation_id = m.allocation_id and oc.subscriber_id is null;
    end if;

    alter table allocations rename to allocations_legacy;
  end if;
end $$;

-- if this is actually a brand-new v2 install (no legacy allocations table
-- ever existed), ownership_changes still needs the subscriber_id column
alter table ownership_changes add column if not exists subscriber_id uuid references subscribers(id);
alter table ownership_changes add column if not exists new_pon text;
alter table ownership_changes add column if not exists new_allocation_no text;
alter table ownership_changes alter column allocation_id drop not null;

-- ---------------------------------------------------------------
-- 3. APPROVALS / REFUNDS: link to an estate & subscriber for filtering
-- ---------------------------------------------------------------
alter table approvals_expenditures add column if not exists estate_id uuid references estates(id);
alter table approvals_expenditures add column if not exists subscriber_id uuid references subscribers(id);
create index if not exists idx_approvals_estate on approvals_expenditures(estate_id);

alter table refunds add column if not exists estate_id uuid references estates(id);
alter table refunds add column if not exists subscriber_id uuid references subscribers(id);
create index if not exists idx_refunds_estate on refunds(estate_id);

-- ---------------------------------------------------------------
-- 4. CUSTOM TABS
-- ---------------------------------------------------------------
create table if not exists custom_tabs (
  id uuid primary key default uuid_generate_v4(),
  tab_key text not null unique,
  label text not null,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create table if not exists custom_tab_records (
  id uuid primary key default uuid_generate_v4(),
  tab_id uuid not null references custom_tabs(id) on delete cascade,
  serial_no bigint generated always as identity,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_ctr_tab on custom_tab_records(tab_id);

alter table custom_fields add column if not exists sort_order int not null default 0;

-- ---------------------------------------------------------------
-- 5. DOCUMENTS
-- ---------------------------------------------------------------
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  description text,
  linked_user_id uuid references profiles(id) on delete set null,
  linked_table text,
  linked_record_id uuid,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_documents_user on documents(linked_user_id);
create index if not exists idx_documents_record on documents(linked_table, linked_record_id);

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_storage_read on storage.objects;
create policy documents_storage_read on storage.objects for select
  using (bucket_id = 'documents' and auth.uid() is not null);
drop policy if exists documents_storage_write on storage.objects;
create policy documents_storage_write on storage.objects for insert
  with check (bucket_id = 'documents' and auth.uid() is not null);
drop policy if exists documents_storage_delete on storage.objects;
create policy documents_storage_delete on storage.objects for delete
  using (bucket_id = 'documents' and is_supervisor_or_above());

-- ---------------------------------------------------------------
-- 6. AUDIT TRIGGERS for the new/renamed tables
-- ---------------------------------------------------------------
drop trigger if exists trg_audit_allocations on allocations_legacy;
drop trigger if exists trg_audit_subscribers on subscribers;
create trigger trg_audit_subscribers after insert or update or delete on subscribers
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_custom_tab_records on custom_tab_records;
create trigger trg_audit_custom_tab_records after insert or update or delete on custom_tab_records
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_documents on documents;
create trigger trg_audit_documents after insert or update or delete on documents
  for each row execute procedure write_audit_log();

-- ---------------------------------------------------------------
-- 7. apply_edit_request: teach it about custom_data / data jsonb columns
-- ---------------------------------------------------------------
create or replace function apply_edit_request(p_request_id uuid, p_approve boolean, p_review_comment text default null)
returns void as $$
declare
  r edit_requests%rowtype;
  v_role user_role := current_role_name();
  k text;
  v jsonb;
begin
  if v_role not in ('super_admin','admin','supervisor') then
    raise exception 'Only supervisors/admins can review requests';
  end if;

  select * into r from edit_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'Request not found or already reviewed';
  end if;

  if not p_approve then
    update edit_requests set status='rejected', reviewed_by=auth.uid(), reviewed_at=now(), review_comment=p_review_comment
    where id = p_request_id;
    return;
  end if;

  if r.request_type = 'delete' then
    execute format('update %I set is_deleted = true, updated_at = now() where id = $1', r.table_name) using r.record_id;
  else
    for k, v in select * from jsonb_each(r.proposed_changes) loop
      if k = 'custom_data' then
        execute format('update %I set custom_data = $1, updated_at = now() where id = $2', r.table_name) using v, r.record_id;
      elsif k = 'data' then
        execute format('update %I set data = $1, updated_at = now() where id = $2', r.table_name) using v, r.record_id;
      else
        execute format('update %I set %I = $1, updated_at = now() where id = $2', r.table_name, k)
          using (v #>> '{}'), r.record_id;
      end if;
    end loop;
  end if;

  update edit_requests set status='approved', reviewed_by=auth.uid(), reviewed_at=now(), review_comment=p_review_comment
  where id = p_request_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------
-- 8. RLS for new tables
-- ---------------------------------------------------------------
alter table subscribers enable row level security;
alter table custom_tabs enable row level security;
alter table custom_tab_records enable row level security;
alter table documents enable row level security;

drop policy if exists sub_select on subscribers;
create policy sub_select on subscribers for select using (auth.uid() is not null);
drop policy if exists sub_insert on subscribers;
create policy sub_insert on subscribers for insert with check (auth.uid() is not null);
drop policy if exists sub_update on subscribers;
create policy sub_update on subscribers for update using (is_supervisor_or_above());
drop policy if exists sub_delete on subscribers;
create policy sub_delete on subscribers for delete using (is_supervisor_or_above());

drop policy if exists ct_select on custom_tabs;
create policy ct_select on custom_tabs for select using (auth.uid() is not null);
drop policy if exists ct_write on custom_tabs;
create policy ct_write on custom_tabs for insert with check (is_admin_or_above());
drop policy if exists ct_update on custom_tabs;
create policy ct_update on custom_tabs for update using (is_admin_or_above());
drop policy if exists ct_delete on custom_tabs;
create policy ct_delete on custom_tabs for delete using (is_admin_or_above());

drop policy if exists ctr_select on custom_tab_records;
create policy ctr_select on custom_tab_records for select using (auth.uid() is not null);
drop policy if exists ctr_insert on custom_tab_records;
create policy ctr_insert on custom_tab_records for insert with check (auth.uid() is not null);
drop policy if exists ctr_update on custom_tab_records;
create policy ctr_update on custom_tab_records for update using (is_supervisor_or_above());
drop policy if exists ctr_delete on custom_tab_records;
create policy ctr_delete on custom_tab_records for delete using (is_supervisor_or_above());

drop policy if exists doc_select on documents;
create policy doc_select on documents for select using (auth.uid() is not null);
drop policy if exists doc_insert on documents;
create policy doc_insert on documents for insert with check (auth.uid() is not null);
drop policy if exists doc_delete on documents;
create policy doc_delete on documents for delete using (is_supervisor_or_above());

-- =====================================================================
-- DONE. Your old data is safe in "allocations_legacy". The app now
-- reads/writes "subscribers" instead. Next: deploy the v2 frontend
-- code and follow README.md "Upgrading from v1" section.
-- =====================================================================
