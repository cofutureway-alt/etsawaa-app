-- Product slugs were built from the whole title: a long title (e.g. a
-- 280-character Arabic marketing sentence) produced a 287-character slug,
-- longer than the storefront's slug guard accepted, so the approved product
-- answered 404. New slugs stop at 120 characters on a word boundary; the app
-- guard now accepts up to 400 so the existing long slugs keep working.

create or replace function public.fn_product_slug(p_base text)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  v_base text;
  v_candidate text;
  v_n integer := 0;
  v_cut integer;
begin
  v_base := trim(both '-' from lower(regexp_replace(coalesce(p_base, 'product'), '[^a-zA-Z0-9؀-ۿ]+', '-', 'g')));
  if length(v_base) > 120 then
    v_base := left(v_base, 120);
    -- cut back to the last whole word when one ends past the halfway mark
    v_cut := length(v_base) - position('-' in reverse(v_base));
    if position('-' in v_base) > 0 and v_cut >= 60 then
      v_base := left(v_base, v_cut);
    end if;
    v_base := trim(both '-' from v_base);
  end if;
  v_candidate := case when v_base = '' or v_base is null then 'product' else v_base end;
  loop
    if not exists (
      select 1 from public.products
      where slug_ar = v_candidate or slug_en = v_candidate
    ) then
      return v_candidate;
    end if;
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n::text;
  end loop;
end $function$;
