-- =====================================================================
-- NAFIL HOUSING & CONSTRUCTION COMPANY (NAFILHCC)
-- ADMINISTRATIVE MANAGEMENT SYSTEM - DATABASE SCHEMA (v2)
-- Run this ENTIRE file once in Supabase SQL Editor (Project > SQL Editor > New query)
-- FOR BRAND NEW PROJECTS ONLY.
-- If you already have v1 running live, do NOT run this file — run
-- sql/upgrade_v1_to_v2.sql instead, which upgrades your live data in place.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 1. ROLES / PROFILES
-- ---------------------------------------------------------------
do $$ begin
  create type user_role as enum ('super_admin','admin','supervisor','user');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique,
  email text not null,
  role user_role not null default 'user',
  supervisor_id uuid references profiles(id) on delete set null,
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Unnamed User'),
    coalesce(new.email, ''),
    new.raw_user_meta_data->>'username',
    case
      when new.raw_user_meta_data->>'role' in ('super_admin','admin','supervisor','user')
        then (new.raw_user_meta_data->>'role')::user_role
      else 'user'::user_role
    end
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never let a profile-row hiccup block Supabase from creating the auth account.
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

create or replace function current_role_name() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function is_admin_or_above() returns boolean as $$
  select current_role_name() in ('super_admin','admin');
$$ language sql stable security definer;

create or replace function is_supervisor_or_above() returns boolean as $$
  select current_role_name() in ('super_admin','admin','supervisor');
$$ language sql stable security definer;

create or replace function get_login_email(p_username text)
returns text as $$
  select email from profiles where lower(username) = lower(p_username) and is_active = true limit 1;
$$ language sql stable security definer;

grant execute on function get_login_email(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- 2. ESTATES
-- ---------------------------------------------------------------
create table if not exists estates (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  category text not null default 'site_and_services',
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create table if not exists estate_property_types (
  id uuid primary key default uuid_generate_v4(),
  estate_id uuid not null references estates(id) on delete cascade,
  property_type text not null,
  created_at timestamptz not null default now(),
  unique (estate_id, property_type)
);

-- ---------------------------------------------------------------
-- 3. OFFERS (Provisional Offer register) and ALLOCATION_RECORDS
--    (Final Allocation register) — two separate registers, since
--    the office tracks and prints them separately.
-- ---------------------------------------------------------------
create table if not exists offers (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  subscriber_name text not null,
  form_no text,
  property_type text,
  phone_number text,
  email_address text,
  offer_printed boolean not null default false,
  offer_collected boolean not null default false,
  offer_collected_by text,
  offer_collected_date date,
  amount_paid numeric(15,2) not null default 0,
  comment text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_offers_estate on offers(estate_id);

create table if not exists allocation_records (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  subscriber_name text not null,
  house_no text,
  property_type text,
  printed boolean not null default false,
  signed boolean not null default false,
  collected boolean not null default false,
  collected_by text,
  collected_date date,
  phone_number text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_allocrec_estate on allocation_records(estate_id);

create table if not exists ownership_changes (
  id uuid primary key default uuid_generate_v4(),
  offer_id uuid references offers(id) on delete cascade,
  allocation_record_id uuid references allocation_records(id) on delete cascade,
  previous_owner text not null,
  new_owner text not null,
  reason text,
  approved_by text,
  new_pon text,
  new_allocation_no text,
  date_changed date not null default current_date,
  comments text,
  remarks text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 4. APPROVALS / EXPENDITURES
-- ---------------------------------------------------------------
create table if not exists approvals_expenditures (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  title text not null,
  purpose text,
  category text,
  estate_id uuid references estates(id),
  application_by text,
  paid_to text,
  amount_applied numeric(15,2) default 0,
  amount_approved numeric(15,2) default 0,
  date_of_approval date,
  comments text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists idx_approvals_category on approvals_expenditures(category);
create index if not exists idx_approvals_estate on approvals_expenditures(estate_id);

-- ---------------------------------------------------------------
-- 5. REFUNDS
-- ---------------------------------------------------------------
create table if not exists refunds (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  subscriber_name text not null,
  estate_id uuid references estates(id),
  reason text,
  refund_made_by text,
  account_to_be_paid text,
  amount_subscriber_has numeric(15,2) default 0,
  amount_requested numeric(15,2) default 0,
  amount_approved numeric(15,2) default 0,
  date_of_approval date,
  account_paid_to text,
  comments text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists idx_refunds_estate on refunds(estate_id);

-- ---------------------------------------------------------------
-- 6. CUSTOM FIELDS
-- ---------------------------------------------------------------
create table if not exists custom_fields (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  field_key text not null,
  field_label text not null,
  field_type text not null default 'text',
  options jsonb default '[]'::jsonb,
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  unique (table_name, field_key)
);

-- ---------------------------------------------------------------
-- 7. CUSTOM TABS
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

-- ---------------------------------------------------------------
-- 8. DOCUMENTS
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
-- 9. AUDIT LOG
-- ---------------------------------------------------------------
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  performed_by uuid references profiles(id),
  performed_at timestamptz not null default now()
);

create or replace function write_audit_log() returns trigger as $$
declare
  v_user uuid := auth.uid();
begin
  if (tg_op = 'INSERT') then
    insert into audit_logs(table_name, record_id, action, new_data, performed_by)
    values (tg_table_name, new.id, 'INSERT', to_jsonb(new), v_user);
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into audit_logs(table_name, record_id, action, old_data, new_data, performed_by)
    values (tg_table_name, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), v_user);
    return new;
  elsif (tg_op = 'DELETE') then
    insert into audit_logs(table_name, record_id, action, old_data, performed_by)
    values (tg_table_name, old.id, 'DELETE', to_jsonb(old), v_user);
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_audit_offers on offers;
create trigger trg_audit_offers after insert or update or delete on offers
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_allocation_records on allocation_records;
create trigger trg_audit_allocation_records after insert or update or delete on allocation_records
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_ownership on ownership_changes;
create trigger trg_audit_ownership after insert or update or delete on ownership_changes
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_approvals on approvals_expenditures;
create trigger trg_audit_approvals after insert or update or delete on approvals_expenditures
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_refunds on refunds;
create trigger trg_audit_refunds after insert or update or delete on refunds
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_estates on estates;
create trigger trg_audit_estates after insert or update or delete on estates
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_custom_tab_records on custom_tab_records;
create trigger trg_audit_custom_tab_records after insert or update or delete on custom_tab_records
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_documents on documents;
create trigger trg_audit_documents after insert or update or delete on documents
  for each row execute procedure write_audit_log();

-- ---------------------------------------------------------------
-- 10. EDIT / DELETE REQUEST WORKFLOW
-- ---------------------------------------------------------------
create table if not exists edit_requests (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid not null,
  request_type text not null,
  proposed_changes jsonb,
  reason text,
  status text not null default 'pending',
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  review_comment text
);

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
-- 11. ROW LEVEL SECURITY
-- ---------------------------------------------------------------
alter table profiles enable row level security;
alter table estates enable row level security;
alter table estate_property_types enable row level security;
alter table offers enable row level security;
alter table allocation_records enable row level security;
alter table ownership_changes enable row level security;
alter table approvals_expenditures enable row level security;
alter table refunds enable row level security;
alter table custom_fields enable row level security;
alter table custom_tabs enable row level security;
alter table custom_tab_records enable row level security;
alter table documents enable row level security;
alter table audit_logs enable row level security;
alter table edit_requests enable row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (auth.uid() is not null);
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update using (auth.uid() = id or is_admin_or_above());
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles for insert with check (is_admin_or_above());
drop policy if exists profiles_admin_delete on profiles;
create policy profiles_admin_delete on profiles for delete using (is_admin_or_above());

drop policy if exists estates_select on estates;
create policy estates_select on estates for select using (auth.uid() is not null);
drop policy if exists estates_write on estates;
create policy estates_write on estates for insert with check (is_admin_or_above());
drop policy if exists estates_update on estates;
create policy estates_update on estates for update using (is_admin_or_above());
drop policy if exists estates_delete on estates;
create policy estates_delete on estates for delete using (is_admin_or_above());

drop policy if exists ept_select on estate_property_types;
create policy ept_select on estate_property_types for select using (auth.uid() is not null);
drop policy if exists ept_write on estate_property_types;
create policy ept_write on estate_property_types for insert with check (is_admin_or_above());
drop policy if exists ept_delete on estate_property_types;
create policy ept_delete on estate_property_types for delete using (is_admin_or_above());

drop policy if exists offers_select on offers;
create policy offers_select on offers for select using (auth.uid() is not null);
drop policy if exists offers_insert on offers;
create policy offers_insert on offers for insert with check (auth.uid() is not null);
drop policy if exists offers_update on offers;
create policy offers_update on offers for update using (is_supervisor_or_above());
drop policy if exists offers_delete on offers;
create policy offers_delete on offers for delete using (is_supervisor_or_above());

drop policy if exists allocrec_select on allocation_records;
create policy allocrec_select on allocation_records for select using (auth.uid() is not null);
drop policy if exists allocrec_insert on allocation_records;
create policy allocrec_insert on allocation_records for insert with check (auth.uid() is not null);
drop policy if exists allocrec_update on allocation_records;
create policy allocrec_update on allocation_records for update using (is_supervisor_or_above());
drop policy if exists allocrec_delete on allocation_records;
create policy allocrec_delete on allocation_records for delete using (is_supervisor_or_above());

drop policy if exists oc_select on ownership_changes;
create policy oc_select on ownership_changes for select using (auth.uid() is not null);
drop policy if exists oc_insert on ownership_changes;
create policy oc_insert on ownership_changes for insert with check (auth.uid() is not null);
drop policy if exists oc_update on ownership_changes;
create policy oc_update on ownership_changes for update using (is_supervisor_or_above());
drop policy if exists oc_delete on ownership_changes;
create policy oc_delete on ownership_changes for delete using (is_supervisor_or_above());

drop policy if exists ae_select on approvals_expenditures;
create policy ae_select on approvals_expenditures for select using (auth.uid() is not null);
drop policy if exists ae_insert on approvals_expenditures;
create policy ae_insert on approvals_expenditures for insert with check (auth.uid() is not null);
drop policy if exists ae_update on approvals_expenditures;
create policy ae_update on approvals_expenditures for update using (is_supervisor_or_above());
drop policy if exists ae_delete on approvals_expenditures;
create policy ae_delete on approvals_expenditures for delete using (is_supervisor_or_above());

drop policy if exists rf_select on refunds;
create policy rf_select on refunds for select using (auth.uid() is not null);
drop policy if exists rf_insert on refunds;
create policy rf_insert on refunds for insert with check (auth.uid() is not null);
drop policy if exists rf_update on refunds;
create policy rf_update on refunds for update using (is_supervisor_or_above());
drop policy if exists rf_delete on refunds;
create policy rf_delete on refunds for delete using (is_supervisor_or_above());

drop policy if exists cf_select on custom_fields;
create policy cf_select on custom_fields for select using (auth.uid() is not null);
drop policy if exists cf_write on custom_fields;
create policy cf_write on custom_fields for insert with check (is_admin_or_above());
drop policy if exists cf_delete on custom_fields;
create policy cf_delete on custom_fields for delete using (is_admin_or_above());

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

drop policy if exists al_select on audit_logs;
create policy al_select on audit_logs for select using (is_supervisor_or_above());

drop policy if exists er_select on edit_requests;
create policy er_select on edit_requests for select using (
  auth.uid() is not null and (requested_by = auth.uid() or is_supervisor_or_above())
);
drop policy if exists er_insert on edit_requests;
create policy er_insert on edit_requests for insert with check (auth.uid() is not null and requested_by = auth.uid());
drop policy if exists er_update on edit_requests;
create policy er_update on edit_requests for update using (is_supervisor_or_above());

-- ---------------------------------------------------------------
-- 12. SEED
-- ---------------------------------------------------------------
insert into estates (name, category) values
  ('Sample Estate 1', 'site_and_services')
on conflict (name) do nothing;

-- =====================================================================
-- END OF SCHEMA. Next: create your first Super Admin (see README.md)
-- =====================================================================
