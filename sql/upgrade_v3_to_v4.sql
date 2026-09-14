-- =====================================================================
-- NAFILHCC ADMIN SYSTEM — UPGRADE v3 -> v4
-- Run this ONCE in the SQL Editor of your LIVE Supabase project.
--
-- What this does:
--   1. Allows an Allocation record to have NO subscriber name yet, so
--      houses/plots with defects, bad structure, erosion, hillside
--      location, etc. can be captured in the system (with a House No
--      and a comment explaining why it isn't allocated) even before
--      anyone is assigned to them.
--   2. Adds a new "payments" register — a running ledger of every
--      amount a subscriber has paid, tagged as Property, Infrastructure,
--      or Legal/TDP (since these are tracked separately and infra/TDP
--      is not part of the property cost).
--   3. Lets each estate define, per property type, the EXPECTED
--      property cost, infrastructure fee, and legal/TDP fee — since
--      these vary from estate to estate — so payment percentages can
--      be calculated correctly.
--
-- Safe to run more than once — every step checks first. Nothing is
-- deleted.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------
-- 1. Allocations no longer require a subscriber name
-- ---------------------------------------------------------------
alter table allocation_records alter column subscriber_name drop not null;

-- ---------------------------------------------------------------
-- 2. Per-property-type expected fees (vary by estate)
-- ---------------------------------------------------------------
alter table estate_property_types add column if not exists expected_property_cost numeric(15,2);
alter table estate_property_types add column if not exists expected_infrastructure_fee numeric(15,2);
alter table estate_property_types add column if not exists expected_legal_tdp_fee numeric(15,2);

drop policy if exists ept_update on estate_property_types;
create policy ept_update on estate_property_types for update using (is_admin_or_above());

-- ---------------------------------------------------------------
-- 3. PAYMENTS register
-- ---------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  subscriber_name text not null,
  property_type text,
  payment_type text not null default 'property', -- 'property' | 'infrastructure' | 'legal_tdp' | 'other'
  amount numeric(15,2) not null default 0,
  date_paid date,
  payment_reference text,
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_payments_estate on payments(estate_id);
create index if not exists idx_payments_subscriber on payments(estate_id, lower(subscriber_name));

drop trigger if exists trg_audit_payments on payments;
create trigger trg_audit_payments after insert or update or delete on payments
  for each row execute procedure write_audit_log();

alter table payments enable row level security;
drop policy if exists payments_select on payments;
create policy payments_select on payments for select using (auth.uid() is not null);
drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert with check (auth.uid() is not null);
drop policy if exists payments_update on payments;
create policy payments_update on payments for update using (is_supervisor_or_above());
drop policy if exists payments_delete on payments;
create policy payments_delete on payments for delete using (is_supervisor_or_above());

-- =====================================================================
-- DONE. Next: deploy the v4 frontend code.
-- =====================================================================
