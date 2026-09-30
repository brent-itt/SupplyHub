-- 1. Apply the migration.
-- 2. Create the initial user in Supabase Dashboard > Authentication > Users.
-- 3. Replace the email below and run this once in the privileged SQL editor.
--    Do not expose a service-role key or this bootstrap through the website.
do $$
declare
  v_email text := 'replace-with-your-university-email@example.edu';
  v_id uuid;
begin
  if exists (select 1 from public.profiles where role = 'super_admin' and is_active) then
    raise exception 'A super admin already exists. Use the app Users page to manage access.';
  end if;
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then raise exception 'Create this user in Authentication first, and enter their exact email above.'; end if;
  update public.profiles set role = 'super_admin', is_active = true where id = v_id;
end;
$$;
