create or replace function public.apply_paid_xendit_invoice(
  p_external_id text,
  p_invoice_id text,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_order public.eduplan_payment_orders%rowtype;
  period_start timestamptz;
  period_end timestamptz;
begin
  select * into payment_order
  from public.eduplan_payment_orders
  where external_id = p_external_id
  for update;

  if not found then
    raise exception 'Payment order not found';
  end if;

  if payment_order.status = 'PAID' then
    if payment_order.xendit_invoice_id = p_invoice_id and payment_order.amount = p_amount then
      return;
    end if;
    raise exception 'Paid order verification mismatch';
  end if;

  if payment_order.amount <> p_amount then
    raise exception 'Invoice amount mismatch';
  end if;
  if payment_order.status <> 'PENDING' then
    raise exception 'Payment order is not pending';
  end if;

  update public.eduplan_payment_orders
  set status = 'PAID', xendit_invoice_id = p_invoice_id, paid_at = now()
  where id = payment_order.id;

  select greatest(now(), coalesce(subscription.current_period_end, now()))
  into period_start
  from (select 1) as singleton
  left join public.eduplan_subscriptions subscription on subscription.user_id = payment_order.user_id;

  period_end := case payment_order.plan
    when 'monthly' then period_start + interval '1 month'
    when 'yearly' then period_start + interval '1 year'
  end;

  insert into public.eduplan_subscriptions (
    user_id, plan, status, current_period_start, current_period_end, generations_used, updated_at
  ) values (
    payment_order.user_id, payment_order.plan, 'active', period_start, period_end, 0, now()
  )
  on conflict (user_id) do update
    set plan = excluded.plan,
        status = 'active',
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        generations_used = 0,
        updated_at = now();
end;
$$;

revoke all on function public.apply_paid_xendit_invoice(text, text, integer) from public, anon, authenticated;
grant execute on function public.apply_paid_xendit_invoice(text, text, integer) to service_role;
