-- Gmail SMTP has no idempotency API: claim each attempt before sending.
begin;
alter table public.student_vip_reminders
  add column provider text not null default 'resend' check (provider in ('resend', 'gmail')),
  add column smtp_claim uuid;
drop function public.prepare_student_vip_reminder(uuid, uuid, uuid, text, jsonb);
create function public.prepare_student_vip_reminder(p_id uuid, p_log_id uuid, p_actor_id uuid, p_email text, p_payload jsonb, p_provider text default 'resend')
returns public.student_vip_reminders language plpgsql security definer set search_path = '' as $$
declare
  v_log public.student_stock_out_logs%rowtype;
  v_reminder public.student_vip_reminders%rowtype;
  v_email text := lower(btrim(p_email));
begin
  perform 1 from public.profiles where id = p_actor_id and is_active and role in ('admin', 'super_admin') for share;
  if not found then raise exception 'Only active administrators can send reminders.' using errcode = '42501'; end if;
  if p_provider is null or p_provider not in ('resend', 'gmail') or p_id is null or p_log_id is null or v_email is null or length(v_email) > 254
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
    if v_reminder.provider <> p_provider then
      raise exception 'Email provider changed. Refresh the page before sending.' using errcode = '22023';
    end if;
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
    where log_id = p_log_id and ((accepted_at is null and provider = p_provider) or accepted_at > now() - interval '5 minutes')
    order by created_at desc limit 1;
  if found then
    if v_reminder.provider = 'resend' and v_reminder.accepted_at is null and v_reminder.created_at < now() - interval '23 hours' then
      raise exception 'An earlier reminder is unconfirmed. Check its delivery in Resend before sending another.' using errcode = '22023';
    end if;
    return v_reminder;
  end if;
  -- Older student forms did not collect email. Save the admin-supplied contact.
  if v_log.student_email is null then
    update public.student_stock_out_logs set student_email = v_email where id = p_log_id;
  end if;
  insert into public.student_vip_reminders(id, log_id, actor_id, recipient, payload, provider)
    values (p_id, p_log_id, p_actor_id, v_email, p_payload, p_provider) returning * into v_reminder;
  return v_reminder;
end;
$$;
revoke all on function public.prepare_student_vip_reminder(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_student_vip_reminder(uuid, uuid, uuid, text, jsonb, text) to service_role;


create function public.claim_student_gmail_reminder(p_id uuid, p_claim uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_claim is null then raise exception 'A delivery claim is required.' using errcode = '22023'; end if;
  update public.student_vip_reminders set smtp_claim = p_claim
    where id = p_id and provider = 'gmail' and accepted_at is null and smtp_claim is null;
  return found;
end;
$$;
revoke all on function public.claim_student_gmail_reminder(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_student_gmail_reminder(uuid, uuid) to service_role;

-- Release only after a definite SMTP rejection; uncertain delivery stays claimed.
create function public.release_student_gmail_reminder(p_id uuid, p_claim uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.student_vip_reminders set smtp_claim = null
    where id = p_id and provider = 'gmail' and accepted_at is null and smtp_claim = p_claim;
end;
$$;
revoke all on function public.release_student_gmail_reminder(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_student_gmail_reminder(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
