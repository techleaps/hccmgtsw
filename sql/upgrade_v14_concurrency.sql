-- ============================================================
-- v14: concurrency + performance for multi-user / large estates
-- - auto-bump updated_at on every UPDATE (for conflict detection)
-- - indexes on common date filter columns
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'estates', 'estate_property_types', 'offers', 'allocation_records',
    'ownership_changes', 'payments', 'approvals_expenditures', 'refunds',
    'contract_awards', 'construction_units', 'custom_fields', 'custom_tabs',
    'custom_tab_records', 'documents', 'edit_requests'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists trg_set_updated_at on %I', t);
      execute format(
        'create trigger trg_set_updated_at before update on %I
         for each row execute function public.set_updated_at()',
        t
      );
    end if;
  end loop;
end;
$$;

-- Date / soft-delete indexes (speeds filtered lists under concurrent load)
create index if not exists idx_payments_date_paid on payments(date_paid);
create index if not exists idx_payments_estate_deleted on payments(estate_id, is_deleted);

create index if not exists idx_refunds_date_approval on refunds(date_of_approval);
create index if not exists idx_refunds_estate_deleted on refunds(estate_id, is_deleted);

create index if not exists idx_approvals_date_approval on approvals_expenditures(date_of_approval);
create index if not exists idx_approvals_deleted on approvals_expenditures(is_deleted);

create index if not exists idx_offers_estate_deleted on offers(estate_id, is_deleted);
create index if not exists idx_offers_collected_date on offers(offer_collected_date);

create index if not exists idx_alloc_estate_deleted on allocation_records(estate_id, is_deleted);
create index if not exists idx_alloc_collected_date on allocation_records(collected_date);

create index if not exists idx_contract_awards_approval on contract_awards(approval_date);
create index if not exists idx_contract_awards_deleted on contract_awards(is_deleted);

create index if not exists idx_ownership_date_changed on ownership_changes(date_changed);
create index if not exists idx_construction_contract_date on construction_units(date_of_contract);
create index if not exists idx_construction_estate_deleted on construction_units(estate_id, is_deleted);

create index if not exists idx_documents_created on documents(created_at desc);
create index if not exists idx_edit_requests_requested on edit_requests(requested_at desc);
