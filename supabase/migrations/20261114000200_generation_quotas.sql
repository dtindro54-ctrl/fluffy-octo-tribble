alter table public.eduplan_subscriptions
  add column if not exists generations_used integer not null default 0 check (generations_used >= 0);

create table if not exists public.eduplan_trial_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_at timestamptz not null default now()
);

alter table public.eduplan_trial_claims enable row level security;

create policy "Users can read their own trial claim"
  on public.eduplan_trial_claims for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.eduplan_trial_claims from anon, authenticated;

create or replace function public.consume_eduplan_generation(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription public.eduplan_subscriptions%rowtype;
  inserted_user uuid;
  current_limit integer;
begin
  if p_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'authentication_required');
  end if;

  select * into subscription
  from public.eduplan_subscriptions
  where user_id = p_user_id
    and status = 'active'
    and current_period_end > now()
  for update;

  if found then
    current_limit := case subscription.plan
      when 'monthly' then 8
      when 'yearly' then 15
      else 0
    end;

    if subscription.generations_used >= current_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'quota_exhausted',
        'plan', subscription.plan,
        'used', subscription.generations_used,
        'limit', current_limit,
        'period_end', subscription.current_period_end
      );
    end if;

    update public.eduplan_subscriptions
      set generations_used = generations_used + 1, updated_at = now()
      where user_id = p_user_id
      returning * into subscription;

    return jsonb_build_object(
      'allowed', true,
      'plan', subscription.plan,
      'used', subscription.generations_used,
      'limit', current_limit,
      'period_end', subscription.current_period_end
    );
  end if;

  insert into public.eduplan_trial_claims (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing
    returning user_id into inserted_user;

  if inserted_user is not null then
    return jsonb_build_object('allowed', true, 'plan', 'trial', 'used', 1, 'limit', 1);
  end if;

  return jsonb_build_object('allowed', false, 'reason', 'trial_used', 'plan', 'free', 'used', 1, 'limit', 1);
end;
$$;

revoke all on function public.consume_eduplan_generation(uuid) from public, anon, authenticated;
grant execute on function public.consume_eduplan_generation(uuid) to service_role;
