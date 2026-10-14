-- Rank the full queue before search and pagination are applied.
begin;

create or replace view public.student_vip_queue with (security_invoker = true) as
  select q.*,
    row_number() over (order by q.created_at, q.id) as queue_position,
    case when q.available_quantity > 0 then
      count(*) filter (where q.available_quantity > 0) over (
        order by q.created_at, q.id rows between unbounded preceding and current row
      )
    end as reminder_position
  from (
    select s.*, i.quantity as stock_quantity, i.is_archived,
      (s.quantity - s.fulfilled_quantity) as remaining_quantity,
      row_number() over (partition by s.item_id order by s.created_at, s.id) as item_position,
      least(s.quantity - s.fulfilled_quantity, greatest(0, case when i.is_archived then 0 else i.quantity end -
        coalesce(sum(s.quantity - s.fulfilled_quantity) over (partition by s.item_id order by s.created_at, s.id rows between unbounded preceding and 1 preceding), 0)))::integer as available_quantity
    from public.student_stock_out_logs s join public.items i on i.id = s.item_id
    where s.status = 'pending' and s.vip_queued_at is not null
  ) q;

notify pgrst, 'reload schema';
commit;
