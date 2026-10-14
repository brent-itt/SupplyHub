-- One-time administrator reset. Run in Supabase SQL Editor, not as a migration.
-- Clears requisitions, transaction history, and the previously requested
-- student logs/VIP queue, including their dependent history records.
-- Keeps tables, columns, constraints, accounts, items, and inventory quantities.
begin;
set local lock_timeout = '10s';

-- List every dependent table explicitly; do not cascade to other tables.
truncate table
  public.student_vip_reminders,
  public.student_stock_out_issues,
  public.student_stock_out_logs,
  public.requisition_logs,
  public.transactions,
  public.requisitions;

select
  (select count(*) from public.requisitions) as remaining_requisitions,
  (select count(*) from public.transactions) as remaining_transactions,
  (select count(*) from public.student_stock_out_logs) as remaining_student_logs,
  (select count(*) from public.student_vip_queue) as remaining_vip_queue;
commit;
