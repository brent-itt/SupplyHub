-- Capture the school staff requestor and request date, plus the selected supply
-- details at submission time. The authenticated recorder remains requester_id.
begin;

alter table public.requisitions
  add column requester_name text,
  add column request_date date,
  add column item_name text,
  add column item_code text;

update public.requisitions r set
  requester_name = case when length(btrim(p.full_name)) >= 2 then btrim(p.full_name)
    when length(btrim(p.email)) >= 2 then left(btrim(p.email), 160) else 'School staff' end,
  request_date = (r.created_at at time zone 'Asia/Manila')::date,
  item_name = i.name,
  item_code = i.sku
from public.profiles p, public.items i
where p.id = r.requester_id and i.id = r.item_id;

alter table public.requisitions
  alter column requester_name set not null,
  alter column request_date set not null,
  alter column item_name set not null,
  alter column item_code set not null,
  add constraint requisitions_requester_name_check check (length(btrim(requester_name)) between 2 and 160),
  add constraint requisitions_request_date_check check (request_date between date '0001-01-01' and date '9999-12-31'),
  add constraint requisitions_item_name_check check (length(item_name) between 1 and 160),
  add constraint requisitions_item_code_check check (length(item_code) between 1 and 80);

-- Remove the old endpoint so all new requests require the revised fields.
drop function public.create_requisition(uuid, integer, text);

create function public.create_requisition(
  p_item_id uuid, p_quantity integer, p_purpose text,
  p_requester_name text, p_request_date date
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_item public.items%rowtype;
  v_id uuid;
begin
  v_actor := public.require_role(array['staff']);
  if p_quantity is null or p_quantity <= 0
     or p_purpose is null or length(btrim(p_purpose)) not between 3 and 2000
     or p_requester_name is null or length(btrim(p_requester_name)) not between 2 and 160
     or p_request_date is null or p_request_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception 'Enter the school staff requestor name, date, positive quantity, and purpose.' using errcode = '22023';
  end if;
  select * into v_item from public.items where id = p_item_id for share;
  if not found or v_item.is_archived then raise exception 'Supply is unavailable.' using errcode = '22023'; end if;
  -- Item name/code are always read from inventory, never accepted from a form.
  insert into public.requisitions(item_id, requester_id, quantity, purpose, requester_name, request_date, item_name, item_code)
    values (v_item.id, v_actor, p_quantity, btrim(p_purpose), btrim(p_requester_name), p_request_date, v_item.name, v_item.sku)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_requisition(uuid, integer, text, text, date) from public, anon, authenticated;
grant execute on function public.create_requisition(uuid, integer, text, text, date) to authenticated;

commit;
