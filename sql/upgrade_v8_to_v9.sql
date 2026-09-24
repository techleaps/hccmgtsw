-- Per-subscriber / per-unit infrastructure waiver
alter table allocation_records add column if not exists infrastructure_waived boolean not null default false;
alter table offers add column if not exists infrastructure_waived boolean not null default false;
