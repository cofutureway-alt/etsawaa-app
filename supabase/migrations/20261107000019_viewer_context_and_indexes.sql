-- Round-trip consolidation (2026-11-07)
--
-- 1. fn_viewer_context(): everything a page needs about the signed-in person
--    in ONE call. Before, every panel request ran in sequence
--      profiles → fn_legal_status → fn_my_permissions → vendors →
--      products(count) → vendors(suspension) → notifications
--    (and the page loader repeated the first three). The app resolves this
--    once per request and shares it between the layout and the page.
--    SECURITY INVOKER: every part is read under the caller's own RLS (the
--    helper functions it calls are themselves definer functions).
-- 2. Indexes for foreign keys that are filtered or joined on hot paths, or
--    whose parent rows are deleted (cascades scanned the whole child table).

create or replace function public.fn_viewer_context()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select id, full_name, role, status, locale, phone, phone_alternate, avatar_url
      from public.profiles
     where id = auth.uid()
  ),
  shop as (
    select v.id, v.slug, v.store_name_ar, v.store_name_en, v.short_desc_ar, v.short_desc_en,
           v.welcome_msg_ar, v.welcome_msg_en, v.logo_path, v.banner_path, v.category_ids,
           v.first_name, v.last_name, v.phone, v.governorate_id, v.area_id, v.address1, v.address2,
           v.postal_code, v.socials, v.status, v.rejection_reason, v.verification_status,
           v.verification_note, v.grace_until, v.onboarding_step, v.terms_version,
           v.terms_accepted_at, v.terms_signature, v.suspension_reason,
           (select count(*)::int from public.products pr
             where pr.vendor_id = v.id and pr.status = 'rejected'
               and pr.rejected_final = false and pr.deleted_at is null) as needs_changes
      from public.vendors v
     where v.owner_id = auth.uid()
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'profile', (select to_jsonb(me) from me),
    'legal', public.fn_legal_status(),
    'permissions', case when (select role from me) in ('admin', 'staff')
                        then coalesce(public.fn_my_permissions() -> 'permissions', '[]'::jsonb)
                        else '[]'::jsonb end,
    'vendor', (select to_jsonb(shop) from shop),
    'unread', (select count(*)::int from public.notifications n where n.user_id = auth.uid() and n.read_at is null)
  ) end
$$;

revoke all on function public.fn_viewer_context() from public, anon;
grant execute on function public.fn_viewer_context() to authenticated, service_role;

-- 2. indexes ---------------------------------------------------------------
create index if not exists reviews_customer_product_idx        on public.reviews (customer_id, product_id);
create index if not exists wishlist_items_product_idx           on public.wishlist_items (product_id);
create index if not exists recently_viewed_product_idx          on public.recently_viewed (product_id);
create index if not exists cart_items_product_idx               on public.cart_items (product_id);
create index if not exists cart_items_variant_idx               on public.cart_items (variant_id);
create index if not exists product_attribute_values_attr_idx    on public.product_attribute_values (attribute_id);
create index if not exists product_attribute_values_option_idx  on public.product_attribute_values (option_id) where option_id is not null;
create index if not exists product_facets_option_idx            on public.product_facets (option_id);
create index if not exists category_attributes_attr_idx         on public.category_attributes (attribute_id);
create index if not exists contact_messages_user_idx            on public.contact_messages (user_id) where user_id is not null;
create index if not exists coupon_redemptions_user_idx          on public.coupon_redemptions (user_id);
create index if not exists event_vendors_vendor_idx             on public.event_vendors (vendor_id);
create index if not exists order_documents_vendor_idx           on public.order_documents (vendor_id);
create index if not exists order_notes_group_idx                on public.order_notes (group_id) where group_id is not null;
create index if not exists refund_request_items_group_idx       on public.refund_request_items (group_id);
create index if not exists ad_campaigns_product_idx             on public.ad_campaigns (product_id);
create index if not exists blog_posts_category_idx              on public.blog_posts (category_id);
create index if not exists media_folders_parent_idx             on public.media_folders (parent_id);
create index if not exists packaging_returns_vendor_idx         on public.packaging_returns (vendor_id);
create index if not exists packaging_order_items_item_idx       on public.packaging_order_items (item_id);
create index if not exists packaging_return_items_oi_idx        on public.packaging_return_items (order_item_id);
create index if not exists products_vendor_status_idx           on public.products (vendor_id, status) where deleted_at is null;
