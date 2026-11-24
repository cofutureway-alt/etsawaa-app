-- Ad banners are made by the platform (owner 2026-11-16): the vendor buys a
-- banner package and pays; the order waits "in review"; the admin picks the
-- banner — an image uploaded now or a banner already in the banners system —
-- and its section (hero, between home sections, bottom, a category page),
-- then approves. The vendor no longer uploads an image or picks a spot.

update public.ad_placements set needs_image = false where kind = 'banner';
update public.ad_placements set desc_ar = desc_ar || ' فريق المنصة بيجهّز البانر ويحدد مكانه بعد الدفع.',
       desc_en = desc_en || ' The platform team prepares the banner and places it after payment.'
 where kind = 'banner' and desc_ar not like '%فريق المنصة%';

-- placing: a banner slot needs no image, spot or category from the vendor
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef('public.fn_vendor_place_ad_order'::regproc) into v_src;
  if position('banner slots are filled by the admin' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    'if v_place.code in (''category_banner'', ''category_featured'')',
    'if v_place.code = ''category_featured''  -- banner slots are filled by the admin');
  v_new := replace(v_new,
    'if v_place.code = ''home_spot'' and coalesce(v_a->>''spot'', '''') not in',
    'if v_place.code = ''home_spot'' and coalesce(v_a->>''spot'', '''') <> '''' and coalesce(v_a->>''spot'', '''') not in');
  if v_new = v_src or position('<> '''' and coalesce' in v_new) = 0 then
    raise exception 'fn_vendor_place_ad_order changed shape; patch not applied';
  end if;
  execute v_new;
end $$;

-- approving: the admin's banner for every banner slot
-- p_banners: one entry per assignment (same order), for banner slots:
--   { "banner_id": uuid }                       → reuse a banner from the banners system
--   { "image_path": "...", "link_url": "..." }  → a new banner from this image
--   + "placement": hero | after_* | bottom | category, "category_id" (for category)
drop function if exists public.fn_admin_decide_ad_order(uuid, text, text, text);
create or replace function public.fn_admin_decide_ad_order(p_order_id uuid, p_decision text, p_reason text default null,
  p_refund_method text default 'wallet', p_banners jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.ad_orders%rowtype; v_days int; v_a jsonb; v_place public.ad_placements%rowtype;
  v_banner uuid; v_camp uuid; v_owner uuid; v_pos int := 0; v_details jsonb; v_method text; v_wr uuid;
  v_name text; v_limit int; v_b jsonb; v_bplace text; v_bcat uuid; v_img text; v_link text; v_store_ar text; v_store_en text;
begin
  if not (public.is_admin() or public.has_permission('ads.manage')) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_order from public.ad_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_order.status <> 'in_review' then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
  select owner_id, store_name_ar, store_name_en into v_owner, v_store_ar, v_store_en from public.vendors where id = v_order.vendor_id;
  v_name := coalesce(v_order.package_snapshot->>'name_ar', '');

  if p_decision = 'approve' then
    v_days := greatest(1, coalesce((v_order.package_snapshot->>'duration_days')::int, 7));
    v_limit := nullif((v_order.package_snapshot->>'impressions_included')::int, 0);
    for v_a in select * from jsonb_array_elements(v_order.assignments) loop
      v_pos := v_pos + 1;
      select * into v_place from public.ad_placements where code = v_a->>'placement';
      continue when v_place.code is null or v_place.kind = 'service';
      v_banner := null; v_img := nullif(v_a->>'image_path', ''); v_link := nullif(v_a->>'link_url', '');
      v_bplace := null; v_bcat := nullif(v_a->>'category_id', '')::uuid;
      if v_place.kind = 'banner' then
        v_b := coalesce(p_banners -> (v_pos - 1), '{}'::jsonb);
        v_bplace := coalesce(nullif(v_b->>'placement', ''),
          case v_place.code when 'home_hero' then 'hero' when 'category_banner' then 'category' else nullif(v_a->>'spot', '') end);
        if v_bplace is null or v_bplace not in ('hero', 'after_brands', 'after_categories', 'after_best', 'after_best_selling',
             'after_top_rated', 'after_vendors', 'after_recent', 'bottom', 'category') then
          raise exception 'banner_placement_required' using errcode = 'P0001';
        end if;
        v_bcat := case when v_bplace = 'category' then coalesce(nullif(v_b->>'category_id', '')::uuid, v_bcat) end;
        if v_bplace = 'category' and (v_bcat is null or not exists (select 1 from public.categories c where c.id = v_bcat and c.deleted_at is null)) then
          raise exception 'banner_category_required' using errcode = 'P0001';
        end if;
        if nullif(v_b->>'banner_id', '') is not null then
          update public.banners set placement = v_bplace, category_id = v_bcat, vendor_id = v_order.vendor_id, is_active = true,
                 starts_at = now(), ends_at = now() + make_interval(days => v_days),
                 link_url = coalesce(nullif(v_b->>'link_url', ''), link_url)
           where id = (v_b->>'banner_id')::uuid
          returning id, image_path, link_url into v_banner, v_img, v_link;
          if v_banner is null then raise exception 'banner_not_found' using errcode = 'P0001'; end if;
        else
          v_img := nullif(v_b->>'image_path', '');
          if v_img is null or v_img !~ '^(u/[0-9a-fA-F-]{36}|banners)/[A-Za-z0-9._-]+$' then
            raise exception 'banner_image_required' using errcode = 'P0001';
          end if;
          v_link := coalesce(nullif(v_b->>'link_url', ''), v_link, '');
          insert into public.banners (title_ar, title_en, image_path, link_url, position, is_active, starts_at, ends_at, placement, vendor_id, category_id)
          values (coalesce(nullif(v_b->>'title', ''), v_store_ar, ''), coalesce(nullif(v_b->>'title', ''), v_store_en, v_store_ar, ''),
                  v_img, v_link, 100 + v_pos, true, now(), now() + make_interval(days => v_days), v_bplace, v_order.vendor_id, v_bcat)
          returning id into v_banner;
        end if;
      end if;
      insert into public.ad_campaigns (package_id, vendor_id, product_id, source, status, started_at, ends_at, order_id, placement,
          section, spot, category_id, template, image_path, link_url, position, impressions_limit, banner_id, granted_by)
      values (v_order.package_id, v_order.vendor_id, nullif(v_a->>'product_id', '')::uuid, 'paid', 'active', now(),
          now() + make_interval(days => v_days), v_order.id, v_place.code, nullif(v_a->>'section', ''),
          coalesce(v_bplace, nullif(v_a->>'spot', '')), v_bcat, nullif(v_a->>'template', ''), v_img, v_link,
          coalesce((v_a->>'position')::int, v_pos), case when v_place.kind = 'product_page' then v_limit end, v_banner, auth.uid())
      returning id into v_camp;
    end loop;
    update public.ad_orders set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           starts_at = now(), ends_at = now() + make_interval(days => v_days) where id = v_order.id;
    perform public.fn_notify(v_owner, 'ad_order_approved', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تمت الموافقة على إعلانك ' || v_order.number, 'body', 'إعلانك يظهر الآن لمدة ' || v_days || ' يوم'),
      'en', jsonb_build_object('title', 'Your ad ' || v_order.number || ' is approved', 'body', 'It is live now for ' || v_days || ' days'),
      'link', '/vendor/ads'));
  elsif p_decision = 'reject' then
    if coalesce(trim(p_reason), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    if p_refund_method not in ('wallet', 'withdrawal') then return jsonb_build_object('ok', false, 'reason', 'bad_refund_method'); end if;
    update public.ad_orders set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = trim(p_reason)
     where id = v_order.id;
    if v_order.payment_status = 'paid' and v_order.amount_piastres > 0 then
      perform public.fn_post_transaction(v_order.vendor_id, 'ad_refund', v_order.amount_piastres, 'ad-refund:' || v_order.number,
        'Refund of rejected ad order ' || v_order.number, null, null, jsonb_build_object('ad_order', v_order.id));
      if p_refund_method = 'withdrawal' then
        select method, details into v_method, v_details from public.withdrawal_requests
         where vendor_id = v_order.vendor_id and kind = 'withdrawal' order by created_at desc limit 1;
        insert into public.withdrawal_requests (vendor_id, amount_piastres, method, details, requested_by, kind, reference)
        values (v_order.vendor_id, v_order.amount_piastres, coalesce(v_method, 'wallet'), coalesce(v_details, '{}'::jsonb), auth.uid(),
                'ad_refund', v_order.number)
        returning id into v_wr;
        insert into public.wallet_transactions (vendor_id, type, amount_piastres, reference, reason, created_by)
        values (v_order.vendor_id, 'withdrawal', -v_order.amount_piastres, 'withdrawal:' || v_wr::text,
                'Ad refund paid out (' || v_order.number || ')', auth.uid());
      end if;
      update public.ad_orders set payment_status = 'refunded', refund_method = p_refund_method, refunded_at = now() where id = v_order.id;
    end if;
    perform public.fn_notify(v_owner, 'ad_order_rejected', jsonb_build_object(
      'ar', jsonb_build_object('title', 'تم رفض طلب الإعلان ' || v_order.number, 'body', trim(p_reason) ||
            case when v_order.payment_status = 'paid' then case when p_refund_method = 'wallet' then ' — تم رد المبلغ لمحفظتك' else ' — سيُحوَّل المبلغ لوسيلة السحب الخاصة بك' end else '' end),
      'en', jsonb_build_object('title', 'Ad order ' || v_order.number || ' rejected', 'body', trim(p_reason) ||
            case when v_order.payment_status = 'paid' then case when p_refund_method = 'wallet' then ' — refunded to your wallet' else ' — the amount will be paid to your payout method' end else '' end),
      'link', '/vendor/ads'));
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  perform public.fn_audit('ads.order_' || p_decision, 'ad_orders', v_order.id::text, null,
    jsonb_build_object('number', v_order.number, 'reason', p_reason, 'refund', p_refund_method));
  return jsonb_build_object('ok', true);
exception when sqlstate 'P0001' then
  -- nothing above is kept: the order stays in review
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;
revoke all on function public.fn_admin_decide_ad_order(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_admin_decide_ad_order(uuid, text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
