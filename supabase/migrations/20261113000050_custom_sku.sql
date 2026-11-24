-- SKU: generated on save as before, but the seller may type their own.
-- A row sent with "sku" sets it ('' = back to the generated one); a row sent
-- without it keeps a custom SKU it already has (sku_custom), else regenerates.
alter table public.variants add column if not exists sku_custom boolean not null default false;

do $$
declare v_def text := pg_get_functiondef('public.fn_save_children'::regproc);
begin
  if position('v_sku_custom' in v_def) > 0 then return; end if;
  v_def := replace(v_def, 'v_sku text;', 'v_sku text; v_sku_custom boolean; v_custom_txt text; v_old_sku text; v_old_custom boolean;');
  v_def := replace(v_def, '      -- SKU must stay unique store-wide; suffix if another product took it',
'      -- the seller''s own SKU wins over the generated one
      v_sku_custom := false;
      if s ? ''sku'' then
        v_custom_txt := left(upper(regexp_replace(btrim(coalesce(s->>''sku'', '''')), ''[^A-Za-z0-9._-]'', '''', ''g'')), 40);
        if v_custom_txt <> '''' then v_sku := v_custom_txt; v_sku_custom := true; end if;
      else
        select sku, sku_custom into v_old_sku, v_old_custom from public.variants where id = v_variant;
        if coalesce(v_old_custom, false) and v_old_sku is not null then v_sku := v_old_sku; v_sku_custom := true; end if;
      end if;
      -- SKU must stay unique store-wide; suffix if another product took it');
  v_def := replace(v_def, 'sku = v_sku, price_piastres = v_rprice,', 'sku = v_sku, sku_custom = v_sku_custom, price_piastres = v_rprice,');
  if position('sku_custom = v_sku_custom' in v_def) = 0 or position('v_custom_txt :=' in v_def) = 0 then
    raise exception 'fn_save_children shape changed — patch not applied';
  end if;
  execute v_def;
end $$;

notify pgrst, 'reload schema';
