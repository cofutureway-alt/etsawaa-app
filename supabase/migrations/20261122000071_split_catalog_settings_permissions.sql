-- 2026-11-22 (owner request): one permission per admin page.
-- "catalog.manage" opened six pages at once (categories, mega menu, brands,
-- tags, attributes, size types) and "settings.manage" four, so a role could
-- not show one page without the others. They become one key per page; every
-- role and per-person grant that held the old key gets all of its new keys,
-- so nobody loses or gains access today. The old keys stay accepted by the
-- database (a role saved before this keeps working) but are no longer offered.

-- ── 1. existing grants: old key → every new key
do $$
declare
  v_cat text[] := array['catalog.categories', 'catalog.mega_menu', 'catalog.brands', 'catalog.tags', 'catalog.attributes', 'catalog.size_types'];
  v_set text[] := array['settings.general', 'settings.sections', 'settings.documents', 'settings.email_templates'];
begin
  update public.roles r
     set permissions = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
            select e.x from jsonb_array_elements_text(r.permissions) e(x)
             where e.x not in ('catalog.manage', 'settings.manage')
            union select c.x from unnest(v_cat) c(x) where r.permissions ? 'catalog.manage'
            union select c.x from unnest(v_set) c(x) where r.permissions ? 'settings.manage') s)
   where r.permissions ? 'catalog.manage' or r.permissions ? 'settings.manage';

  insert into public.user_permissions (user_id, permission, granted)
    select u.user_id, k, u.granted from public.user_permissions u, unnest(v_cat) k where u.permission = 'catalog.manage'
    union all
    select u.user_id, k, u.granted from public.user_permissions u, unnest(v_set) k where u.permission = 'settings.manage'
  on conflict do nothing;
  delete from public.user_permissions where permission in ('catalog.manage', 'settings.manage');
end $$;

-- ── 2. table rules: each catalog table follows its own page
create or replace function public.has_catalog(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission('catalog.' || p_area) or public.has_permission('catalog.manage');
$$;
grant execute on function public.has_catalog(text) to anon, authenticated;

alter policy attribute_defs_read on public.attribute_defs using ((deleted_at is null) or public.has_catalog('attributes'));
alter policy attribute_defs_write_admin on public.attribute_defs using (public.has_catalog('attributes')) with check (public.has_catalog('attributes'));
alter policy attribute_options_read on public.attribute_options using ((deleted_at is null) or public.has_catalog('attributes'));
alter policy attribute_options_write_admin on public.attribute_options using (public.has_catalog('attributes')) with check (public.has_catalog('attributes'));
-- a category's attributes are set from the categories page and the attributes page
alter policy category_attributes_write_admin on public.category_attributes
  using (public.has_catalog('attributes') or public.has_catalog('categories'))
  with check (public.has_catalog('attributes') or public.has_catalog('categories'));
alter policy brand_categories_write on public.brand_categories using (public.has_catalog('brands')) with check (public.has_catalog('brands'));
alter policy brands_read_admin on public.brands using (public.has_catalog('brands'));
alter policy brands_write_admin on public.brands using (public.has_catalog('brands')) with check (public.has_catalog('brands'));
alter policy categories_read_admin on public.categories using (public.has_catalog('categories'));
alter policy categories_write_admin on public.categories using (public.has_catalog('categories')) with check (public.has_catalog('categories'));
alter policy mega_menu_art_read on public.mega_menu_art using (is_active or public.has_catalog('mega_menu'));
alter policy mega_menu_art_write on public.mega_menu_art using (public.has_catalog('mega_menu')) with check (public.has_catalog('mega_menu'));
alter policy size_type_categories_admin on public.size_type_categories using (public.has_catalog('size_types')) with check (public.has_catalog('size_types'));
alter policy size_types_admin on public.size_types using (public.has_catalog('size_types')) with check (public.has_catalog('size_types'));
alter policy tags_read_admin on public.tags using (public.has_catalog('tags'));
alter policy tags_write_admin on public.tags using (public.has_catalog('tags')) with check (public.has_catalog('tags'));

-- settings rows: readable with any settings page (saving stays admin-only in fn_admin_set_setting)
create or replace function public.has_any_settings()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission('settings.general') or public.has_permission('settings.sections')
      or public.has_permission('settings.documents') or public.has_permission('settings.email_templates')
      or public.has_permission('settings.manage');
$$;
grant execute on function public.has_any_settings() to authenticated;
alter policy settings_read_permissioned on public.settings using (public.has_any_settings());
alter policy settings_update_permissioned on public.settings using (public.has_any_settings()) with check (public.has_any_settings());
alter policy settings_write_permissioned on public.settings with check (public.has_any_settings());
alter policy settings_delete_permissioned on public.settings using (public.has_any_settings());

-- ── 3. functions
do $$
declare v_fn text; v_area text; v_src text; v_new text;
begin
  for v_fn, v_area in values ('fn_attribute_usage', 'attributes'), ('fn_attribute_option_usage', 'attributes'),
      ('fn_admin_leaf_page', 'attributes'), ('fn_admin_review_template', 'attributes'),
      ('fn_admin_accept_brand', 'brands'), ('fn_admin_reject_brand', 'brands') loop
    select pg_get_functiondef(('public.' || v_fn)::regproc) into v_src;
    continue when position('catalog.manage' in v_src) = 0;
    v_new := replace(v_src, 'public.has_permission(''catalog.manage'')', 'public.has_catalog(''' || v_area || ''')');
    if v_new = v_src then raise exception '% changed shape; permission split not applied', v_fn; end if;
    execute v_new;
  end loop;
end $$;
