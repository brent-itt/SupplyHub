-- Pending request edits, conflict detection, and an admin-only audit trail.
begin;

alter table public.requisitions add column version integer not null default 1 check (version > 0);

create table public.requisition_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requisitions(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  actor_name text not null,
  event text not null check (event in ('submitted', 'edited', 'approved', 'rejected', 'cancelled')),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index requisition_logs_created_idx on public.requisition_logs(created_at desc, id desc);
create index requisition_logs_request_idx on public.requisition_logs(request_id, created_at desc, id desc);
alter table public.requisition_logs enable row level security;
revoke all on public.requisition_logs from public, anon, authenticated;
grant select on public.requisition_logs to authenticated;
create policy requisition_logs_admin_read on public.requisition_logs for select to authenticated
  using ((select public.active_role()) in ('admin', 'super_admin'));

create function public.increment_requisition_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new is not distinct from old then return null; end if;
  new.version := old.version + 1;
  return new;
end;
$$;
revoke execute on function public.increment_requisition_version() from public, anon, authenticated;
create trigger requisition_version before update on public.requisitions
  for each row execute function public.increment_requisition_version();

create function public.log_requisition_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_event text;
begin
  select left(coalesce(nullif(btrim(full_name), ''), nullif(email, ''), 'Staff account'), 160)
    into v_actor_name from public.profiles where id = v_actor;
  v_event := case when tg_op = 'INSERT' then 'submitted'
    when old.status is distinct from new.status and new.status in ('approved', 'rejected', 'cancelled') then new.status
    else 'edited' end;
  insert into public.requisition_logs(request_id, actor_id, actor_name, event, before_data, after_data)
    values (new.id, v_actor, coalesce(v_actor_name, 'System'), v_event,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;
revoke execute on function public.log_requisition_activity() from public, anon, authenticated;
create trigger requisition_activity after insert or update on public.requisitions
  for each row execute function public.log_requisition_activity();

create function public.update_requisition(
  p_request_id uuid, p_item_id uuid, p_quantity integer, p_purpose text,
  p_requester_name text, p_request_date date, p_expected_version integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_request public.requisitions%rowtype;
  v_item public.items%rowtype;
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  select * into v_request from public.requisitions where id = p_request_id for update;
  if not found or (v_request.requester_id <> v_actor and public.active_role() not in ('admin', 'super_admin')) then
    raise exception 'You cannot edit this requisition.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending requisitions can be edited.' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version <> v_request.version then
    raise exception 'This requisition has changed. Reload it before editing.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0
     or p_purpose is null or length(btrim(p_purpose)) not between 3 and 2000
     or p_requester_name is null or length(btrim(p_requester_name)) not between 2 and 160
     or p_request_date is null or p_request_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception 'Enter the school staff requestor name, date, positive quantity, and purpose.' using errcode = '22023';
  end if;
  select * into v_item from public.items where id = p_item_id for share;
  if not found or v_item.is_archived then raise exception 'Supply is unavailable.' using errcode = '22023'; end if;
  update public.requisitions set item_id = v_item.id, item_name = v_item.name, item_code = v_item.sku,
    quantity = p_quantity, purpose = btrim(p_purpose), requester_name = btrim(p_requester_name), request_date = p_request_date
    where id = p_request_id;
end;
$$;
revoke execute on function public.update_requisition(uuid, uuid, integer, text, text, date, integer) from public, anon, authenticated;
grant execute on function public.update_requisition(uuid, uuid, integer, text, text, date, integer) to authenticated;

-- Reviews must act on the version the admin actually saw, not on a later edit.
drop function public.review_requisition(uuid, text, text);
create function public.review_requisition(p_request_id uuid, p_decision text, p_note text, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_request public.requisitions%rowtype;
  v_item public.items%rowtype;
begin
  v_actor := public.require_role(array['admin', 'super_admin']);
  if p_decision is null or p_decision not in ('approved', 'rejected') or length(coalesce(p_note, '')) > 2000 then
    raise exception 'Choose approved or rejected and provide a valid review note.' using errcode = '22023';
  end if;
  select * into v_request from public.requisitions where id = p_request_id for update;
  if not found then raise exception 'Requisition not found.' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then
    raise exception 'This requisition has already been processed.' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version <> v_request.version then
    raise exception 'This requisition has changed. Reload and review the latest details.' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    select * into v_item from public.items where id = v_request.item_id for update;
    if v_item.is_archived then raise exception 'This supply is archived.' using errcode = '22023'; end if;
    if v_item.quantity < v_request.quantity then raise exception 'Insufficient stock.' using errcode = '22023'; end if;
    update public.items set quantity = quantity - v_request.quantity, updated_at = now() where id = v_item.id;
    insert into public.transactions(item_id, actor_id, kind, quantity_delta, balance_after, note, reference, request_id)
      values (v_item.id, v_actor, 'stock_out', -v_request.quantity, v_item.quantity - v_request.quantity,
        btrim(coalesce(p_note, '')), 'Requisition ' || v_request.id::text, v_request.id);
  end if;
  update public.requisitions set status = p_decision, reviewer_id = v_actor,
    review_note = btrim(coalesce(p_note, '')), reviewed_at = now() where id = p_request_id;
end;
$$;
revoke execute on function public.review_requisition(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.review_requisition(uuid, text, text, integer) to authenticated;

commit;
