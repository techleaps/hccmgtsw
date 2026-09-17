-- v5 → v6: documents linked to subscribers; COO fee + estate on ownership_changes
-- Safe to run on live DB (additive only).

alter table documents add column if not exists estate_id uuid references estates(id);
alter table documents add column if not exists subscriber_name text;
create index if not exists idx_documents_subscriber on documents(estate_id, lower(subscriber_name));

alter table ownership_changes add column if not exists estate_id uuid references estates(id);
alter table ownership_changes add column if not exists amount_paid numeric(15,2) default 0;
alter table ownership_changes add column if not exists property_type text;
create index if not exists idx_ownership_estate on ownership_changes(estate_id);

-- Backfill estate_id on ownership_changes from linked allocation/offer where missing
update ownership_changes oc
set estate_id = ar.estate_id
from allocation_records ar
where oc.allocation_record_id = ar.id
  and oc.estate_id is null;

update ownership_changes oc
set estate_id = o.estate_id
from offers o
where oc.offer_id = o.id
  and oc.estate_id is null;

alter table refunds add column if not exists property_type text;
