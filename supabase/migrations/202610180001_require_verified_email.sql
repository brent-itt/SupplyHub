-- Check Auth's trusted confirmation timestamp for both direct API reads and RPCs.
-- Keep administrator approval separate from ownership of the email inbox.
create or replace function public.active_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid() and p.is_active and u.email_confirmed_at is not null;
$$;

create or replace function public.require_role(p_roles text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_actor for share;
  if not found or not v_profile.is_active or not (v_profile.role = any(p_roles)) then
    raise exception 'Your account does not have permission for this action.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = v_actor and email_confirmed_at is not null) then
    raise exception 'Verify your email before accessing SupplyHub.' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
