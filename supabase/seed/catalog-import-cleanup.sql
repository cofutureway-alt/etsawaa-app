-- One-time, after the first catalog-import.sql run (2026-11-03).
-- The 76 placeholder areas from 20261031000004_seed_geography.sql: 63 were
-- adopted by the import (the owner's master list); these 13 are not in it
-- (one, Sharm El Sheikh, sat under Red Sea instead of South Sinai). They are
-- deactivated — not deleted — so the admin can restore any of them from
-- Zones. Not part of the re-runnable import on purpose: a re-run must never
-- touch areas an admin adds later.
update public.areas a
   set is_active = false
 where a.is_active
   and a.pickup_fee_piastres = 0
   and a.name_ar in ('وسط البلد','فيصل','السويس البلد','دمياط مدينة','الأقصر مدينة','6 أكتوبر',
                     'أسيوط مدينة','المنيا مدينة','العلامين','الداخلة','الفيوم مدينة','قنا مدينة','شرم الشيخ');
