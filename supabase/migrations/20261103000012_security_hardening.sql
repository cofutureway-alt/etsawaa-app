-- ============================================================================
-- Security hardening — server-authoritative coupon engine + storage MIME
-- allowlists.
--
-- 1) fn_apply_coupon: revoke the anon grant added by
--    20261103000001_fix_coupon_anon_and_fn_guards.sql. The guest coupon
--    preview (/api/coupon) now recomputes every line server-side
--    (priceCouponLines in app/features/checkout/pricing.server.ts) and calls
--    the RPC through the service client, so an anonymous caller no longer
--    needs — or gets — direct access to the discount engine. Combined with
--    the route change this closes the "unauthenticated coupon oracle with
--    client-trusted prices" gap: the percent discount can no longer be
--    inflated by invented unit_price_piastres / commission_bps values.
--    `authenticated` keeps execute: the signed-in checkout display quote
--    (loadCheckoutQuote) calls it with the user's own client.
--
-- 2) storage.buckets: add allowed_mime_types + explicit per-bucket size
--    limits. Until now any authenticated user could store ANY file type up
--    to 50 MB in the public `media` bucket. The app-level validateUpload()
--    guard (now enforced server-side) remains the fine-grained gate; the
--    bucket lists are the outer boundary. The media list includes the
--    video/pdf kinds admin media settings can enable (video/mp4, webm,
--    quicktime; application/pdf); the documents list matches customer
--    evidence uploads (images + pdf).
--
-- Re-running is safe (revoke is idempotent; updates are absolute sets).
-- ============================================================================
begin;

-- --------------------------------------------------------------------------
-- 1) Coupon engine — server callers only
-- --------------------------------------------------------------------------
revoke execute on function public.fn_apply_coupon(text, jsonb) from anon;
grant execute on function public.fn_apply_coupon(text, jsonb) to authenticated;

-- --------------------------------------------------------------------------
-- 2) Bucket MIME allowlists + size limits
-- --------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'video/mp4', 'video/webm', 'video/quicktime',
         'application/pdf'],
       file_size_limit = 52428800  -- 50 MB, outer cap; app settings are stricter
 where id = 'media';

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'application/pdf'],
       file_size_limit = 10485760  -- 10 MB (max_pdf_mb default)
 where id = 'documents';

commit;
