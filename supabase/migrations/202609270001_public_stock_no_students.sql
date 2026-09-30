-- Publish only explicitly selected inventory, remove student access, and allow
-- staff to record stock movements without granting inventory administration.
begin;

-- Existing student accounts lose app access. They remain inactive and can be
-- assigned a real staff/admin role later by a Super Admin.
update public.profiles
set role = 'staff', is_active = false
where role = 'student';

alter table public.profiles alter column role set default 'staff';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'staff'));

alter table public.items add column if not exists show_on_landing boolean not null default false;

drop policy if exists public_landing_items_read on public.items;
create policy public_landing_items_read on public.items for select to anon
  using (show_on_landing and not is_archived);
revoke select on public.items from anon;
grant select (id, name, category, unit, quantity, is_archived, show_on_landing, updated_at)
  on public.items to anon;

create or replace function public.stock_movement(
  p_item_id uuid, p_kind text, p_quantity integer, p_note text, p_reference text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_item public.items%rowtype;
  v_existing public.transactions%rowtype;
  v_delta integer;
  v_balance bigint;
  v_id uuid;
  v_note text := btrim(coalesce(p_note, ''));
  v_reference text := btrim(coalesce(p_reference, ''));
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  if p_kind is null or p_kind not in ('stock_in', 'stock_out', 'adjustment')
     or p_quantity is null or p_idempotency_key is null
     or (p_kind = 'adjustment' and (p_quantity < 0 or v_note = ''))
     or (p_kind <> 'adjustment' and p_quantity <= 0)
     or length(v_note) > 2000 or length(v_reference) > 160 then
    raise exception 'Invalid stock movement. Adjustments require a nonnegative total and a reason.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.transactions where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.item_id is distinct from p_item_id or v_existing.actor_id <> v_actor
       or v_existing.kind <> p_kind or v_existing.note <> v_note
       or v_existing.reference <> v_reference or v_existing.request_id is not null
       or (p_kind = 'adjustment' and v_existing.balance_after <> p_quantity)
       or (p_kind = 'stock_in' and v_existing.quantity_delta <> p_quantity)
       or (p_kind = 'stock_out' and v_existing.quantity_delta <> -p_quantity) then
      raise exception 'This transaction key was already used for a different movement.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'Supply not found.' using errcode = 'P0002'; end if;
  if v_item.is_archived then raise exception 'Restore this supply before recording stock.' using errcode = '22023'; end if;
  v_delta := case p_kind when 'stock_in' then p_quantity when 'stock_out' then -p_quantity
    else p_quantity - v_item.quantity end;
  v_balance := v_item.quantity::bigint + v_delta;
  if v_balance < 0 then raise exception 'Insufficient stock.' using errcode = '22023'; end if;
  if v_balance > 2147483647 then raise exception 'Stock exceeds the supported quantity.' using errcode = '22023'; end if;
  update public.items set quantity = v_balance::integer, updated_at = now() where id = p_item_id;
  insert into public.transactions(item_id, actor_id, kind, quantity_delta, balance_after, note, reference, idempotency_key)
    values (p_item_id, v_actor, p_kind, v_delta, v_balance::integer, v_note, v_reference, p_idempotency_key)
    returning id into v_id;
  return v_id;
end;
$$;

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
  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.set_item_public_visibility(p_item_id uuid, p_show_on_landing boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role(array['admin', 'super_admin']);
  if p_show_on_landing is null then
    raise exception 'Choose whether this supply appears on the public stock list.' using errcode = '22023';
  end if;
  update public.items set show_on_landing = p_show_on_landing, updated_at = now() where id = p_item_id;
  if not found then raise exception 'Supply not found.' using errcode = 'P0002'; end if;
end;
$$;

revoke execute on function public.stock_movement(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.set_user_access(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.set_item_public_visibility(uuid, boolean) from public, anon, authenticated;
grant execute on function public.stock_movement(uuid, text, integer, text, text, uuid) to authenticated;
grant execute on function public.set_user_access(uuid, text, boolean) to authenticated;
grant execute on function public.set_item_public_visibility(uuid, boolean) to authenticated;

commit;
