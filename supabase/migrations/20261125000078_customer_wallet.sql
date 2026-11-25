-- ============================================================================
-- Customer wallet (Phase A) — refund balance + gift balance (lots with expiry)
--
-- Money is integer piastres. The ledger is the source of truth: the two
-- balance columns move ONLY from the post-insert trigger, and the CHECK
-- (>= 0) constraint makes overspending impossible. Every write is a definer
-- function that locks the rows it reads and carries a unique reference, so a
-- retry is a no-op. Test-mode orders (fn_is_test_order) never move wallet money.
--
-- Buckets:
--   refund — the customer's own money, never expires
--   gift   — granted by an admin with its own expiry date (a gift lot)
-- Spending takes gift lots first (earliest expiry), then the refund bucket.
--
-- This migration also replaces the latest bodies of fn_create_order,
-- fn_confirm_payment, fn_cancel_order, fn_cancel_order_admin and
-- fn_admin_execute_refund, keeping every existing behaviour and adding the
-- wallet part.
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 1) TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.customer_wallets (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  refund_piastres bigint not null default 0 check (refund_piastres >= 0),
  gift_piastres   bigint not null default 0 check (gift_piastres >= 0),
  updated_at      timestamptz not null default now()
);

create table if not exists public.customer_wallet_gifts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  amount_piastres    bigint not null check (amount_piastres > 0),
  remaining_piastres bigint not null check (remaining_piastres >= 0),
  expires_at         timestamptz not null,
  reason             text not null,
  status             text not null default 'active' check (status in ('active', 'used', 'expired')),
  expiry_notified_at timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists customer_gifts_user_idx
  on public.customer_wallet_gifts (user_id, status, expires_at);
create index if not exists customer_gifts_expiry_idx
  on public.customer_wallet_gifts (expires_at) where status = 'active';

create table if not exists public.customer_wallet_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  bucket            text not null check (bucket in ('refund', 'gift')),
  type              text not null check (type in (
                      'refund_credit', 'exchange_credit', 'cancel_credit', 'order_payment',
                      'order_payment_reversal', 'gift_credit', 'gift_expiry',
                      'admin_credit', 'admin_debit')),
  amount_piastres   bigint not null check (amount_piastres <> 0),
  reference         text not null,
  order_id          uuid references public.orders(id) on delete set null,
  refund_request_id uuid references public.refund_requests(id) on delete set null,
  gift_id           uuid references public.customer_wallet_gifts(id) on delete set null,
  reason            text,
  meta              jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint customer_wallet_tx_debit_needs_reason check (
    amount_piastres > 0 or length(trim(coalesce(reason, ''))) > 0),
  constraint customer_wallet_tx_admin_needs_reason check (
    type not in ('admin_credit', 'admin_debit')
    or length(trim(coalesce(reason, ''))) > 0),
  constraint customer_wallet_tx_once unique (user_id, type, bucket, reference)
);
create index if not exists customer_wallet_tx_user_idx
  on public.customer_wallet_transactions (user_id, created_at desc);
create index if not exists customer_wallet_tx_order_idx
  on public.customer_wallet_transactions (order_id);

alter table public.customer_wallets enable row level security;
alter table public.customer_wallet_gifts enable row level security;
alter table public.customer_wallet_transactions enable row level security;

-- ----------------------------------------------------------------------------
-- 2) TRIGGER — the ledger moves the balances; nothing else can
-- ----------------------------------------------------------------------------
create or replace function public.fn_customer_wallet_apply_tx()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.customer_wallets (user_id) values (new.user_id)
    on conflict (user_id) do nothing;
  if new.bucket = 'gift' then
    update public.customer_wallets
      set gift_piastres = gift_piastres + new.amount_piastres, updated_at = now()
      where user_id = new.user_id;
  else
    update public.customer_wallets
      set refund_piastres = refund_piastres + new.amount_piastres, updated_at = now()
      where user_id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists customer_wallet_tx_apply on public.customer_wallet_transactions;
create trigger customer_wallet_tx_apply
  after insert on public.customer_wallet_transactions
  for each row execute function public.fn_customer_wallet_apply_tx();

-- ----------------------------------------------------------------------------
-- 3) RLS — customers read their own rows, admins read everything, nobody
--    writes directly (every write is a definer function)
-- ----------------------------------------------------------------------------
drop policy if exists customer_wallets_own_read on public.customer_wallets;
create policy customer_wallets_own_read on public.customer_wallets
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('refunds.view'));

drop policy if exists customer_gifts_own_read on public.customer_wallet_gifts;
create policy customer_gifts_own_read on public.customer_wallet_gifts
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('refunds.view'));

drop policy if exists customer_wallet_tx_own_read on public.customer_wallet_transactions;
create policy customer_wallet_tx_own_read on public.customer_wallet_transactions
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('refunds.view'));

revoke all on public.customer_wallets, public.customer_wallet_gifts,
  public.customer_wallet_transactions from anon, public;
grant select on public.customer_wallets, public.customer_wallet_gifts,
  public.customer_wallet_transactions to authenticated;

-- ----------------------------------------------------------------------------
-- 4) FN_WALLET_POST — the single ledger writer (signed: + credit, − debit)
-- ----------------------------------------------------------------------------
create or replace function public.fn_wallet_post(
  p_user uuid, p_bucket text, p_type text, p_amount bigint, p_reference text,
  p_reason text default null, p_order_id uuid default null,
  p_refund_request_id uuid default null, p_gift_id uuid default null,
  p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  if p_user is null or p_bucket not in ('refund', 'gift')
     or p_type not in ('refund_credit', 'exchange_credit', 'cancel_credit', 'order_payment',
                       'order_payment_reversal', 'gift_credit', 'gift_expiry',
                       'admin_credit', 'admin_debit') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_amount is null or p_amount = 0 or coalesce(trim(p_reference), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  -- test-mode orders never touch real wallet money
  if p_order_id is not null and p_type in ('refund_credit', 'exchange_credit', 'cancel_credit')
     and public.fn_is_test_order(p_order_id) then
    return jsonb_build_object('ok', true, 'posted', false, 'reason', 'test_order');
  end if;
  select id into v_tx from public.customer_wallet_transactions
   where user_id = p_user and type = p_type and bucket = p_bucket
     and reference = p_reference;
  if v_tx is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_tx);
  end if;
  insert into public.customer_wallet_transactions (user_id, bucket, type, amount_piastres,
      reference, order_id, refund_request_id, gift_id, reason, meta, created_by)
  values (p_user, p_bucket, p_type, p_amount, p_reference, p_order_id,
      p_refund_request_id, p_gift_id, nullif(trim(coalesce(p_reason, '')), ''),
      coalesce(p_meta, '{}'::jsonb), auth.uid())
  returning id into v_tx;
  return jsonb_build_object('ok', true, 'tx_id', v_tx);
exception when unique_violation then
  return jsonb_build_object('ok', true, 'duplicate', true);
end $$;

-- ----------------------------------------------------------------------------
-- 5) GIFT EXPIRY — a lot past its date gives back what is left (gift_expiry)
-- ----------------------------------------------------------------------------
create or replace function public.fn_wallet_expire_gifts_for(p_user uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_count integer := 0;
begin
  for r in select * from public.customer_wallet_gifts
            where user_id = p_user and status = 'active' and expires_at <= now()
            for update
  loop
    if r.remaining_piastres > 0 then
      perform public.fn_wallet_post(p_user, 'gift', 'gift_expiry', -r.remaining_piastres,
        'gift-expiry:' || r.id::text || ':' || gen_random_uuid()::text, 'expired', null, null, r.id, '{}'::jsonb);
    end if;
    update public.customer_wallet_gifts
      set remaining_piastres = 0, status = 'expired'
      where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.fn_wallet_expire_gifts()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_warned integer := 0; v_expired integer := 0;
begin
  -- three days before the date: one reminder per lot
  for r in select * from public.customer_wallet_gifts
            where status = 'active' and remaining_piastres > 0
              and expiry_notified_at is null
              and expires_at > now() and expires_at <= now() + interval '3 days'
            for update
  loop
    update public.customer_wallet_gifts set expiry_notified_at = now() where id = r.id;
    perform public.fn_notify(r.user_id, 'wallet_gift_expiring', jsonb_build_object(
      'ar', jsonb_build_object('title', 'هدية تقترب من الانتهاء',
        'body', 'ينتهي رصيد الهدية ' || round(r.remaining_piastres / 100.0, 2) || ' ج.م في '
                || to_char(r.expires_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')),
      'en', jsonb_build_object('title', 'Your gift balance is expiring',
        'body', 'EGP ' || round(r.remaining_piastres / 100.0, 2) || ' of gift balance expires on '
                || to_char(r.expires_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')),
      'link', '/account/wallet'));
    v_warned := v_warned + 1;
  end loop;
  for r in select distinct user_id from public.customer_wallet_gifts
            where status = 'active' and expires_at <= now()
  loop
    v_expired := v_expired + public.fn_wallet_expire_gifts_for(r.user_id);
  end loop;
  return jsonb_build_object('ok', true, 'warned', v_warned, 'expired', v_expired);
end $$;

-- ----------------------------------------------------------------------------
-- 6) FN_WALLET_SPEND — gift lots first (earliest expiry), then refund
-- ----------------------------------------------------------------------------
create or replace function public.fn_wallet_spend(
  p_user uuid, p_amount bigint, p_order_id uuid, p_reference text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.customer_wallets%rowtype;
  v_left bigint;
  v_take bigint;
  v_gift_total bigint := 0;
  v_lots jsonb := '[]'::jsonb;
  r record;
begin
  if p_user is null or p_amount is null or p_amount <= 0
     or coalesce(trim(p_reference), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  perform public.fn_wallet_expire_gifts_for(p_user);
  insert into public.customer_wallets (user_id) values (p_user)
    on conflict (user_id) do nothing;
  select * into v_wallet from public.customer_wallets where user_id = p_user for update;
  if v_wallet.refund_piastres + v_wallet.gift_piastres < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available_piastres', v_wallet.refund_piastres + v_wallet.gift_piastres);
  end if;
  v_left := p_amount;
  for r in select * from public.customer_wallet_gifts
            where user_id = p_user and status = 'active' and remaining_piastres > 0
              and expires_at > now()
            order by expires_at asc, created_at asc
            for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.remaining_piastres);
    update public.customer_wallet_gifts
      set remaining_piastres = remaining_piastres - v_take,
          status = case when remaining_piastres - v_take = 0 then 'used' else 'active' end
      where id = r.id;
    v_lots := v_lots || jsonb_build_object(
      'gift_id', r.id, 'amount_piastres', v_take, 'expires_at', r.expires_at);
    v_left := v_left - v_take;
    v_gift_total := v_gift_total + v_take;
  end loop;
  if v_gift_total > 0 then
    perform public.fn_wallet_post(p_user, 'gift', 'order_payment', -v_gift_total,
      p_reference, 'order_payment', p_order_id, null, null, jsonb_build_object('lots', v_lots));
  end if;
  if v_left > 0 then
    perform public.fn_wallet_post(p_user, 'refund', 'order_payment', -v_left,
      p_reference, 'order_payment', p_order_id, null, null, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'amount_piastres', p_amount,
    'gift_piastres', v_gift_total, 'refund_piastres', p_amount - v_gift_total);
end $$;

-- ----------------------------------------------------------------------------
-- 7) FN_WALLET_RESTORE — reverses every order_payment of an order exactly once
-- ----------------------------------------------------------------------------
create or replace function public.fn_wallet_restore(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; e record; v_users uuid[] := '{}'::uuid[]; u uuid;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_order');
  end if;
  for r in select * from public.customer_wallet_transactions
            where order_id = p_order_id and type = 'order_payment'
            order by created_at
  loop
    -- one reversal per (user, bucket, reference): a repeat is a no-op
    if exists (select 1 from public.customer_wallet_transactions t
                where t.user_id = r.user_id and t.type = 'order_payment_reversal'
                  and t.bucket = r.bucket and t.reference = r.reference) then
      continue;
    end if;
    perform public.fn_wallet_post(r.user_id, r.bucket, 'order_payment_reversal',
      -r.amount_piastres, r.reference,
      coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'order_cancelled'),
      p_order_id, r.refund_request_id, null,
      jsonb_build_object('restores', r.id));
    -- gift money goes back to the lots it came from
    if r.bucket = 'gift' then
      for e in select (x->>'gift_id')::uuid as gift_id,
                      (x->>'amount_piastres')::bigint as amount
               from jsonb_array_elements(coalesce(r.meta->'lots', '[]'::jsonb)) x
      loop
        update public.customer_wallet_gifts
          set remaining_piastres = least(amount_piastres, remaining_piastres + e.amount),
              status = 'active'
          where id = e.gift_id and user_id = r.user_id;
      end loop;
    end if;
    v_users := v_users || r.user_id;
  end loop;
  -- a lot already past its date expires again at once
  for u in select distinct x from unnest(v_users) x loop
    perform public.fn_wallet_expire_gifts_for(u);
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------------------
-- 8) FN_MY_WALLET — the signed-in customer's balances, gifts and ledger
-- ----------------------------------------------------------------------------
create or replace function public.fn_my_wallet()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_wallet public.customer_wallets%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  perform public.fn_wallet_expire_gifts_for(v_uid);
  select * into v_wallet from public.customer_wallets where user_id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'refund_piastres', coalesce(v_wallet.refund_piastres, 0),
    'gift_piastres', coalesce(v_wallet.gift_piastres, 0),
    'gifts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'amount_piastres', g.amount_piastres,
          'remaining_piastres', g.remaining_piastres,
          'expires_at', g.expires_at, 'reason', g.reason)
        order by g.expires_at)
        from public.customer_wallet_gifts g
        where g.user_id = v_uid and g.status = 'active' and g.remaining_piastres > 0), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select t.id, t.bucket, t.type, t.amount_piastres, t.reference, t.reason,
               t.order_id, t.created_at, o.number as order_number
          from public.customer_wallet_transactions t
          left join public.orders o on o.id = t.order_id
          where t.user_id = v_uid
          order by t.created_at desc
          limit 100) x), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------------------
-- 9) ADMIN — adjust the refund bucket, grant a gift, cancel a gift, list
-- ----------------------------------------------------------------------------
create or replace function public.fn_admin_wallet_adjust(
  p_user uuid, p_amount bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_balance bigint; v_type text; v_res jsonb;
begin
  if not public.has_permission('refunds.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_user is null or p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  perform public.fn_wallet_expire_gifts_for(p_user);
  insert into public.customer_wallets (user_id) values (p_user)
    on conflict (user_id) do nothing;
  select refund_piastres into v_balance from public.customer_wallets
   where user_id = p_user for update;
  if p_amount < 0 and v_balance + p_amount < 0 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available_piastres', v_balance);
  end if;
  v_type := case when p_amount > 0 then 'admin_credit' else 'admin_debit' end;
  v_res := public.fn_wallet_post(p_user, 'refund', v_type, p_amount,
    v_type || ':' || gen_random_uuid()::text, p_reason, null, null, null, '{}'::jsonb);
  if coalesce((v_res->>'ok')::boolean, false) then
    perform public.fn_audit('customer_wallet.adjusted', 'customer_wallets', p_user::text,
      jsonb_build_object('refund_piastres', v_balance),
      jsonb_build_object('refund_piastres', v_balance + p_amount, 'reason', p_reason));
    perform public.fn_notify(p_user,
      case when p_amount > 0 then 'wallet_credited' else 'wallet_debited_admin' end,
      jsonb_build_object(
        'ar', jsonb_build_object('title', 'تحديث رصيد محفظتك',
          'body', case when p_amount > 0 then 'أضافت الإدارة ' else 'خصمت الإدارة ' end
                  || round(abs(p_amount) / 100.0, 2) || ' ج.م — ' || p_reason),
        'en', jsonb_build_object('title', 'Your wallet balance was updated',
          'body', case when p_amount > 0 then 'The team added ' else 'The team deducted ' end
                  || 'EGP ' || round(abs(p_amount) / 100.0, 2) || ' — ' || p_reason),
        'link', '/account/wallet'));
  end if;
  return v_res;
end $$;

create or replace function public.fn_admin_wallet_gift(
  p_user uuid, p_amount bigint, p_expires_at timestamptz, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_gift uuid;
begin
  if not public.has_permission('refunds.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_user is null or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'bad_expiry');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  insert into public.customer_wallet_gifts (user_id, amount_piastres, remaining_piastres,
      expires_at, reason, status, created_by)
  values (p_user, p_amount, p_amount, p_expires_at, left(trim(p_reason), 500), 'active', auth.uid())
  returning id into v_gift;
  perform public.fn_wallet_post(p_user, 'gift', 'gift_credit', p_amount,
    'gift:' || v_gift::text, p_reason, null, null, v_gift, '{}'::jsonb);
  perform public.fn_audit('customer_wallet.gift_granted', 'customer_wallet_gifts', v_gift::text,
    null, jsonb_build_object('user_id', p_user, 'amount_piastres', p_amount,
                             'expires_at', p_expires_at, 'reason', p_reason));
  perform public.fn_notify(p_user, 'wallet_gift', jsonb_build_object(
    'ar', jsonb_build_object('title', 'هدية في محفظتك',
      'body', 'أضافت الإدارة هدية ' || round(p_amount / 100.0, 2) || ' ج.م تنتهي في '
              || to_char(p_expires_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')),
    'en', jsonb_build_object('title', 'A gift in your wallet',
      'body', 'The team added a gift of EGP ' || round(p_amount / 100.0, 2)
              || ' that expires on ' || to_char(p_expires_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')),
    'link', '/account/wallet'));
  return jsonb_build_object('ok', true, 'gift_id', v_gift);
end $$;

create or replace function public.fn_admin_wallet_gift_cancel(p_gift_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.customer_wallet_gifts%rowtype;
begin
  if not public.has_permission('refunds.manage') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select * into g from public.customer_wallet_gifts where id = p_gift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if g.status <> 'active' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if g.remaining_piastres > 0 then
    perform public.fn_wallet_post(g.user_id, 'gift', 'gift_expiry', -g.remaining_piastres,
      'gift-expiry:' || g.id::text || ':' || gen_random_uuid()::text, p_reason, null, null, g.id, '{}'::jsonb);
  end if;
  update public.customer_wallet_gifts
    set remaining_piastres = 0, status = 'expired'
    where id = g.id;
  perform public.fn_audit('customer_wallet.gift_cancelled', 'customer_wallet_gifts', g.id::text,
    jsonb_build_object('remaining_piastres', g.remaining_piastres),
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_admin_customer_wallet(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_wallet public.customer_wallets%rowtype; v_profile record;
begin
  if not public.has_permission('refunds.view') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform public.fn_wallet_expire_gifts_for(p_user);
  select id, full_name, phone, email into v_profile from public.profiles where id = p_user;
  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_wallet from public.customer_wallets where user_id = p_user;
  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object('id', v_profile.id, 'full_name', v_profile.full_name,
                               'phone', v_profile.phone, 'email', v_profile.email),
    'refund_piastres', coalesce(v_wallet.refund_piastres, 0),
    'gift_piastres', coalesce(v_wallet.gift_piastres, 0),
    'gifts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'amount_piastres', g.amount_piastres,
          'remaining_piastres', g.remaining_piastres, 'expires_at', g.expires_at,
          'reason', g.reason, 'status', g.status)
        order by g.created_at desc)
        from public.customer_wallet_gifts g where g.user_id = p_user), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select t.id, t.bucket, t.type, t.amount_piastres, t.reference, t.reason,
               t.order_id, t.created_at, o.number as order_number
          from public.customer_wallet_transactions t
          left join public.orders o on o.id = t.order_id
          where t.user_id = p_user
          order by t.created_at desc
          limit 100) x), '[]'::jsonb));
end $$;

create or replace function public.fn_admin_customer_wallets(p_search text default null, p_page integer default 1)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_size integer := 25;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total integer;
begin
  if not public.has_permission('refunds.view') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select count(*) into v_total
    from public.customer_wallets w join public.profiles p on p.id = w.user_id
   where (w.refund_piastres <> 0 or w.gift_piastres <> 0)
     and (v_search is null
          or p.full_name ilike '%' || v_search || '%'
          or p.phone ilike '%' || v_search || '%'
          or p.email ilike '%' || v_search || '%');
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', w.user_id, 'full_name', p.full_name, 'phone', p.phone,
      'email', p.email, 'refund_piastres', w.refund_piastres,
      'gift_piastres', w.gift_piastres, 'updated_at', w.updated_at)
      order by w.updated_at desc), '[]'::jsonb) into v_rows
    from (select w0.* from public.customer_wallets w0
            join public.profiles p0 on p0.id = w0.user_id
           where (w0.refund_piastres <> 0 or w0.gift_piastres <> 0)
             and (v_search is null
                  or p0.full_name ilike '%' || v_search || '%'
                  or p0.phone ilike '%' || v_search || '%'
                  or p0.email ilike '%' || v_search || '%')
           order by w0.updated_at desc
           offset (v_page - 1) * v_size limit v_size) w
    join public.profiles p on p.id = w.user_id;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'total', v_total,
    'page', v_page, 'page_size', v_size,
    'refund_total_piastres', (select coalesce(sum(refund_piastres), 0) from public.customer_wallets),
    'gift_total_piastres', (select coalesce(sum(remaining_piastres), 0)
                              from public.customer_wallet_gifts
                             where status = 'active' and expires_at > now()));
end $$;

-- grants: the writers stay internal, the rest is callable as the signed-in user
revoke all on function public.fn_wallet_post(uuid, text, text, bigint, text, text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fn_wallet_spend(uuid, bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.fn_wallet_restore(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_wallet_expire_gifts_for(uuid) from public, anon, authenticated;
grant execute on function public.fn_wallet_post(uuid, text, text, bigint, text, text, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.fn_wallet_spend(uuid, bigint, uuid, text) to service_role;
grant execute on function public.fn_wallet_restore(uuid, text) to service_role;
grant execute on function public.fn_wallet_expire_gifts_for(uuid) to service_role;
revoke all on function public.fn_wallet_expire_gifts() from public, anon, authenticated;
grant execute on function public.fn_wallet_expire_gifts() to service_role;
revoke all on function public.fn_my_wallet() from public, anon;
grant execute on function public.fn_my_wallet() to authenticated;
revoke all on function public.fn_admin_wallet_adjust(uuid, bigint, text) from public, anon;
grant execute on function public.fn_admin_wallet_adjust(uuid, bigint, text) to authenticated;
revoke all on function public.fn_admin_wallet_gift(uuid, bigint, timestamptz, text) from public, anon;
grant execute on function public.fn_admin_wallet_gift(uuid, bigint, timestamptz, text) to authenticated;
revoke all on function public.fn_admin_wallet_gift_cancel(uuid, text) from public, anon;
grant execute on function public.fn_admin_wallet_gift_cancel(uuid, text) to authenticated;
revoke all on function public.fn_admin_customer_wallet(uuid) from public, anon;
grant execute on function public.fn_admin_customer_wallet(uuid) to authenticated;
revoke all on function public.fn_admin_customer_wallets(text, integer) from public, anon;
grant execute on function public.fn_admin_customer_wallets(text, integer) to authenticated;

-- daily: expire past gifts and warn three days ahead (same pattern as the
-- other scheduled jobs)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    begin
      perform cron.unschedule('expire-customer-wallet-gifts');
    exception when others then null;
    end;
    perform cron.schedule('expire-customer-wallet-gifts', '30 3 * * *',
      'select public.fn_wallet_expire_gifts();');
  else
    raise notice 'pg_cron not available — fn_wallet_expire_gifts is exposed for a scheduled Edge Function';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 10) ORDERS — the wallet part and the 'wallet' payment method
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists wallet_paid_piastres integer not null default 0;
alter table public.orders drop constraint if exists orders_wallet_paid_check;
alter table public.orders add constraint orders_wallet_paid_check
  check (wallet_paid_piastres >= 0 and wallet_paid_piastres <= total_piastres);
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('kashier', 'cod', 'wallet'));

-- refund requests opened by a cancelled order
alter table public.refund_requests drop constraint if exists refund_requests_source_check;
alter table public.refund_requests add constraint refund_requests_source_check
  check (source in ('customer', 'admin', 'cancel'));
alter table public.refund_requests drop constraint if exists refund_requests_method_check;
alter table public.refund_requests add constraint refund_requests_method_check
  check (refund_method is null or refund_method in ('original', 'bank_transfer', 'wallet', 'cash', 'other', 'store_wallet'));

-- ----------------------------------------------------------------------------
-- 11) FN_CREATE_ORDER — latest body (20261104000007) + the wallet part.
--     p_payload->>'wallet_piastres' is capped to the balance and the total;
--     fn_wallet_spend runs inside this transaction. When the wallet covers
--     the whole total the method becomes 'wallet', the payment is paid and
--     the order takes the status a confirmed card payment gives it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_addr jsonb := p_payload->'address';
  v_method text := p_payload->>'payment_method';
  v_coupon_code text := nullif(trim(coalesce(p_payload->>'coupon_code', '')), '');
  v_attempt uuid := nullif(p_payload->>'attempt_key', '')::uuid;
  v_existing orders%rowtype;
  v_profile record;
  v_area record;
  r record;
  x record;
  v_it record;

  v_cod_cap integer := 500000;
  v_shipping integer;
  v_lines jsonb := '[]'::jsonb;          -- coupon validation lines
  v_rows jsonb := '[]'::jsonb;           -- priced rows for insertion
  v_row jsonb;
  v_subtotal integer := 0;

  v_vendor_ids uuid[] := '{}'::uuid[];
  v_vendor_mode boolean := false;        -- any vendor-shipped item

  v_coupon_row public.coupons%rowtype;
  v_coupon jsonb;
  v_discount integer := 0;               -- product-funded
  v_cd_discount integer := 0;            -- commission-funded (VO-22)
  v_free_shipping boolean := false;
  v_eligible_subtotal integer := 0;
  v_line_discount integer;
  v_running integer := 0;
  v_last_eligible integer := -1;

  v_total integer;
  v_wallet_request bigint := 0;
  v_wallet_available bigint;
  v_wallet_paid integer := 0;
  v_wallet_full boolean := false;
  v_wallet_res jsonb;
  v_order_id uuid;
  v_number text;
  v_yy smallint;
  v_seq integer;
  v_group_id uuid;
  v_group_subtotal integer;
  v_group_discount integer;
  v_group_commission integer;
  v_commission_bps integer;
  v_rate numeric;
  v_event record;
  v_event_percent integer := 0;
  v_event_cap integer;
  v_unit integer;
  v_unavailable text := '';
  v_order_status text;
  v_vid uuid;
  v_i integer;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;

  -- idempotency: the same attempt key resolves to the same order (no dupes)
  if v_attempt is not null then
    select * into v_existing from public.orders where attempt_key = v_attempt;
    if found then
      return jsonb_build_object('ok', true, 'order_id', v_existing.id,
        'number', v_existing.number, 'payment_method', v_existing.payment_method,
        'wallet_paid_piastres', v_existing.wallet_paid_piastres,
        'duplicate', true);
    end if;
  end if;

  if v_method not in ('kashier', 'cod', 'wallet') then
    return jsonb_build_object('ok', false, 'reason', 'bad_payment_method');
  end if;

  -- account email is the order email — taken from the profile, never the payload
  select email, coalesce(phone, '') into v_profile from public.profiles where id = v_uid;
  if v_profile.email is null or v_profile.email = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_missing');
  end if;

  -- address validation (AGENT §29: email read-only, alternate required ≠ primary)
  if coalesce(trim(v_addr->>'full_name'), '') = ''
     or coalesce(trim(v_addr->>'address1'), '') = ''
     or coalesce(trim(v_addr->>'phone_primary'), '') = ''
     or coalesce(trim(v_addr->>'phone_alternate'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'address_incomplete');
  end if;
  if (v_addr->>'phone_primary') = (v_addr->>'phone_alternate') then
    return jsonb_build_object('ok', false, 'reason', 'phones_equal');
  end if;
  if (v_addr->>'phone_primary') !~ '^\+201(0|1|2|5)[0-9]{8}$'
     or (v_addr->>'phone_alternate') !~ '^\+201(0|1|2|5)[0-9]{8}$' then
    return jsonb_build_object('ok', false, 'reason', 'phone_invalid');
  end if;

  select a.id, a.governorate_id, a.is_active, a.name_ar, a.name_en,
         g.is_active as gov_active, g.shipping_fee_piastres, g.name_ar as gov_ar, g.name_en as gov_en
    into v_area
    from public.areas a join public.governorates g on g.id = a.governorate_id
    where a.id = (v_addr->>'area_id')::bigint
      and a.governorate_id = (v_addr->>'governorate_id')::smallint;
  if not found or not v_area.is_active or not v_area.gov_active then
    return jsonb_build_object('ok', false, 'reason', 'area_unavailable');
  end if;
  v_shipping := v_area.shipping_fee_piastres;

  -- COD cap from settings (default 5,000 EGP)
  select coalesce((s.value->>'cod_max_total_piastres')::integer, 500000) into v_cod_cap
    from public.settings s where s.key in ('payments', 'checkout') and s.value ? 'cod_max_total_piastres'
     order by (s.key = 'payments') desc limit 1;

  -- lock the cart + the variants (deterministic order avoids deadlocks)
  for r in
    select ci.variant_id, ci.qty, ci.product_id,
           v.stock, v.is_active, v.deleted_at as v_deleted, v.price_piastres,
           v.sale_price_piastres, v.option_key, v.sku, v.image_path,
           p.name_ar, p.name_en, p.status as p_status, p.deleted_at as p_deleted,
           p.shipping_mode, p.is_fragile, p.leaf_category_id, p.brand_id,
           p.vendor_id, coalesce(v.sale_starts_at, p.sale_starts_at) as sale_starts_at, coalesce(v.sale_ends_at, p.sale_ends_at) as sale_ends_at, p.event_hidden
      from public.cart_items ci
      join public.variants v on v.id = ci.variant_id
      join public.products p on p.id = ci.product_id
      where ci.user_id = v_uid
      order by ci.variant_id
        for update of ci, v
  loop
    if r.p_deleted is not null or r.p_status <> 'approved'
       or r.v_deleted is not null or not r.is_active or r.price_piastres is null
       or not public.vendor_can_sell(r.vendor_id)
        or public.fn_packaging_order_cap_reached(r.vendor_id)
       or r.event_hidden
       or exists (select 1 from public.v_active_event_vendors aev
                  where aev.vendor_id = r.vendor_id and aev.status = 'refused') then
      v_unavailable := v_unavailable || case when v_unavailable = '' then '' else '، ' end || coalesce(nullif(r.name_ar, ''), r.name_en);
      continue;
    end if;
    if r.stock < r.qty then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_stock',
        'variant_id', r.variant_id, 'stock', r.stock, 'name', r.name_ar);
    end if;

    -- unit price: variant sale (product-level window) then event discount —
    -- identical rules to v_storefront_products
    v_unit := r.price_piastres;
    if r.sale_price_piastres is not null
       and r.sale_starts_at is not null and r.sale_starts_at <= now()
       and (r.sale_ends_at is null or r.sale_ends_at > now()) then
      v_unit := least(r.price_piastres, r.sale_price_piastres);
    end if;
    select d.percent, d.max_discount_piastres into v_event_percent, v_event_cap
      from public.v_active_event_vendors aev
      join public.event_discounts d on d.event_id = aev.event_id
      where aev.vendor_id = r.vendor_id and aev.status = 'accepted'
        and ((d.scope = 'product' and d.ref_id = r.product_id)
          or (d.scope = 'category' and public.fn_category_within(r.leaf_category_id, d.ref_id)))
      order by (d.scope = 'product') desc, d.percent desc
      limit 1;
    if found and v_event_percent > 0 then
      -- max_discount_piastres caps the DISCOUNT, not the resulting price.
      -- (Previously this raised v_unit up to the cap, overcharging the customer
      -- whenever the discount exceeded it; least() also bounds the subtraction
      -- so int4 cannot overflow on ~21.5M+ EGP lines.)
      v_unit := v_unit - least(
        trunc(v_unit * v_event_percent / 100),
        coalesce(v_event_cap, v_unit)
      );
    end if;
    v_event_percent := 0; v_event_cap := null;

    v_rows := v_rows || jsonb_build_object(
      'variant_id', r.variant_id, 'product_id', r.product_id,
      'vendor_id', r.vendor_id, 'leaf_category_id', r.leaf_category_id,
      'brand_id', r.brand_id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'option_key', r.option_key, 'sku', r.sku,
      'image_path', coalesce(nullif(r.image_path, ''),
        (select pm.path from public.product_media pm
          where pm.product_id = r.product_id and pm.kind = 'image'
          order by pm.position limit 1)),
      'unit', v_unit, 'qty', r.qty, 'on_sale', v_unit < r.price_piastres,
      'shipping_mode', r.shipping_mode, 'is_fragile', r.is_fragile);
    v_subtotal := v_subtotal + v_unit * r.qty;
  end loop;

  if jsonb_array_length(v_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;
  if v_unavailable <> '' then
    return jsonb_build_object('ok', false, 'reason', 'items_unavailable', 'names', v_unavailable);
  end if;

  -- vendor groups + vendor-shipped detection
  for x in select distinct (e->>'vendor_id')::uuid as vid,
                  bool_or((e->>'shipping_mode') = 'vendor') as is_vendor_mode
           from jsonb_array_elements(v_rows) e group by 1
  loop
    v_vendor_ids := v_vendor_ids || x.vid;
    if x.is_vendor_mode then v_vendor_mode := true; end if;
  end loop;

  -- coupon (same engine as the cart — server-side recalculation; lines carry
  -- the vendor's live commission rate for commission_percent quoting)
  if v_coupon_code is not null then
    for r in select je as ln from jsonb_array_elements(v_rows) je loop
      select coalesce(
          public.fn_vendor_line_commission((r.ln->>'vendor_id')::uuid, (r.ln->>'leaf_category_id')::uuid) * 100,
          (vl.rewards->>'commission_percent')::numeric * 100,
          500
        ) into v_commission_bps
        from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
       where v.id = (r.ln->>'vendor_id')::uuid;
      v_lines := v_lines || jsonb_build_object(
        'product_id', r.ln->>'product_id', 'vendor_id', r.ln->>'vendor_id',
        'leaf_category_id', r.ln->>'leaf_category_id', 'brand_id', r.ln->>'brand_id',
        'unit_price_piastres', (r.ln->>'unit')::integer, 'qty', (r.ln->>'qty')::integer,
        'on_sale', (r.ln->>'on_sale')::boolean,
        'commission_bps', v_commission_bps);
    end loop;
    v_coupon := public.fn_apply_coupon(v_coupon_code, v_lines);
    if not coalesce((v_coupon->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'coupon_' || coalesce(v_coupon->>'reason', 'invalid'));
    end if;
    select * into v_coupon_row from public.coupons c where upper(c.code) = upper(v_coupon_code);
    if (v_coupon->>'type') = 'commission_percent' then
      v_cd_discount := (v_coupon->>'discount_piastres')::integer;
    else
      v_discount := (v_coupon->>'discount_piastres')::integer;
    end if;
    v_free_shipping := coalesce((v_coupon->>'free_shipping')::boolean, false);

    -- companion product coupon (stacking, AGENT §31): product-funded first,
    -- then the commission-funded one on the reduced commission.
    if v_coupon_row.type = 'commission_percent'
       and coalesce(v_coupon_row.pairs_with, '') <> '' then
      declare
        v_pair public.coupons%rowtype;
        v_pair_res jsonb;
      begin
        select * into v_pair from public.coupons c2 where upper(c2.code) = upper(v_coupon_row.pairs_with);
        if v_pair.id is not null and v_pair.status = 'active' and v_pair.stackable
           and v_pair.type in ('percent','fixed') then
          v_pair_res := public.fn_apply_coupon(v_pair.code, v_lines);
          if coalesce((v_pair_res->>'ok')::boolean, false) then
            v_discount := (v_pair_res->>'discount_piastres')::integer;
            if coalesce((v_pair_res->>'free_shipping')::boolean, false) then v_free_shipping := true; end if;
          end if;
        end if;
      end;
    end if;

    -- per-line eligibility for proportional allocation (same rules as the engine)
    v_i := 0;
    for r in select je as ln from jsonb_array_elements(v_lines) je loop
      if public.c_scope_ok(v_coupon_row, r.ln)
         and not (v_coupon_row.exclude_sale_items and (r.ln->>'on_sale')::boolean) then
        v_eligible_subtotal := v_eligible_subtotal + (r.ln->>'unit_price_piastres')::integer * (r.ln->>'qty')::integer;
        v_last_eligible := v_i;
      end if;
      v_i := v_i + 1;
    end loop;
    if v_free_shipping then v_shipping := 0; end if;
  end if;

  -- allocate the PRODUCT coupon across eligible lines proportionally; the
  -- remainder lands on the last eligible line so the sum matches exactly
  v_running := 0;
  v_i := 0;
  if v_discount > 0 and v_eligible_subtotal > 0 then
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_row := v_it.ln;
      v_line_discount := 0;
      declare
        v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
        v_is_eligible boolean;
      begin
        select public.c_scope_ok(v_coupon_row, jsonb_build_object(
                 'vendor_id', v_row->>'vendor_id', 'leaf_category_id', v_row->>'leaf_category_id',
                 'brand_id', v_row->>'brand_id', 'product_id', v_row->>'product_id'))
             and not (v_coupon_row.exclude_sale_items and (v_row->>'on_sale')::boolean)
          into v_is_eligible;
        if v_is_eligible and v_eligible_subtotal > 0 then
          if v_i = v_last_eligible then
            v_line_discount := v_discount - v_running; -- remainder on the last eligible line
          else
            v_line_discount := trunc(v_discount::numeric * v_line_total / v_eligible_subtotal)::integer;
          end if;
        end if;
      end;
      v_rows := jsonb_set(v_rows, array[v_i::text, 'coupon_discount'], to_jsonb(v_line_discount));
      v_running := v_running + v_line_discount;
      v_i := v_i + 1;
    end loop;
  else
    for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
      v_rows := jsonb_set(v_rows, array[v_i::text, 'coupon_discount'], to_jsonb(0));
      v_i := v_i + 1;
    end loop;
  end if;

  -- VO-22: allocate the COMMISSION-FUNDED discount per line —
  -- line_cd = trunc(coupon% × commission_bps × (line_total − product_discount) / 10000 / 100)
  -- capped so commission never goes negative; remainder lands on the last
  -- commission-eligible (rate > 0) line so the sum matches the engine quote.
  if v_coupon_row.type = 'commission_percent' and v_cd_discount > 0 then
    declare
      v_line_commission integer := 0;
      v_line_cd integer := 0;
      v_cd_running integer := 0;
      v_j integer := 0;
    begin
      -- find the last line with a positive rate (remainder target)
      v_j := 0;
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        select coalesce(
            public.fn_vendor_line_commission((v_it.ln->>'vendor_id')::uuid, (v_it.ln->>'leaf_category_id')::uuid) * 100,
            (vl.rewards->>'commission_percent')::numeric * 100,
            500
          ) into v_commission_bps
          from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
         where v.id = (v_it.ln->>'vendor_id')::uuid;
        v_j := v_j + 1;
      end loop;
      v_j := 0;
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        v_row := v_it.ln;
        select coalesce(
            public.fn_vendor_line_commission((v_row->>'vendor_id')::uuid, (v_row->>'leaf_category_id')::uuid) * 100,
            (vl.rewards->>'commission_percent')::numeric * 100,
            500
          ) into v_commission_bps
          from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
         where v.id = (v_row->>'vendor_id')::uuid;
        v_line_commission := greatest(
          trunc(((v_row->>'unit')::integer * (v_row->>'qty')::integer
                 - coalesce((v_row->>'coupon_discount')::integer, 0))
                * coalesce(v_commission_bps, 0) / 10000.0)::integer, 0);
        v_line_cd := least(trunc(v_line_commission * v_coupon_row.value / 100.0)::integer, v_line_commission);
        if coalesce(v_commission_bps, 0) = 0 then
          v_line_cd := 0; -- zero-commission items produce zero discount
        end if;
        -- the per-line sum IS the order discount (AGENT §31 rounding: per item
        -- to the nearest piastre) — no remainder juggling on top of the quote
        v_rows := jsonb_set(v_rows, array[v_j::text, 'cd_discount'], to_jsonb(v_line_cd));
        v_cd_running := v_cd_running + v_line_cd;
        v_j := v_j + 1;
      end loop;
      v_cd_discount := v_cd_running;
    end;
  else
    declare
      v_j integer := 0;
    begin
      for v_it in select je as ln from jsonb_array_elements(v_rows) je loop
        v_rows := jsonb_set(v_rows, array[v_j::text, 'cd_discount'], to_jsonb(0));
        v_j := v_j + 1;
      end loop;
    end;
  end if;

  v_total := v_subtotal - v_discount - v_cd_discount + v_shipping;

  -- customer wallet: the amount asked for is capped to the balance and the
  -- total; 'wallet' as the method means the wallet must cover everything
  if p_payload ? 'wallet_piastres' then
    v_wallet_request := greatest(coalesce(nullif(p_payload->>'wallet_piastres', '')::bigint, 0), 0);
  end if;
  if v_method = 'wallet' then
    v_wallet_request := greatest(v_total, 0);
  end if;
  if v_wallet_request > 0 and v_total > 0 then
    perform public.fn_wallet_expire_gifts_for(v_uid);
    select coalesce(refund_piastres, 0) + coalesce(gift_piastres, 0)
      into v_wallet_available
      from public.customer_wallets where user_id = v_uid;
    v_wallet_request := least(v_wallet_request, coalesce(v_wallet_available, 0), v_total::bigint);
  else
    v_wallet_request := 0;
  end if;
  v_wallet_paid := v_wallet_request::integer;
  v_wallet_full := v_wallet_paid > 0 and v_wallet_paid = v_total;
  if v_method = 'wallet' and not v_wallet_full then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available_piastres', coalesce(v_wallet_available, 0));
  end if;
  if v_wallet_full then
    v_method := 'wallet';
  end if;

  -- COD rules (US-05/US-06): cap + vendor-shipped — decided here, server-side
  if v_method = 'cod' then
    if v_vendor_mode then
      return jsonb_build_object('ok', false, 'reason', 'cod_vendor_ship');
    end if;
    if coalesce((select (s.value->>'cod_enabled')::boolean from public.settings s where s.key = 'payments'), true) = false then
      return jsonb_build_object('ok', false, 'reason', 'cod_disabled');
    end if;
    if v_total - v_wallet_paid > v_cod_cap then
      return jsonb_build_object('ok', false, 'reason', 'cod_cap', 'cap_piastres', v_cod_cap);
    end if;
  end if;

  -- shipment number ETS-YY-### — one per order, assigned exactly once
  v_yy := (extract(year from now())::integer % 100)::smallint;
  insert into public.order_sequences (year, last_seq) values (v_yy, 0)
    on conflict (year) do nothing;
  update public.order_sequences set last_seq = last_seq + 1
    where year = v_yy returning last_seq into v_seq;
  v_number := 'ETS-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 3, '0');

  v_order_status := case when v_method = 'cod' then 'processing'::text
                         when v_vendor_mode then 'on_hold'
                         when v_wallet_full then 'processing'
                         else 'pending_payment' end;

  insert into public.orders (number, attempt_key, user_id, email,
      phone_primary, phone_alternate, ship_name, governorate_id, area_id,
      address1, address2, postal_code, status, payment_method, payment_status,
      subtotal_piastres, discount_piastres, shipping_fee_piastres, total_piastres,
      wallet_paid_piastres,
      coupon_id, coupon_code,
      -- L-20 delivery pin (optional; Egypt-bounds CHECKs guard values;
      -- coordinates are ADMIN/CARRIER-only — vendor snapshots never select them)
      shipping_lat, shipping_lng, shipping_geo_accuracy_m)
  values (v_number, v_attempt, v_uid, v_profile.email,
      v_addr->>'phone_primary', v_addr->>'phone_alternate', v_addr->>'full_name',
      (v_addr->>'governorate_id')::smallint, (v_addr->>'area_id')::bigint,
      v_addr->>'address1', nullif(trim(coalesce(v_addr->>'address2', '')), ''),
      nullif(trim(coalesce(v_addr->>'postal_code', '')), ''),
      -- pin (only when both coordinates are numeric and inside Egypt)
      v_order_status, v_method,
      case when v_wallet_full then 'paid' when v_method = 'cod' then 'cod_pending' else 'unpaid' end,
      v_subtotal, v_discount + v_cd_discount, v_shipping, v_total,
      v_wallet_paid,
      case when v_coupon_row.id is not null then v_coupon_row.id end,
      trim(coalesce(v_coupon_code, '')
        || case when v_coupon_row.type = 'commission_percent'
                and coalesce(v_coupon_row.pairs_with, '') <> '' then '+' || v_coupon_row.pairs_with else '' end),
      -- L-20 delivery pin (optional; Egypt-bounds CHECKs guard the values;
      -- coordinates are ADMIN/CARRIER-only — vendor snapshots never select them)
      case when jsonb_typeof(v_addr->'lat') = 'number'
           and jsonb_typeof(v_addr->'lng') = 'number'
           and (v_addr->>'lat')::double precision between 21.0 and 31.8
           and (v_addr->>'lng')::double precision between 24.0 and 37.0
          then (v_addr->>'lat')::double precision end,
      case when jsonb_typeof(v_addr->'lat') = 'number'
           and jsonb_typeof(v_addr->'lng') = 'number'
           and (v_addr->>'lat')::double precision between 21.0 and 31.8
           and (v_addr->>'lng')::double precision between 24.0 and 37.0
          then (v_addr->>'lng')::double precision end,
      case when jsonb_typeof(v_addr->'geo_accuracy') = 'number'
           and (v_addr->>'geo_accuracy')::int between 1 and 5000
          then (v_addr->>'geo_accuracy')::int end)
  returning id into v_order_id;

  -- one group per vendor; commission from the vendor's level rewards (bps)
  foreach v_vid in array v_vendor_ids loop
    v_group_subtotal := 0; v_group_discount := 0; v_group_commission := 0;
    select coalesce((vl.rewards->>'commission_percent')::numeric, 5) into v_rate
      from public.vendors v left join public.vendor_levels vl on vl.id = v.level_id
      where v.id = v_vid;
    v_commission_bps := round(coalesce(v_rate, 5) * 100)::integer;

    insert into public.order_vendor_groups (order_id, vendor_id, status,
        shipping_mode, vendor_ship_status)
    values (v_order_id, v_vid,
        case when v_method = 'cod' then 'preparing' else 'pending' end,
        case when exists (
          select 1 from jsonb_array_elements(v_rows) e
          where (e->>'vendor_id')::uuid = v_vid and (e->>'shipping_mode') = 'vendor'
        ) then 'vendor' else 'platform' end,
        case when exists (
          select 1 from jsonb_array_elements(v_rows) e
          where (e->>'vendor_id')::uuid = v_vid and (e->>'shipping_mode') = 'vendor'
        ) then 'pending_admin' else 'not_required' end)
    returning id into v_group_id;

    for v_it in select je as ln from jsonb_array_elements(v_rows) je where (je->>'vendor_id')::uuid = v_vid loop
      v_row := v_it.ln;
      declare
        v_line_total integer := (v_row->>'unit')::integer * (v_row->>'qty')::integer;
        v_line_discount integer := coalesce((v_row->>'coupon_discount')::integer, 0);
        v_line_cd integer := coalesce((v_row->>'cd_discount')::integer, 0);
        -- commission on the price after the PRODUCT discount; the
        -- commission-funded coupon eats FROM that commission (vendor keeps
        -- the full net line — VO-22)
        -- H-08: the LEAF's effective percent (its own row, else the nearest
        -- ancestor override) beats the vendor level default for THIS line
        v_line_bps integer := coalesce(
          (select round(public.fn_vendor_line_commission((v_row->>'vendor_id')::uuid, (v_row->>'leaf_category_id')::uuid) * 100)::integer),
          v_commission_bps,
          500
        );
        v_commission integer := greatest(
          trunc((v_line_total - v_line_discount) * v_line_bps / 10000)::integer
            - v_line_cd, 0);
      begin
        insert into public.order_items (order_id, group_id, vendor_id, variant_id,
            product_id, leaf_category_id, product_name_ar, product_name_en,
            option_key, sku, image_path, unit_price_piastres, qty,
            line_total_piastres, coupon_discount_piastres, commission_piastres,
            commission_rate_bps, is_fragile)
        values (v_order_id, v_group_id, v_vid, (v_row->>'variant_id')::uuid,
            (v_row->>'product_id')::uuid, (v_row->>'leaf_category_id')::uuid,
            coalesce(v_row->>'name_ar', ''), coalesce(v_row->>'name_en', ''),
            coalesce(v_row->>'option_key', ''), v_row->>'sku', v_row->>'image_path',
            (v_row->>'unit')::integer, (v_row->>'qty')::integer,
            v_line_total, v_line_discount + v_line_cd, v_commission, v_line_bps,
            coalesce((v_row->>'is_fragile')::boolean, false));

        v_group_subtotal := v_group_subtotal + v_line_total;
        v_group_discount := v_group_discount + v_line_discount + v_line_cd;
        v_group_commission := v_group_commission + v_commission;

        -- stock decrement (variant rows are locked above)
        update public.variants set stock = stock - (v_row->>'qty')::integer
          where id = (v_row->>'variant_id')::uuid;
      end;
    end loop;

    update public.order_vendor_groups
      set items_subtotal_piastres = v_group_subtotal,
          discount_piastres = v_group_discount,
          commission_piastres = v_group_commission
      where id = v_group_id;
  end loop;

  -- coupon redemption (counts toward max_uses inside the transaction)
  if v_coupon_row.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id)
    values (v_coupon_row.id, v_uid, v_order_id);
  end if;

  -- purchased lines leave the cart
  delete from public.cart_items where user_id = v_uid;

  -- the wallet part is taken inside this transaction (gift lots first)
  if v_wallet_paid > 0 then
    v_wallet_res := public.fn_wallet_spend(v_uid, v_wallet_paid, v_order_id,
      'order:' || v_order_id::text);
    if not coalesce((v_wallet_res->>'ok')::boolean, false) then
      raise exception 'wallet_spend_failed:%', coalesce(v_wallet_res->>'reason', 'unknown');
    end if;
  end if;

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order_id, v_order_status,
          case when v_wallet_full then 'payment_confirmed_wallet' else 'order_created' end, v_uid);

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'number', v_number,
    'payment_method', v_method, 'status', v_order_status, 'wallet_paid_piastres', v_wallet_paid);
exception
  when others then
    -- transaction rolls back automatically; surface the real cause
    return jsonb_build_object('ok', false, 'reason', 'server_error',
      'detail', sqlerrm);
end $function$;

-- ----------------------------------------------------------------------------
-- 12) FN_CONFIRM_PAYMENT — latest body (20261104000023) + compare the card
--     amount with the non-wallet remainder.
-- ----------------------------------------------------------------------------
drop function if exists public.fn_confirm_payment(text, text, text, integer, jsonb);
CREATE OR REPLACE FUNCTION public.fn_confirm_payment(p_number text, p_provider_ref text, p_status text, p_amount_piastres integer, p_raw jsonb, p_mode text DEFAULT 'live'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order orders%rowtype;
  v_paid boolean;
  v_new_status text;
  v_ref text := coalesce(nullif(trim(p_provider_ref), ''), 'missing');
  v_due integer;
begin
  select * into v_order from public.orders where number = p_number for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if coalesce(p_mode, 'live') <> v_order.payment_mode then
    return jsonb_build_object('ok', false, 'reason', 'mode_mismatch');
  end if;

  -- idempotency on provider_ref (US-08: identical ref processed once)
  select exists (
    select 1 from public.payments
    where provider = 'kashier' and provider_ref = v_ref and status = 'succeeded'
  ) into v_paid;
  if v_paid then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  -- a later failure for an order that is already paid changes nothing
  if p_status = 'failed' and v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  -- the card pays only what the wallet did not cover
  v_due := v_order.total_piastres - coalesce(v_order.wallet_paid_piastres, 0);
  if p_amount_piastres is not null and p_amount_piastres <> v_due then
    insert into public.payments (order_id, provider, provider_ref, amount_piastres,
        status, raw_payload, processed_at, mode)
    values (v_order.id, 'kashier', v_ref, p_amount_piastres, 'failed',
        jsonb_build_object('reason', 'amount_mismatch', 'expected', v_due,
                           'webhook', coalesce(p_raw, '{}'::jsonb)), now(), v_order.payment_mode);
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;

  insert into public.payments (order_id, provider, provider_ref, amount_piastres,
      status, raw_payload, processed_at, mode)
  values (v_order.id, 'kashier', v_ref, v_due, p_status,
      coalesce(p_raw, '{}'::jsonb), now(), v_order.payment_mode);

  if p_status = 'succeeded' then
    v_new_status := case when v_order.status = 'pending_payment'
      and exists (select 1 from public.order_vendor_groups g
                  where g.order_id = v_order.id and g.vendor_ship_status = 'pending_admin')
      then 'on_hold'::text
      when v_order.status = 'pending_payment' then 'processing'
      else v_order.status end;
    update public.orders
      set payment_status = 'paid', status = v_new_status, updated_at = now()
      where id = v_order.id;
    insert into public.order_status_history (order_id, status, note)
    values (v_order.id, v_new_status, case when v_order.payment_mode = 'test' then 'payment_confirmed_test' else 'payment_confirmed' end);
    perform public.fn_notify(v_order.user_id, 'payment_success', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم تأكيد الدفع', 'body', 'تم استلام دفعة الطلب ' || v_order.number),
      'en', jsonb_build_object('title', 'Payment confirmed', 'body', 'Payment received for order ' || v_order.number),
      'link', '/account/orders/' || v_order.number));
  else
    insert into public.order_status_history (order_id, status, note)
    values (v_order.id, v_order.status, 'payment_failed');
    perform public.fn_notify(v_order.user_id, 'payment_failed', jsonb_build_object(
      'ar', jsonb_build_object('title', 'فشل الدفع', 'body', 'فشل دفع الطلب ' || v_order.number || ' — يمكنك إعادة المحاولة'),
      'en', jsonb_build_object('title', 'Payment failed', 'body', 'Payment failed for order ' || v_order.number || ' — you can retry'),
      'link', '/account/orders/' || v_order.number));
  end if;

  return jsonb_build_object('ok', true, 'idempotent', false);
end $function$;
revoke all on function public.fn_confirm_payment(text, text, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_confirm_payment(text, text, text, integer, jsonb, text) to service_role;

-- ----------------------------------------------------------------------------
-- 13) FN_CANCEL_ORDER (customer) — latest body (20261031000007) + the wallet
--     part back to the wallet, plus a refund request for the card part.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancel_order(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_order orders%rowtype;
  it record;
  v_card_paid integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select * into v_order from public.orders where id = p_order_id and user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_order.status not in ('pending_payment', 'processing', 'on_hold') then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;
  if exists (select 1 from public.order_vendor_groups g
             where g.order_id = v_order.id
               and g.status not in ('pending', 'preparing')) then
    return jsonb_build_object('ok', false, 'reason', 'already_shipping');
  end if;

  -- restore stock
  for it in select variant_id, qty from public.order_items where order_id = v_order.id loop
    update public.variants set stock = stock + it.qty where id = it.variant_id;
  end loop;

  -- release the coupon redemption (cancelled orders don't consume uses)
  delete from public.coupon_redemptions where order_id = v_order.id;

  update public.orders
    set status = 'cancelled', cancel_reason = left(trim(p_reason), 500),
        cancelled_at = now(), updated_at = now()
    where id = v_order.id;
  update public.order_vendor_groups
    set status = 'cancelled', cancelled_at = now()
    where order_id = v_order.id and status in ('pending', 'preparing');

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order.id, 'cancelled', left(trim(p_reason), 500), v_uid);

  -- customer wallet: the wallet part goes straight back; a card part that
  -- was already paid opens an approved refund the admin settles (wallet or card)
  if coalesce(v_order.wallet_paid_piastres, 0) > 0 then
    perform public.fn_wallet_restore(v_order.id, 'order_cancelled');
  end if;
  v_card_paid := case when v_order.payment_status = 'paid'
                      then greatest(v_order.total_piastres - coalesce(v_order.wallet_paid_piastres, 0), 0)
                      else 0 end;
  if v_card_paid > 0
     and not exists (select 1 from public.refund_requests rr
                      where rr.order_id = v_order.id and rr.source = 'cancel') then
    insert into public.refund_requests (order_id, user_id, kind, description, evidence,
        status, source, logistics_status, refund_total_piastres,
        decided_at, decision_note, created_by)
    values (v_order.id, v_order.user_id, 'return',
        left('إلغاء الطلب ' || v_order.number || ' — ' || coalesce(trim(p_reason), ''), 2000),
        '[]'::jsonb, 'approved', 'cancel', 'not_required', v_card_paid,
        now(), 'card part of a cancelled order', auth.uid());
  end if;
  perform public.fn_notify(v_order.user_id, 'order_cancelled', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم إلغاء الطلب', 'body', 'تم إلغاء الطلب ' || v_order.number),
    'en', jsonb_build_object('title', 'Order cancelled', 'body', 'Order ' || v_order.number || ' was cancelled'),
    'link', '/account/orders/' || v_order.number));

  return jsonb_build_object('ok', true);
end $function$;

-- ----------------------------------------------------------------------------
-- 14) FN_CANCEL_ORDER_ADMIN — latest body (20261103000001) + wallet restore
--     and the same card-part refund request.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancel_order_admin(p_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old text; r record; v_order public.orders%rowtype; v_card_paid integer;
begin
  if not public.has_permission('orders.approve') then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  v_old := v_order.status;
  if v_old in ('completed','cancelled') then raise exception 'not_cancellable'; end if;
  update public.orders set status = 'cancelled', cancel_reason = p_reason,
    cancelled_at = now(), updated_at = now() where id = p_order_id;
  insert into public.order_status_history (order_id, status, actor, note)
  values (p_order_id, 'cancelled', auth.uid(), p_reason);
  update public.order_vendor_groups set status = 'cancelled', cancel_reason = p_reason,
    cancelled_at = now() where order_id = p_order_id and status not in ('delivered');
  for r in
    select oi.variant_id, oi.qty from public.order_items oi where oi.order_id = p_order_id
  loop
    update public.variants set stock = stock + r.qty where id = r.variant_id;
  end loop;
  -- customer wallet: the wallet part goes straight back; a card part that
  -- was already paid opens an approved refund the admin settles (wallet or card)
  if coalesce(v_order.wallet_paid_piastres, 0) > 0 then
    perform public.fn_wallet_restore(p_order_id, 'order_cancelled_admin');
  end if;
  v_card_paid := case when v_order.payment_status = 'paid'
                      then greatest(v_order.total_piastres - coalesce(v_order.wallet_paid_piastres, 0), 0)
                      else 0 end;
  if v_card_paid > 0
     and not exists (select 1 from public.refund_requests rr
                      where rr.order_id = p_order_id and rr.source = 'cancel') then
    insert into public.refund_requests (order_id, user_id, kind, description, evidence,
        status, source, logistics_status, refund_total_piastres,
        decided_at, decision_note, created_by)
    values (p_order_id, v_order.user_id, 'return',
        left('إلغاء الطلب ' || v_order.number || ' — ' || coalesce(trim(p_reason), ''), 2000),
        '[]'::jsonb, 'approved', 'cancel', 'not_required', v_card_paid,
        now(), 'card part of a cancelled order', auth.uid());
  end if;
end $function$;

-- ----------------------------------------------------------------------------
-- 15) FN_ADMIN_EXECUTE_REFUND — latest body (20261104000017) + the
--     'store_wallet' method (refund_credit / cancel_credit into the refund
--     bucket, reference 'refund:<request id>').
-- ----------------------------------------------------------------------------
drop function if exists public.fn_admin_execute_refund(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.fn_admin_execute_refund(p_request_id uuid, p_note text DEFAULT NULL::text, p_method text DEFAULT 'original'::text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_refunded bigint;
  v_wallet_res jsonb;
begin
  if not public.has_permission('refunds.manage') then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_req from public.refund_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_req.status = 'refunded' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_req.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if v_req.logistics_status = 'awaiting_return' then
    return jsonb_build_object('ok', false, 'reason', 'awaiting_return');
  end if;
  if coalesce(p_method, '') not in ('original', 'bank_transfer', 'wallet', 'cash', 'other', 'store_wallet') then
    return jsonb_build_object('ok', false, 'reason', 'bad_method');
  end if;
  update public.refund_requests set status = 'refunded', executed_at = now(), executed_by = auth.uid(),
         execution_note = nullif(trim(coalesce(p_note, '')), ''),
         refund_method = p_method, refund_reference = nullif(trim(coalesce(p_reference, '')), '')
   where id = p_request_id;
  -- refund into the customer's wallet (refund balance, never expires)
  if p_method = 'store_wallet' and v_req.refund_total_piastres > 0 then
    v_wallet_res := public.fn_wallet_post(
      v_req.user_id, 'refund',
      case when v_req.source = 'cancel' then 'cancel_credit' else 'refund_credit' end,
      v_req.refund_total_piastres, 'refund:' || v_req.id::text,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'refund'),
      v_req.order_id, v_req.id, null, '{}'::jsonb);
    if not coalesce((v_wallet_res->>'ok')::boolean, false) then
      raise exception 'wallet_failed:%', coalesce(v_wallet_res->>'reason', 'unknown');
    end if;
    perform public.fn_notify(v_req.user_id, 'wallet_credited', jsonb_build_object(
      'ar', jsonb_build_object('title', 'رصيد في محفظتك',
        'body', 'أضيف ' || round(v_req.refund_total_piastres / 100.0, 2) || ' ج.م إلى محفظتك'),
      'en', jsonb_build_object('title', 'Money added to your wallet',
        'body', 'EGP ' || round(v_req.refund_total_piastres / 100.0, 2) || ' was added to your wallet balance'),
      'link', '/account/wallet'));
  end if;
  select * into v_order from public.orders where id = v_req.order_id for update;
  select coalesce(sum(refund_total_piastres), 0) into v_refunded
    from public.refund_requests where order_id = v_order.id and status = 'refunded';
  update public.orders set payment_status = case when v_refunded >= v_order.total_piastres then 'refunded'
                                                 else 'partially_refunded' end, updated_at = now()
   where id = v_order.id and v_refunded > 0;
  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order.id, v_order.status, 'refund_executed', auth.uid());
  perform public.fn_refund_event(p_request_id, 'refunded', p_note,
    jsonb_build_object('method', p_method, 'reference', p_reference, 'amount_piastres', v_req.refund_total_piastres));
  perform public.fn_audit('refund.executed', 'refund_requests', p_request_id::text,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'refunded', 'method', p_method, 'reference', p_reference,
                       'amount_piastres', v_req.refund_total_piastres));
  perform public.fn_notify(v_order.user_id, 'refund_executed', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم رد المبلغ', 'body', 'تم رد ' || round(v_req.refund_total_piastres / 100.0, 2) || ' ج.م — الطلب ' || v_order.number),
    'en', jsonb_build_object('title', 'Refund issued', 'body', 'EGP ' || round(v_req.refund_total_piastres / 100.0, 2) || ' refunded — order ' || v_order.number),
    'link', '/account/returns'));
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.fn_admin_execute_refund(uuid, text, text, text) from public, anon;
grant execute on function public.fn_admin_execute_refund(uuid, text, text, text) to authenticated;

commit;
