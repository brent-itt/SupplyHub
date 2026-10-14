-- One-time reset requested by the administrator. Run in the Supabase SQL Editor.
-- Clears all student submissions and their collection/reminder links.
-- Inventory balances and the stock transaction ledger are preserved.
begin;

-- Match the collection workflow's lock order and prevent concurrent changes.
lock table public.items, public.student_stock_out_logs,
  public.student_stock_out_issues, public.student_vip_reminders in exclusive mode;

delete from public.student_vip_reminders;
delete from public.student_stock_out_issues;
delete from public.student_stock_out_logs;

select
  (select count(*) from public.student_stock_out_logs) as remaining_student_logs,
  (select count(*) from public.student_vip_queue) as remaining_vip_queue;

commit;
