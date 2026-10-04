-- Public student submissions remain pending until active staff confirm issuance.
begin;

create table public.student_stock_out_logs (
  id uuid primary key,
  student_name text not null check (length(btrim(student_name)) between 2 and 160),
  receipt_date date not null check (receipt_date between date '0001-01-01' and date '9999-12-31'),
  receipt_number text not null check (length(btrim(receipt_number)) between 1 and 160),
  item_id uuid not null references public.items(id) on delete restrict,
  item_name text not null,
  item_code text not null,
  unit text not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'pending' check (status in ('pending', 'issued', 'rejected')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles(id) on delete restrict,
  processed_by_name text,
  processing_note text not null default '' check (length(processing_note) <= 500),
  transaction_id uuid unique references public.transactions(id) on delete restrict,
  check ((status = 'pending' and processed_by is null and processed_at is null and transaction_id is null)
    or (status = 'issued' and processed_by is not null and processed_at is not null and transaction_id is not null)
    or (status = 'rejected' and processed_by is not null and processed_at is not null and transaction_id is null))
);
create index student_stock_out_logs_created_idx on public.student_stock_out_logs(created_at desc, id desc);
create index student_stock_out_logs_status_idx on public.student_stock_out_logs(status, created_at desc);
alter table public.student_stock_out_logs enable row level security;
revoke all on public.student_stock_out_logs from public, anon, authenticated, service_role;
grant select on public.student_stock_out_logs to authenticated, service_role;
create policy student_stock_out_logs_staff_read on public.student_stock_out_logs for select to authenticated
  using ((select public.active_role()) in ('staff', 'admin', 'super_admin'));

-- Short-lived counters store only a keyed hash, never the student's IP address.
create table public.student_form_rate_limits (
  rate_key text primary key,
  window_start timestamptz not null,
  submissions integer not null
);
alter table public.student_form_rate_limits enable row level security;
revoke all on public.student_form_rate_limits from public, anon, authenticated, service_role;

create function public.submit_student_stock_out(
  p_id uuid, p_student_name text, p_receipt_date date, p_receipt_number text,
  p_item_id uuid, p_quantity integer, p_rate_key text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items%rowtype;
  v_existing public.student_stock_out_logs%rowtype;
  v_count integer;
begin
  if p_id is null or p_student_name is null or length(btrim(p_student_name)) not between 2 and 160
    or p_student_name ~ E'[\r\n]' or p_receipt_number is null or length(btrim(p_receipt_number)) not between 1 and 160
    or p_receipt_number ~ E'[\r\n]' or p_receipt_date is null
    or p_receipt_date not between date '0001-01-01' and date '9999-12-31'
    or p_item_id is null or p_quantity is null or p_quantity < 1
    or p_rate_key is null or p_rate_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Enter a name, valid date, receipt number, item, and positive whole quantity.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 1));
  select * into v_existing from public.student_stock_out_logs where id = p_id;
  if found then
    if v_existing.student_name <> btrim(p_student_name) or v_existing.receipt_date <> p_receipt_date
      or v_existing.receipt_number <> btrim(p_receipt_number) or v_existing.item_id <> p_item_id or v_existing.quantity <> p_quantity then
      raise exception 'This submission was already recorded with different details. Start a new form.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  select * into v_item from public.items where id = p_item_id for share;
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
  insert into public.student_stock_out_logs(id, student_name, receipt_date, receipt_number, item_id, item_name, item_code, unit, quantity)
    values (p_id, btrim(p_student_name), p_receipt_date, btrim(p_receipt_number), v_item.id, v_item.name, v_item.sku, v_item.unit, p_quantity);
  return p_id;
end;
$$;
revoke execute on function public.submit_student_stock_out(uuid, text, date, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.submit_student_stock_out(uuid, text, date, text, uuid, integer, text) to service_role;

create function public.process_student_stock_out(p_id uuid, p_decision text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_log public.student_stock_out_logs%rowtype;
  v_transaction uuid;
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  if p_decision is null or p_decision not in ('issued', 'rejected') or length(coalesce(p_note, '')) > 500
    or (p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) < 3) then
    raise exception 'Choose a decision and include a reason when rejecting a submission.' using errcode = '22023';
  end if;
  select * into v_log from public.student_stock_out_logs where id = p_id for update;
  if not found then raise exception 'Student submission not found.' using errcode = 'P0002'; end if;
  if v_log.status = p_decision then return v_log.transaction_id; end if;
  if v_log.status <> 'pending' then raise exception 'This submission has already been processed.' using errcode = '22023'; end if;
  if p_decision = 'issued' then
    v_transaction := public.stock_movement(v_log.item_id, 'stock_out', v_log.quantity,
      'Student: ' || v_log.student_name || E'\nReceipt number: ' || v_log.receipt_number || E'\nDate: ' || v_log.receipt_date::text
        || E'\nStaff note: ' || btrim(coalesce(p_note, '')),
      'STUDENT-' || v_log.id::text, v_log.id);
  end if;
  select left(coalesce(nullif(btrim(full_name), ''), nullif(email, ''), 'Staff account'), 160)
    into v_actor_name from public.profiles where id = v_actor;
  update public.student_stock_out_logs set status = p_decision, processed_at = now(), processed_by = v_actor,
    processed_by_name = v_actor_name, processing_note = btrim(coalesce(p_note, '')), transaction_id = v_transaction where id = p_id;
  return v_transaction;
end;
$$;
revoke execute on function public.process_student_stock_out(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.process_student_stock_out(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
