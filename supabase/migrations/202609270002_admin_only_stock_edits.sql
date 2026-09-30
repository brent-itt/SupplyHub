-- Run after the public-stock migration. Staff retain viewing, QR scanning,
-- and requisitions; only Admin and Super Admin may change stock quantities.
begin;

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
  v_actor := public.require_role(array['admin', 'super_admin']);
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

revoke execute on function public.stock_movement(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.stock_movement(uuid, text, integer, text, text, uuid) to authenticated;

commit;
