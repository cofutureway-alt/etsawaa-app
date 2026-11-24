-- option_key is the variant's option ids joined with ',' (a lookup key). The
-- cart, checkout and order pages printed it as is, so a customer would read
-- "16f0765f-…,98b28c7e-…" instead of "أسود · M". These functions turn a key
-- into its readable label (colour · size/storage · RAM), and expose it on
-- variants and order_items as computed columns (option_label_ar / _en).
create or replace function public.fn_option_key_label(p_key text, p_lang text)
returns text
language sql stable set search_path = public as $$
  select string_agg(case when p_lang = 'en' then o.label_en else o.label_ar end, ' · '
                    order by case d.code when 'color' then 0 when 'size' then 1 when 'memory' then 2 else 3 end, o.sort)
    from unnest(string_to_array(nullif(p_key, ''), ',')) k
    join public.attribute_options o on o.id::text = trim(k)
    join public.attribute_defs d on d.id = o.attribute_id
   where trim(k) ~ '^[0-9a-f-]{36}$';
$$;
grant execute on function public.fn_option_key_label(text, text) to anon, authenticated;

create or replace function public.option_label_ar(public.variants) returns text
language sql stable as $$ select public.fn_option_key_label($1.option_key, 'ar') $$;
create or replace function public.option_label_en(public.variants) returns text
language sql stable as $$ select public.fn_option_key_label($1.option_key, 'en') $$;
create or replace function public.option_label_ar(public.order_items) returns text
language sql stable as $$ select public.fn_option_key_label($1.option_key, 'ar') $$;
create or replace function public.option_label_en(public.order_items) returns text
language sql stable as $$ select public.fn_option_key_label($1.option_key, 'en') $$;
grant execute on function public.option_label_ar(public.variants), public.option_label_en(public.variants),
  public.option_label_ar(public.order_items), public.option_label_en(public.order_items) to anon, authenticated;

notify pgrst, 'reload schema';
