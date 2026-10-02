-- =====================================================================
-- NAFILHCC ADMIN SYSTEM — UPGRADE v2 -> v3
-- Run this ONCE in the SQL Editor of your LIVE Supabase project.
--
-- What this does:
--   1. Creates two new, separate registers: "offers" and
--      "allocation_records" (previously combined into one "subscribers"
--      table).
--   2. Copies every existing row out of "subscribers" into the right
--      new table(s) — nothing is deleted. The old table is kept,
--      renamed to "subscribers_legacy_v2", as a permanent backup.
--   3. Makes every date field optional everywhere (nothing required).
--   4. Carries over any custom columns you'd already added.
--
-- Safe to run more than once — every step checks first.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------
-- 1. OFFERS (Provisional Offer register)
-- ---------------------------------------------------------------
create table if not exists offers (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  subscriber_name text not null,
  form_no text,                 -- "Form No" / PON on the office sheet
  property_type text,
  phone_number text,
  email_address text,
  offer_printed boolean not null default false,
  offer_collected boolean not null default false,
  offer_collected_by text,
  offer_collected_date date,    -- optional: fill in later if unknown now
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

-- ---------------------------------------------------------------
-- 2. ALLOCATION_RECORDS (Final Allocation register)
-- ---------------------------------------------------------------
create table if not exists allocation_records (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  subscriber_name text not null,
  house_no text,                 -- "House No" on the office sheet
  property_type text,
  printed boolean not null default false,
  signed boolean not null default false,
  collected boolean not null default false,
  collected_by text,
  collected_date date,           -- optional: fill in later if unknown now
  phone_number text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_allocrec_estate on allocation_records(estate_id);

-- ---------------------------------------------------------------
-- 3. Migrate data out of "subscribers" (only runs once — skips if
--    already done or if there's nothing to migrate)
-- ---------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.subscribers') is not null
     and (select count(*) from offers) = 0
     and (select count(*) from allocation_records) = 0 then

    for s in select * from subscribers loop
      if s.offer_made or s.pon is not null or s.offer_collected_by is not null then
        insert into offers (
          estate_id, subscriber_name, form_no, property_type, phone_number, email_address,
          offer_printed, offer_collected, offer_collected_by, offer_collected_date,
          amount_paid, comment, remarks, custom_data, created_by, created_at, is_deleted
        ) values (
          s.estate_id, s.subscriber_name, s.pon, s.property_type, s.phone_number, s.email_address,
          s.offer_printed, s.offer_collected, s.offer_collected_by, s.offer_collected_date,
          coalesce(s.amount_paid_property,0) + coalesce(s.amount_paid_infrastructure,0),
          s.comments, s.remarks, s.custom_data, s.created_by, s.created_at, s.is_deleted
        );
      end if;

      if s.allocation_made or s.allocation_no is not null or s.allocation_collected_by is not null then
        insert into allocation_records (
          estate_id, subscriber_name, house_no, property_type,
          printed, signed, collected, collected_by, collected_date, phone_number,
          remarks, custom_data, created_by, created_at, is_deleted
        ) values (
          s.estate_id, s.subscriber_name, s.allocation_no, s.property_type,
          false, s.allocation_made, (s.allocation_collected_by is not null or s.allocation_collected_date is not null),
          s.allocation_collected_by, s.allocation_collected_date, s.phone_number,
          s.remarks, s.custom_data, s.created_by, s.created_at, s.is_deleted
        );
      end if;
    end loop;

    alter table subscribers rename to subscribers_legacy_v2;
  end if;
end $$;

-- if an old v1 "allocations" table is still sitting around under its
-- original name (not yet renamed to allocations_legacy), tuck it away
-- too, so its name can never collide with anything going forward
do $$ begin
  if to_regclass('public.allocations') is not null then
    alter table allocations rename to allocations_legacy_v1;
  end if;
exception when others then null; end $$;

-- ---------------------------------------------------------------
-- 4. Change of Ownership: point at the new tables going forward
-- ---------------------------------------------------------------
alter table ownership_changes add column if not exists offer_id uuid references offers(id);
alter table ownership_changes add column if not exists allocation_record_id uuid references allocation_records(id);

-- ---------------------------------------------------------------
-- 5. Carry over any custom columns you'd already added to the old
--    combined "subscribers" register, into both new registers
-- ---------------------------------------------------------------
insert into custom_fields (table_name, field_key, field_label, field_type, options, sort_order, created_by)
select 'offers', field_key, field_label, field_type, options, sort_order, created_by
from custom_fields where table_name = 'subscribers' and is_deleted = false
on conflict (table_name, field_key) do nothing;

insert into custom_fields (table_name, field_key, field_label, field_type, options, sort_order, created_by)
select 'allocation_records', field_key, field_label, field_type, options, sort_order, created_by
from custom_fields where table_name = 'subscribers' and is_deleted = false
on conflict (table_name, field_key) do nothing;

-- ---------------------------------------------------------------
-- 6. Audit triggers
-- ---------------------------------------------------------------
drop trigger if exists trg_audit_offers on offers;
create trigger trg_audit_offers after insert or update or delete on offers
  for each row execute procedure write_audit_log();

drop trigger if exists trg_audit_allocation_records on allocation_records;
create trigger trg_audit_allocation_records after insert or update or delete on allocation_records
  for each row execute procedure write_audit_log();

-- ---------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------
alter table offers enable row level security;
alter table allocation_records enable row level security;

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

-- =====================================================================
-- DONE. Your old combined data is safe in "subscribers_legacy_v2".
-- The app now reads/writes "offers" and "allocation_records" as two
-- separate registers. Next: deploy the v3 frontend code.
-- =====================================================================
