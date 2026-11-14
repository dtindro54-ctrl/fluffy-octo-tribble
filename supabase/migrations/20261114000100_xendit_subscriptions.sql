create table if not exists public.eduplan_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  status text not null check (status in ('active', 'expired', 'cancelled')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.eduplan_payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null unique,
  xendit_invoice_id text unique,
  plan text not null check (plan in ('monthly', 'yearly')),
  amount integer not null check (amount in (199000, 350000)),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'EXPIRED', 'FAILED')),
  invoice_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.eduplan_subscriptions enable row level security;
alter table public.eduplan_payment_orders enable row level security;

create policy "Users can read their own subscription"
  on public.eduplan_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their own payment orders"
  on public.eduplan_payment_orders for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.eduplan_subscriptions from anon, authenticated;
revoke insert, update, delete on public.eduplan_payment_orders from anon, authenticated;

create or replace function public.apply_paid_xendit_invoice(p_external_id text, p_invoice_id text)
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

  if not found or payment_order.status = 'PAID' then
    return;
  end if;

  update public.eduplan_payment_orders
  set status = 'PAID',
      xendit_invoice_id = coalesce(p_invoice_id, xendit_invoice_id),
      paid_at = now()
  where id = payment_order.id;

  select greatest(now(), coalesce(s.current_period_end, now()))
  into period_start
  from (select 1) as singleton
  left join public.eduplan_subscriptions s on s.user_id = payment_order.user_id;

  period_end := case payment_order.plan
    when 'monthly' then period_start + interval '1 month'
    when 'yearly' then period_start + interval '1 year'
  end;

  insert into public.eduplan_subscriptions (user_id, plan, status, current_period_start, current_period_end, updated_at)
  values (payment_order.user_id, payment_order.plan, 'active', period_start, period_end, now())
  on conflict (user_id) do update
    set plan = excluded.plan,
        status = 'active',
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        updated_at = now();
end;
$$;

revoke all on function public.apply_paid_xendit_invoice(text, text) from public, anon, authenticated;
grant execute on function public.apply_paid_xendit_invoice(text, text) to service_role;
