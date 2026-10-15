-- Partial student collections and FIFO reservations for unfilled requests.
begin;

alter table public.student_stock_out_logs
  add column student_email text check (student_email is null or
    (length(student_email) <= 254 and student_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  add column fulfilled_quantity integer not null default 0,
  add column vip_queued_at timestamptz;

update public.student_stock_out_logs set fulfilled_quantity = quantity where status = 'issued';
alter table public.student_stock_out_logs drop constraint student_stock_out_logs_check;
alter table public.student_stock_out_logs add constraint student_stock_out_progress_check check (
  fulfilled_quantity between 0 and quantity and
  ((status = 'pending' and fulfilled_quantity < quantity and
    ((fulfilled_quantity = 0 and transaction_id is null and processed_by is null and processed_at is null)
      or (fulfilled_quantity > 0 and transaction_id is not null and processed_by is not null and processed_at is not null)))
   or (status = 'issued' and fulfilled_quantity = quantity and transaction_id is not null and processed_by is not null and processed_at is not null)
   or (status = 'rejected' and fulfilled_quantity < quantity and processed_by is not null and processed_at is not null
     and ((fulfilled_quantity = 0 and transaction_id is null) or (fulfilled_quantity > 0 and transaction_id is not null))))
);
create index student_vip_pending_idx on public.student_stock_out_logs(item_id, created_at, id)
  where status = 'pending' and vip_queued_at is not null;

create table public.student_stock_out_issues (
  idempotency_key uuid primary key,
  log_id uuid not null references public.student_stock_out_logs(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  scanned_barcode text not null,
  note text not null,
  created_at timestamptz not null default now()
);
create index student_stock_out_issues_log_idx on public.student_stock_out_issues(log_id);
alter table public.student_stock_out_issues enable row level security;
revoke all on public.student_stock_out_issues from public, anon, authenticated, service_role;
grant select on public.student_stock_out_issues to authenticated;
create policy student_stock_out_issues_read on public.student_stock_out_issues for select to authenticated
  using ((select public.active_role()) in ('staff', 'admin', 'super_admin'));
insert into public.student_stock_out_issues(idempotency_key, log_id, quantity, transaction_id, scanned_barcode, note, created_at)
  select id, id, quantity, transaction_id, coalesce(scanned_barcode, upper(item_code)), processing_note, processed_at
  from public.student_stock_out_logs where status = 'issued';

-- Private calculation: ordinary issuance reserves all VIP balances; a VIP
-- student can collect only stock left after earlier VIP students of that item.
create function public.student_reserved_quantity(p_item_id uuid, p_log_id uuid default null)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(q.quantity - q.fulfilled_quantity), 0)
  from public.student_stock_out_logs q
  where q.item_id = p_item_id and q.status = 'pending' and q.vip_queued_at is not null
    and (p_log_id is null or q.id <> p_log_id)
    and (not exists (select 1 from public.student_stock_out_logs s where s.id = p_log_id and s.item_id = p_item_id and s.vip_queued_at is not null)
      or (q.created_at, q.id) < (select s.created_at, s.id from public.student_stock_out_logs s where s.id = p_log_id));
$$;
revoke all on function public.student_reserved_quantity(uuid, uuid) from public, anon, authenticated, service_role;

create function public.student_stock_availability(p_student_log_id uuid default null)
returns table(item_id uuid, available_quantity integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role(array['staff', 'admin', 'super_admin']);
  return query select i.id, greatest(0, i.quantity::bigint - public.student_reserved_quantity(i.id, p_student_log_id))::integer
    from public.items i where not i.is_archived;
end;
$$;
revoke all on function public.student_stock_availability(uuid) from public, anon, authenticated, service_role;
grant execute on function public.student_stock_availability(uuid) to authenticated;

-- Keep waiting submissions queued when inventory falls after their submission.
-- Every write locks the item before student logs, including partial checkout.
create function public.queue_student_shortages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.student_stock_out_logs s set vip_queued_at = clock_timestamp()
    where s.item_id = new.id and s.status = 'pending' and s.vip_queued_at is null
      and s.quantity - s.fulfilled_quantity > greatest(0, new.quantity::bigint - public.student_reserved_quantity(new.id));
  return new;
end;
$$;
revoke all on function public.queue_student_shortages() from public, anon, authenticated, service_role;
create trigger student_shortages after update of quantity on public.items
  for each row when (new.quantity < old.quantity) execute function public.queue_student_shortages();

update public.student_stock_out_logs s set vip_queued_at = s.created_at
  from public.items i where s.item_id = i.id and s.status = 'pending' and s.quantity > i.quantity;

drop function public.submit_student_stock_out(uuid, text, date, text, uuid, integer, text);
create function public.submit_student_stock_out(
  p_id uuid, p_student_name text, p_receipt_date date, p_receipt_number text,
  p_item_id uuid, p_quantity integer, p_rate_key text, p_student_email text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items%rowtype;
  v_existing public.student_stock_out_logs%rowtype;
  v_count integer;
  v_email text := lower(btrim(p_student_email));
begin
  if p_id is null or p_student_name is null or length(btrim(p_student_name)) not between 2 and 160
    or p_student_name ~ E'[\r\n]' or p_receipt_number is null or length(btrim(p_receipt_number)) not between 1 and 160
    or p_receipt_number ~ E'[\r\n]' or p_receipt_date is null
    or p_receipt_date not between date '0001-01-01' and date '9999-12-31'
    or p_item_id is null or p_quantity is null or p_quantity < 1
    or p_rate_key is null or p_rate_key !~ '^[a-f0-9]{64}$'
    or v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a name, valid email, date, receipt number, item, and positive whole quantity.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 1));
  select * into v_existing from public.student_stock_out_logs where id = p_id;
  if found then
    if v_existing.student_name <> btrim(p_student_name) or v_existing.receipt_date <> p_receipt_date
      or v_existing.receipt_number <> btrim(p_receipt_number) or v_existing.item_id <> p_item_id or v_existing.quantity <> p_quantity
      or v_existing.student_email is distinct from v_email then
      raise exception 'This submission was already recorded with different details. Start a new form.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.is_archived then
    raise exception 'This item is no longer available. Choose another item.' using errcode = '22023';
  end if;
  delete from public.student_form_rate_limits where window_start < now() - interval '1 day';
  insert into public.student_form_rate_limits as limits(rate_key, window_start, submissions)
    values (p_rate_key, now(), 1)
    on conflict (rate_key) do update set
      submissions = case when limits.window_start < now() - interval '5 minutes' then 1 else limits.submissions + 1 end,
      window_start = case when limits.window_start < now() - interval '5 minutes' then now() else limits.window_start end
    returning submissions into v_count;
  if v_count > 60 then
    raise exception 'Too many submissions. Please wait five minutes or ask the Supplies Office for help.' using errcode = 'P0001';
  end if;
  insert into public.student_stock_out_logs(id, student_name, student_email, receipt_date, receipt_number, item_id, item_name, item_code, unit, quantity, vip_queued_at)
    values (p_id, btrim(p_student_name), v_email, p_receipt_date, btrim(p_receipt_number), v_item.id, v_item.name, v_item.sku, v_item.unit, p_quantity,
      case when p_quantity > greatest(0, v_item.quantity::bigint - public.student_reserved_quantity(v_item.id)) then clock_timestamp() end);
  return p_id;
end;
$$;
revoke all on function public.submit_student_stock_out(uuid, text, date, text, uuid, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_student_stock_out(uuid, text, date, text, uuid, integer, text, text) to service_role;

drop function public.process_student_stock_out(uuid, text, text, text);
create function public.process_student_stock_out(
  p_id uuid, p_decision text, p_note text, p_scanned_barcode text default null,
  p_quantity integer default null, p_idempotency_key uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_log public.student_stock_out_logs%rowtype;
  v_item public.items%rowtype;
  v_issue public.student_stock_out_issues%rowtype;
  v_barcode text := upper(btrim(coalesce(p_scanned_barcode, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_key uuid := coalesce(p_idempotency_key, p_id);
  v_quantity integer;
  v_transaction uuid;
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  if p_decision is null or p_decision not in ('issued', 'rejected') or length(v_note) > 500
    or (p_decision = 'rejected' and length(v_note) < 3) then
    raise exception 'Choose a decision and include a reason when rejecting a submission.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  select * into v_log from public.student_stock_out_logs where id = p_id;
  if not found then raise exception 'Student submission not found.' using errcode = 'P0002'; end if;
  select * into v_item from public.items where id = v_log.item_id for update;
  select * into v_log from public.student_stock_out_logs where id = p_id for update;
  if p_decision = 'issued' then
    if v_barcode !~ '^[A-Z0-9._-]{1,80}$' then
      raise exception 'Scan the requested item barcode before completing stock out.' using errcode = '22023';
    end if;
    select * into v_issue from public.student_stock_out_issues where idempotency_key = v_key;
    if found then
      if v_issue.log_id <> p_id or v_issue.quantity <> coalesce(p_quantity, v_log.quantity)
        or v_issue.scanned_barcode <> v_barcode or v_issue.note <> v_note then
        raise exception 'This checkout key was already used with different details or barcode.' using errcode = '22023';
      end if;
      return v_issue.transaction_id;
    end if;
  elsif v_log.status = 'rejected' then
    return v_log.transaction_id;
  end if;
  if v_log.status <> 'pending' then raise exception 'This submission has already been processed.' using errcode = '22023'; end if;
  select left(coalesce(nullif(btrim(full_name), ''), nullif(email, ''), 'Staff account'), 160)
    into v_actor_name from public.profiles where id = v_actor;
  if p_decision = 'rejected' then
    update public.student_stock_out_logs set status = 'rejected', processed_at = now(), processed_by = v_actor,
      processed_by_name = v_actor_name, processing_note = v_note where id = p_id;
    return v_log.transaction_id;
  end if;
  if v_item.is_archived then raise exception 'Restore this supply before recording stock.' using errcode = '22023'; end if;
  if v_barcode <> upper(v_item.sku) then
    raise exception 'Wrong barcode. Scan the item requested in this student submission.' using errcode = '22023';
  end if;
  v_quantity := coalesce(p_quantity, v_log.quantity - v_log.fulfilled_quantity);
  if v_quantity < 1 or v_quantity > v_log.quantity - v_log.fulfilled_quantity then
    raise exception 'Issue a positive quantity no greater than the student remaining balance.' using errcode = '22023';
  end if;
  if v_quantity > v_item.quantity then raise exception 'Insufficient stock. Refresh to issue the available quantity.' using errcode = '22023'; end if;
  if v_quantity > greatest(0, v_item.quantity::bigint - public.student_reserved_quantity(v_item.id, v_log.id)) then
    raise exception 'Earlier VIP students have priority for this stock. Refresh and serve the queue in order.' using errcode = '22023';
  end if;
  insert into public.transactions(item_id, actor_id, kind, quantity_delta, balance_after, note, reference, idempotency_key)
    values (v_item.id, v_actor, 'stock_out', -v_quantity, v_item.quantity - v_quantity,
      'Student: ' || v_log.student_name || E'\nReceipt number: ' || v_log.receipt_number || E'\nDate: ' || v_log.receipt_date::text
        || E'\nBarcode: ' || v_barcode || E'\nStaff note: ' || v_note,
      'STUDENT-' || v_log.id::text, v_key) returning id into v_transaction;
  insert into public.student_stock_out_issues(idempotency_key, log_id, quantity, transaction_id, scanned_barcode, note)
    values (v_key, v_log.id, v_quantity, v_transaction, v_barcode, v_note);
  update public.student_stock_out_logs set fulfilled_quantity = fulfilled_quantity + v_quantity,
    status = case when fulfilled_quantity + v_quantity = quantity then 'issued' else 'pending' end,
    vip_queued_at = case when fulfilled_quantity + v_quantity < quantity then coalesce(vip_queued_at, clock_timestamp()) else vip_queued_at end,
    processed_at = now(), processed_by = v_actor, processed_by_name = v_actor_name,
    processing_note = v_note, transaction_id = v_transaction, scanned_barcode = v_barcode where id = p_id;
  update public.items set quantity = quantity - v_quantity, updated_at = now() where id = v_item.id;
  return v_transaction;
end;
$$;
revoke all on function public.process_student_stock_out(uuid, text, text, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.process_student_stock_out(uuid, text, text, text, integer, uuid) to authenticated;

-- The window is evaluated before UI search/pagination, preserving per-item FIFO.
create view public.student_vip_queue with (security_invoker = true) as
  select s.*, i.quantity as stock_quantity, i.is_archived,
    (s.quantity - s.fulfilled_quantity) as remaining_quantity,
    row_number() over (partition by s.item_id order by s.created_at, s.id) as item_position,
    least(s.quantity - s.fulfilled_quantity, greatest(0, case when i.is_archived then 0 else i.quantity end -
      coalesce(sum(s.quantity - s.fulfilled_quantity) over (partition by s.item_id order by s.created_at, s.id rows between unbounded preceding and 1 preceding), 0)))::integer as available_quantity
  from public.student_stock_out_logs s join public.items i on i.id = s.item_id
  where s.status = 'pending' and s.vip_queued_at is not null;
revoke all on public.student_vip_queue from public, anon, authenticated, service_role;
grant select on public.student_vip_queue to authenticated;

-- Stock movement and requisition priority checks follow below.

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
  v_actor := public.require_role(case when p_kind = 'stock_out'
    then array['staff', 'admin', 'super_admin']
    else array['admin', 'super_admin'] end);
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
  if p_kind = 'stock_out' and p_quantity > greatest(0, v_item.quantity::bigint - public.student_reserved_quantity(p_item_id)) then
    raise exception 'Insufficient unreserved stock. VIP students have priority; serve their pending collections first.' using errcode = '22023';
  end if;
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


create or replace function public.review_requisition(p_request_id uuid, p_decision text, p_note text, p_expected_version integer)
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
    if v_request.quantity > greatest(0, v_item.quantity::bigint - public.student_reserved_quantity(v_item.id)) then
      raise exception 'VIP students have priority for this stock. Serve their pending collections first.' using errcode = '22023';
    end if;
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


notify pgrst, 'reload schema';
commit;
