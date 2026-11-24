-- Free-text specs in both languages: value_text holds the Arabic, value_text_en
-- the English. fn_save_product stores both (a row needs at least one of them).
alter table public.product_attribute_values add column if not exists value_text_en text;

do $$
declare v_def text := pg_get_functiondef('public.fn_save_product'::regproc);
begin
  if position('value_text_en' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
    'if nullif(v_val ->> ''value_text'', '''') is null and nullif(v_val ->> ''value_number'', '''') is null',
    'if nullif(v_val ->> ''value_text'', '''') is null and nullif(v_val ->> ''value_text_en'', '''') is null and nullif(v_val ->> ''value_number'', '''') is null');
  v_def := replace(v_def,
    'insert into public.product_attribute_values (product_id, attribute_id, option_id, option_ids, value_text, value_number, value_bool)',
    'insert into public.product_attribute_values (product_id, attribute_id, option_id, option_ids, value_text, value_text_en, value_number, value_bool)');
  v_def := replace(v_def,
    '        nullif(v_val ->> ''value_text'', ''''),
        nullif(v_val ->> ''value_number'', '''')::numeric,',
    '        nullif(v_val ->> ''value_text'', ''''),
        left(nullif(btrim(v_val ->> ''value_text_en''), ''''), 500),
        nullif(v_val ->> ''value_number'', '''')::numeric,');
  if (length(v_def) - length(replace(v_def, 'value_text_en', ''))) / length('value_text_en') < 3 then
    raise exception 'fn_save_product shape changed — patch not applied';
  end if;
  execute v_def;
end $$;

notify pgrst, 'reload schema';
