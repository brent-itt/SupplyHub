begin;

-- Older versions approved unconfirmed accounts immediately. Keep those pending.
update public.profiles p set is_active = false
from auth.users u
where u.id = p.id and (u.email is null or u.email_confirmed_at is null) and p.is_active;

create or replace function public.set_user_access(p_user_id uuid, p_role text, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
begin
  perform pg_advisory_xact_lock(72146821493812001::bigint);
  v_actor := public.require_role(array['super_admin']);
  if p_role is null or p_role not in ('staff', 'admin', 'super_admin') or p_is_active is null then
    raise exception 'Provide a valid role and account status.' using errcode = '22023';
  end if;
  if p_user_id = v_actor and (p_role <> 'super_admin' or not p_is_active) then
    raise exception 'You cannot disable or demote your own super admin account.' using errcode = '22023';
  end if;
  if p_is_active and not exists (
    select 1 from auth.users where id = p_user_id and email is not null and email_confirmed_at is not null
  ) then
    raise exception 'The account owner must verify their email before activation.' using errcode = '22023';
  end if;
  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
end;
$$;

-- Only a verified active super admin can view other users' confirmation status.
-- Read Auth's trusted timestamp, never editable user metadata.
create or replace function public.get_account_profiles()
returns table (id uuid, email text, full_name text, role text, is_active boolean, created_at timestamptz, email_verified boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role(array['super_admin']);
  return query
    select p.id, p.email, p.full_name, p.role, p.is_active, p.created_at,
      (u.email is not null and u.email_confirmed_at is not null)
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at desc, p.id limit 500;
end;
$$;

revoke execute on function public.get_account_profiles() from public, anon, authenticated;
grant execute on function public.get_account_profiles() to authenticated;

commit;
