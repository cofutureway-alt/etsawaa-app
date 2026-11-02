-- ============================================================================
-- Phase 02 — M-17 QA seed: sample category tree (fashion / electronics / home),
-- 2 levels each. DISABLED BY DEFAULT: only runs when settings key
-- 'qa.seed_catalog' is true. Idempotent (slug-guarded). The disable section
-- removes the QA rows by their slug prefix without touching real data.
-- Run manually as postgres; do NOT apply in normal migrations.
-- ============================================================================

do $$
declare
  v_enabled boolean;
  v_fashion uuid; v_electronics uuid; v_home uuid;
begin
  select coalesce((value->>'enabled')::boolean, false) into v_enabled
    from public.settings where key = 'qa.seed_catalog';

  if v_enabled is not true then
    raise notice 'qa seed disabled (settings.qa.seed_catalog != true) — nothing done';
    return;
  end if;

  -- parents (slug prefix qa- marks every QA row)
  insert into public.categories (slug_ar, slug_en, name_ar, name_en, is_active, show_in_header)
  values ('qa-fashion', 'qa-fashion', 'أزياء', 'Fashion', true, false)
  on conflict do nothing;
  select id into v_fashion from public.categories where slug_en = 'qa-fashion';

  insert into public.categories (slug_ar, slug_en, name_ar, name_en, is_active, show_in_header)
  values ('qa-electronics', 'qa-electronics', 'إلكترونيات', 'Electronics', true, false)
  on conflict do nothing;
  select id into v_electronics from public.categories where slug_en = 'qa-electronics';

  insert into public.categories (slug_ar, slug_en, name_ar, name_en, is_active, show_in_header)
  values ('qa-home', 'qa-home', 'المنزل', 'Home', true, false)
  on conflict do nothing;
  select id into v_home from public.categories where slug_en = 'qa-home';

  -- children (level 2)
  insert into public.categories (parent_id, slug_ar, slug_en, name_ar, name_en, is_active)
  values
    (v_fashion, 'qa-men', 'qa-men', 'رجالي', 'Men', true),
    (v_fashion, 'qa-women', 'qa-women', 'نسائي', 'Women', true),
    (v_electronics, 'qa-phones', 'qa-phones', 'هواتف', 'Phones', true),
    (v_electronics, 'qa-laptops', 'qa-laptops', 'لابتوبات', 'Laptops', true),
    (v_home, 'qa-furniture', 'qa-furniture', 'أثاث', 'Furniture', true),
    (v_home, 'qa-kitchen', 'qa-kitchen', 'مطبخ', 'Kitchen', true)
  on conflict do nothing;

  raise notice 'qa seed applied';
end $$;

-- Disable / clean: set qa.seed_catalog.enabled=false then run:
--   delete from public.categories where slug_en like 'qa-%';
-- Real (non-QA) rows are never touched: the prefix guard is the toggle.
