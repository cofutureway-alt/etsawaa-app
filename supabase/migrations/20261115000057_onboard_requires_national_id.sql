-- Owner request: a vendor cannot submit the store for review without the
-- national ID image (the verification step is no longer skippable).
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_vendor_onboard'::regproc) into v_src;
  if position('national_id_required' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    '  v_exists := v_vendor.id is not null;',
    '  v_exists := v_vendor.id is not null;
  if not v_exists or not exists (select 1 from public.vendor_documents d where d.vendor_id = v_vendor.id and d.type = ''national_id'') then
    raise exception ''national_id_required'';
  end if;');
  if v_new = v_src then raise exception 'fn_vendor_onboard changed shape; patch not applied'; end if;
  execute v_new;
end $$;
