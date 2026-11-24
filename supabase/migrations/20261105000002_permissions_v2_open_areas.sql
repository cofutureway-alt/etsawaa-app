-- Permissions v2 (part 2): open the admin areas to staff by permission.
-- Every listed RLS policy / RPC had a hard `is_admin()`; it is rewritten in
-- place to `has_permission('<key>')` (has_permission is true for admins, so
-- admins keep full access). Anything NOT listed stays admin-only on purpose:
-- settings/commissions, roles, email templates & provider, imports/staging,
-- slug redirects, contact inbox, earnings release, legal publishing helpers.

do $mig$
declare
  r record;
  v_expr text;
  v_using text;
  v_check text;
  v_sql text;
  -- table.policy → replacement expression
  pol jsonb := '{    "orders.orders_select_own": "public.has_permission(''orders.view'')",
    "order_items.items_select_reader": "public.has_permission(''orders.view'')",
    "order_documents.documents_select_reader": "public.has_permission(''orders.view'')",
    "order_notes.notes_select_reader": "public.has_permission(''orders.view'')",
    "order_status_history.history_select_reader": "public.has_permission(''orders.view'')",
    "order_vendor_groups.groups_select_reader": "public.has_permission(''orders.view'')",
    "payments.payments_select_reader": "public.has_permission(''orders.view'')",
    "order_sequences.order_sequences_admin": "public.has_permission(''orders.view'')",
    "refund_requests.refund_requests_select_reader": "(public.has_permission(''refunds.view'') or public.has_permission(''orders.view''))",
    "refund_request_items.refund_items_select_reader": "(public.has_permission(''refunds.view'') or public.has_permission(''orders.view''))",
    "refund_events.refund_events_read": "(public.has_permission(''refunds.view'') or public.has_permission(''orders.view''))",
    "packaging_balances.packaging_balances_read": "public.has_permission(''packaging.view'')",
    "packaging_events.packaging_events_read": "public.has_permission(''packaging.view'')",
    "packaging_items.packaging_items_admin_insert": "public.has_permission(''packaging.manage'')",
    "packaging_items.packaging_items_admin_update": "public.has_permission(''packaging.manage'')",
    "packaging_items.packaging_items_read": "public.has_permission(''packaging.view'')",
    "packaging_order_items.packaging_order_items_read": "public.has_permission(''packaging.view'')",
    "packaging_orders.packaging_orders_read": "public.has_permission(''packaging.view'')",
    "packaging_payments.packaging_payments_read": "public.has_permission(''packaging.view'')",
    "packaging_return_items.packaging_return_items_read": "public.has_permission(''packaging.view'')",
    "packaging_returns.packaging_returns_read": "public.has_permission(''packaging.view'')",
    "vendors.vendors_select_admin": "(public.has_permission(''vendors.view'') or public.has_permission(''orders.view'') or public.has_permission(''products.view''))",
    "vendor_documents.vendor_documents_admin_read": "public.has_permission(''vendors.view'')",
    "objects.documents_admin_read": "public.has_permission(''vendors.view'')",
    "vendor_status_history.vendor_status_history_read": "public.has_permission(''vendors.view'')",
    "vendor_level_history.level_history_admin_read": "public.has_permission(''vendors.view'')",
    "store_members.store_members_select_own": "public.has_permission(''vendors.view'')",
    "vendor_change_requests.vcr_read": "(public.has_permission(''vendors.view'') or public.has_permission(''store_changes.review''))",
    "legal_acceptances.legal_acceptances_read": "(public.has_permission(''users.view'') or public.has_permission(''vendors.view''))",
    "vendor_penalties.penalties_vendor_read": "(public.has_permission(''vendors.view'') or public.has_permission(''penalties.manage''))",
    "penalty_rules.penalty_rules_admin_all": "public.has_permission(''penalties.manage'')",
    "wallets.wallets_vendor_read": "(public.has_permission(''withdrawals.view'') or public.has_permission(''vendors.view''))",
    "wallet_transactions.wallet_tx_vendor_read": "(public.has_permission(''withdrawals.view'') or public.has_permission(''vendors.view''))",
    "withdrawal_requests.withdrawals_vendor_read": "public.has_permission(''withdrawals.view'')",
    "pickup_charges.pickup_charges_read": "(public.has_permission(''withdrawals.view'') or public.has_permission(''vendors.view''))",
    "products.products_select_admin": "(public.has_permission(''products.view'') or public.has_permission(''orders.view''))",
    "reviews.reviews_admin_all": "public.has_permission(''reviews.moderate'')",
    "coupons.coupons_admin_all": "public.has_permission(''coupons.manage'')",
    "coupon_scopes.coupon_scopes_admin_all": "public.has_permission(''coupons.manage'')",
    "coupon_redemptions.coupon_redemptions_admin_read": "public.has_permission(''coupons.manage'')",
    "ad_campaigns.ad_campaigns_admin_all": "public.has_permission(''ads.manage'')",
    "ad_packages.ad_packages_admin_all": "public.has_permission(''ads.manage'')",
    "events.events_admin_all": "public.has_permission(''events.manage'')",
    "event_discounts.event_discounts_admin_all": "public.has_permission(''events.manage'')",
    "event_vendors.event_vendors_admin_all": "public.has_permission(''events.manage'')",
    "banners.banners_write_admin": "public.has_permission(''banners.manage'')",
    "categories.categories_read_admin": "public.has_permission(''catalog.manage'')",
    "categories.categories_write_admin": "public.has_permission(''catalog.manage'')",
    "brands.brands_read_admin": "public.has_permission(''catalog.manage'')",
    "brands.brands_write_admin": "public.has_permission(''catalog.manage'')",
    "tags.tags_read_admin": "public.has_permission(''catalog.manage'')",
    "tags.tags_write_admin": "public.has_permission(''catalog.manage'')",
    "attribute_defs.attribute_defs_read": "public.has_permission(''catalog.manage'')",
    "attribute_defs.attribute_defs_write_admin": "public.has_permission(''catalog.manage'')",
    "attribute_options.attribute_options_read": "public.has_permission(''catalog.manage'')",
    "attribute_options.attribute_options_write_admin": "public.has_permission(''catalog.manage'')",
    "category_attributes.category_attributes_write_admin": "public.has_permission(''catalog.manage'')",
    "size_types.size_types_admin": "public.has_permission(''catalog.manage'')",
    "size_type_categories.size_type_categories_admin": "public.has_permission(''catalog.manage'')",
    "vendor_levels.vendor_levels_write_admin": "public.has_permission(''levels.manage'')",
    "level_rewards.level_rewards_admin_write": "public.has_permission(''levels.manage'')",
    "level_reward_grants.level_reward_grants_read": "(public.has_permission(''levels.manage'') or public.has_permission(''vendors.view''))",
    "badges.badges_admin_write": "public.has_permission(''badges.manage'')",
    "badges.badges_read": "public.has_permission(''badges.manage'')",
    "achievement_goals.achievement_goals_admin_write": "public.has_permission(''badges.manage'')",
    "blog_posts.blog_posts_admin_all": "public.has_permission(''blog.manage'')",
    "blog_posts.blog_posts_read": "public.has_permission(''blog.manage'')",
    "blog_categories.blog_categories_admin_all": "public.has_permission(''blog.manage'')",
    "static_pages.static_pages_admin_write": "public.has_permission(''pages.manage'')",
    "audit_logs.audit_read_admin": "public.has_permission(''logs.view'')",
    "areas.areas_write_admin": "public.has_permission(''zones.manage'')",
    "governorates.governorates_write_admin": "public.has_permission(''zones.manage'')"
  }'::jsonb;
  -- function name → replacement expression (all overloads)
  fns jsonb := '{
    "fn_admin_bulk_order_status": "public.has_permission(''orders.edit'')",
    "fn_admin_set_order_status": "public.has_permission(''orders.edit'')",
    "fn_update_group_status": "public.has_permission(''orders.edit'')",
    "fn_set_cod_collected": "public.has_permission(''orders.edit'')",
    "fn_cancel_order_admin": "public.has_permission(''orders.approve'')",
    "fn_log_document": "public.has_permission(''orders.view'')",
    "fn_approve_vendor_shipping": "public.has_permission(''shipping.manage'')",
    "fn_request_vendor_shipping": "public.has_permission(''shipping.manage'')",
    "fn_admin_order_refundables": "public.has_permission(''refunds.view'')",
    "fn_admin_create_return": "public.has_permission(''refunds.manage'')",
    "fn_admin_decide_refund": "public.has_permission(''refunds.manage'')",
    "fn_admin_execute_refund": "public.has_permission(''refunds.manage'')",
    "fn_admin_return_received": "public.has_permission(''refunds.manage'')",
    "fn_admin_packaging_order_action": "public.has_permission(''packaging.manage'')",
    "fn_admin_packaging_record_payment": "public.has_permission(''packaging.manage'')",
    "fn_admin_packaging_return_action": "public.has_permission(''packaging.manage'')",
    "fn_admin_create_packaging_return": "public.has_permission(''packaging.manage'')",
    "fn_admin_delete_packaging_item": "public.has_permission(''packaging.manage'')",
    "fn_admin_vendor_overview": "public.has_permission(''vendors.view'')",
    "fn_admin_customer_overview": "public.has_permission(''users.view'')",
    "fn_admin_review_vendor": "public.has_permission(''vendors.review'')",
    "fn_admin_verify_vendor": "public.has_permission(''vendors.verify'')",
    "fn_admin_review_document": "public.has_permission(''vendors.verify'')",
    "fn_admin_set_verification": "public.has_permission(''vendors.verify'')",
    "fn_admin_suspend_vendor": "public.has_permission(''vendors.suspend'')",
    "fn_admin_reinstate_vendor": "public.has_permission(''vendors.suspend'')",
    "fn_ban_vendor": "public.has_permission(''vendors.suspend'')",
    "fn_hide_vendor_listings": "public.has_permission(''vendors.suspend'')",
    "fn_admin_set_vendor_hidden": "public.has_permission(''vendors.suspend'')",
    "fn_guard_store_settings": "public.has_permission(''vendors.edit'')",
    "fn_admin_decide_store_change": "public.has_permission(''store_changes.review'')",
    "fn_admin_withdrawal_decision": "public.has_permission(''withdrawals.manage'')",
    "fn_cancel_withdrawal": "public.has_permission(''withdrawals.manage'')",
    "fn_admin_adjust_wallet": "public.has_permission(''withdrawals.manage'')",
    "fn_admin_apply_penalty": "public.has_permission(''penalties.manage'')",
    "fn_admin_waive_penalty": "public.has_permission(''penalties.manage'')",
    "fn_admin_decide_product": "public.has_permission(''products.review'')",
    "fn_admin_review_product": "public.has_permission(''products.review'')",
    "fn_admin_archive_product": "public.has_permission(''products.edit'')",
    "fn_admin_hide_product": "public.has_permission(''products.edit'')",
    "fn_clone_product": "public.has_permission(''products.edit'')",
    "fn_products_guard_privileged": "public.has_permission(''products.edit'')",
    "product_owned_or_admin": "public.has_permission(''products.edit'')",
    "fn_admin_leaf_page": "public.has_permission(''catalog.manage'')",
    "fn_admin_review_template": "public.has_permission(''catalog.manage'')",
    "fn_attribute_usage": "public.has_permission(''catalog.manage'')",
    "fn_attribute_option_usage": "public.has_permission(''catalog.manage'')",
    "fn_admin_grant_ad": "public.has_permission(''ads.manage'')",
    "fn_event_set_vendor": "public.has_permission(''events.manage'')",
    "fn_promote_vendor_level": "public.has_permission(''levels.manage'')",
    "fn_admin_save_achievement": "public.has_permission(''badges.manage'')",
    "fn_admin_evaluate_achievements": "public.has_permission(''badges.manage'')",
    "fn_admin_publish_legal": "public.has_permission(''legal.manage'')",
    "fn_admin_import_areas": "public.has_permission(''zones.manage'')"
  }'::jsonb;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and pol ? (tablename || '.' || policyname)
  loop
    v_expr := pol ->> (r.tablename || '.' || r.policyname);
    v_using := regexp_replace(coalesce(r.qual, ''), '(public\.)?is_admin\(\)', v_expr, 'g');
    v_check := regexp_replace(coalesce(r.with_check, ''), '(public\.)?is_admin\(\)', v_expr, 'g');
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
    if r.with_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;

  for r in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and fns ? p.proname
       and p.prosrc ~ 'is_admin\(\)'
  loop
    v_sql := regexp_replace(pg_get_functiondef(r.oid), '(public\.)?is_admin\(\)', fns ->> r.proname, 'g');
    execute v_sql;
  end loop;
end
$mig$;
