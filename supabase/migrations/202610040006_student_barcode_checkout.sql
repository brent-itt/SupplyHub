-- Student logs are issued only through a matching barcode checkout.
begin;
alter table public.student_stock_out_logs add column scanned_barcode text;

drop function public.process_student_stock_out(uuid, text, text);
create function public.process_student_stock_out(p_id uuid, p_decision text, p_note text, p_scanned_barcode text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_log public.student_stock_out_logs%rowtype;
  v_item public.items%rowtype;
  v_barcode text := upper(btrim(coalesce(p_scanned_barcode, '')));
  v_transaction uuid;
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  if p_decision is null or p_decision not in ('issued', 'rejected') or length(coalesce(p_note, '')) > 500
    or (p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) < 3) then
    raise exception 'Choose a decision and include a reason when rejecting a submission.' using errcode = '22023';
  end if;
  select * into v_log from public.student_stock_out_logs where id = p_id for update;
  if not found then raise exception 'Student submission not found.' using errcode = 'P0002'; end if;
  if p_decision = 'issued' and v_barcode !~ '^[A-Z0-9._-]{1,80}$' then
    raise exception 'Scan the requested item barcode before completing stock out.' using errcode = '22023';
  end if;
  if v_log.status = p_decision then
    if p_decision = 'issued' and v_barcode <> upper(coalesce(v_log.scanned_barcode, v_log.item_code)) then
      raise exception 'The barcode does not match this student stock out.' using errcode = '22023';
    end if;
    return v_log.transaction_id;
  end if;
  if v_log.status <> 'pending' then raise exception 'This submission has already been processed.' using errcode = '22023'; end if;
  if p_decision = 'issued' then
    select * into v_item from public.items where id = v_log.item_id for update;
    if v_barcode <> upper(v_item.sku) then
      raise exception 'Wrong barcode. Scan the item requested in this student submission.' using errcode = '22023';
    end if;
    v_transaction := public.stock_movement(v_log.item_id, 'stock_out', v_log.quantity,
      'Student: ' || v_log.student_name || E'\nReceipt number: ' || v_log.receipt_number || E'\nDate: ' || v_log.receipt_date::text
        || E'\nBarcode: ' || v_barcode || E'\nStaff note: ' || btrim(coalesce(p_note, '')),
      'STUDENT-' || v_log.id::text, v_log.id);
  end if;
  select left(coalesce(nullif(btrim(full_name), ''), nullif(email, ''), 'Staff account'), 160)
    into v_actor_name from public.profiles where id = v_actor;
  update public.student_stock_out_logs set status = p_decision, processed_at = now(), processed_by = v_actor,
    processed_by_name = v_actor_name, processing_note = btrim(coalesce(p_note, '')), transaction_id = v_transaction,
    scanned_barcode = case when p_decision = 'issued' then v_barcode else null end where id = p_id;
  return v_transaction;
end;
$$;
revoke execute on function public.process_student_stock_out(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.process_student_stock_out(uuid, text, text, text) to authenticated;
notify pgrst, 'reload schema';
commit;
