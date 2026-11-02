-- ============================================================================
-- Etsawaa — Phase 01 seeds (F-07)
-- 27 governorates + areas scaffold + 4 roles + default settings + welcome mail
-- Apply: supabase db reset (runs migrations then this file)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Roles (RBAC matrix; matches app/lib/permissions.ts DEFAULT_STAFF_PERMISSIONS)
-- ----------------------------------------------------------------------------
insert into public.roles (slug, name_ar, name_en, permissions, is_system) values
  ('admin',    'مدير',        'Admin',        '["*"]'::jsonb, true),
  ('staff',    'موظف',        'Staff',        '["users.read","products.read","orders.read","settings.read"]'::jsonb, true),
  ('vendor',   'بائع',        'Vendor',       '[]'::jsonb, false),
  ('customer', 'عميل',        'Customer',     '[]'::jsonb, false)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- The 27 governorates of Egypt + default shipping fee (5,000 piastres = 50 EGP)
-- ----------------------------------------------------------------------------
insert into public.governorates (id, name_ar, name_en, shipping_fee_piastres, sort) values
  (1,  'القاهرة',        'Cairo',          5000, 1),
  (2,  'الجيزة',         'Giza',           5000, 2),
  (3,  'الإسكندرية',     'Alexandria',     5000, 3),
  (4,  'القليوبية',      'Qalyubia',       5000, 4),
  (5,  'بورسعيد',        'Port Said',      5000, 5),
  (6,  'السويس',         'Suez',           5000, 6),
  (7,  'دمياط',          'Damietta',       5000, 7),
  (8,  'الدقهلية',       'Dakahlia',       5000, 8),
  (9,  'الشرقية',        'Sharqia',        5000, 9),
  (10, 'المنوفية',       'Monufia',        5000, 10),
  (11, 'الغربية',        'Gharbia',        5000, 11),
  (12, 'كفر الشيخ',      'Kafr El Sheikh', 5000, 12),
  (13, 'البحيرة',        'Beheira',        5000, 13),
  (14, 'الإسماعيلية',    'Ismailia',       5000, 14),
  (15, 'بني سويف',       'Beni Suef',      5000, 15),
  (16, 'الفيوم',         'Faiyum',         5000, 16),
  (17, 'المنيا',         'Minya',          5000, 17),
  (18, 'أسيوط',          'Asyut',          5000, 18),
  (19, 'سوهاج',          'Sohag',          5000, 19),
  (20, 'قنا',            'Qena',           5000, 20),
  (21, 'الأقصر',         'Luxor',          5000, 21),
  (22, 'أسوان',          'Aswan',          5000, 22),
  (23, 'البحر الأحمر',   'Red Sea',        5000, 23),
  (24, 'مطروح',          'Matrouh',        5000, 24),
  (25, 'الوادي الجديد',  'New Valley',     5000, 25),
  (26, 'شمال سيناء',     'North Sinai',    5000, 26),
  (27, 'جنوب سيناء',     'South Sinai',    5000, 27)
on conflict (id) do nothing;

-- Areas scaffold: one generic area per governorate (real pickup-rate rows to
-- be filled per area from the admin shipping settings in phase 05).
insert into public.areas (governorate_id, name_ar, name_en, pickup_fee_piastres, sort)
select g.id, 'منطقة عامة', 'General Area', 0, 1
from public.governorates g
where not exists (select 1 from public.areas a where a.governorate_id = g.id);

-- ----------------------------------------------------------------------------
-- Default settings (site identity + design tokens = defaults of tokens.css)
-- ----------------------------------------------------------------------------
insert into public.settings (key, value) values
  (
    'site.general',
    '{
      "site_name_ar": "اتسوء",
      "site_name_en": "Etsawaa",
      "tagline_ar": "سوقك المصري متعدد البائعين",
      "tagline_en": "Egypt''s multi-vendor marketplace",
      "default_locale": "ar",
      "timezone": "Africa/Cairo",
      "cod_max_total_piastres": 500000,
      "default_hold_days": 14
    }'::jsonb
  ),
  (
    'settings.design',
    '{
      "primary": "#F30609",
      "action": "#BE0404",
      "actionHover": "#8D0504",
      "ink": "#510504"
    }'::jsonb
  )
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Welcome email template (F-18) — flat inline styles, no emoji, bilingual
-- ----------------------------------------------------------------------------
insert into public.email_templates (key, subject_ar, subject_en, html_ar, html_en, variables) values
  (
    'welcome',
    'أهلًا بك في {{site_name}}',
    'Welcome to {{site_name}}',
    '<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#FAFAFA;font-family:Tahoma,Arial,sans-serif;color:#1F2937;"><div style="max-width:560px;margin:0 auto;padding:32px 16px;"><div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:32px;"><h1 style="margin:0 0 8px;font-size:20px;color:#BE0404;">أهلًا {{name}}،</h1><p style="margin:0 0 16px;font-size:14px;line-height:1.7;">حسابك في {{site_name}} جاهز الآن. تفضل بزيارة المتجر وابدأ التسوق.</p><a href="{{site_url}}" style="display:inline-block;background:#BE0404;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:8px;">زيارة المتجر</a></div><p style="margin:16px 0 0;font-size:12px;color:#6B7280;text-align:center;">&copy; {{site_name}} — جميع الحقوق محفوظة.</p></div></body></html>',
    '<!doctype html><html lang="en" dir="ltr"><body style="margin:0;background:#FAFAFA;font-family:Arial,sans-serif;color:#1F2937;"><div style="max-width:560px;margin:0 auto;padding:32px 16px;"><div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:32px;"><h1 style="margin:0 0 8px;font-size:20px;color:#BE0404;">Welcome, {{name}},</h1><p style="margin:0 0 16px;font-size:14px;line-height:1.7;">Your {{site_name}} account is ready. Visit the store and start exploring.</p><a href="{{site_url}}" style="display:inline-block;background:#BE0404;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:8px;">Visit the store</a></div><p style="margin:16px 0 0;font-size:12px;color:#6B7280;text-align:center;">&copy; {{site_name}} — All rights reserved.</p></div></body></html>',
    '["name","site_name","site_url"]'::jsonb
  )
on conflict (key) do nothing;
