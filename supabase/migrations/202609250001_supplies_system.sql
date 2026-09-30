-- Run once in the Supabase SQL editor, or apply with `supabase db push`.
-- PostgreSQL owns the stock balance and authorization rules, including when a
-- caller bypasses the website and contacts the Supabase API directly.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'staff'
    check (role in ('super_admin', 'admin', 'staff')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(sku) between 1 and 80),
  name text not null check (length(name) between 1 and 160),
  description text not null default '' check (length(description) <= 2000),
  category text not null default 'General' check (length(category) between 1 and 80),
  unit text not null default 'piece' check (length(unit) between 1 and 40),
  location text not null default '' check (length(location) <= 160),
  quantity integer not null default 0 check (quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  is_archived boolean not null default false,
  show_on_landing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  purpose text not null check (length(purpose) between 1 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_id uuid references public.profiles(id) on delete restrict,
  review_note text not null default '' check (length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status in ('approved', 'rejected') and reviewer_id is not null and reviewed_at is not null)
      or (status in ('pending', 'cancelled') and reviewer_id is null and reviewed_at is null))
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null check (kind in ('stock_in', 'stock_out', 'adjustment')),
  quantity_delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  note text not null default '' check (length(note) <= 2000),
  reference text not null default '' check (length(reference) <= 160),
  request_id uuid unique references public.requisitions(id) on delete restrict,
  idempotency_key uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check ((kind = 'stock_in' and quantity_delta > 0)
      or (kind = 'stock_out' and quantity_delta < 0)
      or (kind = 'adjustment' and length(btrim(note)) > 0))
);

create index items_category_idx on public.items(category) where not is_archived;
create index transactions_item_created_idx on public.transactions(item_id, created_at desc);
create index transactions_created_idx on public.transactions(created_at desc);
create index requisitions_requester_created_idx on public.requisitions(requester_id, created_at desc);
create index requisitions_status_idx on public.requisitions(status, created_at desc);

-- User-supplied auth metadata must never grant a role or activate an account.
create function public.handle_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email, full_name)
    values (new.id, coalesce(new.email, ''), left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 160))
    on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function public.handle_auth_user();

-- Covers users created in the dashboard before this migration was installed.
insert into public.profiles(id, email, full_name)
select id, coalesce(email, ''), left(coalesce(raw_user_meta_data ->> 'full_name', ''), 160)
from auth.users on conflict (id) do nothing;

create function public.active_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

-- The lock prevents an account being disabled/demoted partway through a write.
create function public.require_role(p_roles text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_actor for share;
  if not found or not v_profile.is_active or not (v_profile.role = any(p_roles)) then
    raise exception 'Your account does not have permission for this action.' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.transactions enable row level security;
alter table public.requisitions enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.active_role()) in ('admin', 'super_admin'));
create policy items_read on public.items for select to authenticated
  using ((select public.active_role()) is not null
    and (not is_archived or (select public.active_role()) in ('admin', 'super_admin')));
create policy public_landing_items_read on public.items for select to anon
  using (show_on_landing and not is_archived);
create policy transactions_read on public.transactions for select to authenticated
  using ((select public.active_role()) in ('admin', 'super_admin'));
create policy requisitions_read on public.requisitions for select to authenticated
  using ((select public.active_role()) is not null
    and (requester_id = (select auth.uid()) or (select public.active_role()) in ('admin', 'super_admin')));

create function public.upsert_item(
  p_id uuid, p_sku text, p_name text, p_description text, p_category text,
  p_unit text, p_location text, p_low_stock_threshold integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.require_role(array['admin', 'super_admin']);
  if p_sku is null or length(btrim(p_sku)) not between 1 and 80
     or p_name is null or length(btrim(p_name)) not between 1 and 160
     or p_category is null or length(btrim(p_category)) not between 1 and 80
     or p_unit is null or length(btrim(p_unit)) not between 1 and 40
     or p_low_stock_threshold is null or p_low_stock_threshold < 0
     or length(coalesce(p_description, '')) > 2000 or length(coalesce(p_location, '')) > 160 then
    raise exception 'Provide a valid SKU, name, category, unit, location and stock threshold.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.items(sku, name, description, category, unit, location, low_stock_threshold)
    values (upper(btrim(p_sku)), btrim(p_name), btrim(coalesce(p_description, '')), btrim(p_category),
      btrim(p_unit), btrim(coalesce(p_location, '')), p_low_stock_threshold) returning id into v_id;
  else
    update public.items set sku = upper(btrim(p_sku)), name = btrim(p_name),
      description = btrim(coalesce(p_description, '')), category = btrim(p_category), unit = btrim(p_unit),
      location = btrim(coalesce(p_location, '')), low_stock_threshold = p_low_stock_threshold, updated_at = now()
      where id = p_id returning id into v_id;
    if not found then raise exception 'Supply not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create function public.stock_movement(
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
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  if p_kind is null or p_kind not in ('stock_in', 'stock_out', 'adjustment')
     or p_quantity is null or p_idempotency_key is null
     or (p_kind = 'adjustment' and (p_quantity < 0 or v_note = ''))
     or (p_kind <> 'adjustment' and p_quantity <= 0)
     or length(v_note) > 2000 or length(v_reference) > 160 then
    raise exception 'Invalid stock movement. Adjustments require a nonnegative total and a reason.' using errcode = '22023';
  end if;
  -- Serialize identical keys before checking for a retry; a unique constraint is
  -- also retained as the final guard. A retry cannot change the original payload.
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

create function public.archive_item(p_item_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items%rowtype;
begin
  perform public.require_role(array['admin', 'super_admin']);
  if p_archived is null then raise exception 'An archive status is required.' using errcode = '22023'; end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'Supply not found.' using errcode = 'P0002'; end if;
  if p_archived and v_item.quantity <> 0 then
    raise exception 'Only supplies with zero stock can be archived.' using errcode = '22023';
  end if;
  if p_archived and exists (select 1 from public.requisitions where item_id = p_item_id and status = 'pending') then
    raise exception 'Resolve pending requisitions before archiving this supply.' using errcode = '22023';
  end if;
  update public.items set is_archived = p_archived, updated_at = now() where id = p_item_id;
end;
$$;

create function public.set_item_public_visibility(p_item_id uuid, p_show_on_landing boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_role(array['admin', 'super_admin']);
  if p_show_on_landing is null then
    raise exception 'Choose whether this supply appears on the public stock list.' using errcode = '22023';
  end if;
  update public.items set show_on_landing = p_show_on_landing, updated_at = now() where id = p_item_id;
  if not found then raise exception 'Supply not found.' using errcode = 'P0002'; end if;
end;
$$;

create function public.create_requisition(p_item_id uuid, p_quantity integer, p_purpose text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_item public.items%rowtype;
  v_id uuid;
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  if p_quantity is null or p_quantity <= 0 or p_purpose is null or length(btrim(p_purpose)) not between 1 and 2000 then
    raise exception 'Enter a positive quantity and a purpose for the requisition.' using errcode = '22023';
  end if;
  -- Share-lock with archive_item so an open request cannot appear after archive.
  select * into v_item from public.items where id = p_item_id for share;
  if not found or v_item.is_archived then raise exception 'Supply is unavailable.' using errcode = '22023'; end if;
  insert into public.requisitions(item_id, requester_id, quantity, purpose)
    values (p_item_id, v_actor, p_quantity, btrim(p_purpose)) returning id into v_id;
  return v_id;
end;
$$;

create function public.review_requisition(p_request_id uuid, p_decision text, p_note text)
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

create function public.cancel_requisition(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_request public.requisitions%rowtype;
begin
  v_actor := public.require_role(array['staff', 'admin', 'super_admin']);
  select * into v_request from public.requisitions where id = p_request_id for update;
  if not found or v_request.requester_id <> v_actor then
    raise exception 'You can only cancel your own requisitions.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then raise exception 'Only pending requisitions can be cancelled.' using errcode = '22023'; end if;
  update public.requisitions set status = 'cancelled' where id = p_request_id;
end;
$$;

create function public.set_user_access(p_user_id uuid, p_role text, p_is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
begin
  -- Serialize access changes before acquiring actor/target profile locks.
  perform pg_advisory_xact_lock(72146821493812001::bigint);
  v_actor := public.require_role(array['super_admin']);
  if p_role is null or p_role not in ('staff', 'admin', 'super_admin') or p_is_active is null then
    raise exception 'Provide a valid role and account status.' using errcode = '22023';
  end if;
  if p_user_id = v_actor and (p_role <> 'super_admin' or not p_is_active) then
    raise exception 'You cannot disable or demote your own super admin account.' using errcode = '22023';
  end if;
  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
end;
$$;

create function public.protect_transaction_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Stock history is immutable. Record an adjustment to correct a balance.' using errcode = '42501';
end;
$$;
create trigger transactions_immutable before update or delete on public.transactions
  for each row execute function public.protect_transaction_history();

-- Supabase projects may configure permissive default privileges. Explicitly
-- strip them from these tables/functions; the browser only receives SELECT.
revoke all on public.profiles, public.items, public.transactions, public.requisitions from public, anon, authenticated;
grant select on public.profiles, public.items, public.transactions, public.requisitions to authenticated;
grant select (id, name, category, unit, quantity, is_archived, show_on_landing, updated_at) on public.items to anon;
revoke execute on function public.handle_auth_user() from public, anon, authenticated;
revoke execute on function public.require_role(text[]) from public, anon, authenticated;
revoke execute on function public.active_role() from public, anon, authenticated;
revoke execute on function public.protect_transaction_history() from public, anon, authenticated;
revoke execute on function public.upsert_item(uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.stock_movement(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.archive_item(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.set_item_public_visibility(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.create_requisition(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.review_requisition(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_requisition(uuid) from public, anon, authenticated;
revoke execute on function public.set_user_access(uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.active_role() to authenticated;
grant execute on function public.upsert_item(uuid, text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.stock_movement(uuid, text, integer, text, text, uuid) to authenticated;
grant execute on function public.archive_item(uuid, boolean) to authenticated;
grant execute on function public.set_item_public_visibility(uuid, boolean) to authenticated;
grant execute on function public.create_requisition(uuid, integer, text) to authenticated;
grant execute on function public.review_requisition(uuid, text, text) to authenticated;
grant execute on function public.cancel_requisition(uuid) to authenticated;
grant execute on function public.set_user_access(uuid, text, boolean) to authenticated;

commit;
