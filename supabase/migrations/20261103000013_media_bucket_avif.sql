-- ============================================================================
-- Media bucket: allow image/avif.
--
-- 20261103000012_security_hardening.sql gave the `media` bucket a MIME
-- allowlist, but the admin media settings screen (admin/media-settings.tsx)
-- also offers image/avif. With it enabled there, validateUpload() accepted an
-- AVIF upload and Storage then refused it. The bucket list must be a superset
-- of every type the settings screen can enable.
--
-- Re-running is safe (absolute set).
-- ============================================================================
begin;

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
         'video/mp4', 'video/webm', 'video/quicktime',
         'application/pdf']
 where id = 'media';

commit;
