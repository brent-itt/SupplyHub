-- Separate the public display limit from the actual inventory balance.
begin;

alter table public.items add column if not exists public_quantity integer;
-- Preserve the existing display on upgrade, without resetting later choices.
update public.items set public_quantity = quantity where public_quantity is null;
alter table public.items alter column public_quantity set default 0;
alter table public.items alter column public_quantity set not null;
alter table public.items drop constraint if exists items_public_quantity_check;
alter table public.items add constraint items_public_quantity_check check (public_quantity >= 0);

drop function if exists public.set_item_public_visibility(uuid, boolean);
create or replace function public.set_item_public_visibility(
  p_item_id uuid, p_show_on_landing boolean, p_public_quantity integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role(array['admin', 'super_admin']);
  if p_show_on_landing is null or p_public_quantity is null or p_public_quantity < 0 then
    raise exception 'Choose visibility and a nonnegative whole displayed quantity.' using errcode = '22023';
  end if;
  update public.items
    set show_on_landing = p_show_on_landing, public_quantity = p_public_quantity, updated_at = now()
    where id = p_item_id;
  if not found then raise exception 'Supply not found.' using errcode = 'P0002'; end if;
end;
$$;

-- Only the capped quantity crosses the public API boundary. Never return the
-- actual stock count to the landing-page client or anonymous API callers.
create or replace function public.get_public_stock()
returns table (id uuid, name text, category text, unit text, quantity integer)
language sql stable security definer set search_path = '' as $$
  select i.id, i.name, i.category, i.unit, least(i.quantity, i.public_quantity)
  from public.items i
  where i.show_on_landing and not i.is_archived
  order by i.name, i.id;
$$;

revoke select on public.items from anon;
revoke select (quantity) on public.items from anon;
revoke execute on function public.set_item_public_visibility(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.set_item_public_visibility(uuid, boolean, integer) to authenticated;
revoke execute on function public.get_public_stock() from public, anon, authenticated;
grant execute on function public.get_public_stock() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
