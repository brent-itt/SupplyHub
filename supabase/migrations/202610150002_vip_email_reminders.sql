-- Server-only email preparation and delivery receipts. No inventory mutations.
begin;

create table public.student_vip_reminders (
  id uuid primary key,
  log_id uuid not null references public.student_stock_out_logs(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  recipient text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  provider_id text,
  check ((accepted_at is null and provider_id is null) or (accepted_at is not null and provider_id is not null))
);
create index student_vip_reminders_log_idx on public.student_vip_reminders(log_id, created_at desc);
alter table public.student_vip_reminders enable row level security;
revoke all on public.student_vip_reminders from public, anon, authenticated, service_role;
grant select on public.student_vip_reminders to authenticated;
create policy student_vip_reminders_admin_read on public.student_vip_reminders for select to authenticated
  using ((select public.active_role()) in ('admin', 'super_admin'));

create function public.prepare_student_vip_reminder(p_id uuid, p_log_id uuid, p_actor_id uuid, p_email text, p_payload jsonb)
returns public.student_vip_reminders language plpgsql security definer set search_path = '' as $$
declare
  v_log public.student_stock_out_logs%rowtype;
  v_reminder public.student_vip_reminders%rowtype;
  v_email text := lower(btrim(p_email));
begin
  perform 1 from public.profiles where id = p_actor_id and is_active and role in ('admin', 'super_admin') for share;
  if not found then raise exception 'Only active administrators can send reminders.' using errcode = '42501'; end if;
  if p_id is null or p_log_id is null or v_email is null or length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload->'to' is distinct from jsonb_build_array(v_email)
    or coalesce(length(p_payload->>'text'), 0) = 0 or coalesce(length(p_payload->>'from'), 0) = 0
    or coalesce(length(p_payload->>'subject'), 0) = 0 then
    raise exception 'A valid student email and reminder are required.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 2));
  select * into v_log from public.student_stock_out_logs where id = p_log_id for update;
  if not found then raise exception 'Student submission not found.' using errcode = 'P0002'; end if;
  select * into v_reminder from public.student_vip_reminders where id = p_id;
  if found then
    if v_reminder.log_id <> p_log_id or v_reminder.recipient <> v_email then
      raise exception 'This reminder belongs to a different request or email.' using errcode = '22023';
    end if;
    if v_reminder.accepted_at is not null then return v_reminder; end if;
  end if;
  if v_log.status <> 'pending' or v_log.vip_queued_at is null then
    raise exception 'This student is no longer waiting in VIP Queue. Refresh the page.' using errcode = '22023';
  end if;
  if v_log.student_email is not null and lower(v_log.student_email) <> v_email then
    raise exception 'The student email has changed. Refresh before sending.' using errcode = '22023';
  end if;
  -- Resume an uncertain send across refreshes instead of generating a new email.
  select * into v_reminder from public.student_vip_reminders
    where log_id = p_log_id and (accepted_at is null or accepted_at > now() - interval '5 minutes')
    order by created_at desc limit 1;
  if found then
    if v_reminder.accepted_at is null and v_reminder.created_at < now() - interval '23 hours' then
      raise exception 'An earlier reminder is unconfirmed. Check its delivery in Resend before sending another.' using errcode = '22023';
    end if;
    return v_reminder;
  end if;
  -- Older student forms did not collect email. Save the admin-supplied contact.
  if v_log.student_email is null then
    update public.student_stock_out_logs set student_email = v_email where id = p_log_id;
  end if;
  insert into public.student_vip_reminders(id, log_id, actor_id, recipient, payload)
    values (p_id, p_log_id, p_actor_id, v_email, p_payload) returning * into v_reminder;
  return v_reminder;
end;
$$;
revoke all on function public.prepare_student_vip_reminder(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.prepare_student_vip_reminder(uuid, uuid, uuid, text, jsonb) to service_role;

create function public.complete_student_vip_reminder(p_id uuid, p_provider_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_provider_id is null or length(btrim(p_provider_id)) not between 1 and 200 then
    raise exception 'A provider email ID is required.' using errcode = '22023';
  end if;
  update public.student_vip_reminders set accepted_at = now(), provider_id = p_provider_id
    where id = p_id and accepted_at is null;
  if not found and not exists (select 1 from public.student_vip_reminders where id = p_id and provider_id = p_provider_id) then
    raise exception 'Reminder not found or already recorded differently.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.complete_student_vip_reminder(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.complete_student_vip_reminder(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
