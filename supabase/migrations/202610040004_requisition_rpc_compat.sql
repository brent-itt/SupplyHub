-- Repair projects where the requisition RPCs were installed without migration 002.
-- Safe to rerun, and safe after the complete migration sequence.
begin;

alter table public.requisitions
  add column if not exists requester_name text,
  add column if not exists request_date date,
  add column if not exists item_name text,
  add column if not exists item_code text;

update public.requisitions r set
  requester_name = coalesce(r.requester_name, case when length(btrim(p.full_name)) >= 2 then left(btrim(p.full_name), 160)
    when length(btrim(p.email)) >= 2 then left(btrim(p.email), 160) else 'School staff' end),
  request_date = coalesce(r.request_date, (r.created_at at time zone 'Asia/Manila')::date),
  item_name = coalesce(r.item_name, (select i.name from public.items i where i.id = r.item_id)),
  item_code = coalesce(r.item_code, (select i.sku from public.items i where i.id = r.item_id))
from public.profiles p
where p.id = r.requester_id
  and (r.requester_name is null or r.request_date is null or r.item_name is null or r.item_code is null);

alter table public.requisitions
  alter column requester_name set not null,
  alter column request_date set not null,
  alter column item_name set not null,
  alter column item_code set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.requisitions'::regclass and conname = 'requisitions_requester_name_check') then
    alter table public.requisitions add constraint requisitions_requester_name_check check (length(btrim(requester_name)) between 2 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.requisitions'::regclass and conname = 'requisitions_request_date_check') then
    alter table public.requisitions add constraint requisitions_request_date_check check (request_date between date '0001-01-01' and date '9999-12-31');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.requisitions'::regclass and conname = 'requisitions_item_name_check') then
    alter table public.requisitions add constraint requisitions_item_name_check check (length(item_name) between 1 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.requisitions'::regclass and conname = 'requisitions_item_code_check') then
    alter table public.requisitions add constraint requisitions_item_code_check check (length(item_code) between 1 and 80);
  end if;
end;
$$;

-- The legacy endpoint cannot supply the required metadata.
drop function if exists public.create_requisition(uuid, integer, text);

create or replace function public.create_requisition(
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
  insert into public.requisitions(item_id, requester_id, quantity, purpose, requester_name, request_date, item_name, item_code)
    values (v_item.id, v_actor, p_quantity, btrim(p_purpose), btrim(p_requester_name), p_request_date, v_item.name, v_item.sku)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_requisition(uuid, integer, text, text, date) from public, anon, authenticated;
grant execute on function public.create_requisition(uuid, integer, text, text, date) to authenticated;

notify pgrst, 'reload schema';
commit;
