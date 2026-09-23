-- COO import helpers + partial unique estate names
alter table ownership_changes add column if not exists property_type text;
alter table ownership_changes add column if not exists status text;

alter table estates drop constraint if exists estates_name_key;
create unique index if not exists estates_name_active_key
  on estates (name)
  where is_deleted = false;
