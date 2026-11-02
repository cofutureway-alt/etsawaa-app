# L-16/L-17/L-18 — Operations: Monitoring · Backups · Rollback · Launch checklist

الحالة: وثائق تشغيل جاهزة للتوقيع. كل ما هو "قبل المفاتيح" يُنفَّذ لحظة
تشغيل المفاتيح الحقيقية (integration gate أدناه) — لا mock data.

## L-16 — Monitoring (edge errors, webhook failures, cron failures → admin alerts)

### ما هو مُطبَّق فعلاً في الكود (verified)
- `email_logs`: كل إرسال/محاولة يُسجَّل (status: sent/failed/not_configured) —
  قوالب الإداريّة ترسل عبر Resend عند توفر `RESEND_API_KEY` وإلا `not_configured`
  بصدق (بدون نجاح مزيف).
- `payments`: كل webhook Kashier يُسجَّل مع الحالة (verification fail ≠ silent).
- `audit_logs`: كل فعل إداري مُسجَّل (FORCE RLS مفعّل — migration 20261101100005).
- `order_documents`: كل طباعة/إعادة طباعة تُسجَّل.
- Cron/Edge (Supabase scheduled functions): أي فشل يعيد non-2xx → يظهر في
  Supabase logs → القاعدة أدناه.

### قاعدة التنبيه (runbook)
| الإشارة | المصدر | العتبة | الفعل |
|---|---|---|---|
| فشل إرسال إيميل | `email_logs where status='failed'` | ≥3 خلال 10 دقائق | تنبيه admin + فحص Resend dashboard |
| `not_configured` متكرر | `email_logs` | أي صف بعد الإطلاق | مفاتيح غير مضبوطة — حاجب إطلاق |
| فشل webhook | `payments where status='failed'` | أي صف | فحص HMAC/merchantId فوراً |
| أخطاء 5xx | Supabase edge logs | ≥5/دقيقة | rollback (أدناه) |
| RLS probe | `scripts/rls-audit.mjs` (أسبوعي) | أي CRITICAL | تجميد الإطلاق |

اختبار التنبيه (تطوعي بعد ضبط مفاتيح Resend): إرسال test-send من محرر
القوالب بعنوان غير صالح → صف failed في `email_logs` = الإشارة تُولَّد.

## L-17 — Backups + restore drill + rollback + RTO/RPO

- Supabase PITR مفعّل على الخطة (daily base + WAL) — RPO ≤ 5 دقائق.
- دراسة الاستعادة (restore drill) قبل الإطلاق: استعادة نسخة إلى مشروع
  staging وتشغيل `npm test` + `scripts/rls-audit.mjs` عليه — تُسجَّل النتيجة.
- RTO مستهدف: ≤ 60 دقيقة (استعادة نقطة زمنية + redeploy).
- Runbook التراجع عن كود (rollback):
  1. `git checkout <previous-phase-tag>` على جهاز النشر و`npm run build`.
  2. الـmigrations تراكمية وآمنة (additive) — لا rollback قاعدة إلا في
     كارثة، وعندها PITR إلى اللحظة السابقة للحادثة.
  3. Kashier: تبديل `KASHIER_MODE` إلى `test` أثناء الحادثة لوقف التقاط
     مدفاقات جديدة دون رفض العملاء.
  4. إبلاغ: صفحة حالة + إيميل للمتأثرين (قالب `order_confirmation`على
     عنوان الدعم).
- تصدير أسبوعي يدوي احتياطي: نسخ CSV لجداول `orders/payments/wallets/
  wallet_transactions/withdrawal_requests` إلى تخزين مشفّر خارجي.

## L-18 — Launch checklist (تُوقَّع قبل بدء التشغيل)

| # | البند | الدليل | ✓ |
|---|---|---|---|
| 1 | الصفحات القانونية (about/terms/privacy/returns) منشورة بـAR+EN | evidence/phase-08/screens/static-*.png | ☐ |
| 2 | سياسة الاستبدال والاسترجاع مطابقة لـAGENT (بدون كلمة ضريبة) | scan أدناه | ☐ |
| 3 | مفاتيح Kashier **الحيّة** مضبوطة + webhook secret + txn حيّ تجريبي بمبلغ 1 قرش ثم استرجاع | integration proof | ☐ |
| 4 | نطاق البريد مُوثَّق (SPF/DKIM) في Resend + إرسال حي ناجح لثلاثة قوالب | email_logs success | ☐ |
| 5 | صندوق دعم يعمل (support@etsawaa.com يستقبل) | اختبار يدوي | ☐ |
| 6 | Google OAuth round-trip حي | integration proof | ☐ |
| 7 | sitemap.xml + robots.txt على النطاق النهائي (SITE_URL) | evidence/phase-08 tests B12–B17 | ☐ |
| 8 | خريطة الموقع تتضمن المنتجات/الفئات/المدونة المنشورة فقط | B15 | ☐ |
| 9 | RLS audit: 0 CRITICAL | rls-audit.json | ☐ |
| 10 | e2e كاملة ×2 (مسارات مختلفة md5) | tests-raw-run1/2.json | ☐ |
| 11 | Lighthouse ≥90 موبايل (home/product/category) | lighthouse-3x.json | ☐ |
| 12 | طباعة: A4+A5 على Chrome/Edge/Safari + مسح Code128 بجهاز حقيقي | print/ + توقيع المالك | ☐ |
| 13 | نسخ احتياطي PITR مفعّل + دراسة استعادة ناجحة | لوحة Supabase | ☐ |
| 14 | Seeds = migrations فقط (بدون بيانات تجريبية) — counts=0 في كل السويتات | pristine logs | ☐ |
| 15 | لا ZIP في المستودع + لا service_role في الكلاينت | scan | ☐ |
| 16 | موافقة صاحب المشروع النهائية | توقيع هذا الملف | ☐ |

**قاعدة صارمة:** لا بدء تشغيل حي قبل تعبئة كل خانات 1–16.

## Integration gate (قبل بند 3/4/6) — خطة التنفيذ اللحظي
1. ضبط `RESEND_API_KEY` + عنوان مُرسل مُوثَّق → تشغيل test-send من
   `/ar/admin/email-templates` لكل قالب → صفوف sent في `email_logs`.
2. `KASHIER_MODE=live` + مفاتيح حيّة + webhook URL في لوحة Kashier
   → طلب COD↔بطاقة بمبلغ أدنى → تحقق الـwebhook HMAC → صف payments paid.
3. Google OAuth: redirect URIs على النطاق النهائي → تسجيل دخول كامل.
