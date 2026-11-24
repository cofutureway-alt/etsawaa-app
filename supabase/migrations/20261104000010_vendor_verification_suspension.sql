-- ============================================================================
-- Seller verification documents, review workflow and full suspension
--
-- Documents: commercial register, tax card, national ID — several images per
-- type, each reviewed on its own (verified / rejected with a reason code and
-- a note the seller sees). Old id_front/id_back rows become national_id.
--
-- Verification status gains 'needs_changes' (sent back to the seller with
-- notes); admins can move a store back to 'submitted' (pending review) at any
-- time. Every status/verification change is kept in vendor_status_history
-- with the admin and the reason.
--
-- Full rejection = SUSPENSION: status 'suspended', verification 'rejected',
-- products hidden, withdrawals frozen. The seller can still sign in and read
-- the reason, but every seller RPC refuses (fn_assert_my_store_operational)
-- and direct writes are blocked by RLS.
-- ============================================================================
begin;

-- ── documents ───────────────────────────────────────────────────────────────
alter table public.vendor_documents drop constraint if exists vendor_documents_one_per_type;
alter table public.vendor_documents drop constraint if exists vendor_documents_type_check;
update public.vendor_documents set type = 'national_id' where type in ('id_front', 'id_back');
alter table public.vendor_documents add constraint vendor_documents_type_check
  check (type in ('commercial_register', 'tax_card', 'national_id', 'residence'));
alter table public.vendor_documents
  add column if not exists reject_reason text,
  add column if not exists position smallint not null default 0;
alter table public.vendor_documents drop constraint if exists vendor_documents_reject_reason_check;
alter table public.vendor_documents add constraint vendor_documents_reject_reason_check
  check (reject_reason is null or reject_reason in ('blurry', 'unreadable', 'expired', 'mismatch', 'incomplete', 'wrong_document', 'other'));
create index if not exists vendor_documents_type_idx on public.vendor_documents (vendor_id, type);

-- owner: read all own documents; add while the store is not suspended;
-- remove only what is not verified yet (verified proof stays on file)
drop policy if exists vendor_documents_owner on public.vendor_documents;
drop policy if exists vendor_documents_owner_read on public.vendor_documents;
create policy vendor_documents_owner_read on public.vendor_documents for select to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()));
drop policy if exists vendor_documents_owner_insert on public.vendor_documents;
create policy vendor_documents_owner_insert on public.vendor_documents for insert to authenticated
  with check (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid() and v.status <> 'suspended'));
drop policy if exists vendor_documents_owner_delete on public.vendor_documents;
create policy vendor_documents_owner_delete on public.vendor_documents for delete to authenticated
  using (status <> 'verified' and exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid() and v.status <> 'suspended'));
grant delete on public.vendor_documents to authenticated;

-- ── vendor status fields ────────────────────────────────────────────────────
alter table public.vendors drop constraint if exists vendors_verification_status_check;
alter table public.vendors add constraint vendors_verification_status_check
  check (verification_status in ('unverified', 'submitted', 'needs_changes', 'verified', 'rejected', 'grace_expired'));
alter table public.vendors
  add column if not exists suspension_reason text,
  add column if not exists suspended_at timestamptz;

-- a suspended store cannot change its own row
drop policy if exists vendors_update_own on public.vendors;
create policy vendors_update_own on public.vendors for update to authenticated
  using (owner_id = auth.uid() and status <> 'suspended') with check (owner_id = auth.uid());

-- ── history ─────────────────────────────────────────────────────────────────
create table if not exists public.vendor_status_history (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  field text not null check (field in ('status', 'verification')),
  from_value text,
  to_value text not null,
  reason text,
  actor uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists vendor_status_history_vendor_idx on public.vendor_status_history (vendor_id, created_at desc);
grant select on public.vendor_status_history to authenticated;
alter table public.vendor_status_history enable row level security;
drop policy if exists vendor_status_history_read on public.vendor_status_history;
create policy vendor_status_history_read on public.vendor_status_history for select to authenticated
  using (public.is_admin() or exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()));

create or replace function public.fn_vendor_status_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status then
    insert into public.vendor_status_history (vendor_id, field, from_value, to_value, reason, actor)
    values (new.id, 'status', old.status, new.status,
            case new.status when 'suspended' then new.suspension_reason when 'rejected' then new.rejection_reason end, auth.uid());
  end if;
  if new.verification_status is distinct from old.verification_status then
    insert into public.vendor_status_history (vendor_id, field, from_value, to_value, reason, actor)
    values (new.id, 'verification', old.verification_status, new.verification_status, new.verification_note, auth.uid());
  end if;
  return new;
end
$function$;
drop trigger if exists trg_vendor_status_history on public.vendors;
create trigger trg_vendor_status_history after update of status, verification_status on public.vendors
  for each row execute function public.fn_vendor_status_history();
revoke execute on function public.fn_vendor_status_history() from public, anon, authenticated;

-- ── the gate ────────────────────────────────────────────────────────────────
create or replace function public.fn_assert_my_store_operational()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if public.is_admin() then return; end if;
  if exists (select 1 from public.vendors where owner_id = auth.uid() and status = 'suspended') then
    raise exception 'store_suspended' using errcode = 'P0001', hint = 'This store is suspended; contact the administration.';
  end if;
end
$function$;
revoke execute on function public.fn_assert_my_store_operational() from public, anon;
grant execute on function public.fn_assert_my_store_operational() to authenticated;

-- ── admin: one document ─────────────────────────────────────────────────────
create or replace function public.fn_admin_review_document(p_doc uuid, p_decision text, p_reason text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_doc public.vendor_documents%rowtype; v_owner uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_decision not in ('verified', 'rejected', 'pending') then return jsonb_build_object('ok', false, 'reason', 'bad_decision'); end if;
  if p_decision = 'rejected' and coalesce(p_reason, '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  update public.vendor_documents set
    status = p_decision,
    reject_reason = case when p_decision = 'rejected' then p_reason end,
    review_note = case when p_decision = 'rejected' then nullif(trim(coalesce(p_note, '')), '') end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_doc returning * into v_doc;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select owner_id into v_owner from public.vendors where id = v_doc.vendor_id;
  if p_decision = 'rejected' then
    perform public.fn_notify(v_owner, 'verification.document_rejected', jsonb_build_object(
      'ar', jsonb_build_object('title', 'مستند يحتاج إلى استبدال', 'body', 'رفضت الإدارة أحد مستندات التوثيق — افتح صفحة التوثيق لمعرفة السبب'),
      'en', jsonb_build_object('title', 'A document needs replacing', 'body', 'An admin rejected one of your verification documents — open Verification to see why'),
      'link', '/vendor/verification'));
  end if;
  perform public.fn_audit('vendor.document.' || p_decision, 'vendor_documents', p_doc::text, null,
    jsonb_build_object('reason', p_reason, 'note', p_note));
  return jsonb_build_object('ok', true);
end
$function$;

-- ── admin: verification status (pending review / needs changes / verified) ──
create or replace function public.fn_admin_set_verification(p_vendor uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v public.vendors%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status not in ('submitted', 'needs_changes', 'verified') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  if p_status = 'needs_changes' and coalesce(trim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
  update public.vendors set
    verification_status = p_status,
    verification_note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_vendor returning * into v;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status = 'verified' then
    -- verification clears grace: products return to sale
    update public.variants set is_active = true
    where product_id in (select id from public.products where vendor_id = v.id) and deleted_at is null;
  end if;
  perform public.fn_notify(v.owner_id, 'verification.' || p_status, jsonb_build_object(
    'ar', jsonb_build_object('title', case p_status when 'verified' then 'تم توثيق متجرك' when 'needs_changes' then 'مطلوب تعديلات للتوثيق' else 'توثيقك قيد المراجعة' end,
                             'body', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'افتح صفحة التوثيق للتفاصيل')),
    'en', jsonb_build_object('title', case p_status when 'verified' then 'Your store is verified' when 'needs_changes' then 'Changes needed for verification' else 'Your verification is under review' end,
                             'body', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Open Verification for details')),
    'link', '/vendor/verification'));
  return jsonb_build_object('ok', true);
end
$function$;

-- ── admin: reject everything + suspend / reinstate ──────────────────────────
create or replace function public.fn_admin_suspend_vendor(p_vendor uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v public.vendors%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(trim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  update public.vendors set
    suspension_reason = trim(p_reason), suspended_at = now(),
    status = 'suspended', verification_status = 'rejected', verification_note = trim(p_reason),
    hidden_from_listings = true, hidden_reason = trim(p_reason),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_vendor returning * into v;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.fn_notify(v.owner_id, 'vendor.suspended', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم رفض الطلب وإيقاف المتجر', 'body', trim(p_reason)),
    'en', jsonb_build_object('title', 'Application rejected — store suspended', 'body', trim(p_reason)),
    'link', '/vendor'));
  perform public.fn_audit('vendor.suspended', 'vendors', p_vendor::text, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end
$function$;

create or replace function public.fn_admin_reinstate_vendor(p_vendor uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v public.vendors%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.vendors set
    status = 'active', suspension_reason = null, suspended_at = null,
    hidden_from_listings = false, hidden_reason = null,
    verification_status = 'submitted', verification_note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_vendor and status = 'suspended' returning * into v;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_suspended'); end if;
  perform public.fn_notify(v.owner_id, 'vendor.reinstated', jsonb_build_object(
    'ar', jsonb_build_object('title', 'تم إعادة تفعيل متجرك', 'body', 'متجرك نشط مجددًا وتوثيقه قيد المراجعة'),
    'en', jsonb_build_object('title', 'Your store is active again', 'body', 'Your store is active and its verification is under review'),
    'link', '/vendor'));
  perform public.fn_audit('vendor.reinstated', 'vendors', p_vendor::text, null, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end
$function$;

-- ── seller: send the corrected application back for review ──────────────────
create or replace function public.fn_vendor_resubmit_verification()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v public.vendors%rowtype;
begin
  perform public.fn_assert_my_store_operational();
  select * into v from public.vendors where owner_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_store'); end if;
  if v.verification_status not in ('unverified', 'needs_changes', 'rejected', 'grace_expired') then
    return jsonb_build_object('ok', false, 'reason', 'not_needed');
  end if;
  if exists (select 1 from public.vendor_documents where vendor_id = v.id and status = 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'rejected_documents_left');
  end if;
  update public.vendors set verification_status = 'submitted', verification_note = null where id = v.id;
  return jsonb_build_object('ok', true);
end
$function$;

revoke execute on function public.fn_admin_review_document(uuid, text, text, text) from public, anon;
revoke execute on function public.fn_admin_set_verification(uuid, text, text) from public, anon;
revoke execute on function public.fn_admin_suspend_vendor(uuid, text) from public, anon;
revoke execute on function public.fn_admin_reinstate_vendor(uuid, text) from public, anon;
revoke execute on function public.fn_vendor_resubmit_verification() from public, anon;
grant execute on function public.fn_admin_review_document(uuid, text, text, text) to authenticated;
grant execute on function public.fn_admin_set_verification(uuid, text, text) to authenticated;
grant execute on function public.fn_admin_suspend_vendor(uuid, text) to authenticated;
grant execute on function public.fn_admin_reinstate_vendor(uuid, text) to authenticated;
grant execute on function public.fn_vendor_resubmit_verification() to authenticated;

-- fn_save_product: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_save_product(p_product jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user      uuid := auth.uid();
  v_vendor    uuid;
  v_product   public.products%rowtype;
  v_is_new    boolean := p_id is null;
  v_cat       uuid := nullif(p_product ->> 'leaf_category_id', '')::uuid;
  v_is_leaf   boolean;
  v_attr      record;
  v_val       jsonb;
  v_opt       uuid;
  v_specs     jsonb := '{}'::jsonb;
  v_media     jsonb;
  v_i         integer;
  v_sale_s    timestamptz;
  v_sale_e    timestamptz;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select id into v_vendor from public.vendors where owner_id = v_user;
  if v_vendor is null then
    raise exception 'not allowed: no store' using errcode = '42501';
  end if;

  if v_is_new then
    insert into public.products (vendor_id, status) values (v_vendor, 'draft') returning * into v_product;
  else
    select * into v_product from public.products where id = p_id and vendor_id = v_vendor;
    if v_product.id is null then
      raise exception 'not allowed: product not found' using errcode = '42501';
    end if;
    if v_product.status not in ('draft', 'rejected') then
      raise exception 'product is locked in status %', v_product.status;
    end if;
  end if;

  -- category: must be an active leaf
  if v_cat is not null then
    select not exists (select 1 from public.categories c where c.parent_id = v_cat and c.deleted_at is null)
      and exists (select 1 from public.categories c where c.id = v_cat and c.is_active and c.deleted_at is null)
      into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be an active leaf category';
    end if;
  end if;
  if coalesce(p_product ->> 'brand_id', '') <> ''
     and not exists (select 1 from public.brands where id = (p_product ->> 'brand_id')::uuid and deleted_at is null) then
    raise exception 'brand not found';
  end if;

  v_sale_s := nullif(p_product ->> 'sale_starts_at', '')::timestamptz;
  v_sale_e := nullif(p_product ->> 'sale_ends_at', '')::timestamptz;
  if v_sale_s is not null and v_sale_e is not null and v_sale_e <= v_sale_s then
    raise exception 'sale schedule end must be after the start';
  end if;

  update public.products set
    name_ar  = coalesce(p_product ->> 'name_ar',  v_product.name_ar),
    name_en  = coalesce(p_product ->> 'name_en',  v_product.name_en),
    desc_ar  = coalesce(p_product ->> 'desc_ar',  v_product.desc_ar),
    desc_en  = coalesce(p_product ->> 'desc_en',  v_product.desc_en),
    short_ar = coalesce(p_product ->> 'short_ar', v_product.short_ar),
    short_en = coalesce(p_product ->> 'short_en', v_product.short_en),
    leaf_category_id = coalesce(v_cat, v_product.leaf_category_id),
    brand_id = coalesce(nullif(p_product ->> 'brand_id', '')::uuid, v_product.brand_id),
    is_fragile = coalesce((p_product ->> 'is_fragile')::boolean, v_product.is_fragile),
    shipping_mode = coalesce(p_product ->> 'shipping_mode', v_product.shipping_mode),
    shipping_class = coalesce(p_product ->> 'shipping_class', v_product.shipping_class),
    weight_g = coalesce((p_product ->> 'weight_g')::int, v_product.weight_g),
    dims = coalesce(p_product -> 'dims', v_product.dims),
    sale_starts_at = coalesce(v_sale_s, v_product.sale_starts_at),
    sale_ends_at = coalesce(v_sale_e, v_product.sale_ends_at)
  where id = v_product.id
  returning * into v_product;

  if coalesce(v_product.slug_ar, '') = '' and coalesce(v_product.name_ar, '') <> '' then
    update public.products set slug_ar = public.fn_product_slug(v_product.name_ar) where id = v_product.id;
  end if;
  if coalesce(v_product.slug_en, '') = '' and coalesce(v_product.name_en, '') <> '' then
    update public.products set slug_en = public.fn_product_slug(v_product.name_en) where id = v_product.id;
  end if;

  if p_product ? 'attributes' then
    delete from public.product_attribute_values where product_id = v_product.id;
    for v_val in select * from jsonb_array_elements(coalesce(p_product -> 'attributes', '[]'::jsonb)) loop
      select * into v_attr from public.attribute_defs
        where id = (v_val ->> 'attribute_id')::uuid and deleted_at is null;
      if v_attr.id is null then
        raise exception 'attribute % not found', v_val ->> 'attribute_id';
      end if;
      if v_product.leaf_category_id is null
         or not public.fn_attr_in_template(v_attr.id, v_product.leaf_category_id) then
        raise exception 'attribute % does not belong to the product category', v_attr.code;
      end if;
      v_opt := nullif(v_val ->> 'option_id', '')::uuid;
      if v_attr.type in ('enum', 'color') then
        if v_opt is null or not exists (
          select 1 from public.attribute_options where id = v_opt and attribute_id = v_attr.id and deleted_at is null
        ) then
          raise exception 'value for % must come from the admin options', v_attr.code;
        end if;
      end if;
      insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
      values (
        v_product.id, v_attr.id, v_opt,
        nullif(v_val ->> 'value_text', ''),
        nullif(v_val ->> 'value_number', '')::numeric,
        nullif(v_val ->> 'value_bool', '')::boolean
      );
    end loop;

    delete from public.product_facets where product_id = v_product.id;
    insert into public.product_facets (product_id, attribute_id, option_id)
    select v_product.id, pav.attribute_id, pav.option_id
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    where pav.product_id = v_product.id and ad.is_filterable and pav.option_id is not null;

    select coalesce(jsonb_object_agg(ad.code, jsonb_build_object(
      'type', ad.type,
      'unit', ad.unit,
      'value', case
        when pav.option_id is not null then jsonb_build_object(
          'option_id', pav.option_id,
          'label_ar', ao.label_ar, 'label_en', ao.label_en, 'color_hex', ao.color_hex)
        when ad.type = 'number' then to_jsonb(pav.value_number)
        when ad.type = 'bool' then to_jsonb(pav.value_bool)
        else to_jsonb(pav.value_text) end
    )), '{}'::jsonb)
    into v_specs
    from public.product_attribute_values pav
    join public.attribute_defs ad on ad.id = pav.attribute_id
    left join public.attribute_options ao on ao.id = pav.option_id
    where pav.product_id = v_product.id;
    update public.products set specs = v_specs where id = v_product.id;
  end if;

  if p_product ? 'media' then
    delete from public.product_media where product_id = v_product.id;
    v_i := 0;
    for v_media in select * from jsonb_array_elements(coalesce(p_product -> 'media', '[]'::jsonb)) loop
      insert into public.product_media (product_id, kind, path, position)
      values (v_product.id, coalesce(v_media ->> 'kind', 'image'), v_media ->> 'path', v_i);
      v_i := v_i + 1;
    end loop;
  end if;

  if p_product ? 'tag_ids' then
    delete from public.product_tags where product_id = v_product.id;
    insert into public.product_tags (product_id, tag_id)
    select v_product.id, value::uuid
    from jsonb_array_elements_text(coalesce(p_product -> 'tag_ids', '[]'::jsonb)) value
    where exists (select 1 from public.tags where id = value::uuid and deleted_at is null);
  end if;

  if coalesce((p_product -> 'apply_defaults')::boolean, false) then
    update public.variants set
      price_piastres = coalesce(nullif(p_product ->> 'default_price_piastres', '')::int, price_piastres),
      sale_price_piastres = coalesce(nullif(p_product ->> 'default_sale_piastres', '')::int, sale_price_piastres)
    where product_id = v_product.id and deleted_at is null;
  end if;

  select * into v_product from public.products where id = v_product.id;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, case when v_is_new then 'product.create' else 'product.update' end, 'products', v_product.id::text,
          jsonb_build_object('status', v_product.status, 'name_ar', v_product.name_ar));

  return jsonb_build_object(
    'id', v_product.id,
    'slug_ar', v_product.slug_ar,
    'slug_en', v_product.slug_en,
    'status', v_product.status,
    'updated_at', v_product.updated_at
  );
end $function$;

-- fn_save_children: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_save_children(p_product_id uuid, p_children jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  c jsonb; s jsonb; img text;
  v_group uuid; v_variant uuid;
  v_keep_groups uuid[] := '{}'; v_keep_variants uuid[] := '{}';
  v_keys text[] := '{}';
  v_key text; v_ids uuid[]; v_sku text; v_color_code text; v_size_code text; v_i integer;
  v_price integer; v_sale integer; v_s0 timestamptz; v_s1 timestamptz;
  v_prefix text;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.* into v_product from public.products p join public.vendors v on v.id = p.vendor_id
   where p.id = p_product_id and v.owner_id = v_user;
  if v_product.id is null then raise exception 'not allowed: product not found' using errcode = '42501'; end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is locked in status %', v_product.status;
  end if;
  v_prefix := 'ET-' || upper(substr(replace(p_product_id::text, '-', ''), 1, 6));

  for c in select * from jsonb_array_elements(coalesce(p_children, '[]'::jsonb)) loop
    v_price := nullif(c->>'price_piastres', '')::integer;
    v_sale := nullif(c->>'sale_price_piastres', '')::integer;
    if v_price is not null and v_price <= 0 then raise exception 'price must be positive'; end if;
    if v_sale is not null and (v_price is null or v_sale >= v_price) then
      raise exception 'sale price must be lower than the price';
    end if;
    v_s0 := nullif(c->>'sale_starts_at', '')::timestamptz;
    v_s1 := nullif(c->>'sale_ends_at', '')::timestamptz;
    -- a discount with no start date starts now
    if v_sale is not null and v_s0 is null then v_s0 := now(); end if;
    if v_sale is null then v_s0 := null; v_s1 := null; end if;
    if v_s0 is not null and v_s1 is not null and v_s1 <= v_s0 then
      raise exception 'sale schedule end must be after the start';
    end if;

    v_group := nullif(c->>'id', '')::uuid;
    if v_group is not null and not exists (select 1 from public.variant_groups where id = v_group and product_id = p_product_id) then
      v_group := null;
    end if;
    if v_group is null then
      insert into public.variant_groups (product_id) values (p_product_id) returning id into v_group;
    end if;
    update public.variant_groups set
      color_option_id = nullif(c->>'color_option_id', '')::uuid,
      price_piastres = v_price, sale_price_piastres = v_sale,
      sale_starts_at = v_s0, sale_ends_at = v_s1,
      sort = coalesce(array_length(v_keep_groups, 1), 0), deleted_at = null
    where id = v_group;
    v_keep_groups := v_keep_groups || v_group;

    delete from public.variant_group_media where group_id = v_group;
    v_i := 0;
    for img in select jsonb_array_elements_text(coalesce(c->'images', '[]'::jsonb)) loop
      insert into public.variant_group_media (group_id, path, position) values (v_group, img, v_i);
      v_i := v_i + 1;
      exit when v_i >= 12;
    end loop;

    select coalesce(upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g')), '')
      into v_color_code from public.attribute_options o where o.id = nullif(c->>'color_option_id', '')::uuid;

    for s in select * from jsonb_array_elements(case when jsonb_array_length(coalesce(c->'sizes', '[]'::jsonb)) = 0
                                                    then '[{}]'::jsonb else c->'sizes' end) loop
      v_ids := array_remove(array[nullif(c->>'color_option_id', '')::uuid, nullif(s->>'size_option_id', '')::uuid], null);
      select coalesce(string_agg(x::text, ',' order by x::text), '') into v_key from unnest(v_ids) x;
      if v_key = any(v_keys) then
        raise exception 'duplicate colour/size combination';
      end if;
      v_keys := v_keys || v_key;
      if coalesce((s->>'stock')::integer, 0) < 0 then raise exception 'stock cannot be negative'; end if;

      select upper(regexp_replace(coalesce(o.label_en, o.code), '[^A-Za-z0-9]', '', 'g'))
        into v_size_code from public.attribute_options o where o.id = nullif(s->>'size_option_id', '')::uuid;
      v_sku := v_prefix || coalesce('-' || nullif(left(v_color_code, 6), ''), '') || coalesce('-' || nullif(left(v_size_code, 6), ''), '');

      -- reuse the live row for this combination (keeps cart/order references)
      select id into v_variant from public.variants
       where product_id = p_product_id and option_key = v_key and deleted_at is null;
      if v_variant is null then
        -- a tombstoned row for the same combination is revived instead of duplicated
        select id into v_variant from public.variants
         where product_id = p_product_id and option_key = v_key order by updated_at desc limit 1;
      end if;
      if v_variant is null then
        insert into public.variants (product_id, option_key, option_ids) values (p_product_id, v_key, v_ids)
        returning id into v_variant;
      end if;
      -- SKU must stay unique store-wide; suffix if another product took it
      if exists (select 1 from public.variants where sku = v_sku and deleted_at is null and id <> v_variant) then
        v_sku := v_sku || '-' || upper(substr(replace(v_variant::text, '-', ''), 1, 4));
      end if;
      update public.variants set
        group_id = v_group, option_key = v_key, option_ids = v_ids,
        size_option_id = nullif(s->>'size_option_id', '')::uuid,
        sku = v_sku, price_piastres = v_price, sale_price_piastres = v_sale,
        sale_starts_at = v_s0, sale_ends_at = v_s1,
        stock = coalesce((s->>'stock')::integer, 0),
        image_path = (select path from public.variant_group_media where group_id = v_group order by position limit 1),
        is_active = true, deleted_at = null
      where id = v_variant;
      v_keep_variants := v_keep_variants || v_variant;
    end loop;
  end loop;

  update public.variants set deleted_at = now(), is_active = false
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_variants));
  update public.variant_groups set deleted_at = now()
   where product_id = p_product_id and deleted_at is null and not (id = any(v_keep_groups));
  update public.products set updated_at = now() where id = p_product_id;

  return jsonb_build_object('ok', true, 'children', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'sizes', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'size_option_id', v.size_option_id, 'sku', v.sku, 'stock', v.stock)
                                          order by v.option_key), '[]'::jsonb)
                  from public.variants v where v.group_id = g.id and v.deleted_at is null)) order by g.sort), '[]'::jsonb)
    from public.variant_groups g where g.product_id = p_product_id and g.deleted_at is null));
end
$function$;

-- fn_submit_product: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_submit_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_product public.products%rowtype;
  v_vendor  public.vendors%rowtype;
  v_config  jsonb := public.fn_vendor_config();
  v_target  text;
  v_missing text[] := '{}'::text[];
  v_attr    record;
  v_is_leaf boolean;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then
    raise exception 'product not found';
  end if;
  select * into v_vendor from public.vendors where id = v_product.vendor_id;
  if v_vendor.owner_id <> v_user then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if v_product.status not in ('draft', 'rejected') then
    raise exception 'product is not submittable in status %', v_product.status;
  end if;

  -- selling gate (grace expiry / suspension blocks publish at API level)
  if not public.vendor_can_sell(v_vendor.id) then
    raise exception 'selling is blocked for this store (% / %)', v_vendor.status, v_vendor.verification_status
      using errcode = 'P0001';
  end if;

  -- completeness validation
  if coalesce(v_product.name_ar, '') = '' or coalesce(v_product.name_en, '') = '' then
    v_missing := v_missing || 'name';
  end if;
  if v_product.leaf_category_id is null then
    v_missing := v_missing || 'category';
  else
    select not exists (
      select 1 from public.categories c where c.parent_id = v_product.leaf_category_id and c.deleted_at is null
    ) into v_is_leaf;
    if not v_is_leaf then
      raise exception 'category must be a leaf category';
    end if;
  end if;
  if not exists (select 1 from public.product_media where product_id = v_product.id) then
    v_missing := v_missing || 'media';
  end if;
  if not exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and sku is not null and price_piastres is not null and price_piastres > 0
  ) then
    v_missing := v_missing || 'variants';
  end if;
  if exists (
    select 1 from public.variants
    where product_id = v_product.id and deleted_at is null
      and (sku is null or price_piastres is null or price_piastres <= 0)
  ) then
    v_missing := v_missing || 'variants_incomplete';
  end if;
  for v_attr in
    select ad.code from public.attribute_defs ad
    where ad.is_required and ad.deleted_at is null
      and not ad.is_variant_axis -- axis attrs live in the variant combos
      and public.fn_attr_in_template(ad.id, v_product.leaf_category_id)
      and not exists (
        select 1 from public.product_attribute_values pav
        where pav.product_id = v_product.id and pav.attribute_id = ad.id
      )
  loop
    v_missing := v_missing || ('attribute:' || v_attr.code);
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'product is incomplete: %', array_to_string(v_missing, ', ');
  end if;

  if coalesce(v_config ->> 'review_required', 'true') = 'true' then
    v_target := 'pending';
  else
    v_target := 'approved';
  end if;

  update public.products set
    status = v_target,
    rejection_reason = null,
    submitted_at = now(),
    published_at = case when v_target = 'approved' then now() else null end
  where id = v_product.id
  returning * into v_product;

  if v_target = 'pending' then
    perform public.fn_notify(a.id, 'product.pending', jsonb_build_object(
      'product_id', v_product.id, 'name_ar', v_product.name_ar, 'name_en', v_product.name_en,
      'vendor', v_vendor.store_name_ar
    ))
    from public.profiles a where a.role = 'admin';
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'product.submit', 'products', v_product.id::text, jsonb_build_object('status', v_target));

  return jsonb_build_object('status', v_target);
end $function$;

-- fn_clone_product: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_clone_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g public.variant_groups%rowtype;
  v_new_group uuid;
  v_user    uuid := auth.uid();
  v_src     public.products%rowtype;
  v_new     public.products%rowtype;
  v_variant record;
  v_new_sku text;
  v_n       integer := 0;
  v_drift   text[] := '{}'::text[];
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  select * into v_src from public.products where id = p_product_id;
  if v_src.id is null then
    raise exception 'product not found';
  end if;
  -- Admin may clone any product (the admin products page calls this); a vendor
  -- only its own. Without the is_admin() branch the admin button always failed.
  if not public.is_admin()
     and not exists (select 1 from public.vendors where id = v_src.vendor_id and owner_id = v_user) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  if coalesce((public.fn_vendor_config() ->> 'allow_clone'), 'true') <> 'true' then
    raise exception 'cloning is disabled';
  end if;

  insert into public.products (
    vendor_id, leaf_category_id, brand_id, name_ar, name_en, desc_ar, desc_en, short_ar, short_en,
    is_fragile, shipping_mode, shipping_class, weight_g, dims, status, sale_starts_at, sale_ends_at
  ) values (
    v_src.vendor_id, v_src.leaf_category_id, v_src.brand_id,
    v_src.name_ar || ' (نسخة)', v_src.name_en || ' (copy)',
    v_src.desc_ar, v_src.desc_en, v_src.short_ar, v_src.short_en,
    v_src.is_fragile, v_src.shipping_mode, v_src.shipping_class, v_src.weight_g, v_src.dims,
    'draft', v_src.sale_starts_at, v_src.sale_ends_at
  ) returning * into v_new;

  update public.products set
    slug_ar = public.fn_product_slug(v_new.name_ar),
    slug_en = public.fn_product_slug(v_new.name_en)
  where id = v_new.id;

  insert into public.product_attribute_values (product_id, attribute_id, option_id, value_text, value_number, value_bool)
  select v_new.id, attribute_id, option_id, value_text, value_number, value_bool
  from public.product_attribute_values where product_id = v_src.id;

  insert into public.product_facets (product_id, attribute_id, option_id)
  select v_new.id, attribute_id, option_id from public.product_facets where product_id = v_src.id;

  insert into public.product_media (product_id, kind, path, position)
  select v_new.id, kind, path, position from public.product_media where product_id = v_src.id;

  insert into public.product_tags (product_id, tag_id)
  select v_new.id, tag_id from public.product_tags where product_id = v_src.id;

  -- child products first, then their per-size rows (SKUs get a -C<n> suffix)
  for v_g in select * from public.variant_groups where product_id = v_src.id and deleted_at is null loop
    insert into public.variant_groups (product_id, color_option_id, price_piastres, sale_price_piastres, sale_starts_at, sale_ends_at, sort)
    values (v_new.id, v_g.color_option_id, v_g.price_piastres, v_g.sale_price_piastres, v_g.sale_starts_at, v_g.sale_ends_at, v_g.sort)
    returning id into v_new_group;
    insert into public.variant_group_media (group_id, path, position)
    select v_new_group, path, position from public.variant_group_media where group_id = v_g.id;
    for v_variant in select * from public.variants where group_id = v_g.id and deleted_at is null loop
      v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C1';
      while exists (select 1 from public.variants where sku = v_new_sku and deleted_at is null) loop
        v_n := v_n + 1;
        v_new_sku := coalesce(v_variant.sku, 'SKU') || '-C' || (v_n + 1)::text;
      end loop;
      v_n := 0;
      insert into public.variants (product_id, group_id, size_option_id, sku, option_key, option_ids, price_piastres, sale_price_piastres,
                                   sale_starts_at, sale_ends_at, stock, image_path, is_active)
      values (v_new.id, v_new_group, v_variant.size_option_id, v_new_sku, v_variant.option_key, v_variant.option_ids,
              v_variant.price_piastres, v_variant.sale_price_piastres, v_variant.sale_starts_at, v_variant.sale_ends_at,
              v_variant.stock, v_variant.image_path, v_variant.is_active);
    end loop;
  end loop;

  -- template drift warning: attributes no longer in the current template
  select coalesce(array_agg(pav.attribute_id::text), '{}'::text[]) into v_drift
  from public.product_attribute_values pav
  where pav.product_id = v_new.id
    and not exists (
      select 1 from public.category_attributes ca
      where ca.category_id = v_new.leaf_category_id and ca.attribute_id = pav.attribute_id
    );

  return jsonb_build_object('id', v_new.id, 'name_en', v_new.name_en, 'drifted_attributes', to_jsonb(v_drift));
end $function$;

-- fn_archive_product: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_archive_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_user is null then
    raise exception 'not allowed: caller is not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id and v.owner_id = v_user and p.deleted_at is null
  ) then
    raise exception 'not allowed: not your product' using errcode = '42501';
  end if;
  update public.products set deleted_at = now() where id = p_product_id;
  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (v_user, 'product.archive', 'products', p_product_id::text, jsonb_build_object('archived', true));
  return jsonb_build_object('archived', true);
end $function$;

-- fn_request_withdrawal: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_request_withdrawal(p_amount_piastres integer, p_method text, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendor uuid := public.own_vendor_id();
  v_wallet wallets%rowtype;
  v_min integer;
  v_id uuid;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_vendor is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_method not in ('wallet','bank','instapay') then
    return jsonb_build_object('ok', false, 'reason', 'bad_method');
  end if;
  select * into v_wallet from public.wallets where vendor_id = v_vendor for update;
  if v_wallet is null then
    insert into public.wallets (vendor_id) values (v_vendor);
    select * into v_wallet from public.wallets where vendor_id = v_vendor for update;
  end if;
  select coalesce((s.value->>'min_withdrawal_piastres')::integer, 5000) into v_min
    from public.settings s where s.key = 'wallet';
  if p_amount_piastres < v_min then
    return jsonb_build_object('ok', false, 'reason', 'below_min', 'min_piastres', v_min);
  end if;
  if p_amount_piastres > v_wallet.available_piastres then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available_piastres', v_wallet.available_piastres);
  end if;
  if exists (select 1 from public.withdrawal_requests
             where vendor_id = v_vendor and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'pending_exists');
  end if;

  insert into public.withdrawal_requests (vendor_id, amount_piastres, method, details, requested_by)
  values (v_vendor, p_amount_piastres, p_method, coalesce(p_details, '{}'::jsonb), auth.uid())
  returning id into v_id;

  -- hold the funds: a debit row tied to the withdrawal id
  insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
  values (v_vendor, 'withdrawal', -p_amount_piastres, 'withdrawal:' || v_id::text,
          'Withdrawal request held', auth.uid());
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

-- fn_vendor_set_fulfillment: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_vendor_set_fulfillment(p_group_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group order_vendor_groups%rowtype;
  v_order orders%rowtype;
  v_res jsonb;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_group.vendor_id <> public.own_vendor_id() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_order from public.orders where id = v_group.order_id;

  if v_group.status in ('delivered','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'group_closed');
  end if;
  if v_order.status = 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'payment_pending');
  end if;
  -- vendor shipping cannot ship before admin approval (VO-04)
  if v_group.shipping_mode = 'vendor'
     and v_group.vendor_ship_status in ('pending_admin','not_required','rejected')
     and p_status = 'handed_to_carrier' then
    if v_group.vendor_ship_status = 'pending_admin' then
      return jsonb_build_object('ok', false, 'reason', 'awaiting_admin_approval');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'vendor_ship_not_approved');
  end if;

  -- allowed transitions (server-side table of truth)
  if not (
    (v_group.status = 'pending' and p_status = 'preparing')
    or (v_group.status = 'preparing' and p_status = 'handed_to_carrier')
    or (v_group.status = 'handed_to_carrier' and p_status = 'out_for_delivery')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition',
      'from', v_group.status, 'to', p_status);
  end if;

  update public.order_vendor_groups
     set status = p_status,
         shipped_at = case when p_status = 'handed_to_carrier' then now() else shipped_at end
   where id = p_group_id;

  insert into public.order_status_history (order_id, group_id, status, note, actor)
  values (v_group.order_id, p_group_id, p_status, left(coalesce(p_note, ''), 500), auth.uid());

  -- pickup fee posts exactly at ship time (idempotent on retry)
  if p_status = 'handed_to_carrier' then
    v_res := public.fn_post_pickup_fee(p_group_id);
    if not coalesce((v_res->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'pickup_failed', 'detail', v_res->>'reason');
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $function$;

-- fn_update_group_status: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_update_group_status(p_group_id uuid, p_status text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_group order_vendor_groups%rowtype;
  v_order orders%rowtype;
  r record;
  v_vendor_is_actor boolean := public.own_vendor_id() = (select vendor_id from public.order_vendor_groups where id = p_group_id);
  v_all_delivered boolean;
  v_all_cancelled boolean;
  v_pickup jsonb;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  select * into v_group from public.order_vendor_groups where id = p_group_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_order from public.orders where id = v_group.order_id;
  if not (public.is_admin() or v_vendor_is_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_status not in ('preparing','handed_to_carrier','out_for_delivery','delivered','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  if v_vendor_is_actor and not public.is_admin() then
    -- the vendor walks the allowed fulfillment ladder only (phase 06)
    if v_group.shipping_mode = 'vendor' and v_group.vendor_ship_status in ('pending_admin','not_required','rejected')
       and p_status in ('handed_to_carrier','out_for_delivery','delivered') then
      return jsonb_build_object('ok', false, 'reason',
        case when v_group.vendor_ship_status = 'pending_admin' then 'awaiting_admin_approval' else 'vendor_ship_not_approved' end);
    end if;
    if p_status = 'cancelled' then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if not (
      (v_group.status = 'pending' and p_status = 'preparing')
      or (v_group.status = 'preparing' and p_status = 'handed_to_carrier')
      or (v_group.status = 'handed_to_carrier' and p_status = 'out_for_delivery')
      or (v_group.status = 'out_for_delivery' and p_status = 'delivered')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition',
        'from', v_group.status, 'to', p_status);
    end if;
  end if;
  if v_group.status in ('delivered', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'group_closed');
  end if;
  if p_status <> 'cancelled' and v_order.status = 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'payment_pending');
  end if;
  if p_status = 'cancelled' and not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  update public.order_vendor_groups set
    status = p_status,
    shipped_at = case when p_status = 'handed_to_carrier' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when p_status = 'cancelled' then left(trim(coalesce(p_note, '')), 500) else cancel_reason end
    where id = p_group_id;

  insert into public.order_status_history (order_id, group_id, status, note, actor)
  values (v_order.id, p_group_id, p_status, left(coalesce(p_note, ''), 500), v_uid);

  -- pickup fee exactly once at ship time (any actor; idempotent)
  if p_status = 'handed_to_carrier' then
    v_pickup := public.fn_post_pickup_fee(p_group_id);
    if not coalesce((v_pickup->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'pickup_failed', 'detail', v_pickup->>'reason');
    end if;
  end if;

  -- earnings (pending) post when the group is delivered
  if p_status = 'delivered' then
    perform public.fn_post_earnings(p_group_id);
  end if;

  if p_status = 'cancelled' then
    -- group cancellation restores its stock (US-09: other groups continue)
    for r in select variant_id, qty from public.order_items where group_id = p_group_id loop
      update public.variants set stock = stock + r.qty where id = r.variant_id;
    end loop;
  end if;

  select bool_and(g.status = 'delivered'), bool_and(g.status = 'cancelled')
    into v_all_delivered, v_all_cancelled
    from public.order_vendor_groups g where g.order_id = v_order.id;

  if v_all_delivered then
    update public.orders set status = 'completed', delivered_at = coalesce(delivered_at, now()), updated_at = now()
      where id = v_order.id and status <> 'completed';
    update public.orders set delivered_at = now() where id = v_order.id and delivered_at is null;
    -- customer notification (bilingual payload, F-17 shape)
    perform public.fn_notify(v_order.user_id, 'order_completed', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم تسليم طلبك', 'body', 'طلب ' || v_order.number || ' اكتمل — نشكرك!'),
      'en', jsonb_build_object('title', 'Order delivered', 'body', 'Order ' || v_order.number || ' is complete — thank you!'),
      'link', '/ar/account/orders/' || v_order.number));
  elsif v_all_cancelled then
    update public.orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id;
  end if;

  if p_status = 'delivered' then
    perform public.fn_notify(v_order.user_id, 'order_delivered', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم التسليم', 'body', 'تم تسليم جزء من طلب ' || v_order.number),
      'en', jsonb_build_object('title', 'Delivered', 'body', 'Part of your order ' || v_order.number || ' was delivered'),
      'link', '/ar/account/orders/' || v_order.number));
  end if;

  return jsonb_build_object('ok', true);
end $function$;

-- fn_vendor_event_opt: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_vendor_event_opt(p_event_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendor uuid := public.own_vendor_id();
  v_event  public.events;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
  if v_vendor is null then
    return jsonb_build_object('ok', false, 'reason', 'no_vendor');
  end if;
  if p_status not in ('accepted', 'refused') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- No changing your mind after the event ended.
  if v_event.ends_at is not null and v_event.ends_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'event_ended');
  end if;

  -- event_vendors has no responded_at column; the audit row below records when.
  insert into public.event_vendors (event_id, vendor_id, status)
  values (p_event_id, v_vendor, p_status)
  on conflict (event_id, vendor_id)
  do update set status = excluded.status;

  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (auth.uid(), 'vendor.event.' || p_status, 'event_vendors',
          p_event_id::text, jsonb_build_object('vendor_id', v_vendor, 'status', p_status));

  return jsonb_build_object('ok', true, 'status', p_status);
end $function$;

-- fn_vendor_set_featured: suspended stores refused
CREATE OR REPLACE FUNCTION public.fn_vendor_set_featured(p_product_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_vendor uuid := public.own_vendor_id(); v_slots integer; v_used integer;
begin
  -- a suspended store can look but not act (enforced here, not only in the UI)
  perform public.fn_assert_my_store_operational();
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

-- withdrawals of a suspended store cannot be approved
CREATE OR REPLACE FUNCTION public.fn_admin_withdrawal_decision(p_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_w withdrawal_requests%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_decision not in ('approve','cancel') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  select * into v_w from public.withdrawal_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_decision = 'approve' and exists (select 1 from public.vendors where id = v_w.vendor_id and status = 'suspended') then
    return jsonb_build_object('ok', false, 'reason', 'vendor_suspended');
  end if;
  if v_w.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if p_decision = 'approve' then
    update public.withdrawal_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), paid_at = now()
     where id = p_id;
  else
    update public.withdrawal_requests
       set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now(),
           cancel_reason = left(coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'admin_cancelled'), 300)
     where id = p_id;
    if not exists (select 1 from public.wallet_transactions
                   where vendor_id = v_w.vendor_id and type = 'withdrawal_refund'
                     and reference = 'withdrawal:' || p_id::text) then
      insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
      values (v_w.vendor_id, 'withdrawal_refund', v_w.amount_piastres, 'withdrawal:' || p_id::text,
              'Withdrawal cancelled by admin — hold restored', auth.uid());
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $function$;

commit;
