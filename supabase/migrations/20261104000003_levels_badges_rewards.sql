-- ============================================================================
-- Levels & badges: goals, rewards, automatic evaluation
--
-- Levels (vendor_levels) and badges share one goal model
-- (achievement_goals): every goal of a level/badge must be met.
--   successful_orders  delivered vendor groups              ≥ target
--   ratings            published reviews rated ≥ min_rating  ≥ target
--   withdrawals        approved withdrawal requests          ≥ target
--   products           approved, live products               ≥ target
--   membership         time since the store was approved     ≥ target days/months/years
-- A level/badge with no goals is reached by everyone (entry level).
--
-- Level rewards (level_rewards), several per level:
--   ad_package            one-time ad campaign when the level is reached
--                         (an existing package, or a reward-only package —
--                         ad_packages.visibility = 'rewards')
--   featured_products     the seller may pin N of their products to the home
--                         page "featured" block while at this level
--   commission_reduction  percentage points off the seller's commission in
--                         every category while at this level (15% − 1 = 14%)
--
-- fn_evaluate_vendor_achievements() awards badges and promotes (never
-- demotes) a store to the highest level whose goals it meets; it runs hourly
-- via pg_cron and on demand from the admin pages.
--
-- Also fixes order commission: per-store category overrides
-- (vendor_commission_overrides) and the store's fixed mode were stored but
-- fn_create_order only ever used the category rate or the level default.
-- fn_vendor_line_commission() is now the single source:
--   store override for the leaf (deepest ancestor) → store fixed rate →
--   category rate → level base rate → 5%, minus the level's reduction.
--
-- And closes SEC-03 from the remediation plan: direct client writes may not
-- touch platform-owned product columns (now including featured_by_vendor).
-- ============================================================================
begin;

-- ── levels: presentation fields ─────────────────────────────────────────────
alter table public.vendor_levels
  add column if not exists description_ar text not null default '',
  add column if not exists description_en text not null default '',
  add column if not exists color text not null default '#C8102E';
update public.vendor_levels set icon = 'sprout' where icon is null or icon = '';

-- ── badges ──────────────────────────────────────────────────────────────────
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  description_ar text not null default '',
  description_en text not null default '',
  icon text not null default 'award',
  color text not null default '#C8102E',
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint badges_color_check check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.vendor_badges (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (vendor_id, badge_id)
);
create index if not exists vendor_badges_badge_idx on public.vendor_badges (badge_id);

-- ── goals (levels + badges) ─────────────────────────────────────────────────
create table if not exists public.achievement_goals (
  id uuid primary key default gen_random_uuid(),
  level_id uuid references public.vendor_levels(id) on delete cascade,
  badge_id uuid references public.badges(id) on delete cascade,
  goal_type text not null,
  target integer not null,
  min_rating numeric(2,1),
  duration_unit text,
  sort integer not null default 0,
  constraint achievement_goals_owner_check check ((level_id is null) <> (badge_id is null)),
  constraint achievement_goals_type_check check (goal_type in ('successful_orders', 'ratings', 'withdrawals', 'products', 'membership')),
  constraint achievement_goals_target_check check (target > 0),
  constraint achievement_goals_rating_check check (min_rating is null or (min_rating >= 1 and min_rating <= 5)),
  constraint achievement_goals_unit_check check (
    (goal_type = 'membership' and duration_unit in ('days', 'months', 'years'))
    or (goal_type <> 'membership' and duration_unit is null))
);
create index if not exists achievement_goals_level_idx on public.achievement_goals (level_id);
create index if not exists achievement_goals_badge_idx on public.achievement_goals (badge_id);

-- the old single threshold becomes a goal row
insert into public.achievement_goals (level_id, goal_type, target)
select l.id, 'successful_orders', l.min_successful_orders
from public.vendor_levels l
where l.min_successful_orders > 0
  and not exists (select 1 from public.achievement_goals g where g.level_id = l.id);

-- ── level rewards ───────────────────────────────────────────────────────────
alter table public.ad_packages drop constraint if exists ad_packages_visibility_check;
alter table public.ad_packages add constraint ad_packages_visibility_check
  check (visibility in ('vendors', 'admins', 'rewards'));

create table if not exists public.level_rewards (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.vendor_levels(id) on delete cascade,
  reward_type text not null,
  ad_package_id uuid references public.ad_packages(id) on delete restrict,
  featured_count integer,
  commission_reduction numeric(5,2),
  sort integer not null default 0,
  constraint level_rewards_type_check check (reward_type in ('ad_package', 'featured_products', 'commission_reduction')),
  constraint level_rewards_fields_check check (
    (reward_type = 'ad_package' and ad_package_id is not null)
    or (reward_type = 'featured_products' and featured_count between 1 and 50)
    or (reward_type = 'commission_reduction' and commission_reduction > 0 and commission_reduction <= 100))
);
create index if not exists level_rewards_level_idx on public.level_rewards (level_id);

-- one-time grants (ad packages) — a log, so editing a level never re-grants
create table if not exists public.level_reward_grants (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  level_id uuid not null references public.vendor_levels(id) on delete cascade,
  reward_id uuid references public.level_rewards(id) on delete set null,
  campaign_id uuid references public.ad_campaigns(id) on delete set null,
  granted_at timestamptz not null default now()
);
create unique index if not exists level_reward_grants_once on public.level_reward_grants (vendor_id, reward_id) where reward_id is not null;

alter table public.ad_campaigns drop constraint if exists ad_campaigns_source_check;
alter table public.ad_campaigns add constraint ad_campaigns_source_check
  check (source in ('paid', 'admin_grant', 'level_reward'));

-- seller-picked home features (featured_products reward)
alter table public.products add column if not exists featured_by_vendor boolean not null default false;
create index if not exists products_featured_by_vendor_idx on public.products (vendor_id) where featured_by_vendor;

-- ── grants + RLS (new tables need explicit grants — see 20261104000000) ─────
grant select on public.badges, public.vendor_badges, public.achievement_goals, public.level_rewards to anon, authenticated;
grant insert, update, delete on public.badges, public.achievement_goals, public.level_rewards to authenticated;
grant select on public.level_reward_grants to authenticated;

alter table public.badges enable row level security;
alter table public.vendor_badges enable row level security;
alter table public.achievement_goals enable row level security;
alter table public.level_rewards enable row level security;
alter table public.level_reward_grants enable row level security;

drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select to anon, authenticated using (is_active or public.is_admin());
drop policy if exists badges_admin_write on public.badges;
create policy badges_admin_write on public.badges for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists vendor_badges_read on public.vendor_badges;
create policy vendor_badges_read on public.vendor_badges for select to anon, authenticated using (true);

drop policy if exists achievement_goals_read on public.achievement_goals;
create policy achievement_goals_read on public.achievement_goals for select to anon, authenticated using (true);
drop policy if exists achievement_goals_admin_write on public.achievement_goals;
create policy achievement_goals_admin_write on public.achievement_goals for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists level_rewards_read on public.level_rewards;
create policy level_rewards_read on public.level_rewards for select to anon, authenticated using (true);
drop policy if exists level_rewards_admin_write on public.level_rewards;
create policy level_rewards_admin_write on public.level_rewards for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists level_reward_grants_read on public.level_reward_grants;
create policy level_reward_grants_read on public.level_reward_grants for select to authenticated
  using (public.is_admin() or vendor_id = public.own_vendor_id());

-- reward-only packages stay out of the seller's purchase list
drop policy if exists ad_packages_read on public.ad_packages;
create policy ad_packages_read on public.ad_packages for select to authenticated
  using (is_active and visibility <> 'rewards');

-- ── metrics ─────────────────────────────────────────────────────────────────
create or replace function public.fn_goal_progress(p_vendor uuid, p_goal_type text, p_min_rating numeric)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case p_goal_type
    when 'successful_orders' then (select count(*)::integer from public.order_vendor_groups g
                                    where g.vendor_id = p_vendor and g.status = 'delivered')
    when 'ratings' then (select count(*)::integer from public.reviews r
                          where r.vendor_id = p_vendor and r.status = 'published'
                            and r.rating >= coalesce(p_min_rating, 1))
    when 'withdrawals' then (select count(*)::integer from public.withdrawal_requests w
                              where w.vendor_id = p_vendor and w.status = 'approved')
    when 'products' then (select count(*)::integer from public.products p
                           where p.vendor_id = p_vendor and p.status = 'approved' and p.deleted_at is null)
    when 'membership' then (select greatest(0, floor(extract(epoch from (now() - coalesce(v.reviewed_at, v.created_at))) / 86400))::integer
                             from public.vendors v where v.id = p_vendor)
    else 0
  end;
$function$;

/** target expressed in the same unit as fn_goal_progress (days for membership). */
create or replace function public.fn_goal_required(p_goal_type text, p_target integer, p_unit text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select case when p_goal_type = 'membership'
    then p_target * case p_unit when 'years' then 365 when 'months' then 30 else 1 end
    else p_target end;
$function$;

create or replace function public.fn_goals_met(p_vendor uuid, p_level uuid, p_badge uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not exists (
    select 1 from public.achievement_goals g
    where ((p_level is not null and g.level_id = p_level) or (p_badge is not null and g.badge_id = p_badge))
      and public.fn_goal_progress(p_vendor, g.goal_type, g.min_rating)
          < public.fn_goal_required(g.goal_type, g.target, g.duration_unit)
  );
$function$;

-- ── level reward helpers ────────────────────────────────────────────────────
create or replace function public.fn_vendor_commission_reduction(p_vendor uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(r.commission_reduction), 0)
  from public.vendors v
  join public.level_rewards r on r.level_id = v.level_id and r.reward_type = 'commission_reduction'
  where v.id = p_vendor;
$function$;

create or replace function public.fn_vendor_featured_slots(p_vendor uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(r.featured_count), 0)::integer
  from public.vendors v
  join public.level_rewards r on r.level_id = v.level_id and r.reward_type = 'featured_products'
  where v.id = p_vendor;
$function$;

/** The commission percent for one line of this store in this leaf category. */
create or replace function public.fn_vendor_line_commission(p_vendor uuid, p_leaf uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select greatest(0, coalesce(
      (select o.percent from public.vendor_commission_overrides o
         join public.categories oc on oc.id = o.category_id
        where o.vendor_id = v.id
          and p_leaf is not null
          and public.fn_category_within(p_leaf, o.category_id)
        order by oc.depth desc
        limit 1),
      case when v.commission_mode = 'fixed' then v.commission_fixed_percent end,
      case when p_leaf is not null then public.fn_effective_commission(p_leaf) end,
      (lvl.rewards->>'commission_percent')::numeric,
      5
    ) - public.fn_vendor_commission_reduction(v.id))
  from public.vendors v
  left join public.vendor_levels lvl on lvl.id = v.level_id
  where v.id = p_vendor;
$function$;

-- the admin "effective commission" readout now agrees with what orders charge
create or replace function public.fn_vendor_effective_commission(p_vendor_id uuid, p_category_id uuid default null::uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_vendor_line_commission(p_vendor_id, coalesce(p_category_id, v.category_ids[1]))
  from public.vendors v where v.id = p_vendor_id;
$function$;

-- one-time rewards of a level (ad campaigns); featured slots and the
-- commission reduction follow the current level and need no grant
create or replace function public.fn_grant_level_rewards(p_vendor uuid, p_level uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_campaign uuid; v_pkg public.ad_packages%rowtype; v_count integer := 0;
begin
  for r in select * from public.level_rewards where level_id = p_level and reward_type = 'ad_package' loop
    continue when exists (select 1 from public.level_reward_grants g where g.vendor_id = p_vendor and g.reward_id = r.id);
    select * into v_pkg from public.ad_packages where id = r.ad_package_id;
    continue when not found;
    insert into public.ad_campaigns (package_id, vendor_id, product_id, source, status, started_at, ends_at)
    values (v_pkg.id, p_vendor,
            (select id from public.products where vendor_id = p_vendor and status = 'approved' and deleted_at is null
              order by created_at desc limit 1),
            'level_reward', 'active', now(), now() + make_interval(days => v_pkg.duration_days))
    returning id into v_campaign;
    insert into public.level_reward_grants (vendor_id, level_id, reward_id, campaign_id)
    values (p_vendor, p_level, r.id, v_campaign);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

-- ── evaluation ──────────────────────────────────────────────────────────────
create or replace function public.fn_evaluate_vendor_achievements(p_vendor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.vendors%rowtype;
  v_current_sort integer;
  v_target uuid;
  v_badges integer := 0;
  v_promoted boolean := false;
begin
  select * into v from public.vendors where id = p_vendor;
  if not found or v.status <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  with won as (
    insert into public.vendor_badges (vendor_id, badge_id)
    select p_vendor, b.id from public.badges b
    where b.is_active
      and not exists (select 1 from public.vendor_badges vb where vb.vendor_id = p_vendor and vb.badge_id = b.id)
      and public.fn_goals_met(p_vendor, null, b.id)
    on conflict do nothing
    returning badge_id
  )
  select count(*) into v_badges from won;
  if v_badges > 0 then
    perform public.fn_notify(v.owner_id, 'badge', jsonb_build_object(
      'ar', jsonb_build_object('title', 'شارة جديدة', 'body', 'حصل متجرك على شارة جديدة'),
      'en', jsonb_build_object('title', 'New badge', 'body', 'Your store earned a new badge'),
      'link', '/vendor'));
  end if;

  -- highest active level whose goals are all met; promote only upwards
  select coalesce((select sort from public.vendor_levels where id = v.level_id), -1) into v_current_sort;
  select l.id into v_target from public.vendor_levels l
  where l.is_active and l.sort > v_current_sort and public.fn_goals_met(p_vendor, l.id, null)
  order by l.sort desc limit 1;

  if v_target is not null then
    update public.vendors set level_id = v_target, updated_at = now() where id = p_vendor;
    insert into public.vendor_level_history (vendor_id, from_level, to_level, actor, reason)
    values (p_vendor, v.level_id, v_target, null, 'auto: goals reached');
    perform public.fn_grant_level_rewards(p_vendor, v_target);
    perform public.fn_notify(v.owner_id, 'level', jsonb_build_object(
      'ar', jsonb_build_object('title', 'مستوى جديد', 'body', 'تمت ترقية متجرك إلى مستوى جديد'),
      'en', jsonb_build_object('title', 'New level', 'body', 'Your store moved up a level'),
      'link', '/vendor'));
    v_promoted := true;
  end if;

  -- picks beyond the current allowance are released
  update public.products p set featured_by_vendor = false
  where p.vendor_id = p_vendor and p.featured_by_vendor
    and p.id not in (
      select id from public.products
      where vendor_id = p_vendor and featured_by_vendor
      order by updated_at desc
      limit public.fn_vendor_featured_slots(p_vendor));

  return jsonb_build_object('ok', true, 'badges', v_badges, 'promoted', v_promoted);
end
$function$;

create or replace function public.fn_evaluate_all_achievements()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_res jsonb; v_badges integer := 0; v_promoted integer := 0; v_stores integer := 0;
begin
  for r in select id from public.vendors where status = 'active' loop
    v_res := public.fn_evaluate_vendor_achievements(r.id);
    v_stores := v_stores + 1;
    v_badges := v_badges + coalesce((v_res->>'badges')::integer, 0);
    if coalesce((v_res->>'promoted')::boolean, false) then v_promoted := v_promoted + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'stores', v_stores, 'badges', v_badges, 'promoted', v_promoted);
end
$function$;

create or replace function public.fn_admin_evaluate_achievements()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return public.fn_evaluate_all_achievements();
end
$function$;

-- the old threshold-only engine now delegates
create or replace function public.fn_auto_levels()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select public.fn_evaluate_all_achievements();
$function$;

-- manual promote/demote also hands out the target level's one-time rewards
create or replace function public.fn_promote_vendor_level(p_vendor_id uuid, p_to_level uuid, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_from uuid; v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden_admin_only' using errcode = '42501';
  end if;
  select level_id, owner_id into v_from, v_owner from public.vendors where id = p_vendor_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_from = p_to_level then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  update public.vendors set level_id = p_to_level, updated_at = now() where id = p_vendor_id;
  insert into public.vendor_level_history (vendor_id, from_level, to_level, actor, reason)
  values (p_vendor_id, v_from, p_to_level, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));
  perform public.fn_grant_level_rewards(p_vendor_id, p_to_level);

  perform public.fn_notify(v_owner, 'level',
    jsonb_build_object(
      'ar', jsonb_build_object('title', 'تغيير مستوى المتجر', 'body', 'تم تحديث مستوى متجرك'),
      'en', jsonb_build_object('title', 'Store level changed', 'body', 'Your store level was updated'),
      'link', '/vendor'));

  perform public.fn_audit('vendor.level.changed', 'vendors', p_vendor_id::text,
    jsonb_build_object('level_id', v_from), jsonb_build_object('level_id', p_to_level, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $function$;

-- ── admin save (level/badge + goals + rewards in one transaction) ───────────

/**
 * p = { id?, name_ar, name_en, description_ar, description_en, icon, color,
 *       sort, is_active, base_commission_percent?, hold_days?,
 *       goals: [{goal_type, target, min_rating?, duration_unit?}],
 *       rewards: [{reward_type, ad_package_id?, featured_count?, commission_reduction?}] }
 * p_kind = 'level' | 'badge' (badges ignore rewards).
 */
create or replace function public.fn_admin_save_achievement(p_kind text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  g jsonb; r jsonb; i integer := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(trim(p->>'name_ar'), '') = '' or coalesce(trim(p->>'name_en'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_kind = 'badge' and jsonb_array_length(coalesce(p->'goals', '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'goal_required');
  end if;

  if p_kind = 'level' then
    if v_id is null then
      insert into public.vendor_levels (name_ar, name_en, description_ar, description_en, icon, color, sort, is_active, rewards)
      values (trim(p->>'name_ar'), trim(p->>'name_en'), coalesce(p->>'description_ar', ''), coalesce(p->>'description_en', ''),
              coalesce(nullif(p->>'icon', ''), 'award'), coalesce(nullif(p->>'color', ''), '#C8102E'),
              coalesce((p->>'sort')::integer, 0), coalesce((p->>'is_active')::boolean, true),
              jsonb_strip_nulls(jsonb_build_object(
                'commission_percent', (p->>'base_commission_percent')::numeric,
                'hold_days', (p->>'hold_days')::integer)))
      returning id into v_id;
    else
      update public.vendor_levels set
        name_ar = trim(p->>'name_ar'), name_en = trim(p->>'name_en'),
        description_ar = coalesce(p->>'description_ar', ''), description_en = coalesce(p->>'description_en', ''),
        icon = coalesce(nullif(p->>'icon', ''), 'award'), color = coalesce(nullif(p->>'color', ''), '#C8102E'),
        sort = coalesce((p->>'sort')::integer, sort), is_active = coalesce((p->>'is_active')::boolean, true),
        rewards = jsonb_strip_nulls(rewards || jsonb_build_object(
          'commission_percent', (p->>'base_commission_percent')::numeric,
          'hold_days', (p->>'hold_days')::integer))
      where id = v_id;
      if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    end if;
    delete from public.achievement_goals where level_id = v_id;
    delete from public.level_rewards where level_id = v_id;
  else
    if v_id is null then
      insert into public.badges (name_ar, name_en, description_ar, description_en, icon, color, sort, is_active)
      values (trim(p->>'name_ar'), trim(p->>'name_en'), coalesce(p->>'description_ar', ''), coalesce(p->>'description_en', ''),
              coalesce(nullif(p->>'icon', ''), 'award'), coalesce(nullif(p->>'color', ''), '#C8102E'),
              coalesce((p->>'sort')::integer, 0), coalesce((p->>'is_active')::boolean, true))
      returning id into v_id;
    else
      update public.badges set
        name_ar = trim(p->>'name_ar'), name_en = trim(p->>'name_en'),
        description_ar = coalesce(p->>'description_ar', ''), description_en = coalesce(p->>'description_en', ''),
        icon = coalesce(nullif(p->>'icon', ''), 'award'), color = coalesce(nullif(p->>'color', ''), '#C8102E'),
        sort = coalesce((p->>'sort')::integer, sort), is_active = coalesce((p->>'is_active')::boolean, true)
      where id = v_id;
      if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    end if;
    delete from public.achievement_goals where badge_id = v_id;
  end if;

  for g in select * from jsonb_array_elements(coalesce(p->'goals', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.achievement_goals (level_id, badge_id, goal_type, target, min_rating, duration_unit, sort)
    values (case when p_kind = 'level' then v_id end, case when p_kind = 'badge' then v_id end,
            g->>'goal_type', (g->>'target')::integer,
            case when g->>'goal_type' = 'ratings' then nullif(g->>'min_rating', '')::numeric end,
            case when g->>'goal_type' = 'membership' then coalesce(nullif(g->>'duration_unit', ''), 'days') end,
            i);
  end loop;

  if p_kind = 'level' then
    i := 0;
    for r in select * from jsonb_array_elements(coalesce(p->'rewards', '[]'::jsonb)) loop
      i := i + 1;
      insert into public.level_rewards (level_id, reward_type, ad_package_id, featured_count, commission_reduction, sort)
      values (v_id, r->>'reward_type',
              case when r->>'reward_type' = 'ad_package' then nullif(r->>'ad_package_id', '')::uuid end,
              case when r->>'reward_type' = 'featured_products' then (r->>'featured_count')::integer end,
              case when r->>'reward_type' = 'commission_reduction' then (r->>'commission_reduction')::numeric end,
              i);
    end loop;
  end if;

  perform public.fn_audit(p_kind || '.saved', case when p_kind = 'level' then 'vendor_levels' else 'badges' end,
                          v_id::text, null, p);
  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when check_violation or invalid_text_representation or not_null_violation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_goal_or_reward');
end
$function$;

-- ── seller: pick home-featured products within the level allowance ─────────
create or replace function public.fn_vendor_set_featured(p_product_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_vendor uuid := public.own_vendor_id(); v_slots integer; v_used integer;
begin
  if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.products where id = p_product_id and vendor_id = v_vendor
                 and status = 'approved' and deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_on then
    v_slots := public.fn_vendor_featured_slots(v_vendor);
    select count(*) into v_used from public.products
     where vendor_id = v_vendor and featured_by_vendor and id <> p_product_id;
    if v_used >= v_slots then
      return jsonb_build_object('ok', false, 'reason', 'no_featured_slots', 'slots', v_slots);
    end if;
  end if;
  update public.products set featured_by_vendor = p_on where id = p_product_id;
  return jsonb_build_object('ok', true);
end
$function$;

-- ── SEC-03: platform-owned product columns ──────────────────────────────────
create or replace function public.fn_products_guard_privileged()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.featured_permanent := false;
    new.featured_until     := null;
    new.featured_by_vendor := false;
    new.event_hidden       := false;
    new.published_at       := null;
    new.submitted_at       := null;
    new.rejection_reason   := null;
    new.admin_note         := null;
    new.source             := 'vendor';
    new.deleted_at         := null;
    new.created_at         := now();
  else
    new.featured_permanent := old.featured_permanent;
    new.featured_until     := old.featured_until;
    new.featured_by_vendor := old.featured_by_vendor;
    new.event_hidden       := old.event_hidden;
    new.published_at       := old.published_at;
    new.submitted_at       := old.submitted_at;
    new.rejection_reason   := old.rejection_reason;
    new.admin_note         := old.admin_note;
    new.source             := old.source;
    new.created_at         := old.created_at;
    new.vendor_id          := old.vendor_id;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_products_guard_privileged on public.products;
create trigger trg_products_guard_privileged
  before insert or update on public.products
  for each row execute function public.fn_products_guard_privileged();

-- ── function grants ─────────────────────────────────────────────────────────
revoke execute on function public.fn_goal_progress(uuid, text, numeric) from public, anon;
revoke execute on function public.fn_goals_met(uuid, uuid, uuid) from public, anon;
revoke execute on function public.fn_grant_level_rewards(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fn_evaluate_vendor_achievements(uuid) from public, anon, authenticated;
revoke execute on function public.fn_evaluate_all_achievements() from public, anon, authenticated;
revoke execute on function public.fn_auto_levels() from public, anon, authenticated;
revoke execute on function public.fn_vendor_line_commission(uuid, uuid) from public, anon;
revoke execute on function public.fn_vendor_commission_reduction(uuid) from public, anon;
revoke execute on function public.fn_products_guard_privileged() from public, anon, authenticated;
revoke execute on function public.fn_admin_evaluate_achievements() from public, anon;
revoke execute on function public.fn_admin_save_achievement(text, jsonb) from public, anon;
revoke execute on function public.fn_vendor_set_featured(uuid, boolean) from public, anon;
grant execute on function public.fn_admin_evaluate_achievements() to authenticated;
grant execute on function public.fn_admin_save_achievement(text, jsonb) to authenticated;
grant execute on function public.fn_vendor_set_featured(uuid, boolean) to authenticated;
grant execute on function public.fn_goal_progress(uuid, text, numeric) to authenticated;
grant execute on function public.fn_vendor_featured_slots(uuid) to anon, authenticated;

-- hourly evaluation
select cron.unschedule(jobid) from cron.job where jobname = 'evaluate-achievements';
select cron.schedule('evaluate-achievements', '15 * * * *', 'select public.fn_evaluate_all_achievements();');


-- ── order commission: one source (fn_vendor_line_commission) ────────────────
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
        'duplicate', true);
    end if;
  end if;

  if v_method not in ('kashier', 'cod') then
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
    from public.settings s where s.key = 'checkout';

  -- lock the cart + the variants (deterministic order avoids deadlocks)
  for r in
    select ci.variant_id, ci.qty, ci.product_id,
           v.stock, v.is_active, v.deleted_at as v_deleted, v.price_piastres,
           v.sale_price_piastres, v.option_key, v.sku, v.image_path,
           p.name_ar, p.name_en, p.status as p_status, p.deleted_at as p_deleted,
           p.shipping_mode, p.is_fragile, p.leaf_category_id, p.brand_id,
           p.vendor_id, p.sale_starts_at, p.sale_ends_at, p.event_hidden
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

  -- COD rules (US-05/US-06): cap + vendor-shipped — decided here, server-side
  if v_method = 'cod' then
    if v_vendor_mode then
      return jsonb_build_object('ok', false, 'reason', 'cod_vendor_ship');
    end if;
    if v_total > v_cod_cap then
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
                         else 'pending_payment' end;

  insert into public.orders (number, attempt_key, user_id, email,
      phone_primary, phone_alternate, ship_name, governorate_id, area_id,
      address1, address2, postal_code, status, payment_method, payment_status,
      subtotal_piastres, discount_piastres, shipping_fee_piastres, total_piastres,
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
      case when v_method = 'cod' then 'cod_pending' else 'unpaid' end,
      v_subtotal, v_discount + v_cd_discount, v_shipping, v_total,
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

  insert into public.order_status_history (order_id, status, note, actor)
  values (v_order_id, v_order_status, 'order_created', v_uid);

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'number', v_number,
    'payment_method', v_method, 'status', v_order_status);
exception
  when others then
    -- transaction rolls back automatically; surface the real cause
    return jsonb_build_object('ok', false, 'reason', 'server_error',
      'detail', sqlerrm);
end $function$;

-- ── storefront: seller-picked features count as featured ────────────────────
create or replace view public.v_storefront_products as
SELECT p.id,
    p.slug_ar,
    p.slug_en,
    p.name_ar,
    p.name_en,
    p.short_ar,
    p.short_en,
    p.leaf_category_id,
    cat.name_ar AS category_name_ar,
    cat.name_en AS category_name_en,
    cat.slug_ar AS category_slug_ar,
    cat.slug_en AS category_slug_en,
    p.brand_id,
    b.name_ar AS brand_name_ar,
    b.name_en AS brand_name_en,
    p.vendor_id,
    v.slug AS vendor_slug,
    v.store_name_ar,
    v.store_name_en,
    v.logo_path AS vendor_logo_path,
    lvl.name_ar AS level_name_ar,
    lvl.name_en AS level_name_en,
    lvl.icon AS level_icon,
    img.path AS main_image_path,
    pr.min_price_piastres,
    pr.min_sale_price_piastres,
    pr.has_sale,
    GREATEST(COALESCE(evp.percent, 0), COALESCE(evc.percent, 0)) AS event_percent,
        CASE
            WHEN (COALESCE(evp.percent, 0) >= COALESCE(evc.percent, 0)) THEN evp.max_piastres
            ELSE evc.max_piastres
        END AS event_max_piastres,
    st.stock_total,
    r.rating_avg,
    r.rating_count,
    (p.featured_permanent OR ((p.featured_until IS NOT NULL) AND (p.featured_until > now())) OR (p.featured_by_vendor AND (public.fn_vendor_featured_slots(p.vendor_id) > 0))) AS is_featured,
    p.event_hidden AS is_event_hidden,
    (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))) AS vendor_event_refused,
    ((NOT p.event_hidden) AND (NOT (EXISTS ( SELECT 1
           FROM v_active_event_vendors aev
          WHERE ((aev.vendor_id = v.id) AND (aev.status = 'refused'::text)))))) AS is_listable,
    p.published_at,
    p.created_at
   FROM ((((((((((products p
     JOIN vendors v ON ((v.id = p.vendor_id)))
     LEFT JOIN categories cat ON ((cat.id = p.leaf_category_id)))
     LEFT JOIN brands b ON ((b.id = p.brand_id)))
     LEFT JOIN vendor_levels lvl ON ((lvl.id = v.level_id)))
     LEFT JOIN LATERAL ( SELECT pm.path
           FROM product_media pm
          WHERE ((pm.product_id = p.id) AND (pm.kind = 'image'::text))
          ORDER BY pm."position"
         LIMIT 1) img ON (true))
     LEFT JOIN LATERAL ( SELECT min(
                CASE
                    WHEN ((p.sale_starts_at IS NOT NULL) AND (p.sale_starts_at <= now()) AND ((p.sale_ends_at IS NULL) OR (p.sale_ends_at > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN LEAST(v2.price_piastres, v2.sale_price_piastres)
                    ELSE v2.price_piastres
                END) AS min_price_piastres,
            min(
                CASE
                    WHEN ((p.sale_starts_at IS NOT NULL) AND (p.sale_starts_at <= now()) AND ((p.sale_ends_at IS NULL) OR (p.sale_ends_at > now())) AND (v2.sale_price_piastres IS NOT NULL)) THEN v2.sale_price_piastres
                    ELSE NULL::integer
                END) AS min_sale_price_piastres,
            bool_or(((p.sale_starts_at IS NOT NULL) AND (p.sale_starts_at <= now()) AND ((p.sale_ends_at IS NULL) OR (p.sale_ends_at > now())) AND (v2.sale_price_piastres IS NOT NULL))) AS has_sale,
            min(v2.price_piastres) AS min_regular_piastres
           FROM variants v2
          WHERE ((v2.product_id = p.id) AND (v2.deleted_at IS NULL) AND v2.is_active AND (v2.price_piastres IS NOT NULL))) pr ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(v3.stock), (0)::bigint) AS stock_total
           FROM variants v3
          WHERE ((v3.product_id = p.id) AND (v3.deleted_at IS NULL) AND v3.is_active)) st ON (true))
     LEFT JOIN LATERAL ( SELECT round(avg(rw.rating), 1) AS rating_avg,
            (count(*))::integer AS rating_count
           FROM reviews rw
          WHERE ((rw.product_id = p.id) AND (rw.status = 'published'::text))) r ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'product'::text) AND (d.ref_id = p.id))
          ORDER BY d.percent DESC
         LIMIT 1) evp ON (true))
     LEFT JOIN LATERAL ( SELECT d.percent,
            d.max_discount_piastres AS max_piastres
           FROM (v_active_event_vendors aev
             JOIN event_discounts d ON ((d.event_id = aev.event_id)))
          WHERE ((aev.vendor_id = p.vendor_id) AND (aev.status = 'accepted'::text) AND (d.scope = 'category'::text) AND fn_category_within(p.leaf_category_id, d.ref_id))
          ORDER BY d.percent DESC
         LIMIT 1) evc ON (true))
  WHERE ((p.status = 'approved'::text) AND (p.deleted_at IS NULL) AND (v.status = 'active'::text) AND (v.verification_status <> 'grace_expired'::text) AND (NOT v.hidden_from_listings));

commit;
