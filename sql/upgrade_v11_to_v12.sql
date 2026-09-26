-- Award of contract: richer fields for multi-estate Excel imports
alter table contract_awards add column if not exists request_ref text;
alter table contract_awards add column if not exists portfolio text;
alter table contract_awards add column if not exists amount_applied numeric(18,2) default 0;
alter table contract_awards add column if not exists payment_note text;
alter table contract_awards add column if not exists progress text;
alter table contract_awards add column if not exists comments text;
alter table contract_awards add column if not exists approval_date date;
alter table contract_awards add column if not exists reason text;
alter table contract_awards add column if not exists award_category text;
-- contractor may be blank on some rows (e.g. land premium); keep text not null with default
alter table contract_awards alter column contractor_name drop not null;
