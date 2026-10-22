begin;

-- Server-side student forms and staff analytics also need table privileges:
-- BYPASSRLS does not grant SELECT, and new projects no longer grant it by default.
grant select on public.items, public.transactions to service_role;

commit;
