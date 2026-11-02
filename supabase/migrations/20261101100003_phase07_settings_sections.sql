-- ============================================================================
-- Etsawaa — Phase 07: settings coverage (all 15 sections from JOURNEYS §16.16)
-- Seeds the canonical key for every section with its default value so the
-- coverage matrix is verifiable with one query. Idempotent: never overwrites.
--   1 site.general · 2 general · 3 login · 4 vendors · 5 verification
--   6 financial · 7 withdrawals · 8 shipping (governorates/areas ROWS +
--   /admin/zones — no JSON blob, per-row audit) · 9 payments · 10 policies
--   11 emails · 12 seo · 13 settings.design · 14 media · 15 notifications
-- ============================================================================

insert into public.settings (key, value) values ('general', jsonb_build_object(
  'store_url_pattern', 'Store', 'single_seller', false,
  'show_customer_details', true, 'vendor_onboarding_mode', 'manual',
  'vendor_address_public', false, 'vendor_registration', true,
  'welcome_ar', '', 'welcome_en', '', 'force_onboarding', true,
  'terms_required', true))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('login', jsonb_build_object(
  'google', true, 'facebook', false, 'apple', false,
  'google_client_id', '', 'facebook_app_id', '', 'apple_client_id', ''))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('vendors', jsonb_build_object(
  'allow_status_change', true, 'allow_any_category', true,
  'product_review_required', true, 'allow_clone', true,
  'multi_category', true, 'allow_own_tags', true))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('verification', jsonb_build_object(
  'email_otp', true,
  'required_documents', jsonb_build_object(
     'id_front', true, 'id_back', true, 'commercial_register', false,
     'tax_card', false, 'residence', false),
  'grace_value', 7, 'grace_unit', 'days', 'after_grace', 'block_selling',
  'max_document_mb', 5, 'red_verified_badge', true))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('financial', jsonb_build_object(
  'default_commission_percent', 5, 'category_inheritance', true,
  'commission_on_discounted_price', true))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('withdrawals', jsonb_build_object(
  'methods', jsonb_build_array('wallet', 'bank', 'instapay'),
  'min_withdrawal_piastres', 5000, 'hold_days', 14,
  'eligible_status', 'completed', 'profit_definition', 'available'))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('payments', jsonb_build_object(
  'cod_enabled', true, 'cod_max_total_piastres', 500000,
  'cod_vendor_shipping_block', true, 'kashier_enabled', true,
  'kashier_merchant', '', 'kashier_key', ''))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('policies', jsonb_build_object(
  'terms_vendor', '', 'terms_customer', '', 'policy_privacy', ''))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('emails', jsonb_build_object(
  'provider', 'resend', 'smtp_host', '', 'smtp_port', 587,
  'smtp_user', '', 'from_name', 'Etsawaa'))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('seo', jsonb_build_object(
  'meta_title_ar', '', 'meta_title_en', '', 'meta_desc_ar', '',
  'meta_desc_en', '', 'robots_extra', '', 'sitemap_enabled', true))
on conflict (key) do nothing;

insert into public.settings (key, value) values ('notifications', jsonb_build_object(
  'inapp_enabled', true, 'email_enabled', true,
  'digest', 'instant', 'quiet_hours', '', 'admin_alert_email', ''))
on conflict (key) do nothing;
