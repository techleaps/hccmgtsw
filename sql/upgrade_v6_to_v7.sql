-- v6 → v7: Construction units + contract awards
-- Safe to run on live DB (additive only).

-- Contractors / awards of contract
create table if not exists contract_awards (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid references estates(id),
  contractor_name text not null,
  phone_number text,
  address text,
  description text,
  contract_amount numeric(15,2) default 0,
  amount_given numeric(15,2) default 0,
  award_date date,
  house_numbers text, -- free text list e.g. "A1, A2, A15-A20"
  property_type text,
  status text default 'active', -- active, completed, terminated
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists idx_contract_awards_estate on contract_awards(estate_id);
create index if not exists idx_contract_awards_name on contract_awards(lower(contractor_name));

-- House / property units for construction tracking
create table if not exists construction_units (
  id uuid primary key default uuid_generate_v4(),
  serial_no bigint generated always as identity,
  estate_id uuid not null references estates(id),
  house_no text not null,          -- e.g. A12, B3
  block_letter text,               -- A, B, C, D
  unit_number integer,             -- 12
  property_type text,              -- 4BR Fully, 4BR Semi, 3BR, 2BR
  property_name text,              -- optional friendly name
  awarded boolean not null default false,
  contractor_name text,
  contractor_phone text,
  contract_award_id uuid references contract_awards(id) on delete set null,
  date_of_contract date,
  status_of_work text default 'Not started', -- Not started, Foundation, Superstructure, Roofing, Finishing, Completed, On hold
  remarks text,
  custom_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  unique (estate_id, house_no)
);
create index if not exists idx_construction_estate on construction_units(estate_id);
create index if not exists idx_construction_house on construction_units(estate_id, lower(house_no));
create index if not exists idx_construction_contractor on construction_units(lower(contractor_name));

-- RLS
alter table contract_awards enable row level security;
alter table construction_units enable row level security;

drop policy if exists ca_select on contract_awards;
create policy ca_select on contract_awards for select using (auth.uid() is not null);
drop policy if exists ca_insert on contract_awards;
create policy ca_insert on contract_awards for insert with check (auth.uid() is not null);
drop policy if exists ca_update on contract_awards;
create policy ca_update on contract_awards for update using (is_supervisor_or_above());
drop policy if exists ca_delete on contract_awards;
create policy ca_delete on contract_awards for delete using (is_admin_or_above());

drop policy if exists cu_select on construction_units;
create policy cu_select on construction_units for select using (auth.uid() is not null);
drop policy if exists cu_insert on construction_units;
create policy cu_insert on construction_units for insert with check (auth.uid() is not null);
drop policy if exists cu_update on construction_units;
create policy cu_update on construction_units for update using (is_supervisor_or_above());
drop policy if exists cu_delete on construction_units;
create policy cu_delete on construction_units for delete using (is_admin_or_above());
