-- Services: what the vendor uploads (owner feedback 2026-11-16).
--  * upload_mode: 'work'       → the vendor uploads the files to be worked on
--                               (background removal: their own photos); the
--                               upload is required and, for a per-unit
--                               service, the number of files IS the quantity;
--                 'references' → optional example / reference images;
--                 'none'       → no upload.
--  * units_included: how many units a fixed bundle holds (100 photos …).
--  * the upload limit follows the order size instead of a flat 20:
--    per-unit → the quantity, fixed bundle → its units (else 20).

alter table public.services add column if not exists upload_mode text not null default 'references';
alter table public.services drop constraint if exists services_upload_mode_check;
alter table public.services add constraint services_upload_mode_check check (upload_mode in ('none', 'references', 'work'));
alter table public.services add column if not exists units_included integer check (units_included is null or units_included > 0);

update public.services set upload_mode = 'work', needs_products = false where code = 'bg_removal';
update public.services set units_included = 100 where code = 'photo_100' and units_included is null;
update public.services set units_included = 200 where code = 'photo_200' and units_included is null;
update public.services set units_included = 500 where code = 'photo_500' and units_included is null;
update public.services set units_included = 30 where code = 'starter_pack' and units_included is null;
update public.services set includes = '[{"ar":"ارفع الصور اللي عايز تشيل خلفيتها","en":"Upload the photos you want cleaned up"},{"ar":"قص دقيق لحواف المنتج","en":"Precise cut-out of the product edges"},{"ar":"خلفية بيضاء نظيفة","en":"Clean white background"},{"ar":"السعر على عدد الصور المرفوعة","en":"Priced by the number of photos uploaded"}]'::jsonb
 where code = 'bg_removal';

-- the upload limit a service allows for a given quantity
create or replace function public.fn_service_upload_limit(p_svc public.services, p_qty integer)
returns integer language sql immutable as $$
  select case
    when p_svc.upload_mode = 'none' then 0
    when p_svc.pricing = 'per_unit' then greatest(1, least(p_qty, p_svc.max_qty))
    when p_svc.pricing = 'fixed' and p_svc.units_included is not null then p_svc.units_included
    else 20 end
$$;

-- place an order: uploads drive the quantity of a per-unit "work" service
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_vendor_place_service_order'::regproc) into v_src;
  if position('fn_service_upload_limit' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    '  if array_length(v_files, 1) > 20 then return jsonb_build_object(''ok'', false, ''reason'', ''too_many_files''); end if;',
    '  if v_svc.upload_mode = ''work'' then
    if coalesce(array_length(v_files, 1), 0) = 0 then return jsonb_build_object(''ok'', false, ''reason'', ''files_required''); end if;
    if v_svc.pricing = ''per_unit'' then v_qty := array_length(v_files, 1); end if;
    if v_qty < v_svc.min_qty or v_qty > v_svc.max_qty then return jsonb_build_object(''ok'', false, ''reason'', ''bad_quantity''); end if;
  end if;
  if coalesce(array_length(v_files, 1), 0) > public.fn_service_upload_limit(v_svc, v_qty) then
    return jsonb_build_object(''ok'', false, ''reason'', ''too_many_files'');
  end if;');
  if v_new = v_src then raise exception 'fn_vendor_place_service_order changed shape; patch not applied'; end if;
  execute v_new;
end $$;

notify pgrst, 'reload schema';
