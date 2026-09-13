-- =====================================================================
-- HOTFIX: "Database error creating new user"
-- Run this once in Supabase SQL Editor. Safe to run any time — it only
-- replaces one function, no data is touched.
--
-- Cause: the trigger that copies a new auth account into your profiles
-- table didn't have an explicit search_path, so it could occasionally
-- fail to resolve the user_role type when Supabase's Auth service
-- created the account — and since it runs in the same transaction,
-- the whole account creation was rolled back.
--
-- This version sets search_path explicitly and also catches any other
-- unexpected error so it can never again block account creation.
-- =====================================================================

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
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- After running this, go back to Authentication -> Users -> Add User and
-- try creating your account again.
--
-- Once it's created, go to Table Editor -> profiles, find that row, and set:
--   role                  -> super_admin
--   username              -> whatever you want to sign in with
--   must_change_password  -> false  (since you set your own password already)
