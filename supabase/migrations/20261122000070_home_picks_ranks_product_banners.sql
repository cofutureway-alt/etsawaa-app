-- 2026-11-22 (owner request)
-- 1. Home placement picked by the reviewer: while reviewing a product the
--    admin chooses the home sections it appears in and whether it is
--    "featured", with an optional period, no ad package needed.
-- 2. Rank rules: nobody changes their own role, permissions or status, and
--    nobody touches someone of the same or a higher rank (admins included:
--    one admin cannot demote, ban or delete another).
-- 3. A banner slot on the product page (carousel under "Shipping details"),
--    filled from the banners manager or by approving a bought ad.

-- ── 1. home picks
create table if not exists public.product_home_picks (
  product_id uuid not null references public.products(id) on delete cascade,
  section text not null check (section in ('featured', 'best', 'discounts', 'best_selling', 'top_rated', 'recent')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (product_id, section),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.product_home_picks enable row level security;
drop policy if exists product_home_picks_staff_read on public.product_home_picks;
create policy product_home_picks_staff_read on public.product_home_picks for select to authenticated
  using (public.is_admin() or public.has_permission('products.review'));

-- live picks only (the storefront reads this; no reviewer names leak)
create or replace view public.v_active_home_picks as
  select h.product_id, h.section, h.created_at
    from public.product_home_picks h
   where (h.starts_at is null or h.starts_at <= now()) and (h.ends_at is null or h.ends_at > now());
grant select on public.v_active_home_picks to anon, authenticated;

create or replace function public.fn_admin_set_home_picks(p_product uuid, p_sections text[], p_starts timestamptz default null, p_ends timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_secs text[] := coalesce(p_sections, '{}');
begin
  if not (public.is_admin() or public.has_permission('products.review')) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.products where id = p_product) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from unnest(v_secs) s where s not in ('featured', 'best', 'discounts', 'best_selling', 'top_rated', 'recent')) then
    return jsonb_build_object('ok', false, 'reason', 'bad_section');
  end if;
  if p_starts is not null and p_ends is not null and p_ends <= p_starts then return jsonb_build_object('ok', false, 'reason', 'bad_period'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('section', section, 'starts_at', starts_at, 'ends_at', ends_at)), '[]'::jsonb)
    into v_before from public.product_home_picks where product_id = p_product;
  delete from public.product_home_picks where product_id = p_product;
  insert into public.product_home_picks (product_id, section, starts_at, ends_at)
    select p_product, s, p_starts, p_ends from (select distinct unnest(v_secs) s) x;
  perform public.fn_audit('product.home_picks', 'products', p_product::text, v_before,
    jsonb_build_object('sections', to_jsonb(v_secs), 'starts_at', p_starts, 'ends_at', p_ends));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fn_admin_set_home_picks(uuid, text[], timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_admin_set_home_picks(uuid, text[], timestamptz, timestamptz) to authenticated;

-- a live "featured" pick makes the product featured (badge + first in "Our best")
do $$
declare v_def text := pg_get_viewdef('public.v_storefront_products'::regclass, true);
begin
  if position('product_home_picks' in v_def) > 0 then return; end if;
  if position('p.featured_permanent OR' in v_def) = 0 then raise exception 'v_storefront_products changed shape; featured patch not applied'; end if;
  v_def := replace(v_def, 'p.featured_permanent OR',
    'p.featured_permanent OR (EXISTS ( SELECT 1 FROM product_home_picks hp WHERE hp.product_id = p.id AND hp.section = ''featured''::text AND (hp.starts_at IS NULL OR hp.starts_at <= now()) AND (hp.ends_at IS NULL OR hp.ends_at > now()))) OR');
  execute 'create or replace view public.v_storefront_products as ' || v_def;
end $$;

-- ── 2. rank rules
create or replace function public.fn_admin_set_role(p_user_id uuid, p_new_role text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_old text; v_old_staff text; v_base text; v_staff text;
begin
  if not public.has_permission('users.edit') then
    raise exception 'not allowed: caller cannot change roles' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'not allowed: nobody changes their own role' using errcode = '42501';
  end if;
  select base, staff_role into v_base, v_staff from public.fn_resolve_role(p_new_role);
  if v_base is null then
    raise exception 'invalid role %', p_new_role;
  end if;
  select role, staff_role into v_old, v_old_staff from public.profiles where id = p_user_id;
  if not found then raise exception 'target profile not found'; end if;
  if v_old = 'admin' then
    raise exception 'not allowed: an admin role cannot be changed by another admin' using errcode = '42501';
  end if;
  if (v_old in ('admin', 'staff') or v_base in ('admin', 'staff')) and not public.is_admin() then
    raise exception 'not allowed: only an admin can change admin or staff roles' using errcode = '42501';
  end if;
  update public.profiles set role = v_base, staff_role = v_staff, updated_at = now() where id = p_user_id;
  if v_base <> 'staff' then delete from public.user_permissions where user_id = p_user_id; end if;
  insert into public.audit_logs (actor, action, entity, entity_id, before, after)
  values (auth.uid(), 'role.change', 'profiles', p_user_id::text,
          jsonb_build_object('role', v_old, 'staff_role', v_old_staff), jsonb_build_object('role', v_base, 'staff_role', v_staff));
end $function$;

-- ban/unban and delete: an admin account is out of reach for everyone
do $$
declare v_fn text; v_src text; v_new text;
begin
  foreach v_fn in array array['fn_admin_set_user_status', 'fn_admin_delete_user'] loop
    select pg_get_functiondef(('public.' || v_fn)::regproc) into v_src;
    continue when position('admin accounts are out of reach' in v_src) > 0;
    v_new := replace(v_src,
      'if v_role in (''admin'', ''staff'') and not public.is_admin() then',
      'if v_role = ''admin'' then return jsonb_build_object(''ok'', false, ''reason'', ''higher_rank''); end if; -- admin accounts are out of reach
  if v_role in (''admin'', ''staff'') and not public.is_admin() then');
    if v_new = v_src then raise exception '% changed shape; rank patch not applied', v_fn; end if;
    execute v_new;
  end loop;
end $$;

-- per-person permissions and staff sub-roles: admins only, never on themselves
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_admin_set_user_permissions'::regproc) into v_src;
  if position('ranks: admins only' in v_src) = 0 then
    v_new := replace(v_src,
      'if not public.has_permission(''staff.manage'') then return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;',
      'if not public.is_admin() then return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if; -- ranks: admins only
  if p_user = auth.uid() then return jsonb_build_object(''ok'', false, ''reason'', ''self''); end if;');
    if v_new = v_src then raise exception 'fn_admin_set_user_permissions changed shape'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef('public.fn_admin_set_staff_role'::regproc) into v_src;
  if position('ranks: admins only' in v_src) = 0 then
    v_new := replace(v_src,
      'if not public.has_permission(''staff.manage'') then',
      'if p_user = auth.uid() or not public.is_admin() then -- ranks: admins only');
    if v_new = v_src then raise exception 'fn_admin_set_staff_role changed shape'; end if;
    execute v_new;
  end if;

  -- a staff member with staff.manage could otherwise widen the role they hold
  select pg_get_functiondef('public.fn_admin_set_role_permissions'::regproc) into v_src;
  if position('ranks: admins only' in v_src) = 0 then
    v_new := replace(v_src,
      'if not (public.is_admin() or (public.has_permission(''staff.manage'') and p_slug not in (''admin'', ''staff'', ''vendor'', ''customer''))) then',
      'if not public.is_admin() then -- ranks: admins only');
    if v_new = v_src then raise exception 'fn_admin_set_role_permissions changed shape'; end if;
    execute v_new;
  end if;
end $$;

-- ── 3. product page banners
alter table public.banners drop constraint if exists banners_placement_check;
alter table public.banners add constraint banners_placement_check check (placement = any (array['hero', 'after_brands', 'after_categories', 'after_best',
  'after_best_selling', 'after_top_rated', 'after_vendors', 'after_recent', 'bottom', 'category', 'product_page']));

insert into public.ad_placements (code, kind, name_ar, name_en, desc_ar, desc_en, needs_product, needs_image, sort, is_active)
values ('product_banner', 'banner', 'بانر في صفحة المنتج', 'Product page banner',
  'بانرك يظهر في صفحات المنتجات تحت تفاصيل الشحن. فريق المنصة بيجهّز البانر ويحدد مكانه بعد الدفع.',
  'Your banner on product pages, under the shipping details. The platform team prepares the banner and places it after payment.',
  false, false, 3, true)
on conflict (code) do nothing;

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_admin_decide_ad_order'::regproc) into v_src;
  if position('''product_page''' in v_src) > 0 then return; end if;
  v_new := replace(v_src, 'when ''category_banner'' then ''category'' else', 'when ''category_banner'' then ''category'' when ''product_banner'' then ''product_page'' else');
  v_new := replace(v_new, '''after_top_rated'', ''after_vendors'', ''after_recent'', ''bottom'', ''category'') then',
    '''after_top_rated'', ''after_vendors'', ''after_recent'', ''bottom'', ''category'', ''product_page'') then');
  if position('''product_banner'' then ''product_page''' in v_new) = 0 or position('''category'', ''product_page'') then' in v_new) = 0 then
    raise exception 'fn_admin_decide_ad_order changed shape; product banner patch not applied';
  end if;
  execute v_new;
end $$;
